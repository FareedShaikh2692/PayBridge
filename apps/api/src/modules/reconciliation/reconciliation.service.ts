import { Injectable, OnModuleInit } from '@nestjs/common';
import { PaymentStatus, Prisma, ReconciliationStatus } from '@paybridge/database';
import { ACCOUNTS, dec, money } from '@paybridge/shared';
import { Clock } from '../../common/clock';
import { PageQuery, paged, skipTake } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentProvider, ProviderPaymentView } from '../provider/provider';

const GRACE_MS = 5 * 60_000;
const STUCK_MS = 30 * 60_000;
const OPEN_HOLD: PaymentStatus[] = ['CREATED', 'COMPLIANCE_REVIEW', 'APPROVED'];
type Step = 'HOLD' | 'RELEASE' | 'CAPTURE' | 'SETTLE' | 'REVERSE' | 'RETURN';
const STEP_OF: Record<string, Step | undefined> = {
  PAYMENT_HOLD: 'HOLD',
  PAYMENT_HOLD_RELEASE: 'RELEASE',
  PAYMENT_CAPTURE: 'CAPTURE',
  PAYOUT_SETTLEMENT: 'SETTLE',
  PAYMENT_REVERSAL: 'REVERSE',
  PAYOUT_RETURN: 'RETURN',
};
/** docs/RECONCILIATION.md §3.1 */
const EXPECTED: Record<PaymentStatus, Step[]> = {
  CREATED: ['HOLD'],
  COMPLIANCE_REVIEW: ['HOLD'],
  APPROVED: ['HOLD'],
  PROCESSING: ['HOLD', 'CAPTURE'],
  PAID: ['HOLD', 'CAPTURE', 'SETTLE'],
  FAILED: ['HOLD', 'CAPTURE', 'REVERSE'],
  CANCELLED: ['HOLD', 'RELEASE'],
  RETURNED: ['HOLD', 'CAPTURE', 'SETTLE', 'RETURN', 'REVERSE'],
};
/** docs/RECONCILIATION.md §3.3 */
const PROVIDER_OK: Partial<Record<PaymentStatus, string[]>> = {
  PROCESSING: ['CREATED', 'COMPLIANCE_REVIEW', 'PROCESSING'],
  PAID: ['PAID'],
  FAILED: ['FAILED'],
  RETURNED: ['RETURNED'],
};
const SEVERITY: Record<string, ReconciliationStatus> = {
  DUPLICATE_PROVIDER_PAYMENT: 'DUPLICATE',
  AMOUNT_MISMATCH: 'MISMATCH',
  LEDGER_AMOUNT_MISMATCH: 'MISMATCH',
  STATUS_MISMATCH: 'MISMATCH',
  PAID_BUT_PROVIDER_FAILED: 'MISMATCH',
  UNEXPECTED_LEDGER_POSTING: 'MISMATCH',
  LEDGER_IMBALANCE: 'MISMATCH',
  TRIAL_BALANCE_NONZERO: 'MISMATCH',
  CACHED_BALANCE_DRIFT: 'MISMATCH',
  HOLD_ACCOUNT_MISMATCH: 'MISMATCH',
  PROVIDER_PAYMENT_MISSING: 'MISSING',
  INTERNAL_PAYMENT_MISSING: 'MISSING',
  LEDGER_ENTRY_MISSING: 'MISSING',
  PROVIDER_PAID_INTERNAL_PROCESSING: 'REVIEW_REQUIRED',
  STUCK_IN_PROCESSING: 'REVIEW_REQUIRED',
  STUCK_AWAITING_SUBMISSION: 'REVIEW_REQUIRED',
};
const RANK: ReconciliationStatus[] = ['MATCHED', 'REVIEW_REQUIRED', 'MISSING', 'MISMATCH', 'DUPLICATE'];

