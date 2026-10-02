import { Inject, Injectable } from '@nestjs/common';
import { FxQuote, Prisma } from '@paybridge/database';
import { calculateQuote, dec, money, rate } from '@paybridge/shared';
import { Actor, requireCompany, tenantWhere } from '../../common/actor';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors';
import { PageQuery, paged, skipTake } from '../../common/pagination';
import { Db, PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { AuditService } from '../audit/audit.service';
import { KybService } from '../kyb/kyb.service';

export abstract class RateProvider {
  abstract getMidRate(base: string, quote: string): Promise<string>;
}

/** Deterministic mock: returns the configured mid-market rate. No market data source is contacted. */
@Injectable()
export class MockRateProvider extends RateProvider {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    super();
  }
  async getMidRate(base: string, quote: string): Promise<string> {
    if (base !== 'AED' || quote !== 'INR') throw new DomainError('UNSUPPORTED_CORRIDOR');
    return this.config.FX_MID_RATE_AED_INR;
  }
}

@Injectable()
export class FxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly kyb: KybService,
    private readonly rates: RateProvider,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async indicativeRates() {
    const mid = await this.rates.getMidRate('AED', 'INR');
    const sample = calculateQuote({ baseAmount: '1000', midRate: mid, spreadPct: this.config.FX_SPREAD_PCT, feeAmount: this.config.FX_FEE_AED });
    return {
      baseCurrency: 'AED',
      quoteCurrency: 'INR',
      midMarketRate: rate(mid),
      spreadPercentage: sample.spreadPercentage,
      customerRate: sample.customerRate,
      feeAmount: sample.feeAmount,
      minAmount: money(this.config.FX_MIN_AMOUNT),
      maxAmount: money(this.config.FX_MAX_AMOUNT),
      quoteTtlSeconds: this.config.QUOTE_TTL_SECONDS,
      source: 'mock-rate-provider',
      asOf: this.clock.now(),
    };
  }

  async createQuote(actor: Actor, input: { baseCurrency: string; quoteCurrency: string; baseAmount: string }) {
    const companyId = requireCompany(actor);
    if (input.baseCurrency !== 'AED' || input.quoteCurrency !== 'INR') throw new DomainError('UNSUPPORTED_CORRIDOR');
    await this.kyb.assertApproved(companyId);
    const amount = dec(input.baseAmount);
    if (amount.lt(this.config.FX_MIN_AMOUNT) || amount.gt(this.config.FX_MAX_AMOUNT)) {
      throw new DomainError('AMOUNT_OUT_OF_RANGE', `Amount must be between AED ${money(this.config.FX_MIN_AMOUNT)} and AED ${money(this.config.FX_MAX_AMOUNT)}.`);
    }
    const mid = await this.rates.getMidRate('AED', 'INR');
    const q = calculateQuote({ baseAmount: input.baseAmount, midRate: mid, spreadPct: this.config.FX_SPREAD_PCT, feeAmount: this.config.FX_FEE_AED });
    const createdAt = this.clock.now();
    const expiresAt = new Date(createdAt.getTime() + this.config.QUOTE_TTL_SECONDS * 1000);

    return this.prisma.transaction(async (tx) => {
      const quote = await tx.fxQuote.create({
        data: {
          companyId,
          baseCurrency: 'AED',
          quoteCurrency: 'INR',
          baseAmount: q.baseAmount,
          midMarketRate: q.midMarketRate,
          spreadPercentage: q.spreadPercentage,
          customerRate: q.customerRate,
          feeAmount: q.feeAmount,
          fxMarginAmount: q.fxMarginAmount,
          totalDebitAmount: q.totalDebitAmount,
          recipientAmount: q.recipientAmount,
          createdById: actor.userId,
          createdAt,
          expiresAt,
        },
      });
      await this.audit.record(tx, { action: 'QUOTE_CREATED', entityType: 'fx_quote', entityId: quote.id, companyId, newValue: this.view(quote) });
      return this.view(quote);
    });
  }

  async get(actor: Actor, id: string) {
    const quote = await this.prisma.client.fxQuote.findFirst({ where: { id, ...tenantWhere(actor) }, include: { payment: { select: { id: true, reference: true } } } });
    if (!quote) throw new DomainError('QUOTE_NOT_FOUND');
    return this.view(quote);
  }

  async list(actor: Actor, q: PageQuery & { status?: string }) {
    const now = this.clock.now();
    const where: Prisma.FxQuoteWhereInput = {
      ...tenantWhere(actor),
      ...(q.status === 'EXPIRED' ? { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lte: now } }] } : {}),
      ...(q.status === 'ACTIVE' ? { status: 'ACTIVE', expiresAt: { gt: now } } : {}),
      ...(q.status === 'USED' || q.status === 'CANCELLED' ? { status: q.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.fxQuote.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q), include: { payment: { select: { id: true, reference: true } }, createdBy: { select: { fullName: true } } } }),
      this.prisma.client.fxQuote.count({ where }),
    ]);
    return paged(items.map((i) => this.view(i)), total, q);
  }

  /** ExpireQuotes job: tidies stored status. Expiry itself is always enforced by timestamp at the point of use. */
  async sweepExpired(db: Db = this.prisma.client): Promise<number> {
    const res = await db.fxQuote.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: this.clock.now() } }, data: { status: 'EXPIRED' } });
    return res.count;
  }

  view(q: FxQuote & { payment?: { id: string; reference: string } | null; createdBy?: { fullName: string } }) {
    const now = this.clock.now();
    const expired = q.status === 'ACTIVE' && q.expiresAt <= now;
    return {
      id: q.id,
      companyId: q.companyId,
      baseCurrency: q.baseCurrency,
      quoteCurrency: q.quoteCurrency,
      baseAmount: money(q.baseAmount, 'AED'),
      midMarketRate: rate(q.midMarketRate),
      spreadPercentage: dec(q.spreadPercentage.toString()).toFixed(4),
      customerRate: rate(q.customerRate),
      feeAmount: money(q.feeAmount, 'AED'),
      fxMarginAmount: money(q.fxMarginAmount, 'AED'),
      totalDebitAmount: money(q.totalDebitAmount, 'AED'),
      recipientAmount: money(q.recipientAmount, 'INR'),
      status: expired ? 'EXPIRED' : q.status,
      createdAt: q.createdAt,
      expiresAt: q.expiresAt,
      usedAt: q.usedAt,
      secondsRemaining: q.status === 'ACTIVE' ? Math.max(0, Math.ceil((q.expiresAt.getTime() - now.getTime()) / 1000)) : 0,
      serverTime: now,
      paymentId: q.payment?.id ?? null,
      paymentReference: q.payment?.reference ?? null,
      createdByName: q.createdBy?.fullName ?? null,
    };
  }
}
