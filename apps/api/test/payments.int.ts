import { randomUUID } from 'node:crypto';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { Tenant, TestApp, auth, balance, createBeneficiary, createPlatformAdmin, createQuote, createTenant, createTestApp, expectLedgerSound, postPayment, setVelocityLimit } from './helpers';

describe('payment creation invariants', () => {
  let t: TestApp;
  let platform: { token: string; userId: string };
  let acme: Tenant;
  let beneficiaryId: string;

  beforeAll(async () => {
    t = await createTestApp();
    platform = await createPlatformAdmin(t);
    await setVelocityLimit(t, platform.token, 100000);
    acme = await createTenant(t, platform.token, { fund: '1000000.00' });
    beneficiaryId = (await createBeneficiary(t, acme.maker)).id;
  });
  afterAll(() => t.close());
  afterEach(() => t.clock.reset());

  describe('I3: no payment can use an expired quote', () => {
    it('accepts a quote at 59 s and refuses it from 60 s onward', async () => {
      const fresh = await createQuote(t, acme.maker);
      t.clock.advance(59_000);
      await postPayment(t, acme.maker, { quoteId: fresh.id, beneficiaryId }).expect(201);
      t.clock.reset();

      const atBoundary = await createQuote(t, acme.maker);
      t.clock.advance(60_000);
      const res = await postPayment(t, acme.maker, { quoteId: atBoundary.id, beneficiaryId }).expect(409);
      expect(res.body.error).toMatchObject({ code: 'QUOTE_EXPIRED', message: 'The FX quote has expired.' });
      t.clock.reset();

      const late = await createQuote(t, acme.maker);
      t.clock.advance(61_000);
      await postPayment(t, acme.maker, { quoteId: late.id, beneficiaryId }).expect(409);
      const view = (await t.http.get(`/api/v1/fx/quotes/${late.id}`).set(auth(acme.maker)).expect(200)).body.data;
      expect(view).toMatchObject({ status: 'EXPIRED', secondsRemaining: 0 });
      expect(await t.prisma.paymentOrder.count({ where: { quoteId: { in: [atBoundary.id, late.id] } } })).toBe(0);
    });

    it('enforces expiry by timestamp even while the stored status still says ACTIVE, and the sweep then tidies it', async () => {
      const quote = await createQuote(t, acme.maker);
      t.clock.advance(120_000);
      expect((await t.prisma.fxQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('ACTIVE'); // no job has run
      await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId }).expect(409);
      const { FxService } = await import('../src/modules/fx/fx.service');
      expect(await t.app.get(FxService).sweepExpired()).toBeGreaterThanOrEqual(1);
      expect((await t.prisma.fxQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('EXPIRED');
    });
  });

  describe('I4: no quote can be used twice', () => {
    it('refuses sequential reuse', async () => {
      const quote = await createQuote(t, acme.maker);
      await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId }).expect(201);
      const res = await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId }).expect(409);
      expect(res.body.error.code).toBe('QUOTE_ALREADY_USED');
    });

    it('twenty concurrent payments on one quote: exactly one succeeds, one payment row, one hold', async () => {
      const quote = await createQuote(t, acme.maker);
      const results = await Promise.all(Array.from({ length: 20 }, () => postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409 && r.body.error.code === 'QUOTE_ALREADY_USED')).toHaveLength(19);
      const payments = await t.prisma.paymentOrder.findMany({ where: { quoteId: quote.id } });
      expect(payments).toHaveLength(1);
      expect(await t.prisma.ledgerTransaction.count({ where: { paymentId: payments[0].id, type: 'PAYMENT_HOLD' } })).toBe(1);
      expect(await t.prisma.idempotencyKey.count({ where: { resourceId: payments[0].id } })).toBe(1);
    });

    it('the database refuses a second payment on the same quote and any change to a quote\'s price', async () => {
      const quote = await createQuote(t, acme.maker);
      await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId }).expect(201);
      await expect(t.prisma.$executeRaw`INSERT INTO payment_orders (id, reference, company_id, beneficiary_id, quote_id, source_currency, source_amount, destination_currency, destination_amount, fee_amount, fx_margin_amount, total_debit_amount, exchange_rate, status, compliance_status, approval_status, idempotency_key, created_by, updated_at)
        SELECT gen_random_uuid(), 'PB-DUP', company_id, beneficiary_id, quote_id, source_currency, source_amount, destination_currency, destination_amount, fee_amount, fx_margin_amount, total_debit_amount, exchange_rate, status, compliance_status, approval_status, 'another-key', created_by, now() FROM payment_orders WHERE quote_id = ${quote.id}::uuid`).rejects.toThrow(/unique/i);
      await expect(t.prisma.$executeRaw`UPDATE fx_quotes SET customer_rate = 99 WHERE id = ${quote.id}::uuid`).rejects.toThrow(/IMMUTABLE_RECORD/);
      await expect(t.prisma.$executeRaw`UPDATE fx_quotes SET base_amount = 1, total_debit_amount = 26 WHERE id = ${quote.id}::uuid`).rejects.toThrow(/IMMUTABLE_RECORD/);
      await expect(t.prisma.$executeRaw`UPDATE fx_quotes SET status = 'ACTIVE' WHERE id = ${quote.id}::uuid`).rejects.toThrow(/INVALID_STATE_TRANSITION/);
      await expect(t.prisma.$executeRaw`UPDATE payment_orders SET source_amount = 1, total_debit_amount = 26 WHERE quote_id = ${quote.id}::uuid`).rejects.toThrow(/IMMUTABLE_RECORD/);
      // There is no API to modify a quote at all.
      await t.http.patch(`/api/v1/fx/quotes/${quote.id}`).set(auth(acme.maker)).send({ baseAmount: '1.00' }).expect(404);
    });
  });

  describe('I7: a duplicate Idempotency-Key does not create another payment', () => {
    it('replays the original payment for the same key and body', async () => {
      const quote = await createQuote(t, acme.maker);
      const key = randomUUID();
      const before = await balance(t, acme);
      const first = await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId, purpose: 'INV-7' }, key).expect(201);
      const second = await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId, purpose: 'INV-7' }, key).expect(201);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(await t.prisma.paymentOrder.count({ where: { idempotencyKey: key } })).toBe(1);
      expect(await t.prisma.ledgerTransaction.count({ where: { paymentId: first.body.data.id } })).toBe(1);
      const after = await balance(t, acme);
      expect(Number(before.available) - Number(after.available)).toBeCloseTo(10025, 2); // debited once
    });

    it('ten concurrent requests with one key create one payment and all receive it', async () => {
      const quote = await createQuote(t, acme.maker);
      const key = randomUUID();
      const results = await Promise.all(Array.from({ length: 10 }, () => postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId }, key)));
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
      expect(await t.prisma.paymentOrder.count({ where: { idempotencyKey: key } })).toBe(1);
      expect(await t.prisma.ledgerTransaction.count({ where: { paymentId: results[0].body.data.id, type: 'PAYMENT_HOLD' } })).toBe(1);
    });

    it('refuses the same key with a different body, a missing key and a malformed key', async () => {
      const q1 = await createQuote(t, acme.maker);
      const q2 = await createQuote(t, acme.maker);
      const key = randomUUID();
      await postPayment(t, acme.maker, { quoteId: q1.id, beneficiaryId }, key).expect(201);
      const conflict = await postPayment(t, acme.maker, { quoteId: q2.id, beneficiaryId }, key).expect(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect((await t.prisma.fxQuote.findUniqueOrThrow({ where: { id: q2.id } })).status).toBe('ACTIVE');

      const missing = await t.http.post('/api/v1/payments').set(auth(acme.maker)).send({ quoteId: q2.id, beneficiaryId }).expect(400);
      expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      await postPayment(t, acme.maker, { quoteId: q2.id, beneficiaryId }, 'has spaces and $ymbols').expect(400);
    });

    it('a failed attempt releases the key so the client can retry', async () => {
      const quote = await createQuote(t, acme.maker);
      const key = randomUUID();
      const blocked = await createBeneficiary(t, acme.maker, 'TEST-SANCTION Co');
      await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId: blocked.id }, key).expect(422);
      expect(await t.prisma.idempotencyKey.count({ where: { key } })).toBe(0);
    });
  });

  describe('funds', () => {
    it('refuses a payment the wallet cannot cover and leaves no trace', async () => {
      const poor = await createTenant(t, platform.token, { fund: '5000.00' });
      const b = await createBeneficiary(t, poor.maker);
      const quote = await createQuote(t, poor.maker, '10000.00');
      const key = randomUUID();
      const res = await postPayment(t, poor.maker, { quoteId: quote.id, beneficiaryId: b.id }, key).expect(422);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
      expect(await t.prisma.paymentOrder.count({ where: { companyId: poor.companyId } })).toBe(0);
      expect(await t.prisma.idempotencyKey.count({ where: { companyId: poor.companyId } })).toBe(0);
      expect((await t.prisma.fxQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('ACTIVE');
      expect(await balance(t, poor)).toMatchObject({ available: '5000.00', reserved: '0.00' });
      // The fee counts: 4,980 + 25 > 5,000.
      const edge = await createQuote(t, poor.maker, '4980.00');
      await postPayment(t, poor.maker, { quoteId: edge.id, beneficiaryId: b.id }).expect(422);
      const fits = await createQuote(t, poor.maker, '4975.00');
      await postPayment(t, poor.maker, { quoteId: fits.id, beneficiaryId: b.id }).expect(201);
      expect(await balance(t, poor)).toMatchObject({ available: '0.00', reserved: '5000.00' });
    });

    it('forty concurrent payments that together exceed the balance never overdraw the wallet', async () => {
      const tenant = await createTenant(t, platform.token, { fund: '100000.00', makerChecker: false });
      const b = await createBeneficiary(t, tenant.maker);
      const quotes = [];
      for (let i = 0; i < 40; i++) quotes.push(await createQuote(t, tenant.maker, '10000.00'));
      const results = await Promise.all(quotes.map((q) => postPayment(t, tenant.maker, { quoteId: q.id, beneficiaryId: b.id })));
      const ok = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status === 422 && r.body.error.code === 'INSUFFICIENT_FUNDS');
      expect(ok).toHaveLength(9); // 9 × 10,025 = 90,225 ≤ 100,000 < 10 × 10,025
      expect(refused).toHaveLength(31);
      const wallet = await t.prisma.ledgerAccount.findFirstOrThrow({ where: { companyId: tenant.companyId, code: '2000' } });
      expect(wallet.balance.toFixed(2)).toBe('9775.00');
      expect(await t.prisma.fxQuote.count({ where: { companyId: tenant.companyId, status: 'USED' } })).toBe(9);
      await t.outbox.drainAll();
      await expectLedgerSound(t);
    });
  });

  describe('validation and atomicity', () => {
    it('takes every amount from the quote; a client amount is only an assertion', async () => {
      const quote = await createQuote(t, acme.maker, '10000.00');
      const mismatch = await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId, sourceAmount: '1.00' }).expect(422);
      expect(mismatch.body.error.code).toBe('AMOUNT_MISMATCH');
      await t.http.post('/api/v1/payments').set(auth(acme.maker)).set('Idempotency-Key', randomUUID()).send({ quoteId: quote.id, beneficiaryId, destinationAmount: '99999999.00' }).expect(400);
      const ok = (await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId, sourceAmount: '10000.00' }).expect(201)).body.data;
      expect(ok).toMatchObject({ sourceAmount: '10000.00', destinationAmount: '225865.00', feeAmount: '25.00', exchangeRate: '22.586500' });
    });

    it('requires approved KYB, an active beneficiary and an existing quote', async () => {
      const pending = await createTenant(t, platform.token, { approved: false });
      const noKyb = await t.http.post('/api/v1/fx/quotes').set(auth(pending.maker)).send({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '1000.00' }).expect(403);
      expect(noKyb.body.error.code).toBe('KYB_NOT_APPROVED');
      await postPayment(t, pending.maker, { quoteId: randomUUID(), beneficiaryId: randomUUID() }).expect(403);
      await t.http.post('/api/v1/sandbox/wallet/topup').set(auth(pending.admin)).send({ amount: '100.00' }).expect(403);

      const quote = await createQuote(t, acme.maker);
      const inactive = await createBeneficiary(t, acme.maker, 'Dormant Supplier');
      await t.http.patch(`/api/v1/beneficiaries/${inactive.id}`).set(auth(acme.maker)).send({ status: 'INACTIVE' }).expect(200);
      expect((await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId: inactive.id }).expect(422)).body.error.code).toBe('BENEFICIARY_NOT_ACTIVE');
      expect((await postPayment(t, acme.maker, { quoteId: randomUUID(), beneficiaryId }).expect(404)).body.error.code).toBe('QUOTE_NOT_FOUND');
      expect((await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId: randomUUID() }).expect(404)).body.error.code).toBe('BENEFICIARY_NOT_FOUND');
    });

    it('a ledger failure mid-transaction rolls back everything, and the same key then succeeds', async () => {
      const quote = await createQuote(t, acme.maker);
      const key = randomUUID();
      const before = await balance(t, acme);
      const counts = async () => [await t.prisma.paymentOrder.count(), await t.prisma.paymentStatusHistory.count(), await t.prisma.complianceCheck.count(), await t.prisma.approvalRequest.count(), await t.prisma.ledgerTransaction.count(), await t.prisma.outboxEvent.count()];
      const snapshot = await counts();

      const spy = jest.spyOn(t.app.get(LedgerService), 'post').mockRejectedValueOnce(new Error('simulated ledger outage'));
      const res = await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId }, key).expect(500);
      spy.mockRestore();
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
      expect(JSON.stringify(res.body)).not.toContain('simulated ledger outage'); // internals never leak

      expect(await counts()).toEqual(snapshot);
      expect((await t.prisma.fxQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('ACTIVE');
      expect(await t.prisma.idempotencyKey.count({ where: { key } })).toBe(0);
      expect(await balance(t, acme)).toMatchObject(before);

      await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId }, key).expect(201);
    });

    it('an unbalanced posting is refused by the service with LEDGER_IMBALANCE', async () => {
      const ledger = t.app.get(LedgerService);
      await expect(
        t.prisma.$transaction((tx) =>
          ledger.post(tx, {
            postingKey: `test:${randomUUID()}`, type: 'WALLET_TOPUP', description: 'unbalanced', companyId: acme.companyId,
            entries: [{ account: 'SAFEGUARDING_BANK_AED', direction: 'DEBIT', amount: '100.00', currency: 'AED' }, { account: 'CUSTOMER_WALLET_AED', direction: 'CREDIT', amount: '99.99', currency: 'AED' }],
          }),
        ),
      ).rejects.toMatchObject({ code: 'LEDGER_IMBALANCE', status: 500 });
    });
  });

  it('lists with filtering, sorting and pagination', async () => {
    const all = await t.http.get('/api/v1/payments?pageSize=100&sort=sourceAmount:asc').set(auth(acme.viewer)).expect(200);
    expect(all.body.meta.total).toBe(all.body.data.length);
    const awaiting = (await t.http.get('/api/v1/payments?awaitingApproval=true&pageSize=100').set(auth(acme.approver)).expect(200)).body.data;
    expect(awaiting.length).toBeGreaterThan(0);
    expect(awaiting.every((p: any) => p.approvalStatus === 'PENDING' && p.displayStatus === 'Awaiting approval')).toBe(true);
    const page = await t.http.get('/api/v1/payments?page=2&pageSize=2&status=CREATED').set(auth(acme.viewer)).expect(200);
    expect(page.body.data.length).toBeLessThanOrEqual(2);
    expect(page.body.meta).toMatchObject({ page: 2, pageSize: 2 });
    const none = (await t.http.get('/api/v1/payments?minAmount=999999.00').set(auth(acme.viewer)).expect(200)).body.data;
    expect(none).toEqual([]);
  });
});
