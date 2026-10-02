import { Injectable } from '@nestjs/common';
import { Prisma, WebhookEvent, WebhookEventStatus } from '@paybridge/database';
import { Db, PrismaService, Tx } from '../../common/prisma.service';

/** Data access for provider webhook events. The unique event id is what makes delivery idempotent. */
@Injectable()
export class WebhooksRepository {
  constructor(private readonly prisma: PrismaService) {}

  get db(): Db {
    return this.prisma.client;
  }

  /** INSERT … ON CONFLICT DO NOTHING on the unique event_id. Returns false when the event was already stored. */
  async insertOnce(tx: Tx, data: Prisma.WebhookEventCreateManyInput): Promise<boolean> {
    return (await tx.webhookEvent.createMany({ data: [data], skipDuplicates: true })).count === 1;
  }

  /** Locks the event row so two workers cannot apply the same event. */
  async lock(tx: Tx, eventId: string): Promise<WebhookEvent | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM webhook_events WHERE event_id = ${eventId} FOR UPDATE`;
    return rows.length ? tx.webhookEvent.findUniqueOrThrow({ where: { eventId } }) : null;
  }

  finish(tx: Tx, id: string, status: WebhookEventStatus, error: string | null, at: Date) {
    return tx.webhookEvent.update({ where: { id }, data: { status, error, processedAt: at, attempts: { increment: 1 } } });
  }

  async list(where: Prisma.WebhookEventWhereInput, skip: number, take: number) {
    const [items, total] = await Promise.all([
      this.prisma.client.webhookEvent.findMany({ where, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.client.webhookEvent.count({ where }),
    ]);
    return { items, total };
  }
}
