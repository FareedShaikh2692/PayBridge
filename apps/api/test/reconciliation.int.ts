import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ProviderSubmissionService } from '../src/modules/provider/provider';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { Tenant, TestApp, auth, createPayment, createPlatformAdmin, createTenant, createTestApp, setVelocityLimit } from './helpers';

describe('reconciliation', () => {
  let t: TestApp;
  let platform: { token: string; userId: string };
  let acme: Tenant;
  let recon: ReconciliationService;

  beforeAll(async () => {
    t = await createTestApp();
    platform = await createPlatformAdmin(t);
    await setVelocityLimit(t, platform.token, 100000);
    acme = await createTenant(t, platform.token);
    recon = t.app.get(ReconciliationService);
  });
  afterAll(() => t.close());
  afterEach(() => t.clock.reset());

  /** A fresh payment that has completed cleanly. */
  const paidPayment = async (name?: string) => {
    const p = await createPayment(t, acme, { beneficiaryName: name });
    await t.http.post(`/api/v1/payments/${p.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    await t.outbox.drainAll();
    return p;
  };
  /** Captured and submitted, but no webhook has been delivered yet. */
  const processingPayment = async () => {
    const p = await createPayment(t, acme);
    await t.http.post(`/api/v1/payments/${p.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    await t.app.get(PaymentsService).processApproved(p.id);
    await t.app.get(ProviderSubmissionService).submit(p.id);
    await t.prisma.outboxEvent.deleteMany({ where: { status: 'PENDING' } }); // the provider's webhooks are "lost"
    return p;
  };
  const itemFor = async (paymentId: string) => {
    const run = await recon.runNow(platform.userId);
    const report = await recon.report({ page: 1, pageSize: 100, runId: run.id, paymentId });
    return report.items[0];
  };
  /** Tampers with immutable rows the way a faulty migration or a rogue operator could: triggers off. */
  const tamper = async (sql: string, params: unknown[] = []) => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL session_replication_role = replica`);
      await client.query(sql, params);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  };

  it('a clean payment in every state reconciles as MATCHED', async () => {
    const paid = await paidPayment();
    const failed = await paidPayment('Vendor TEST-FAIL');
    const awaiting = await createPayment(t, acme);
    const cancelled = await createPayment(t, acme);
    await t.http.post(`/api/v1/payments/${cancelled.id}/cancel`).set(auth(acme.maker)).send({}).expect(200);
    const inFlight = await processingPayment();

    const run = await recon.runNow(platform.userId);
    const report = await recon.report({ page: 1, pageSize: 100, runId: run.id });
    const byId = new Map(report.items.map((i) => [i.paymentId, i]));
    for (const p of [paid, failed, awaiting, cancelled, inFlight]) expect([p.id, byId.get(p.id)?.status, byId.get(p.id)?.reasonCodes]).toEqual([p.id, 'MATCHED', []]);
    expect(run).toMatchObject({ status: 'COMPLETED', issueCount: 0, totalItems: 5, matchedCount: 5 });
    expect(report.items.find((i) => i.paymentId === paid.id)).toMatchObject({
      internal: { status: 'PAID', destinationAmount: '225865.00' },
      provider: { records: [{ status: 'PAID', amount: '225865.00', currency: 'INR' }] },
    });
    await t.outbox.drainAll();
  });

  it('PAID_BUT_PROVIDER_FAILED → MISMATCH', async () => {
    const p = await paidPayment();
    await t.prisma.providerPayment.updateMany({ where: { paymentId: p.id }, data: { status: 'FAILED' } });
    expect(await itemFor(p.id)).toMatchObject({ status: 'MISMATCH', reasonCodes: ['PAID_BUT_PROVIDER_FAILED'] });
  });

  it('STATUS_MISMATCH → MISMATCH', async () => {
    const p = await paidPayment();
    await t.prisma.providerPayment.updateMany({ where: { paymentId: p.id }, data: { status: 'PROCESSING' } });
    expect(await itemFor(p.id)).toMatchObject({ status: 'MISMATCH', reasonCodes: ['STATUS_MISMATCH'] });
  });

  it('AMOUNT_MISMATCH → MISMATCH (amount or currency)', async () => {
    const p = await paidPayment();
    await t.prisma.providerPayment.updateMany({ where: { paymentId: p.id }, data: { amount: '225864.99' } });
    expect(await itemFor(p.id)).toMatchObject({ status: 'MISMATCH', reasonCodes: ['AMOUNT_MISMATCH'] });
    const q = await paidPayment();
    await t.prisma.providerPayment.updateMany({ where: { paymentId: q.id }, data: { currency: 'AED' } });
    expect((await itemFor(q.id)).reasonCodes).toEqual(['AMOUNT_MISMATCH']);
  });

  it('DUPLICATE_PROVIDER_PAYMENT → DUPLICATE, which outranks other findings', async () => {
    const p = await paidPayment();
    const original = await t.prisma.providerPayment.findFirstOrThrow({ where: { paymentId: p.id } });
    await t.prisma.providerPayment.create({ data: { providerPaymentId: `pp_dup_${randomUUID().slice(0, 8)}`, paymentId: p.id, amount: original.amount, currency: 'INR', status: 'PAID' } });
    expect(await itemFor(p.id)).toMatchObject({ status: 'DUPLICATE', reasonCodes: ['DUPLICATE_PROVIDER_PAYMENT'] });
  });

  it('PROVIDER_PAYMENT_MISSING → MISSING', async () => {
    const p = await paidPayment();
    await t.prisma.providerPayment.deleteMany({ where: { paymentId: p.id } });
    expect(await itemFor(p.id)).toMatchObject({ status: 'MISSING', reasonCodes: ['PROVIDER_PAYMENT_MISSING'] });
  });

  it('INTERNAL_PAYMENT_MISSING → MISSING', async () => {
    const orphan = await t.prisma.providerPayment.create({ data: { providerPaymentId: `pp_orphan_${randomUUID().slice(0, 8)}`, paymentId: null, amount: '5000', currency: 'INR', status: 'PAID' } });
    const run = await recon.runNow(platform.userId);
    const report = await recon.report({ page: 1, pageSize: 100, runId: run.id, status: 'MISSING' });
    expect(report.items.find((i) => i.providerPaymentId === orphan.providerPaymentId)).toMatchObject({ status: 'MISSING', reasonCodes: ['INTERNAL_PAYMENT_MISSING'], paymentId: null });
    await t.prisma.providerPayment.delete({ where: { id: orphan.id } });
  });

  it('LEDGER_ENTRY_MISSING → MISSING', async () => {
    const p = await paidPayment();
    await tamper(`DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE payment_id = $1 AND type = 'PAYOUT_SETTLEMENT')`, [p.id]);
    await tamper(`DELETE FROM ledger_transactions WHERE payment_id = $1 AND type = 'PAYOUT_SETTLEMENT'`, [p.id]);
    const item = await itemFor(p.id);
    expect(item).toMatchObject({ status: 'MISSING', reasonCodes: ['LEDGER_ENTRY_MISSING'] });
    // Deleting entries also leaves the cached balance out of step, which the ledger-wide control reports.
    const run = await recon.runNow(platform.userId);
    const drift = (await recon.report({ page: 1, pageSize: 100, runId: run.id, status: 'MISMATCH' })).items.filter((i) => i.reasonCodes.includes('CACHED_BALANCE_DRIFT'));
    expect(drift.length).toBeGreaterThan(0);
    // Restore the caches so later cases start clean.
    await t.prisma.$executeRaw`UPDATE ledger_accounts a SET balance = COALESCE((SELECT SUM(CASE WHEN e.direction = a.normal_balance THEN e.amount ELSE -e.amount END) FROM ledger_entries e WHERE e.account_id = a.id), 0)`;
  });

  it('UNEXPECTED_LEDGER_POSTING and PROVIDER_PAID_INTERNAL_PROCESSING', async () => {
    const p = await paidPayment();
    await t.prisma.paymentOrder.update({ where: { id: p.id }, data: { status: 'PROCESSING' } }); // status rewound behind the ledger's back
    expect((await itemFor(p.id)).reasonCodes).toEqual(['UNEXPECTED_LEDGER_POSTING']); // provider PAID is within the grace period
    t.clock.advance(6 * 60_000);
    expect(await itemFor(p.id)).toMatchObject({ status: 'MISMATCH', reasonCodes: ['UNEXPECTED_LEDGER_POSTING', 'PROVIDER_PAID_INTERNAL_PROCESSING'] });
    await t.prisma.paymentOrder.update({ where: { id: p.id }, data: { status: 'PAID' } });
  });

  it('PROVIDER_PAID_INTERNAL_PROCESSING → REVIEW_REQUIRED only after the grace period', async () => {
    const p = await processingPayment();
    await t.prisma.providerPayment.updateMany({ where: { paymentId: p.id }, data: { status: 'PAID' } });
    expect(await itemFor(p.id)).toMatchObject({ status: 'MATCHED', reasonCodes: [] }); // the webhook may still be on its way
    t.clock.advance(6 * 60_000);
    expect(await itemFor(p.id)).toMatchObject({ status: 'REVIEW_REQUIRED', reasonCodes: ['PROVIDER_PAID_INTERNAL_PROCESSING'] });
    t.clock.advance(30 * 60_000);
    expect((await itemFor(p.id)).reasonCodes).toEqual(['PROVIDER_PAID_INTERNAL_PROCESSING', 'STUCK_IN_PROCESSING']);
  });

  it('STUCK_AWAITING_SUBMISSION → REVIEW_REQUIRED for a payment whose job never ran', async () => {
    const p = await createPayment(t, acme);
    await t.http.post(`/api/v1/payments/${p.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    await t.prisma.outboxEvent.deleteMany({ where: { aggregateId: p.id } }); // as if the job were dead-lettered
    expect((await itemFor(p.id)).status).toBe('MATCHED');
    t.clock.advance(31 * 60_000);
    expect(await itemFor(p.id)).toMatchObject({ status: 'REVIEW_REQUIRED', reasonCodes: ['STUCK_AWAITING_SUBMISSION'] });
    t.clock.reset();
    await t.http.post(`/api/v1/payments/${p.id}/cancel`).set(auth(acme.admin)).send({}).expect(200);
  });

  it('LEDGER_AMOUNT_MISMATCH, LEDGER_IMBALANCE and TRIAL_BALANCE_NONZERO when entries are tampered with', async () => {
    const p = await paidPayment();
    await tamper(`UPDATE ledger_entries SET amount = amount - 1 WHERE direction = 'CREDIT' AND currency = 'INR' AND transaction_id IN (SELECT id FROM ledger_transactions WHERE payment_id = $1 AND type = 'PAYMENT_CAPTURE')`, [p.id]);
    const run = await recon.runNow(platform.userId);
    const all = (await recon.report({ page: 1, pageSize: 100, runId: run.id })).items;
    expect(all.find((i) => i.paymentId === p.id)).toMatchObject({ status: 'MISMATCH', reasonCodes: expect.arrayContaining(['LEDGER_AMOUNT_MISMATCH', 'LEDGER_IMBALANCE']) });
    expect(all.find((i) => i.reasonCodes.includes('TRIAL_BALANCE_NONZERO'))).toMatchObject({ status: 'MISMATCH', currency: 'INR', ledger: { difference: '1.00' } });
    await tamper(`UPDATE ledger_entries SET amount = amount + 1 WHERE direction = 'CREDIT' AND currency = 'INR' AND transaction_id IN (SELECT id FROM ledger_transactions WHERE payment_id = $1 AND type = 'PAYMENT_CAPTURE')`, [p.id]);
    await t.prisma.$executeRaw`UPDATE ledger_accounts a SET balance = COALESCE((SELECT SUM(CASE WHEN e.direction = a.normal_balance THEN e.amount ELSE -e.amount END) FROM ledger_entries e WHERE e.account_id = a.id), 0)`;
  });

  it('HOLD_ACCOUNT_MISMATCH and CACHED_BALANCE_DRIFT when a balance is written directly', async () => {
    await t.prisma.$executeRaw`UPDATE ledger_accounts SET balance = balance + 123.45 WHERE company_id = ${acme.companyId}::uuid AND code = '2010'`;
    const run = await recon.runNow(platform.userId);
    const wide = (await recon.report({ page: 1, pageSize: 100, runId: run.id, companyId: acme.companyId, status: 'MISMATCH' })).items;
    expect(wide.map((i) => i.reasonCodes[0])).toEqual(expect.arrayContaining(['HOLD_ACCOUNT_MISMATCH']));
    const drift = (await recon.report({ page: 1, pageSize: 100, runId: run.id })).items.find((i) => i.reasonCodes.includes('CACHED_BALANCE_DRIFT'));
    expect(drift).toBeTruthy();
    await t.prisma.$executeRaw`UPDATE ledger_accounts SET balance = balance - 123.45 WHERE company_id = ${acme.companyId}::uuid AND code = '2010'`;
  });

  it('exposes the report over HTTP with filters, runs asynchronously, and is platform-only', async () => {
    const accepted = await t.http.post('/api/v1/reports/reconciliation/run').set(auth(platform.token)).send({}).expect(202);
    expect(accepted.body.data.status).toBe('RUNNING');
    await t.outbox.drainAll();
    const latest = (await t.http.get('/api/v1/reports/reconciliation').set(auth(platform.token)).expect(200)).body.data;
    expect(latest.run).toMatchObject({ id: accepted.body.data.id, status: 'COMPLETED' });
    expect(Object.keys(latest.summary)).toEqual(expect.arrayContaining(['MATCHED']));

    const filtered = (await t.http.get(`/api/v1/reports/reconciliation?status=MISMATCH&currency=AED&companyId=${acme.companyId}&pageSize=5`).set(auth(platform.token)).expect(200)).body.data;
    expect(filtered.items.every((i: any) => i.status === 'MISMATCH' && i.companyId === acme.companyId && i.currency === 'AED')).toBe(true);
    const byDate = (await t.http.get(`/api/v1/reports/reconciliation?date=${new Date().toISOString().slice(0, 10)}`).set(auth(platform.token)).expect(200)).body.data;
    expect(byDate.run.id).toBe(accepted.body.data.id);
    expect((await t.http.get('/api/v1/reports/reconciliation?date=2001-01-01').set(auth(platform.token)).expect(200)).body.data.run).toBeNull();
    await t.http.get('/api/v1/reports/reconciliation?status=NOT_A_STATUS').set(auth(platform.token)).expect(400);
    expect((await t.http.get('/api/v1/reports/reconciliation/runs').set(auth(platform.token)).expect(200)).body.data.length).toBeGreaterThan(5);

    await t.http.get('/api/v1/reports/reconciliation').set(auth(acme.admin)).expect(403);
    await t.http.post('/api/v1/reports/reconciliation/run').set(auth(acme.admin)).send({}).expect(403);
  });

  it('never modifies business data', async () => {
    const snapshot = async () => ({
      payments: await t.prisma.paymentOrder.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, version: true, updatedAt: true } }),
      ledger: await t.prisma.ledgerTransaction.count(),
      balances: await t.prisma.ledgerAccount.findMany({ orderBy: { id: 'asc' }, select: { id: true, balance: true, version: true } }),
      provider: await t.prisma.providerPayment.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, updatedAt: true } }),
    });
    const before = await snapshot();
    await recon.runNow(platform.userId);
    expect(await snapshot()).toEqual(before);
  });
});
