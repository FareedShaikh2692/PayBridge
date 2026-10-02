import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { Tenant, TestApp, auth, balance, createBeneficiary, createPayment, createPlatformAdmin, createQuote, createTenant, createTestApp, expectLedgerSound, postPayment, setVelocityLimit } from './helpers';

/** Small deterministic PRNG so the randomised scenario is reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ledger invariants', () => {
  let t: TestApp;
  let platform: { token: string; userId: string };
  let acme: Tenant;

  beforeAll(async () => {
    t = await createTestApp();
    platform = await createPlatformAdmin(t);
    await setVelocityLimit(t, platform.token, 100000);
    acme = await createTenant(t, platform.token, { fund: '900000.00' });
  });
  afterAll(() => t.close());

  it('I1 + I2: after a randomised run of every outcome, each transaction balances and the trial balance is zero', async () => {
    const rnd = mulberry32(20261002);
    const names = ['Rahul Sharma', 'Priya Enterprises', 'Mumbai Supplies Pvt Ltd', 'Vendor TEST-FAIL', 'Vendor TEST-DUPLICATE-WEBHOOK', 'Vendor TEST-OUT-OF-ORDER'];
    const beneficiaries: string[] = [];
    for (const n of names) beneficiaries.push((await createBeneficiary(t, acme.maker, n)).id);

    const outcomes: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      // Awkward amounts on purpose: they exercise truncation and the residual margin.
      const amount = (100 + Math.floor(rnd() * 5_900_000) / 100).toFixed(2);
      const payment = await createPayment(t, acme, { amount, beneficiaryId: beneficiaries[Math.floor(rnd() * beneficiaries.length)] });
      const dice = rnd();
      if (payment.status === 'COMPLIANCE_REVIEW') {
        await t.http.post(`/api/v1/admin/compliance/${payment.id}/decision`).set(auth(platform.token)).send({ decision: dice < 0.5 ? 'CLEAR' : 'REJECT', reason: 'randomised scenario' }).expect(200);
        if (dice < 0.5) await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
      } else if (dice < 0.6) await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
      else if (dice < 0.75) await t.http.post(`/api/v1/payments/${payment.id}/reject`).set(auth(acme.approver)).send({ reason: 'randomised scenario' }).expect(200);
      else if (dice < 0.9) await t.http.post(`/api/v1/payments/${payment.id}/cancel`).set(auth(acme.maker)).send({}).expect(200);
      // else: left awaiting approval, with its hold in place
      if (rnd() < 0.5) await t.outbox.drainAll();
    }
    await t.outbox.drainAll();
    for (const p of await t.prisma.paymentOrder.findMany({ where: { companyId: acme.companyId } })) outcomes[p.status] = (outcomes[p.status] ?? 0) + 1;
    expect(Object.keys(outcomes).sort()).toEqual(expect.arrayContaining(['CANCELLED', 'CREATED', 'FAILED', 'PAID']));

    // I1: every transaction, per currency.
    const unbalanced = await t.prisma.$queryRaw<unknown[]>`
      SELECT transaction_id, currency FROM ledger_entries GROUP BY transaction_id, currency
      HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) <> 0`;
    expect(unbalanced).toEqual([]);
    expect(await t.prisma.ledgerTransaction.count()).toBeGreaterThan(60);
    // I2: global totals, and cached balances equal the sum of entries.
    await expectLedgerSound(t);

    // Hold account = total reserved by payments not yet captured or released.
    const open = await t.prisma.paymentOrder.aggregate({ where: { companyId: acme.companyId, status: { in: ['CREATED', 'COMPLIANCE_REVIEW', 'APPROVED'] } }, _sum: { totalDebitAmount: true } });
    expect((await balance(t, acme)).reserved).toBe((open._sum.totalDebitAmount ?? 0).toFixed(2));

    // Customer money is conserved: top-ups = wallet + hold + everything captured for payments that were paid.
    const paid = await t.prisma.paymentOrder.aggregate({ where: { companyId: acme.companyId, status: 'PAID' }, _sum: { totalDebitAmount: true } });
    const b = await balance(t, acme);
    expect((Number(b.available) + Number(b.reserved) + Number(paid._sum.totalDebitAmount ?? 0)).toFixed(2)).toBe('900000.00');

    const tb = (await t.http.get('/api/v1/admin/ledger/trial-balance').set(auth(platform.token)).expect(200)).body.data;
    expect(tb).toMatchObject({ balanced: true, unbalancedTransactions: [], cachedBalanceDrift: [] });
    expect(tb.currencies.map((c: any) => c.currency)).toEqual(['AED', 'INR']);
  });

  it('every terminal payment has released or consumed its hold exactly once', async () => {
    const terminal = await t.prisma.paymentOrder.findMany({ where: { status: { in: ['PAID', 'FAILED', 'CANCELLED'] } }, include: { ledgerTransactions: true } });
    for (const p of terminal) {
      const types = p.ledgerTransactions.map((x) => x.type).sort();
      const holds = types.filter((x) => x === 'PAYMENT_HOLD').length;
      const resolved = types.filter((x) => x === 'PAYMENT_HOLD_RELEASE' || x === 'PAYMENT_CAPTURE').length;
      expect([p.reference, holds, resolved]).toEqual([p.reference, holds, holds]); // 1/1, or 0/0 when rejected at creation
      expect(holds).toBeLessThanOrEqual(1);
    }
  });

  describe('immutability (enforced by the database)', () => {
    it.each(['ledger_entries', 'ledger_transactions', 'audit_logs', 'payment_status_history', 'compliance_checks'])('refuses UPDATE and DELETE on %s', async (table) => {
      const count = async () => Number((await t.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table}`))[0].n); // eslint-disable-line no-restricted-syntax
      const before = await count();
      expect(before).toBeGreaterThan(0);
      await expect(t.prisma.$executeRawUnsafe(`DELETE FROM ${table}`)).rejects.toThrow(/IMMUTABLE_RECORD/); // eslint-disable-line no-restricted-syntax
      await expect(t.prisma.$executeRawUnsafe(`UPDATE ${table} SET id = id`)).rejects.toThrow(/IMMUTABLE_RECORD/); // eslint-disable-line no-restricted-syntax
      expect(await count()).toBe(before);
    });

    it('offers no API to change or delete ledger or audit records', async () => {
      const tx = await t.prisma.ledgerTransaction.findFirstOrThrow();
      for (const path of [`/api/v1/ledger/transactions/${tx.id}`, '/api/v1/audit-logs', `/api/v1/audit-logs/${randomUUID()}`]) {
        expect([404, 405]).toContain((await t.http.delete(path).set(auth(platform.token))).status);
        expect([404, 405]).toContain((await t.http.patch(path).set(auth(platform.token)).send({})).status);
      }
    });
  });

  describe('double entry (enforced by the database at COMMIT)', () => {
    // A plain PostgreSQL connection: no application code, no ORM — only the database's own rules.
    const insertRaw = async (entries: [string, string, string][]) => {
      const wallet = await t.prisma.ledgerAccount.findFirstOrThrow({ where: { companyId: acme.companyId, code: '2000' } });
      const bank = await t.prisma.ledgerAccount.findFirstOrThrow({ where: { companyId: null, code: '1000' } });
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        const txId = randomUUID();
        await client.query('BEGIN');
        await client.query(`INSERT INTO ledger_transactions (id, posting_key, type, description) VALUES ($1, $2, 'WALLET_TOPUP', 'raw insert bypassing the service')`, [txId, `raw:${txId}`]);
        for (const [which, direction, amount] of entries) {
          await client.query(`INSERT INTO ledger_entries (id, transaction_id, account_id, direction, amount, currency, balance_after) VALUES (gen_random_uuid(), $1, $2, $3::"EntryDirection", $4::numeric, 'AED', 0)`, [txId, (which === 'wallet' ? wallet : bank).id, direction, amount]);
        }
        await client.query('COMMIT'); // the deferred balance trigger fires here
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        await client.end();
      }
    };

    it('rejects an unbalanced transaction even when the service is bypassed', async () => {
      const before = await t.prisma.ledgerTransaction.count();
      await expect(insertRaw([['bank', 'DEBIT', '100.00'], ['wallet', 'CREDIT', '99.99']])).rejects.toThrow(/LEDGER_IMBALANCE/);
      await expect(insertRaw([['bank', 'DEBIT', '100.00']])).rejects.toThrow(/LEDGER_IMBALANCE/);
      expect(await t.prisma.ledgerTransaction.count()).toBe(before); // rolled back whole
    });

    it('rejects zero, negative and sub-fils amounts, and a currency that differs from the account', async () => {
      await expect(insertRaw([['bank', 'DEBIT', '0'], ['wallet', 'CREDIT', '0']])).rejects.toThrow(/ledger_entries_amount_positive/);
      await expect(insertRaw([['bank', 'DEBIT', '-5'], ['wallet', 'CREDIT', '-5']])).rejects.toThrow(/ledger_entries_amount_positive/);
      await expect(insertRaw([['bank', 'DEBIT', '1.001'], ['wallet', 'CREDIT', '1.001']])).rejects.toThrow(/ledger_entries_amount_scale/);
      const wallet = await t.prisma.ledgerAccount.findFirstOrThrow({ where: { companyId: acme.companyId, code: '2000' } });
      const anyTx = await t.prisma.ledgerTransaction.findFirstOrThrow();
      await expect(
        t.prisma.$executeRaw`INSERT INTO ledger_entries (id, transaction_id, account_id, direction, amount, currency, balance_after) VALUES (gen_random_uuid(), ${anyTx.id}::uuid, ${wallet.id}::uuid, 'DEBIT', 10, 'INR', 0)`,
      ).rejects.toThrow(/foreign key/i);
    });

    it('a customer balance can never be negative, whatever writes it', async () => {
      await expect(t.prisma.$executeRaw`UPDATE ledger_accounts SET balance = -0.01 WHERE company_id = ${acme.companyId}::uuid AND code = '2000'`).rejects.toThrow(/ledger_accounts_customer_non_negative/);
    });
  });

  describe('posting', () => {
    it('is idempotent by posting key', async () => {
      const ledger = t.app.get(LedgerService);
      const key = `test:${randomUUID()}`;
      const post = () =>
        t.prisma.$transaction((tx) => ledger.post(tx, { postingKey: key, type: 'WALLET_TOPUP', description: 'idempotent', companyId: acme.companyId, entries: [{ account: 'SAFEGUARDING_BANK_AED', direction: 'DEBIT', amount: '10.00', currency: 'AED' }, { account: 'CUSTOMER_WALLET_AED', direction: 'CREDIT', amount: '10.00', currency: 'AED' }] }));
      const before = await balance(t, acme);
      const first = await post();
      const second = await post();
      expect(second.id).toBe(first.id);
      expect(await t.prisma.ledgerTransaction.count({ where: { postingKey: key } })).toBe(1);
      expect((Number((await balance(t, acme)).available) - Number(before.available)).toFixed(2)).toBe('10.00');
    });

    it('a top-up with an Idempotency-Key is applied once', async () => {
      const key = randomUUID();
      const before = await balance(t, acme);
      const first = (await t.http.post('/api/v1/sandbox/wallet/topup').set(auth(acme.admin)).set('Idempotency-Key', key).send({ amount: '250.50' }).expect(200)).body.data;
      const second = (await t.http.post('/api/v1/sandbox/wallet/topup').set(auth(acme.admin)).set('Idempotency-Key', key).send({ amount: '250.50' }).expect(200)).body.data;
      expect(second.transactionId).toBe(first.transactionId);
      expect((Number((await balance(t, acme)).available) - Number(before.available)).toFixed(2)).toBe('250.50');
      await t.http.post('/api/v1/sandbox/wallet/topup').set(auth(acme.admin)).send({ amount: '0' }).expect(422);
      await t.http.post('/api/v1/sandbox/wallet/topup').set(auth(acme.admin)).send({ amount: '12.345' }).expect(400);
      await t.http.post('/api/v1/sandbox/wallet/topup').set(auth(acme.admin)).send({ amount: 100 }).expect(400); // numbers are not accepted for money
    });

    it('records the running balance on every entry and exposes a statement', async () => {
      const wallet = await t.prisma.ledgerAccount.findFirstOrThrow({ where: { companyId: acme.companyId, code: '2000' } });
      const statement = (await t.http.get(`/api/v1/ledger/accounts/${wallet.id}?pageSize=5`).set(auth(acme.admin)).expect(200)).body.data;
      expect(statement.account).toMatchObject({ code: '2000', type: 'LIABILITY', normalBalance: 'CREDIT', currency: 'AED' });
      expect(statement.entries[0].balanceAfter).toBe(statement.account.balance); // newest entry carries the current balance
      expect(statement.entries).toHaveLength(5);
    });

    it('money on the wire is always a fixed-scale string', async () => {
      const b = await createBeneficiary(t, acme.maker, 'Wire Format Check');
      const q = await createQuote(t, acme.maker, '1234.50');
      const p = (await postPayment(t, acme.maker, { quoteId: q.id, beneficiaryId: b.id }).expect(201)).body.data;
      for (const field of ['sourceAmount', 'destinationAmount', 'feeAmount', 'totalDebitAmount']) expect([field, p[field]]).toEqual([field, expect.stringMatching(/^\d+\.\d{2}$/)]);
      expect(p.exchangeRate).toMatch(/^\d+\.\d{6}$/);
      expect(p).toMatchObject({ sourceAmount: '1234.50', destinationAmount: '27883.03', totalDebitAmount: '1259.50' }); // 1234.50 × 22.5865 = 27883.03425 → truncated
    });
  });
});
