import { Injectable } from '@nestjs/common';
import { Prisma } from '@paybridge/database';
import { Db, PrismaService } from '../../common/prisma.service';

/** Data access for the audit trail. Insert and read only: there is deliberately no update or delete. */
@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  insert(db: Db, data: Prisma.AuditLogCreateInput) {
    return db.auditLog.create({ data });
  }

  async list(where: Prisma.AuditLogWhereInput, orderBy: Prisma.AuditLogOrderByWithRelationInput, skip: number, take: number) {
    const [items, total] = await Promise.all([this.prisma.client.auditLog.findMany({ where, orderBy, skip, take }), this.prisma.client.auditLog.count({ where })]);
    return { items, total };
  }

  actors(ids: string[]) {
    return this.prisma.client.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } });
  }
}
