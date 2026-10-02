import { Injectable } from '@nestjs/common';
import { PaymentOrder, Prisma } from '@paybridge/database';
import { Actor, tenantWhere } from '../../common/actor';
import { DomainError } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';

/** Tenant-scoped data access for payments. Reads always carry the caller's company. */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDetail(actor: Actor, id: string) {
    return this.prisma.client.paymentOrder.findFirst({
      where: { id, ...tenantWhere(actor) },
      include: {
        beneficiary: true,
        company: { select: { name: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        statusHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        complianceChecks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { rule: { select: { name: true, type: true } }, decidedBy: { select: { fullName: true } } } },
        approvalRequest: { include: { actions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true } } } }, requestedBy: { select: { fullName: true } } } },
        ledgerTransactions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { entries: { include: { account: { select: { code: true, name: true, companyId: true } } } } } },
      },
    });
  }

  async list(actor: Actor, where: Prisma.PaymentOrderWhereInput, orderBy: Prisma.PaymentOrderOrderByWithRelationInput, skip: number, take: number) {
    const scoped = { ...where, ...tenantWhere(actor) };
    const [items, total] = await Promise.all([
      this.prisma.client.paymentOrder.findMany({ where: scoped, orderBy, skip, take, include: { beneficiary: true, company: { select: { name: true } }, createdBy: { select: { id: true, fullName: true } } } }),
      this.prisma.client.paymentOrder.count({ where: scoped }),
    ]);
    return { items, total };
  }

  exists(tx: Tx, id: string) {
    return tx.paymentOrder.findUnique({ where: { id }, select: { id: true } });
  }

  setProviderPaymentId(tx: Tx, id: string, providerPaymentId: string) {
    return tx.paymentOrder.update({ where: { id }, data: { providerPaymentId } });
  }

  /**
   * Locks the payment row for the rest of the transaction. Every state change goes through this, so
   * approvals, cancellations, processing and webhooks for one payment are strictly serialised.
   */
  async lock(tx: Tx, id: string, actor?: Actor): Promise<PaymentOrder> {
    const rows = await tx.$queryRaw<{ id: string; company_id: string }[]>`SELECT id, company_id FROM payment_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new DomainError('PAYMENT_NOT_FOUND');
    if (actor && !actor.isPlatformAdmin && rows[0].company_id !== actor.companyId) throw new DomainError('PAYMENT_NOT_FOUND');
    return tx.paymentOrder.findUniqueOrThrow({ where: { id } });
  }
}
