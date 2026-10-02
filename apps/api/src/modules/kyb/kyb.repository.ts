import { Injectable } from '@nestjs/common';
import { KybProfile, Prisma } from '@paybridge/database';
import { DomainError } from '../../common/errors';
import { Db, PrismaService, Tx } from '../../common/prisma.service';

/** Data access for KYB profiles and document metadata. */
@Injectable()
export class KybRepository {
  constructor(private readonly prisma: PrismaService) {}

  companyWithProfile(companyId: string) {
    return this.prisma.client.company.findUniqueOrThrow({ where: { id: companyId }, include: { kybProfile: true } });
  }

  company(tx: Tx, companyId: string) {
    return tx.company.findUniqueOrThrow({ where: { id: companyId } });
  }

  findByCompany(db: Db, companyId: string) {
    return db.kybProfile.findUnique({ where: { companyId } });
  }

  findDetail(companyId: string) {
    return this.prisma.client.kybProfile.findUnique({ where: { companyId }, include: { documents: { orderBy: { createdAt: 'asc' } }, reviewedBy: { select: { fullName: true } } } });
  }

  /** Locks the profile row for the rest of the transaction; every status change goes through this. */
  async lock(tx: Tx, id: string): Promise<KybProfile> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM kyb_profiles WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new DomainError('NOT_FOUND', 'The KYB profile was not found.');
    return tx.kybProfile.findUniqueOrThrow({ where: { id } });
  }

  update(tx: Tx, id: string, data: Prisma.KybProfileUncheckedUpdateInput) {
    return tx.kybProfile.update({ where: { id }, data });
  }

  addDocument(tx: Tx, data: Prisma.KybDocumentUncheckedCreateInput) {
    return tx.kybDocument.create({ data });
  }

  approvedAndLapsedBefore(cutoff: Date) {
    return this.prisma.client.kybProfile.findMany({ where: { status: 'APPROVED', expiresAt: { lt: cutoff } }, select: { companyId: true } });
  }
}
