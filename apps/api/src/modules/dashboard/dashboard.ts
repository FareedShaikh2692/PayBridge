import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@paybridge/database';
import { PAYMENT_STATUSES, money } from '@paybridge/shared';
import { Actor, tenantWhere } from '../../common/actor';
import { Clock } from '../../common/clock';
import { CurrentActor, Permissions } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';
import { FxService } from '../fx/fx.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly payments: PaymentsService,
    private readonly clock: Clock,
  ) {}

  async summary(actor: Actor) {
    const scope = tenantWhere(actor);
    const db = this.prisma.client;
    const since = new Date(this.clock.now().getTime() - 13 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const companyFilter = scope.companyId ? Prisma.sql`AND company_id = ${scope.companyId}::uuid` : Prisma.empty;

    const [byStatus, paid, recent, volume, fx, balance, reviewCount, awaitingApproval, blocked] = await Promise.all([
      db.paymentOrder.groupBy({ by: ['status'], where: scope, _count: true, _sum: { sourceAmount: true } }),
      db.paymentOrder.aggregate({ where: { ...scope, status: 'PAID' }, _sum: { sourceAmount: true, feeAmount: true, destinationAmount: true }, _count: true }),
      db.paymentOrder.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 6, include: { beneficiary: true, company: { select: { name: true } }, createdBy: { select: { id: true, fullName: true } } } }),
      db.$queryRaw<{ day: Date; total: Prisma.Decimal; count: bigint }[]>`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, SUM(source_amount) AS total, COUNT(*) AS count
        FROM payment_orders
        WHERE created_at >= ${since} AND status <> 'CANCELLED' ${companyFilter}
        GROUP BY 1 ORDER BY 1`,
      this.fx.indicativeRates(),
      scope.companyId ? this.ledger.balance(db, scope.companyId) : null,
      db.paymentOrder.count({ where: { ...scope, status: 'COMPLIANCE_REVIEW' } }),
      db.paymentOrder.count({ where: { ...scope, approvalStatus: 'PENDING', status: { in: ['CREATED', 'COMPLIANCE_REVIEW'] } } }),
      db.beneficiary.count({ where: { ...scope, status: 'BLOCKED' } }),
    ]);

    const counts = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const row of byStatus) counts[row.status] = row._count;
    const byDay = new Map(volume.map((v) => [new Date(v.day).toISOString().slice(0, 10), v]));
    const series = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      const hit = byDay.get(day);
      return { date: day, amount: money(hit?.total ?? '0'), count: Number(hit?.count ?? 0) };
    });

    const alerts: { level: 'warning' | 'danger' | 'info'; message: string; href: string }[] = [];
    if (reviewCount) alerts.push({ level: 'warning', message: `${reviewCount} payment${reviewCount === 1 ? '' : 's'} in compliance review`, href: actor.isPlatformAdmin ? '/admin/compliance' : '/payments?status=COMPLIANCE_REVIEW' });
    if (awaitingApproval && !actor.isPlatformAdmin) alerts.push({ level: 'info', message: `${awaitingApproval} payment${awaitingApproval === 1 ? '' : 's'} awaiting approval`, href: '/payments?awaitingApproval=true' });
    if (blocked) alerts.push({ level: 'danger', message: `${blocked} blocked beneficiar${blocked === 1 ? 'y' : 'ies'} (screening match)`, href: '/beneficiaries?status=BLOCKED' });

    let platform: Record<string, unknown> | null = null;
    if (actor.isPlatformAdmin) {
      const [companies, kybPending, deadLetters, lastRun] = await Promise.all([
        db.company.count(),
        db.kybProfile.count({ where: { status: 'UNDER_REVIEW' } }),
        db.outboxEvent.count({ where: { status: 'FAILED' } }),
        db.reconciliationRun.findFirst({ where: { status: 'COMPLETED' }, orderBy: { startedAt: 'desc' } }),
      ]);
      platform = { companies, kybPending, deadLetters, lastReconciliation: lastRun ? { id: lastRun.id, startedAt: lastRun.startedAt, totalItems: lastRun.totalItems, issueCount: lastRun.issueCount } : null };
      if (kybPending) alerts.push({ level: 'info', message: `${kybPending} KYB submission${kybPending === 1 ? '' : 's'} awaiting review`, href: '/admin/companies' });
      if (lastRun?.issueCount) alerts.push({ level: 'danger', message: `${lastRun.issueCount} reconciliation item${lastRun.issueCount === 1 ? '' : 's'} need attention`, href: '/admin/reconciliation' });
      if (deadLetters) alerts.push({ level: 'danger', message: `${deadLetters} dead-lettered job${deadLetters === 1 ? '' : 's'}`, href: '/admin/webhooks' });
    }

    return {
      balance: balance ? { available: balance.available, reserved: balance.reserved, currency: 'AED', provisioned: balance.provisioned } : null,
      totals: {
        totalSent: money(paid._sum.sourceAmount ?? '0'),
        totalFees: money(paid._sum.feeAmount ?? '0'),
        totalDelivered: money(paid._sum.destinationAmount ?? '0', 'INR'),
        pendingPayments: counts.CREATED + counts.COMPLIANCE_REVIEW + counts.APPROVED + counts.PROCESSING,
        completedPayments: counts.PAID,
        failedPayments: counts.FAILED,
        cancelledPayments: counts.CANCELLED,
        complianceReviews: reviewCount,
        awaitingApproval,
      },
      statusDistribution: PAYMENT_STATUSES.map((status) => ({ status, count: counts[status] })),
      volume: series,
      recentPayments: recent.map((p) => this.payments.view(p)),
      fx,
      alerts,
      platform,
    };
  }
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @Permissions('payment.read')
  summary(@CurrentActor() actor: Actor) {
    return this.dashboard.summary(actor);
  }
}
