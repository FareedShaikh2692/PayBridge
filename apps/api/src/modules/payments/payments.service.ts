import { Injectable, OnModuleInit } from '@nestjs/common';
import { CancellationReason, PaymentOrder, PaymentStatus, Prisma } from '@paybridge/database';
import { IDEMPOTENCY_KEY_REGEX, dec, gatesClosed, maskAccountNumber, money, paymentDisplayStatus, paymentMachine, postingKey, postings, rate } from '@paybridge/shared';
import { randomBytes } from 'node:crypto';
import { Actor, requireCompany } from '../../common/actor';
import { Clock } from '../../common/clock';
import { sha256Hex } from '../../common/crypto';
import { DomainError } from '../../common/errors';
import { orderBy, paged, skipTake } from '../../common/pagination';
import { PrismaService, Tx } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ComplianceEngine } from '../compliance/compliance.engine';
import { KybService } from '../kyb/kyb.service';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreatePaymentDto, PaymentQuery } from './payments.dto';
import { PaymentsRepository } from './payments.repository';

type ActorRef = { type: 'USER' | 'SYSTEM' | 'PROVIDER'; id?: string | null };

const CANCELLABLE: PaymentStatus[] = ['CREATED', 'COMPLIANCE_REVIEW', 'APPROVED'];
const AWAITING_GATES: PaymentStatus[] = ['CREATED', 'COMPLIANCE_REVIEW'];
const AUDIT_ACTION: Partial<Record<PaymentStatus, string>> = {
  COMPLIANCE_REVIEW: 'PAYMENT_IN_COMPLIANCE_REVIEW',
  APPROVED: 'PAYMENT_APPROVED',
  PROCESSING: 'PAYMENT_PROCESSING',
  PAID: 'PAYMENT_PAID',
  FAILED: 'PAYMENT_FAILED',
  CANCELLED: 'PAYMENT_CANCELLED',
};

