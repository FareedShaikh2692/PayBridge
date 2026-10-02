import { Injectable } from '@nestjs/common';
import { Prisma } from '@paybridge/database';
import { Actor, tenantWhere } from '../../common/actor';
import { Db, PrismaService, Tx } from '../../common/prisma.service';

const WITH_PAYMENT = { payment: { select: { id: true, reference: true } }, createdBy: { select: { fullName: true } } } as const;

/** Tenant-scoped data access for FX quotes. Quotes are created and read; their priced columns are never updated. */
@Injectable()
export class QuotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(tx: Tx, data: Prisma.FxQuoteUncheckedCreateInput) {
    return tx.fxQuote.create({ data });
  }

  findById(actor: Actor, id: string) {
    return this.prisma.client.fxQuote.findFirst({ where: { id, ...tenantWhere(actor) }, include: WITH_PAYMENT });
  }

  async list(actor: Actor, where: Prisma.FxQuoteWhereInput, skip: number, take: number) {
    const scoped = { ...where, ...tenantWhere(actor) };
    const [items, total] = await Promise.all([
      this.prisma.client.fxQuote.findMany({ where: scoped, orderBy: { createdAt: 'desc' }, skip, take, include: WITH_PAYMENT }),
      this.prisma.client.fxQuote.count({ where: scoped }),
    ]);
    return { items, total };
  }

  /** Marks quotes whose lock has run out. Status only; expiry itself is always enforced by timestamp. */
  async expireDue(db: Db, now: Date): Promise<number> {
    return (await db.fxQuote.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } })).count;
  }
}