export function statusFor(codes: string[]): ReconciliationStatus {
  return codes.map((c) => SEVERITY[c] ?? 'MISMATCH').reduce<ReconciliationStatus>((worst, s) => (RANK.indexOf(s) > RANK.indexOf(worst) ? s : worst), 'MATCHED');
}

interface ItemDraft {
  companyId: string | null;
  paymentId: string | null;
  providerPaymentId: string | null;
  currency: string | null;
  status: ReconciliationStatus;
  reasonCodes: string[];
  internalSnapshot?: object;
  providerSnapshot?: object;
  ledgerSnapshot?: object;
}

/**
 * Three-way reconciliation: internal payment ↔ provider record ↔ ledger (docs/RECONCILIATION.md).
 * Strictly read-only against business data: it reports, a human decides.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // RunReconciliation job: on demand, and hourly over a rolling 48-hour window.
    this.outbox.register('reconciliation.run', (payload) => this.execute(payload.runId));
    this.outbox.registerScheduled('RunReconciliation', 3_600_000, async () => {
      const run = await this.createRun(null, new Date(this.clock.now().getTime() - 48 * 3_600_000), this.clock.now());
      await this.execute(run.id);
    });
  }

  private createRun(triggeredById: string | null, from: Date, to: Date) {
    return this.prisma.client.reconciliationRun.create({ data: { periodFrom: from, periodTo: to, triggeredById } });
  }

  /** Queues a run and returns immediately (HTTP 202). */
  async request(userId: string, from?: string, to?: string) {
    const periodTo = to ? new Date(to) : this.clock.now();
    const periodFrom = from ? new Date(from) : new Date(periodTo.getTime() - 30 * 86_400_000);
    return this.prisma.transaction(async (tx) => {
      const run = await tx.reconciliationRun.create({ data: { periodFrom, periodTo, triggeredById: userId } });
      await this.outbox.enqueue(tx, { eventType: 'reconciliation.run', aggregateType: 'reconciliation_run', aggregateId: run.id, payload: { runId: run.id } });
      await this.audit.record(tx, { action: 'RECONCILIATION_REQUESTED', entityType: 'reconciliation_run', entityId: run.id, companyId: null, newValue: { periodFrom, periodTo } });
      return this.runView(run);
    });
  }

  /** Synchronous run, used by the seed script and tests. */
  async runNow(userId: string | null, from?: Date, to?: Date) {
    const periodTo = to ?? this.clock.now();
    const run = await this.createRun(userId, from ?? new Date(periodTo.getTime() - 30 * 86_400_000), periodTo);
    await this.execute(run.id);
    return this.runView(await this.prisma.client.reconciliationRun.findUniqueOrThrow({ where: { id: run.id } }));
  }

  async execute(runId: string): Promise<void> {
    const run = await this.prisma.client.reconciliationRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== 'RUNNING') return;
    try {
      const items = await this.compare(run.periodFrom, run.periodTo);
      // Items and the run summary are written together, so a failed run leaves no partial report.
      await this.prisma.transaction(async (tx) => {
        if (items.length) await tx.reconciliationItem.createMany({ data: items.map((i) => ({ ...i, runId })) });
        await tx.reconciliationRun.update({
          where: { id: runId },
          data: { status: 'COMPLETED', completedAt: this.clock.now(), totalItems: items.length, matchedCount: items.filter((i) => i.status === 'MATCHED').length, issueCount: items.filter((i) => i.status !== 'MATCHED').length },
        });
      });
    } catch (err) {
      await this.prisma.client.reconciliationRun.update({ where: { id: runId }, data: { status: 'FAILED', completedAt: this.clock.now(), error: String(err).slice(0, 1000) } });
      throw err;
    }
  }

  private async compare(from: Date, to: Date): Promise<ItemDraft[]> {
    const now = this.clock.now();

    // Internal payments and the ledger are read from one REPEATABLE READ snapshot.
    const snapshot = await this.prisma.transaction(
      async (tx) => {
        const payments = await tx.paymentOrder.findMany({
          where: { OR: [{ createdAt: { gte: from, lte: to } }, { status: { in: ['APPROVED', 'PROCESSING'] } }] },
          orderBy: { createdAt: 'asc' },
          include: { ledgerTransactions: { include: { entries: { include: { account: { select: { code: true } } } } } } },
        });
        const trial = await this.ledger.trialBalance(tx);
        const holds = await tx.ledgerAccount.findMany({ where: { code: ACCOUNTS.CUSTOMER_HOLD_AED.code, companyId: { not: null } } });
        const open = await tx.paymentOrder.groupBy({ by: ['companyId'], where: { status: { in: OPEN_HOLD } }, _sum: { totalDebitAmount: true } });
        return { payments, trial, holds, open };
      },
      { isolationLevel: 'RepeatableRead', timeoutMs: 60_000 },
    );

    // The provider statement is fetched afterwards, through the port, exactly as it would be from a real
    // provider. Reading it second means the provider can only be *ahead* of our snapshot, which the grace
    // period absorbs.
    const earliest = snapshot.payments.reduce((min, p) => (p.createdAt < min ? p.createdAt : min), from);
    const providerRows = await this.provider.listPayments({ from: earliest, to: now });
    const byPayment = new Map<string, ProviderPaymentView[]>();
    for (const row of providerRows) {
      const key = row.paymentId ?? `orphan:${row.providerPaymentId}`;
      byPayment.set(key, [...(byPayment.get(key) ?? []), row]);
    }

    const items: ItemDraft[] = [];
    const seen = new Set<string>();

    for (const p of snapshot.payments) {
      seen.add(p.id);
      const codes: string[] = [];
      const provider = byPayment.get(p.id) ?? [];
      const age = now.getTime() - p.updatedAt.getTime();

      // ── Ledger ──
      const steps = new Map<Step, (typeof p.ledgerTransactions)[number]>();
      for (const t of p.ledgerTransactions) {
        const step = STEP_OF[t.type];
        if (step) steps.set(step, t);
        const net: Record<string, ReturnType<typeof dec>> = {};
        for (const e of t.entries) net[e.currency] = (net[e.currency] ?? dec('0'))[e.direction === 'DEBIT' ? 'plus' : 'minus'](e.amount.toString());
        if (Object.values(net).some((v) => !v.isZero())) codes.push('LEDGER_IMBALANCE');
      }
      const rejectedAtCreation = p.status === 'CANCELLED' && p.cancellationReason === 'COMPLIANCE_REJECTED' && !steps.has('HOLD');
      const expected = rejectedAtCreation ? [] : EXPECTED[p.status];
      if (expected.some((s) => !steps.has(s))) codes.push('LEDGER_ENTRY_MISSING');
      if ([...steps.keys()].some((s) => !expected.includes(s))) codes.push('UNEXPECTED_LEDGER_POSTING');

      const sum = (step: Step, direction: 'DEBIT' | 'CREDIT', currency: string) =>
        (steps.get(step)?.entries ?? []).filter((e) => e.direction === direction && e.currency.trim() === currency).reduce((acc, e) => acc.plus(e.amount.toString()), dec('0'));
      if (steps.has('HOLD') && !sum('HOLD', 'DEBIT', 'AED').eq(p.totalDebitAmount.toString())) codes.push('LEDGER_AMOUNT_MISMATCH');
      if (steps.has('CAPTURE') && !sum('CAPTURE', 'CREDIT', 'INR').eq(p.destinationAmount.toString())) codes.push('LEDGER_AMOUNT_MISMATCH');

      // ── Provider ──
      const submitted = p.status === 'PROCESSING' || p.status === 'PAID' || p.status === 'FAILED' || p.status === 'RETURNED';
      if (provider.length > 1) codes.push('DUPLICATE_PROVIDER_PAYMENT');
      if (submitted && provider.length === 0) {
        if (p.status !== 'PROCESSING' || age > GRACE_MS) codes.push('PROVIDER_PAYMENT_MISSING');
      }
      if (!submitted && provider.length > 0) codes.push('STATUS_MISMATCH');
      const pr = provider[0];
      if (pr && submitted) {
        if (!dec(pr.amount).eq(p.destinationAmount.toString()) || pr.currency !== p.destinationCurrency.trim()) codes.push('AMOUNT_MISMATCH');
        if (p.status === 'PAID' && pr.status === 'FAILED') codes.push('PAID_BUT_PROVIDER_FAILED');
        else if (p.status === 'PROCESSING' && (pr.status === 'PAID' || pr.status === 'FAILED')) {
          // The webhook may simply not have been applied yet.
          if (now.getTime() - pr.updatedAt.getTime() > GRACE_MS) codes.push('PROVIDER_PAID_INTERNAL_PROCESSING');
        } else if (!(PROVIDER_OK[p.status] ?? []).includes(pr.status)) codes.push('STATUS_MISMATCH');
      }
      if (p.status === 'PROCESSING' && age > STUCK_MS) codes.push('STUCK_IN_PROCESSING');
      if (p.status === 'APPROVED' && age > STUCK_MS) codes.push('STUCK_AWAITING_SUBMISSION');

      const reasonCodes = [...new Set(codes)];
      items.push({
        companyId: p.companyId,
        paymentId: p.id,
        providerPaymentId: pr?.providerPaymentId ?? p.providerPaymentId,
        currency: p.sourceCurrency.trim(),
        status: statusFor(reasonCodes),
        reasonCodes,
        internalSnapshot: { reference: p.reference, status: p.status, sourceAmount: money(p.sourceAmount), destinationAmount: money(p.destinationAmount, 'INR'), totalDebitAmount: money(p.totalDebitAmount), providerPaymentId: p.providerPaymentId, updatedAt: p.updatedAt },
        providerSnapshot: { records: provider.map((r) => ({ providerPaymentId: r.providerPaymentId, status: r.status, amount: r.amount, currency: r.currency, failureReason: r.failureReason })) },
        ledgerSnapshot: { postings: p.ledgerTransactions.map((t) => ({ type: t.type, postingKey: t.postingKey, entries: t.entries.map((e) => ({ account: e.account.code, direction: e.direction, amount: money(e.amount), currency: e.currency.trim() })) })) },
      });
    }

    // Provider records that point at no payment in this snapshot.
    for (const [key, rows] of byPayment) {
      if (seen.has(key)) continue;
      const known = key.startsWith('orphan:') ? null : await this.prisma.client.paymentOrder.findUnique({ where: { id: key }, select: { id: true } });
      if (known) continue; // belongs to a payment outside the period
      for (const r of rows) {
        items.push({
          companyId: null,
          paymentId: null,
          providerPaymentId: r.providerPaymentId,
          currency: r.currency,
          status: 'MISSING',
          reasonCodes: ['INTERNAL_PAYMENT_MISSING'],
          providerSnapshot: { records: [{ providerPaymentId: r.providerPaymentId, paymentId: r.paymentId, status: r.status, amount: r.amount, currency: r.currency }] },
        });
      }
    }

    // ── Ledger-wide controls ──
    for (const c of snapshot.trial.currencies.filter((c) => !dec(c.difference).isZero())) {
      items.push({ companyId: null, paymentId: null, providerPaymentId: null, currency: c.currency, status: 'MISMATCH', reasonCodes: ['TRIAL_BALANCE_NONZERO'], ledgerSnapshot: c });
    }
    for (const d of snapshot.trial.cachedBalanceDrift) {
      items.push({ companyId: null, paymentId: null, providerPaymentId: null, currency: null, status: 'MISMATCH', reasonCodes: ['CACHED_BALANCE_DRIFT'], ledgerSnapshot: d });
    }
    // The hold account must equal the total reserved by payments that have not yet been captured or released.
    const openByCompany = new Map(snapshot.open.map((o) => [o.companyId, dec((o._sum.totalDebitAmount ?? 0).toString())]));
    for (const hold of snapshot.holds) {
      const expected = openByCompany.get(hold.companyId!) ?? dec('0');
      if (!expected.eq(hold.balance.toString())) {
        items.push({
          companyId: hold.companyId,
          paymentId: null,
          providerPaymentId: null,
          currency: 'AED',
          status: 'MISMATCH',
          reasonCodes: ['HOLD_ACCOUNT_MISMATCH'],
          ledgerSnapshot: { holdBalance: money(hold.balance), openPaymentsTotal: money(expected) },
        });
      }
    }
    return items;
  }

  // ── Report ──

  async report(q: PageQuery & { runId?: string; status?: ReconciliationStatus; paymentId?: string; companyId?: string; currency?: string; date?: string; from?: string; to?: string }) {
    let run = q.runId ? await this.prisma.client.reconciliationRun.findUnique({ where: { id: q.runId } }) : null;
    if (!run && !q.runId) {
      const dayStart = q.date ? new Date(`${q.date.slice(0, 10)}T00:00:00.000Z`) : q.from ? new Date(q.from) : undefined;
      const dayEnd = q.date ? new Date(dayStart!.getTime() + 86_400_000) : q.to ? new Date(q.to) : undefined;
      run = await this.prisma.client.reconciliationRun.findFirst({
        where: { status: 'COMPLETED', ...(dayStart || dayEnd ? { startedAt: { ...(dayStart ? { gte: dayStart } : {}), ...(dayEnd ? { lt: dayEnd } : {}) } } : {}) },
        orderBy: { startedAt: 'desc' },
      });
    }
    if (!run) return { run: null, summary: {}, items: [], meta: paged([], 0, q).meta };

    const where: Prisma.ReconciliationItemWhereInput = {
      runId: run.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.paymentId ? { paymentId: q.paymentId } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.currency ? { currency: q.currency.toUpperCase() } : {}),
    };
    const [items, total, grouped] = await Promise.all([
      this.prisma.client.reconciliationItem.findMany({ where, orderBy: [{ status: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }], ...skipTake(q), include: { payment: { select: { reference: true, company: { select: { name: true } } } } } }),
      this.prisma.client.reconciliationItem.count({ where }),
      this.prisma.client.reconciliationItem.groupBy({ by: ['status'], where: { runId: run.id }, _count: true }),
    ]);
    return {
      run: this.runView(run),
      summary: Object.fromEntries(grouped.map((g) => [g.status, g._count])),
      items: items.map((i) => ({
        id: i.id,
        status: i.status,
        reasonCodes: i.reasonCodes,
        paymentId: i.paymentId,
        paymentReference: i.payment?.reference ?? null,
        companyId: i.companyId,
        companyName: i.payment?.company.name ?? null,
        providerPaymentId: i.providerPaymentId,
        currency: i.currency?.trim() ?? null,
        internal: i.internalSnapshot,
        provider: i.providerSnapshot,
        ledger: i.ledgerSnapshot,
      })),
      meta: paged([], total, q).meta,
    };
  }

  async runs(q: PageQuery) {
    const [items, total] = await Promise.all([
      this.prisma.client.reconciliationRun.findMany({ orderBy: { startedAt: 'desc' }, ...skipTake(q) }),
      this.prisma.client.reconciliationRun.count(),
    ]);
    return paged(items.map((r) => this.runView(r)), total, q);
  }

  private runView(r: any) {
    return { id: r.id, status: r.status, periodFrom: r.periodFrom, periodTo: r.periodTo, totalItems: r.totalItems, matchedCount: r.matchedCount, issueCount: r.issueCount, error: r.error, startedAt: r.startedAt, completedAt: r.completedAt, scheduled: r.triggeredById === null };
  }
}