export function ledgerAmounts(p: Pick<PaymentOrder, 'sourceAmount' | 'feeAmount' | 'fxMarginAmount' | 'destinationAmount'>) {
  return { sourceAmount: p.sourceAmount.toString(), feeAmount: p.feeAmount.toString(), fxMarginAmount: p.fxMarginAmount.toString(), destinationAmount: p.destinationAmount.toString() };
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PaymentsRepository,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceEngine,
    private readonly kyb: KybService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // ProcessPayment job
    this.outbox.register('payment.approved', (payload) => this.processApproved(payload.paymentId));
  }

  // ───────────────────────── State machine ─────────────────────────

  /** The only place a payment status is written. Asserts the transition, records history and audits. */
  async transition(
    tx: Tx,
    payment: PaymentOrder,
    to: PaymentStatus,
    by: ActorRef,
    opts: { reason?: string; data?: Prisma.PaymentOrderUncheckedUpdateInput; metadata?: Record<string, unknown> } = {},
  ): Promise<PaymentOrder> {
    paymentMachine.assert(payment.status, to);
    const updated = await tx.paymentOrder.update({ where: { id: payment.id }, data: { ...opts.data, status: to, version: { increment: 1 } } });
    await tx.paymentStatusHistory.create({
      data: { paymentId: payment.id, fromStatus: payment.status, toStatus: to, reason: opts.reason, actorType: by.type, actorId: by.id ?? null, metadata: opts.metadata as Prisma.InputJsonValue | undefined },
    });
    await this.audit.record(tx, {
      action: AUDIT_ACTION[to] ?? `PAYMENT_${to}`,
      entityType: 'payment',
      entityId: payment.id,
      companyId: payment.companyId,
      ...(by.type !== 'USER' ? { userId: null } : {}),
      oldValue: { status: payment.status },
      newValue: { status: to, reason: opts.reason ?? null, actorType: by.type },
    });
    return updated;
  }

  /** Moves a payment to APPROVED once both the compliance gate and the maker-checker gate are closed. */
  private async maybeApprove(tx: Tx, payment: PaymentOrder, by: ActorRef): Promise<PaymentOrder> {
    if (!AWAITING_GATES.includes(payment.status) || !gatesClosed(payment.complianceStatus, payment.approvalStatus)) return payment;
    const approved = await this.transition(tx, payment, 'APPROVED', by, { reason: 'Compliance clear and approval complete' });
    await this.outbox.enqueue(tx, { eventType: 'payment.approved', aggregateType: 'payment', aggregateId: payment.id, payload: { paymentId: payment.id } });
    return approved;
  }

  // ───────────────────────── Creation ─────────────────────────

  async create(actor: Actor, dto: CreatePaymentDto, idempotencyKey: string | undefined): Promise<{ payment: any; replayed: boolean }> {
    if (!idempotencyKey) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
    if (!IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) throw new DomainError('VALIDATION_ERROR', 'Idempotency-Key must be 1–128 characters of letters, digits, "-" or "_".');
    const companyId = requireCompany(actor);
    const requestHash = sha256Hex(JSON.stringify({ quoteId: dto.quoteId, beneficiaryId: dto.beneficiaryId, purpose: dto.purpose ?? null, sourceAmount: dto.sourceAmount ? dec(dto.sourceAmount).toFixed(2) : null }));

    const replay = await this.replay(actor, companyId, idempotencyKey, requestHash);
    if (replay) return replay;

    await this.kyb.assertApproved(companyId);

    try {
      const id = await this.prisma.transaction((tx) => this.createInTransaction(tx, actor, companyId, dto, idempotencyKey, requestHash));
      return { payment: await this.get(actor, id), replayed: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // A concurrent request with the same key committed first (the unique index made us wait for it).
        const again = await this.replay(actor, companyId, idempotencyKey, requestHash);
        if (again) return again;
        if (err.meta?.modelName === 'PaymentOrder') throw new DomainError('QUOTE_ALREADY_USED');
        throw new DomainError('IDEMPOTENCY_IN_PROGRESS');
      }
      throw err;
    }
  }

  private async replay(actor: Actor, companyId: string, key: string, requestHash: string) {
    const record = await this.prisma.client.idempotencyKey.findUnique({ where: { companyId_key: { companyId, key } } });
    if (!record) return null;
    if (record.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT');
    if (record.status !== 'COMPLETED' || !record.resourceId) throw new DomainError('IDEMPOTENCY_IN_PROGRESS');
    return { payment: await this.get(actor, record.resourceId), replayed: true };
  }

  /**
   * One atomic unit (docs/DATABASE.md §7): idempotency record, quote → USED, payment, history, compliance
   * checks, approval request, ledger hold, audit and outbox either all commit or none do.
   * Lock order: quote → ledger accounts.
   */
  private async createInTransaction(tx: Tx, actor: Actor, companyId: string, dto: CreatePaymentDto, idempotencyKey: string, requestHash: string): Promise<string> {
    const now = this.clock.now();
    await tx.idempotencyKey.create({ data: { companyId, key: idempotencyKey, endpoint: 'POST /payments', requestHash, expiresAt: new Date(now.getTime() + 86_400_000) } });

    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company) throw new DomainError('COMPANY_NOT_FOUND');

    // Quote: must belong to this company, and is locked so it can fund exactly one payment.
    const lockedQuote = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fx_quotes WHERE id = ${dto.quoteId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (!lockedQuote.length) throw new DomainError('QUOTE_NOT_FOUND');
    const quote = await tx.fxQuote.findUniqueOrThrow({ where: { id: dto.quoteId } });
    if (quote.status === 'USED') throw new DomainError('QUOTE_ALREADY_USED');
    if (quote.status === 'EXPIRED' || (quote.status === 'ACTIVE' && quote.expiresAt <= now)) throw new DomainError('QUOTE_EXPIRED');
    if (quote.status !== 'ACTIVE') throw new DomainError('QUOTE_NOT_ACTIVE');

    const beneficiary = await tx.beneficiary.findFirst({ where: { id: dto.beneficiaryId, companyId } });
    if (!beneficiary) throw new DomainError('BENEFICIARY_NOT_FOUND');
    if (beneficiary.status !== 'ACTIVE') throw new DomainError('BENEFICIARY_NOT_ACTIVE');

    if (dto.sourceAmount && !dec(dto.sourceAmount).eq(quote.baseAmount.toString())) throw new DomainError('AMOUNT_MISMATCH');

    const verdict = await this.compliance.evaluate(tx, {
      companyId,
      companyName: company.name,
      beneficiary: { name: beneficiary.name, accountHolderName: beneficiary.accountHolderName, country: beneficiary.country },
      sourceAmount: quote.baseAmount.toString(),
      sourceCurrency: quote.baseCurrency,
    });
    const rejected = verdict.result === 'REJECT';
    const approvalRequired = company.makerCheckerEnabled && !rejected;
    const user: ActorRef = { type: 'USER', id: actor.userId };

    await tx.fxQuote.update({ where: { id: quote.id }, data: { status: rejected ? 'CANCELLED' : 'USED', usedAt: now } });

    // Every monetary value is copied from the stored quote; nothing financial comes from the request body.
    let payment = await tx.paymentOrder.create({
      data: {
        reference: `PB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`,
        companyId,
        beneficiaryId: beneficiary.id,
        quoteId: quote.id,
        sourceCurrency: quote.baseCurrency,
        sourceAmount: quote.baseAmount,
        destinationCurrency: quote.quoteCurrency,
        destinationAmount: quote.recipientAmount,
        feeAmount: quote.feeAmount,
        fxMarginAmount: quote.fxMarginAmount,
        totalDebitAmount: quote.totalDebitAmount,
        exchangeRate: quote.customerRate,
        status: 'CREATED',
        complianceStatus: verdict.result,
        approvalStatus: approvalRequired ? 'PENDING' : 'NOT_REQUIRED',
        purpose: dto.purpose,
        idempotencyKey,
        createdById: actor.userId,
        createdAt: now,
      },
    });
    await tx.paymentStatusHistory.create({ data: { paymentId: payment.id, fromStatus: null, toStatus: 'CREATED', actorType: 'USER', actorId: actor.userId, createdAt: now } });
    await this.audit.record(tx, {
      action: 'PAYMENT_CREATED',
      entityType: 'payment',
      entityId: payment.id,
      companyId,
      newValue: { reference: payment.reference, quoteId: quote.id, beneficiaryId: beneficiary.id, sourceAmount: money(quote.baseAmount), destinationAmount: money(quote.recipientAmount, 'INR'), totalDebitAmount: money(quote.totalDebitAmount) },
    });

    await tx.complianceCheck.createMany({
      data: verdict.evaluations.map((e) => ({
        companyId,
        paymentId: payment.id,
        ruleId: e.ruleId,
        ruleCode: e.ruleCode,
        ruleVersion: e.ruleVersion,
        triggered: e.triggered,
        outcome: e.outcome,
        details: e.details as Prisma.InputJsonValue,
      })),
    });
    const fired = verdict.evaluations.filter((e) => e.triggered).map((e) => e.ruleCode);
    await this.audit.record(tx, {
      action: verdict.result === 'CLEAR' ? 'COMPLIANCE_CHECKED' : 'COMPLIANCE_FLAGGED',
      entityType: 'payment',
      entityId: payment.id,
      companyId,
      userId: null,
      newValue: { result: verdict.result, rulesFired: fired },
    });

    if (rejected) {
      // Nothing was reserved, so there is nothing to release.
      payment = await this.transition(tx, payment, 'CANCELLED', { type: 'SYSTEM' }, { reason: `Compliance rejected: ${fired.join(', ')}`, data: { cancellationReason: 'COMPLIANCE_REJECTED', completedAt: now } });
    } else {
      // Reserve the funds. INSUFFICIENT_FUNDS thrown here rolls the whole transaction back, quote included.
      await this.ledger.post(tx, {
        postingKey: postingKey.hold(payment.id),
        type: 'PAYMENT_HOLD',
        description: `Hold for payment ${payment.reference}`,
        entries: postings.hold(ledgerAmounts(payment)),
        companyId,
        paymentId: payment.id,
        createdById: actor.userId,
      });
      if (approvalRequired) {
        await tx.approvalRequest.create({ data: { companyId, paymentId: payment.id, requestedById: actor.userId } });
      }
      if (verdict.result === 'REVIEW') {
        payment = await this.transition(tx, payment, 'COMPLIANCE_REVIEW', { type: 'SYSTEM' }, { reason: `Rules fired: ${fired.join(', ')}` });
      } else {
        payment = await this.maybeApprove(tx, payment, user);
      }
    }

    await tx.idempotencyKey.update({ where: { companyId_key: { companyId, key: idempotencyKey } }, data: { status: 'COMPLETED', resourceId: payment.id, responseStatus: 201 } });
    return payment.id;
  }

  // ───────────────────────── Maker-checker ─────────────────────────

  async approve(actor: Actor, id: string, reason?: string) {
    await this.prisma.transaction(async (tx) => {
      const payment = await this.repo.lock(tx, id, actor);
      const request = await this.assertApprovable(tx, payment, actor);
      await tx.approvalAction.create({ data: { approvalRequestId: request.id, paymentId: id, actorId: actor.userId, action: 'APPROVE', reason } });
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', resolvedAt: this.clock.now() } });
      const updated = await tx.paymentOrder.update({ where: { id }, data: { approvalStatus: 'APPROVED' } });
      await this.audit.record(tx, { action: 'PAYMENT_APPROVAL_GRANTED', entityType: 'payment', entityId: id, companyId: payment.companyId, newValue: { approvalStatus: 'APPROVED', reason: reason ?? null } });
      await this.maybeApprove(tx, updated, { type: 'USER', id: actor.userId });
    });
    return this.get(actor, id);
  }

  async reject(actor: Actor, id: string, reason: string) {
    await this.prisma.transaction(async (tx) => {
      const payment = await this.repo.lock(tx, id, actor);
      const request = await this.assertApprovable(tx, payment, actor);
      await tx.approvalAction.create({ data: { approvalRequestId: request.id, paymentId: id, actorId: actor.userId, action: 'REJECT', reason } });
      await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', resolvedAt: this.clock.now() } });
      const updated = await tx.paymentOrder.update({ where: { id }, data: { approvalStatus: 'REJECTED' } });
      await this.audit.record(tx, { action: 'PAYMENT_REJECTED', entityType: 'payment', entityId: id, companyId: payment.companyId, newValue: { approvalStatus: 'REJECTED', reason } });
      await this.cancelInTransaction(tx, updated, 'APPROVER_REJECTED', { type: 'USER', id: actor.userId }, reason);
    });
    return this.get(actor, id);
  }

  private async assertApprovable(tx: Tx, payment: PaymentOrder, actor: Actor) {
    if (!AWAITING_GATES.includes(payment.status)) throw new DomainError('PAYMENT_ALREADY_PROCESSED');
    if (payment.approvalStatus !== 'PENDING') throw new DomainError('INVALID_STATE_TRANSITION', 'This payment is not awaiting approval.');
    // Four-eyes: the person who created the payment can never be the one who approves it.
    if (payment.createdById === actor.userId) throw new DomainError('SELF_APPROVAL_FORBIDDEN');
    return tx.approvalRequest.findUniqueOrThrow({ where: { paymentId: payment.id } });
  }

  // ───────────────────────── Cancellation ─────────────────────────

  async cancel(actor: Actor, id: string, reason?: string) {
    await this.prisma.transaction(async (tx) => {
      const payment = await this.repo.lock(tx, id, actor);
      if (actor.role === 'MAKER' && payment.createdById !== actor.userId) throw new DomainError('FORBIDDEN', 'Makers can cancel only the payments they created.');
      if (!CANCELLABLE.includes(payment.status)) throw new DomainError('PAYMENT_ALREADY_PROCESSED');
      await this.cancelInTransaction(tx, payment, 'USER_CANCELLED', { type: 'USER', id: actor.userId }, reason);
    });
    return this.get(actor, id);
  }

  private async cancelInTransaction(tx: Tx, payment: PaymentOrder, cancellationReason: CancellationReason, by: ActorRef, note?: string): Promise<PaymentOrder> {
    const cancelled = await this.transition(tx, payment, 'CANCELLED', by, { reason: note ?? cancellationReason, data: { cancellationReason, completedAt: this.clock.now() } });
    const hold = await tx.ledgerTransaction.findUnique({ where: { postingKey: postingKey.hold(payment.id) } });
    if (hold) {
      await this.ledger.post(tx, {
        postingKey: postingKey.release(payment.id),
        type: 'PAYMENT_HOLD_RELEASE',
        description: `Release hold for cancelled payment ${payment.reference}`,
        entries: postings.holdRelease(ledgerAmounts(payment)),
        companyId: payment.companyId,
        paymentId: payment.id,
        createdById: by.id ?? null,
      });
    }
    await tx.approvalRequest.updateMany({ where: { paymentId: payment.id, status: 'PENDING' }, data: { status: 'CANCELLED', resolvedAt: this.clock.now() } });
    return cancelled;
  }

  // ───────────────────────── Compliance decision ─────────────────────────

  async decideCompliance(actor: Actor, id: string, decision: 'CLEAR' | 'REJECT', reason: string) {
    await this.prisma.transaction(async (tx) => {
      const payment = await this.repo.lock(tx, id, actor);
      if (payment.status !== 'COMPLIANCE_REVIEW' || payment.complianceStatus !== 'REVIEW') {
        throw new DomainError('INVALID_STATE_TRANSITION', 'This payment has no open compliance review.');
      }
      await tx.complianceCheck.create({
        data: { companyId: payment.companyId, paymentId: id, ruleCode: 'MANUAL_DECISION', ruleVersion: 0, triggered: true, outcome: decision, decidedById: actor.userId, decisionNote: reason, details: { decision } },
      });
      const updated = await tx.paymentOrder.update({ where: { id }, data: { complianceStatus: decision === 'CLEAR' ? 'CLEARED_BY_ADMIN' : 'REJECTED_BY_ADMIN' } });
      await this.audit.record(tx, { action: decision === 'CLEAR' ? 'COMPLIANCE_CLEARED' : 'COMPLIANCE_REJECTED', entityType: 'payment', entityId: id, companyId: payment.companyId, newValue: { decision, reason } });
      if (decision === 'CLEAR') await this.maybeApprove(tx, updated, { type: 'USER', id: actor.userId });
      else await this.cancelInTransaction(tx, updated, 'COMPLIANCE_REJECTED', { type: 'USER', id: actor.userId }, reason);
    });
    return this.get(actor, id);
  }

  // ───────────────────────── Processing ─────────────────────────

  /**
   * ProcessPayment job. APPROVED → PROCESSING and the ledger capture commit together; the provider call is a
   * separate, idempotent step. Safe to run any number of times: only the first run finds the payment APPROVED.
   */
  async processApproved(paymentId: string): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const payment = await this.repo.lock(tx, paymentId);
      if (payment.status !== 'APPROVED') return;
      const processing = await this.transition(tx, payment, 'PROCESSING', { type: 'SYSTEM' }, { reason: 'Captured and queued for provider submission' });
      await this.ledger.post(tx, {
        postingKey: postingKey.capture(payment.id),
        type: 'PAYMENT_CAPTURE',
        description: `Capture for payment ${payment.reference}`,
        entries: postings.capture(ledgerAmounts(processing)),
        companyId: payment.companyId,
        paymentId: payment.id,
      });
      await this.outbox.enqueue(tx, { eventType: 'provider.submit', aggregateType: 'payment', aggregateId: payment.id, payload: { paymentId: payment.id } });
    });
  }

  /** Provider confirmed the payout: PROCESSING → PAID and the INR payable is settled. Caller holds the row lock. */
  async applyPaid(tx: Tx, payment: PaymentOrder, metadata: Record<string, unknown>): Promise<void> {
    const paid = await this.transition(tx, payment, 'PAID', { type: 'PROVIDER' }, { reason: 'Provider confirmed payout', data: { completedAt: this.clock.now() }, metadata });
    await this.ledger.post(tx, {
      postingKey: postingKey.settle(payment.id),
      type: 'PAYOUT_SETTLEMENT',
      description: `Payout settled for payment ${payment.reference}`,
      entries: postings.settlement(ledgerAmounts(paid)),
      companyId: payment.companyId,
      paymentId: payment.id,
    });
  }

  /** Provider reported failure: PROCESSING → FAILED and the capture is reversed, refunding the wallet in full. */
  async applyFailed(tx: Tx, payment: PaymentOrder, failureReason: string, metadata: Record<string, unknown>): Promise<void> {
    const failed = await this.transition(tx, payment, 'FAILED', { type: 'PROVIDER' }, { reason: failureReason, data: { failureReason, completedAt: this.clock.now() }, metadata });
    const capture = await tx.ledgerTransaction.findUnique({ where: { postingKey: postingKey.capture(payment.id) } });
    await this.ledger.post(tx, {
      postingKey: postingKey.reverse(payment.id),
      type: 'PAYMENT_REVERSAL',
      description: `Reversal for failed payment ${payment.reference}`,
      entries: postings.reversal(ledgerAmounts(failed)),
      companyId: payment.companyId,
      paymentId: payment.id,
      reversesTransactionId: capture?.id ?? null,
    });
  }

  // ───────────────────────── Reads ─────────────────────────

  async list(actor: Actor, q: PaymentQuery) {
    const where: Prisma.PaymentOrderWhereInput = {
      ...(actor.isPlatformAdmin && q.companyId ? { companyId: q.companyId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.beneficiaryId ? { beneficiaryId: q.beneficiaryId } : {}),
      ...(q.awaitingApproval === 'true' ? { approvalStatus: 'PENDING', status: { in: AWAITING_GATES } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.minAmount || q.maxAmount ? { sourceAmount: { ...(q.minAmount ? { gte: q.minAmount } : {}), ...(q.maxAmount ? { lte: q.maxAmount } : {}) } } : {}),
    };
    const { items, total } = await this.repo.list(actor, where, orderBy(q.sort, ['createdAt', 'sourceAmount', 'status', 'updatedAt'] as const, { createdAt: 'desc' }), skipTake(q).skip, skipTake(q).take);
    return paged(items.map((p) => this.view(p)), total, q);
  }

  async get(actor: Actor, id: string) {
    const p = await this.repo.findDetail(actor, id);
    if (!p) throw new DomainError('PAYMENT_NOT_FOUND');
    const canSeeLedger = actor.permissions.has('ledger.read');
    const canSeeCompliance = actor.permissions.has('compliance.read');
    return {
      ...this.view(p),
      timeline: p.statusHistory.map((h) => ({ id: h.id, fromStatus: h.fromStatus, toStatus: h.toStatus, reason: h.reason, actorType: h.actorType, actorId: h.actorId, createdAt: h.createdAt })),
      complianceChecks: canSeeCompliance
        ? p.complianceChecks.map((c) => ({
            id: c.id,
            ruleCode: c.ruleCode,
            ruleName: c.rule?.name ?? (c.ruleCode === 'MANUAL_DECISION' ? 'Manual decision' : c.ruleCode),
            triggered: c.triggered,
            outcome: c.outcome,
            // Screening internals stay with the platform; tenants see only the outcome.
            details: actor.isPlatformAdmin || !['SANCTIONS', 'PEP'].includes(c.rule?.type ?? '') ? c.details : null,
            decidedByName: c.decidedBy?.fullName ?? null,
            decisionNote: c.decisionNote,
            createdAt: c.createdAt,
          }))
        : [],
      approval: p.approvalRequest
        ? {
            id: p.approvalRequest.id,
            status: p.approvalRequest.status,
            requestedByName: p.approvalRequest.requestedBy.fullName,
            createdAt: p.approvalRequest.createdAt,
            resolvedAt: p.approvalRequest.resolvedAt,
            actions: p.approvalRequest.actions.map((a) => ({ id: a.id, action: a.action, actorId: a.actorId, actorName: a.actor.fullName, reason: a.reason, createdAt: a.createdAt })),
          }
        : null,
      ledgerTransactions: canSeeLedger ? p.ledgerTransactions.map((t) => this.ledger.transactionView(t)) : [],
    };
  }

  view(p: any) {
    return {
      id: p.id,
      reference: p.reference,
      companyId: p.companyId,
      companyName: p.company?.name ?? null,
      beneficiaryId: p.beneficiaryId,
      quoteId: p.quoteId,
      sourceCurrency: p.sourceCurrency,
      sourceAmount: money(p.sourceAmount, 'AED'),
      destinationCurrency: p.destinationCurrency,
      destinationAmount: money(p.destinationAmount, 'INR'),
      feeAmount: money(p.feeAmount, 'AED'),
      totalDebitAmount: money(p.totalDebitAmount, 'AED'),
      exchangeRate: rate(p.exchangeRate),
      status: p.status,
      complianceStatus: p.complianceStatus,
      approvalStatus: p.approvalStatus,
      displayStatus: paymentDisplayStatus(p.status, p.complianceStatus, p.approvalStatus),
      cancellationReason: p.cancellationReason,
      failureReason: p.failureReason,
      purpose: p.purpose,
      providerPaymentId: p.providerPaymentId,
      createdById: p.createdById,
      createdByName: p.createdBy?.fullName ?? null,
      beneficiary: p.beneficiary
        ? { id: p.beneficiary.id, name: p.beneficiary.name, bankName: p.beneficiary.bankName, accountNumberMasked: maskAccountNumber(p.beneficiary.accountNumberLast4), ifsc: p.beneficiary.ifsc, country: p.beneficiary.country }
        : undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      completedAt: p.completedAt,
    };
  }
}
