import { Injectable } from '@nestjs/common';
import { Beneficiary, Prisma } from '@paybridge/database';
import { Actor, tenantWhere } from '../../common/actor';
import { Db, PrismaService } from '../../common/prisma.service';

/**
 * Tenant-scoped data access. Every read takes the Actor and adds the caller's company to the WHERE clause,
 * so there is no way to fetch a beneficiary by id alone.
 */
@Injectable()
export class BeneficiariesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(actor: Actor, id: string, db: Db = this.prisma.client): Promise<Beneficiary | null> {
    return db.beneficiary.findFirst({ where: { id, ...tenantWhere(actor) } });
  }

  findByFingerprint(companyId: string, fingerprint: string, db: Db = this.prisma.client): Promise<Beneficiary | null> {
    return db.beneficiary.findUnique({ where: { companyId_accountFingerprint: { companyId, accountFingerprint: fingerprint } } });
  }

  async list(actor: Actor, where: Prisma.BeneficiaryWhereInput, orderBy: Prisma.BeneficiaryOrderByWithRelationInput, skip: number, take: number) {
    const scoped = { ...where, ...tenantWhere(actor) };
    const [items, total] = await Promise.all([
      this.prisma.client.beneficiary.findMany({ where: scoped, orderBy, skip, take, include: { company: { select: { name: true } }, _count: { select: { payments: true } } } }),
      this.prisma.client.beneficiary.count({ where: scoped }),
    ]);
    return { items, total };
  }

  countPayments(id: string, db: Db = this.prisma.client): Promise<number> {
    return db.paymentOrder.count({ where: { beneficiaryId: id } });
  }
}
