import { randomUUID } from 'node:crypto';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { Tenant, TestApp, auth, balance, createBeneficiary, createPayment, createPlatformAdmin, createQuote, createTenant, createTestApp, expectLedgerSound, getPayment, postPayment, setVelocityLimit, signedWebhook } from './helpers';

describe('payment lifecycle (API-level demo scenario)', () => {
  let t: TestApp;
  let platform: { token: string; userId: string };
  let acme: Tenant;

  beforeAll(async () => {
    t = await createTestApp();
    platform = await createPlatformAdmin(t);
    acme = await createTenant(t, platform.token, { name: 'Acme Trading LLC' });
    await setVelocityLimit(t, platform.token, 1000); // this suite sends many payments from one company
  });
  afterAll(() => t.close());

  it('runs the happy path end to end and reconciles as MATCHED', async () => {
    const beneficiary = await createBeneficiary(t, acme.maker, 'Rahul Sharma');
    expect(beneficiary.accountNumberMasked).toMatch(/^XXXXXX\d{4}$/);
    expect(JSON.stringify(beneficiary)).not.toContain('accountNumber"');

    const quote = await createQuote(t, acme.maker, '10000.00');
    expect(quote).toMatchObject({ customerRate: '22.586500', spreadPercentage: '0.5000', feeAmount: '25.00', recipientAmount: '225865.00', totalDebitAmount: '10025.00', status: 'ACTIVE', secondsRemaining: 60 });

    const created = (await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId: beneficiary.id, purpose: 'Invoice INV-1' }).expect(201)).body.data;
    expect(created).toMatchObject({ status: 'CREATED', complianceStatus: 'CLEAR', approvalStatus: 'PENDING', sourceAmount: '10000.00', destinationAmount: '225865.00', totalDebitAmount: '10025.00' });
    expect(await balance(t, acme)).toMatchObject({ available: '489975.00', reserved: '10025.00' });

    // Maker cannot approve at all; the approver can.
    await t.http.post(`/api/v1/payments/${created.id}/approve`).set(auth(acme.maker)).send({}).expect(403);
    const approved = (await t.http.post(`/api/v1/payments/${created.id}/approve`).set(auth(acme.approver)).send({ reason: 'Looks right' }).expect(200)).body.data;
    expect(approved.status).toBe('APPROVED');

    await t.outbox.drainAll(); // ProcessPayment → provider → webhooks → ProcessWebhooks

    const paid = await getPayment(t, acme.admin, created.id);
    expect(paid.status).toBe('PAID');
    expect(paid.providerPaymentId).toMatch(/^pp_/);
    expect(paid.timeline.map((h: any) => h.toStatus)).toEqual(['CREATED', 'APPROVED', 'PROCESSING', 'PAID']);
    expect(paid.ledgerTransactions.map((x: any) => x.type)).toEqual(['PAYMENT_HOLD', 'PAYMENT_CAPTURE', 'PAYOUT_SETTLEMENT']);
    expect(paid.ledgerTransactions.every((x: any) => x.balanced)).toBe(true);
    expect(paid.approval.actions).toHaveLength(1);
    expect(await balance(t, acme)).toMatchObject({ available: '489975.00', reserved: '0.00' });

    const accounts = (await t.http.get('/api/v1/ledger/accounts').set(auth(platform.token)).expect(200)).body.data;
    const bal = (code: string) => accounts.find((a: any) => a.code === code && a.scope === 'SYSTEM').balance;
    expect([bal('4000'), bal('4010'), bal('2300'), bal('1300'), bal('2200')]).toEqual(['25.00', '50.00', '9950.00', '225865.00', '0.00']);

    const events = (await t.http.get(`/api/v1/admin/webhook-events?paymentId=${created.id}`).set(auth(platform.token)).expect(200)).body.data;
    expect(events.map((e: any) => e.eventType).sort()).toEqual(['payment.created', 'payment.paid', 'payment.processing']);
    expect(events.every((e: any) => e.status === 'PROCESSED')).toBe(true);

    const run = await t.app.get(ReconciliationService).runNow(platform.userId);
    const report = (await t.http.get(`/api/v1/reports/reconciliation?runId=${run.id}&paymentId=${created.id}`).set(auth(platform.token)).expect(200)).body.data;
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({ status: 'MATCHED', reasonCodes: [] });
    expect(run.issueCount).toBe(0);

    const audit = (await t.http.get(`/api/v1/audit-logs?entityId=${created.id}&pageSize=100`).set(auth(platform.token)).expect(200)).body.data;
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['PAYMENT_CREATED', 'COMPLIANCE_CHECKED', 'PAYMENT_APPROVAL_GRANTED', 'PAYMENT_APPROVED', 'PAYMENT_PROCESSING', 'PAYMENT_PAID']));
    await expectLedgerSound(t);
  });

  it('I5: processing a payment twice (and concurrently) captures and submits once', async () => {
    const payment = await createPayment(t, acme);
    await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    const { PaymentsService } = await import('../src/modules/payments/payments.service');
    const svc = t.app.get(PaymentsService);
    await Promise.all(Array.from({ length: 8 }, () => svc.processApproved(payment.id)));
    await svc.processApproved(payment.id);
    await t.outbox.drainAll();
    await svc.processApproved(payment.id);

    expect(await t.prisma.ledgerTransaction.count({ where: { paymentId: payment.id, type: 'PAYMENT_CAPTURE' } })).toBe(1);
    expect(await t.prisma.providerPayment.count({ where: { paymentId: payment.id } })).toBe(1);
    expect((await getPayment(t, acme.admin, payment.id)).status).toBe('PAID');
    await expectLedgerSound(t);
  });

  it('I6: a duplicate webhook does not duplicate ledger entries', async () => {
    const payment = await createPayment(t, acme, { beneficiaryName: 'Supplier TEST-DUPLICATE-WEBHOOK' });
    await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    await t.outbox.drainAll();
    const paid = await getPayment(t, acme.admin, payment.id);
    expect(paid.status).toBe('PAID');

    // Replay the provider's paid event: five times in sequence, then ten at once.
    const event = await t.prisma.webhookEvent.findFirstOrThrow({ where: { paymentId: payment.id, eventType: 'payment.paid' } });
    for (let i = 0; i < 5; i++) {
      const res = await signedWebhook(t, event.payload as any).expect(200);
      expect(res.body.data).toEqual({ received: true, duplicate: true });
    }
    const burst = await Promise.all(Array.from({ length: 10 }, () => signedWebhook(t, event.payload as any)));
    expect(burst.every((r) => r.status === 200 && r.body.data.duplicate === true)).toBe(true);
    // A brand-new event id carrying the same news is also harmless: the state machine refuses it.
    await signedWebhook(t, { ...(event.payload as any), event_id: `evt_${randomUUID().replace(/-/g, '')}` }).expect(200);
    await t.outbox.drainAll();

    expect(await t.prisma.ledgerTransaction.count({ where: { paymentId: payment.id, type: 'PAYOUT_SETTLEMENT' } })).toBe(1);
    expect(await t.prisma.webhookEvent.count({ where: { paymentId: payment.id, eventType: 'payment.paid' } })).toBe(2);
    expect(await t.prisma.webhookEvent.count({ where: { paymentId: payment.id, eventType: 'payment.paid', status: 'IGNORED' } })).toBe(1);
    expect(await t.prisma.paymentStatusHistory.count({ where: { paymentId: payment.id, toStatus: 'PAID' } })).toBe(1);
    await expectLedgerSound(t);
  });

  it('applies out-of-order webhooks safely', async () => {
    const payment = await createPayment(t, acme, { beneficiaryName: 'Supplier TEST-OUT-OF-ORDER' });
    await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    await t.outbox.drainAll();
    expect((await getPayment(t, acme.admin, payment.id)).status).toBe('PAID');
    const late = await t.prisma.webhookEvent.findFirstOrThrow({ where: { paymentId: payment.id, eventType: 'payment.processing' } });
    expect(late.status).toBe('IGNORED');
  });

  it('a failed payout reverses the capture and refunds the wallet in full, fee included', async () => {
    const before = await balance(t, acme);
    const payment = await createPayment(t, acme, { beneficiaryName: 'Supplier TEST-FAIL' });
    await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    await t.outbox.drainAll();

    const failed = await getPayment(t, acme.admin, payment.id);
    expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'MOCK_BENEFICIARY_ACCOUNT_CLOSED' });
    expect(failed.ledgerTransactions.map((x: any) => x.type)).toEqual(['PAYMENT_HOLD', 'PAYMENT_CAPTURE', 'PAYMENT_REVERSAL']);
    expect(failed.ledgerTransactions[2].reversesTransactionId).toBe(failed.ledgerTransactions[1].id);
    expect(await balance(t, acme)).toEqual(expect.objectContaining({ available: before.available, reserved: '0.00' }));

    // A later "paid" for the same payment is refused and surfaces in reconciliation as a mismatch.
    const failedEvent = await t.prisma.webhookEvent.findFirstOrThrow({ where: { paymentId: payment.id, eventType: 'payment.failed' } });
    await signedWebhook(t, { ...(failedEvent.payload as any), event_id: `evt_${randomUUID().replace(/-/g, '')}`, event_type: 'payment.paid' }).expect(200);
    await t.outbox.drainAll();
    expect((await getPayment(t, acme.admin, payment.id)).status).toBe('FAILED');
    await expectLedgerSound(t);
  });

  it('retries a provider timeout with the same idempotency key and creates one provider record', async () => {
    const payment = await createPayment(t, acme, { beneficiaryName: 'Supplier TEST-TIMEOUT' });
    await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
    await t.outbox.drainAll();
    expect(await t.prisma.providerPayment.count({ where: { paymentId: payment.id } })).toBe(1);
    const submit = await t.prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'provider.submit', aggregateId: payment.id } });
    expect(submit.attempts).toBe(2); // first attempt timed out, second succeeded
    expect((await getPayment(t, acme.admin, payment.id)).status).toBe('PAID');
  });

  it('rejects webhooks with a bad signature, stale timestamp or malformed body', async () => {
    const payload = { event_id: 'evt_bad_signature_1', event_type: 'payment.paid', provider_payment_id: 'pp_x', payment_id: randomUUID(), timestamp: new Date().toISOString() };
    const bad = await signedWebhook(t, payload, { secret: 'wrong-secret-wrong-secret-wrong-secret' }).expect(401);
    expect(bad.body).toMatchObject({ success: false, error: { code: 'INVALID_WEBHOOK' } });
    await signedWebhook(t, payload, { timestamp: Math.floor(Date.now() / 1000) - 3600 }).expect(401);
    await t.http.post('/api/v1/webhooks/provider').send(payload).expect(401);
    await signedWebhook(t, { event_id: 'evt_malformed_1', event_type: 'payment.exploded' }).expect(401);
    expect(await t.prisma.webhookEvent.count({ where: { eventId: { in: ['evt_bad_signature_1', 'evt_malformed_1'] } } })).toBe(0);
  });

  it('stores a verified webhook for an unknown payment, answers 200 and marks it FAILED', async () => {
    const eventId = `evt_${randomUUID().replace(/-/g, '')}`;
    await signedWebhook(t, { event_id: eventId, event_type: 'payment.paid', provider_payment_id: 'pp_unknown', payment_id: randomUUID(), timestamp: new Date().toISOString() }).expect(200);
    await t.outbox.drainAll();
    expect(await t.prisma.webhookEvent.findUniqueOrThrow({ where: { eventId } })).toMatchObject({ status: 'FAILED', error: 'PAYMENT_NOT_FOUND' });
  });

  describe('compliance and maker-checker gates', () => {
    it('holds a payment above the threshold until compliance clears it AND an approver approves it', async () => {
      const payment = await createPayment(t, acme, { amount: '60000.00' });
      expect(payment).toMatchObject({ status: 'COMPLIANCE_REVIEW', complianceStatus: 'REVIEW', approvalStatus: 'PENDING' });

      const queue = (await t.http.get('/api/v1/admin/compliance-queue').set(auth(platform.token)).expect(200)).body.data;
      expect(queue.find((q: any) => q.paymentId === payment.id).rulesFired.map((r: any) => r.ruleCode)).toEqual(['AMOUNT_THRESHOLD']);
      // A tenant cannot decide compliance on its own payment.
      await t.http.post(`/api/v1/admin/compliance/${payment.id}/decision`).set(auth(acme.admin)).send({ decision: 'CLEAR', reason: 'self-clear' }).expect(403);
      await t.http.post(`/api/v1/admin/compliance/${payment.id}/decision`).set(auth(platform.token)).send({ decision: 'CLEAR' }).expect(400);

      // Approver first: still in review because the compliance gate is open.
      const afterApproval = (await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200)).body.data;
      expect(afterApproval).toMatchObject({ status: 'COMPLIANCE_REVIEW', approvalStatus: 'APPROVED' });
      await t.outbox.drainAll();
      expect((await getPayment(t, acme.admin, payment.id)).status).toBe('COMPLIANCE_REVIEW');

      const cleared = (await t.http.post(`/api/v1/admin/compliance/${payment.id}/decision`).set(auth(platform.token)).send({ decision: 'CLEAR', reason: 'Invoice verified' }).expect(200)).body.data;
      expect(cleared).toMatchObject({ status: 'APPROVED', complianceStatus: 'CLEARED_BY_ADMIN' });
      await t.http.post(`/api/v1/admin/compliance/${payment.id}/decision`).set(auth(platform.token)).send({ decision: 'REJECT', reason: 'changed my mind' }).expect(409);
      await t.outbox.drainAll();
      expect((await getPayment(t, acme.admin, payment.id)).status).toBe('PAID');

      const checks = (await t.http.get(`/api/v1/compliance/checks/${payment.id}`).set(auth(acme.approver)).expect(200)).body.data.checks;
      expect(checks.map((c: any) => c.ruleCode)).toEqual(expect.arrayContaining(['AMOUNT_THRESHOLD', 'VELOCITY_24H', 'DESTINATION_COUNTRY', 'SANCTIONS_SCREEN', 'PEP_SCREEN', 'MANUAL_DECISION']));
    });

    it('a compliance rejection cancels the payment and releases the hold', async () => {
      const before = await balance(t, acme);
      const payment = await createPayment(t, acme, { amount: '70000.00' });
      expect((await balance(t, acme)).reserved).toBe('70025.00');
      const rejected = (await t.http.post(`/api/v1/admin/compliance/${payment.id}/decision`).set(auth(platform.token)).send({ decision: 'REJECT', reason: 'Unsupported purpose' }).expect(200)).body.data;
      expect(rejected).toMatchObject({ status: 'CANCELLED', cancellationReason: 'COMPLIANCE_REJECTED', complianceStatus: 'REJECTED_BY_ADMIN' });
      expect(await balance(t, acme)).toMatchObject({ available: before.available, reserved: '0.00' });
      await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(409);
    });

    it('sends a PEP match to review and blocks a sanctions match outright', async () => {
      const pep = await createPayment(t, acme, { beneficiaryName: 'Mr TEST-PEP Example' });
      expect(pep).toMatchObject({ status: 'COMPLIANCE_REVIEW', complianceStatus: 'REVIEW' });
      await t.http.post(`/api/v1/payments/${pep.id}/cancel`).set(auth(acme.maker)).send({}).expect(200);

      const blocked = await createBeneficiary(t, acme.maker, 'TEST-SANCTION Holdings');
      expect(blocked.status).toBe('BLOCKED');
      const quote = await createQuote(t, acme.maker);
      const res = await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId: blocked.id }).expect(422);
      expect(res.body.error.code).toBe('BENEFICIARY_NOT_ACTIVE');
      expect((await t.http.get(`/api/v1/fx/quotes/${quote.id}`).set(auth(acme.maker)).expect(200)).body.data.status).toBe('ACTIVE');
    });

    it('rejects at creation, without touching the ledger, when a rule says REJECT', async () => {
      // A beneficiary that became sanctioned after it was created.
      const b = await createBeneficiary(t, acme.maker, 'Clean Name Traders');
      await t.prisma.beneficiary.update({ where: { id: b.id }, data: { name: 'TEST-SANCTION Traders' } });
      const before = await balance(t, acme);
      const quote = await createQuote(t, acme.maker);
      const res = (await postPayment(t, acme.maker, { quoteId: quote.id, beneficiaryId: b.id }).expect(201)).body.data;
      expect(res).toMatchObject({ status: 'CANCELLED', cancellationReason: 'COMPLIANCE_REJECTED', complianceStatus: 'REJECT' });
      expect(res.ledgerTransactions ?? []).toEqual([]);
      expect(await t.prisma.ledgerTransaction.count({ where: { paymentId: res.id } })).toBe(0);
      expect(await balance(t, acme)).toMatchObject(before);
      expect((await t.http.get(`/api/v1/fx/quotes/${quote.id}`).set(auth(acme.maker)).expect(200)).body.data.status).toBe('CANCELLED');
    });

    it('enforces four-eyes: a creator can never approve their own payment', async () => {
      const b = await createBeneficiary(t, acme.admin, 'Priya Enterprises');
      const quote = await createQuote(t, acme.admin);
      const payment = (await postPayment(t, acme.admin, { quoteId: quote.id, beneficiaryId: b.id }).expect(201)).body.data;
      const self = await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.admin)).send({}).expect(403);
      expect(self.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
      await t.http.post(`/api/v1/payments/${payment.id}/reject`).set(auth(acme.approver)).send({}).expect(400);
      const rejected = (await t.http.post(`/api/v1/payments/${payment.id}/reject`).set(auth(acme.approver)).send({ reason: 'Wrong beneficiary' }).expect(200)).body.data;
      expect(rejected).toMatchObject({ status: 'CANCELLED', cancellationReason: 'APPROVER_REJECTED', approvalStatus: 'REJECTED' });
      expect(rejected.approval.actions[0]).toMatchObject({ action: 'REJECT', reason: 'Wrong beneficiary' });
      expect((await balance(t, acme)).reserved).toBe('0.00');
    });

    it('flags the sixth payment within 24 hours (velocity)', async () => {
      await setVelocityLimit(t, platform.token, 5);
      const fresh = await createTenant(t, platform.token, { makerChecker: false });
      const statuses: string[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await createPayment(t, fresh, { amount: '100.00' })).complianceStatus);
      expect(statuses).toEqual(['CLEAR', 'CLEAR', 'CLEAR', 'CLEAR', 'CLEAR', 'REVIEW']);
      await setVelocityLimit(t, platform.token, 1000);
      await t.outbox.drainAll();
      await expectLedgerSound(t);
    });

    it('cancellation is possible until processing starts, and never after', async () => {
      const payment = await createPayment(t, acme);
      await t.http.post(`/api/v1/payments/${payment.id}/approve`).set(auth(acme.approver)).send({}).expect(200);
      await t.outbox.drainAll();
      const res = await t.http.post(`/api/v1/payments/${payment.id}/cancel`).set(auth(acme.admin)).send({}).expect(409);
      expect(res.body.error.code).toBe('PAYMENT_ALREADY_PROCESSED');
    });
  });
});
