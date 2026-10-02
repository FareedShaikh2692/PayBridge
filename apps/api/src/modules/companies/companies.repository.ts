import { Injectable } from '@nestjs/common';
import { Prisma } from '@paybridge/database';
import { Db, PrismaService, Tx } from '../../common/prisma.service';

const WITH_KYB = { kybProfile: true } as const;
const MEMBER = { user: true, role: true } as const;

/** Data access for companies (the tenant root) and their members. */
@Injectable()
export class CompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByLicence(db: Db, tradeLicenseNumber: string) {
    return db.company.findUnique({ where: { tradeLicenseNumber } });
  }

  findWithKyb(db: Db, id: string) {
    return db.company.findUnique({ where: { id }, include: WITH_KYB });
  }

  /** Creates the company, its first administrator and an empty KYB profile. */
  async createWithAdmin(tx: Tx, data: Prisma.CompanyCreateInput, userId: string) {
    const adminRole = await this.role(tx, 'COMPANY_ADMIN');
    const company = await tx.company.create({ data });
    await tx.companyUser.create({ data: { companyId: company.id, userId, roleId: adminRole.id } });
    const kybProfile = await tx.kybProfile.create({ data: { companyId: company.id } });
    return { ...company, kybProfile };
  }

  update(tx: Tx, id: string, data: Prisma.CompanyUpdateInput) {
    return tx.company.update({ where: { id }, data, include: WITH_KYB });
  }

  async listAll(where: Prisma.CompanyWhereInput, skip: number, take: number) {
    const [items, total] = await Promise.all([
      this.prisma.client.company.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { kybProfile: true, _count: { select: { members: true, payments: true } } } }),
      this.prisma.client.company.count({ where }),
    ]);
    return { items, total };
  }

  /** Serialises membership changes for one company, so the last-administrator check cannot race. */
  lock(tx: Tx, companyId: string) {
    return tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
  }

  role(db: Db, name: string) {
    return db.role.findUniqueOrThrow({ where: { name } });
  }

  members(companyId: string) {
    return this.prisma.client.companyUser.findMany({ where: { companyId }, include: MEMBER, orderBy: { createdAt: 'asc' } });
  }

  member(tx: Tx, companyId: string, userId: string) {
    return tx.companyUser.findUnique({ where: { companyId_userId: { companyId, userId } }, include: MEMBER });
  }

  addMember(tx: Tx, companyId: string, userId: string, roleId: string) {
    return tx.companyUser.create({ data: { companyId, userId, roleId }, include: MEMBER });
  }

  updateMember(tx: Tx, id: string, data: Prisma.CompanyUserUncheckedUpdateInput) {
    return tx.companyUser.update({ where: { id }, data, include: MEMBER });
  }

  countActiveAdmins(tx: Tx, companyId: string) {
    return tx.companyUser.count({ where: { companyId, status: 'ACTIVE', role: { name: 'COMPANY_ADMIN' } } });
  }
}
