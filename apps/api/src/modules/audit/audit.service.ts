import { Injectable } from '@nestjs/common';
import { Actor, tenantWhere } from '../../common/actor';
import { ctx } from '../../common/context';
import { redact } from '../../common/logger';
import { PageQuery, orderBy, paged, skipTake } from '../../common/pagination';
import { Db } from '../../common/prisma.service';
import { AuditRepository } from './audit.repository';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Append-only audit trail. Pass the transaction client so the record commits (or rolls back) with the change. */
@Injectable()
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async record(db: Db, entry: AuditEntry): Promise<void> {
    const c = ctx();
    await this.repo.insert(db, {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      companyId: entry.companyId !== undefined ? entry.companyId : (c?.companyId ?? null),
      userId: entry.userId !== undefined ? entry.userId : (c?.userId ?? null),
      oldValue: entry.oldValue === undefined ? undefined : (redact(entry.oldValue) as object),
      newValue: entry.newValue === undefined ? undefined : (redact(entry.newValue) as object),
      ipAddress: c?.ipAddress ?? null,
      userAgent: c?.userAgent ?? null,
      requestId: c?.requestId ?? null,
    });
  }

  async list(actor: Actor, q: PageQuery & { action?: string; entityType?: string; entityId?: string; userId?: string; companyId?: string; from?: string; to?: string }) {
    const where = {
      ...tenantWhere(actor),
      ...(actor.isPlatformAdmin && q.companyId ? { companyId: q.companyId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const { items, total } = await this.repo.list(where, orderBy(q.sort, ['createdAt', 'action'] as const, { createdAt: 'desc' }), skipTake(q).skip, skipTake(q).take);
    const users = await this.repo.actors([...new Set(items.map((i) => i.userId).filter(Boolean) as string[])]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return paged(items.map((i) => ({ ...i, user: i.userId ? (byId.get(i.userId) ?? null) : null })), total, q);
  }
}
