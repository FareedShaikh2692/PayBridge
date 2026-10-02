import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@paybridge/database';
import { waitUntil } from '@vercel/functions';
import type { Queue, Worker } from 'bullmq';
import { AppConfig, CONFIG } from '../../config';
import { ctx } from '../../common/context';
import { logger } from '../../common/logger';
import { Db, PrismaService } from '../../common/prisma.service';

export type OutboxHandler = (payload: any, meta: { id: string; attempts: number }) => Promise<void>;

export interface OutboxMessage {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  delayMs?: number;
}

/** Event type → job name from the brief, used as the BullMQ job name so queues read naturally. */
export const JOB_NAMES: Record<string, string> = {
  'payment.approved': 'ProcessPayment',
  'provider.submit': 'RetryFailedProviderRequest',
  'webhook.received': 'ProcessWebhooks',
  'compliance.rescreen': 'RunComplianceChecks',
  'quotes.expire': 'ExpireQuotes',
  'reconciliation.run': 'RunReconciliation',
  'mockprovider.webhook.deliver': 'MockProviderDeliverWebhook',
};

export const MAX_ATTEMPTS = 5;
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const QUEUE = 'paybridge-events';
const DEAD_LETTER_QUEUE = 'paybridge-dead-letter';
const STALE_LOCK_SECONDS = 120;

interface ClaimedRow {
  id: string;
  event_type: string;
  payload: any;
  attempts: number;
  available_at: Date;
  sequence: bigint;
}

/**
 * Transactional outbox (docs/ARCHITECTURE.md §5.1).
 *
 * Writers call `enqueue` inside their database transaction, so follow-up work exists if and only if the
 * state change committed. Two dispatch drivers consume the table:
 *   - inline: the outbox row is the job. Claimed with SKIP LOCKED, retried with exponential backoff, and
 *     marked FAILED (dead-lettered) after MAX_ATTEMPTS. Needs no Redis, so it also runs on serverless.
 *   - bullmq: the relay publishes each row to BullMQ (jobId = outbox id, so re-publishing is harmless) and
 *     Redis-backed workers execute it with the same retry policy and a dead-letter queue.
 */
@Injectable()
export class OutboxService implements OnModuleDestroy {
  private readonly handlers = new Map<string, OutboxHandler>();
  private readonly scheduled: { name: string; everyMs: number; fn: () => Promise<unknown> }[] = [];
  private timers: NodeJS.Timeout[] = [];
  private queue?: Queue;
  private deadLetter?: Queue;
  private worker?: Worker;
  private draining?: Promise<number>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  register(eventType: string, handler: OutboxHandler): void {
    this.handlers.set(eventType, handler);
  }

  /** Recurring work (ExpireQuotes, RunReconciliation). Runs on timers in a long-lived process, or from the cron endpoint on serverless. */
  registerScheduled(name: string, everyMs: number, fn: () => Promise<unknown>): void {
    this.scheduled.push({ name, everyMs, fn });
  }

  async enqueue(db: Db, message: OutboxMessage): Promise<void> {
    await db.outboxEvent.create({
      data: {
        eventType: message.eventType,
        aggregateType: message.aggregateType,
        aggregateId: message.aggregateId,
        payload: { ...(message.payload ?? {}), correlationId: ctx()?.requestId ?? null } as Prisma.InputJsonValue,
        availableAt: new Date(Date.now() + (message.delayMs ?? 0)),
      },
    });
  }

  /** Called after a request commits. Starts a background drain without blocking the response. */
  kick(): void {
    if (this.config.NODE_ENV === 'test') return; // tests drain explicitly for determinism
    if (this.config.isServerless) {
      waitUntil(this.drain({ maxMs: 25_000, waitForScheduledMs: 10_000 }).catch((err) => logger.error({ err: String(err) }, 'outbox drain failed')));
      return;
    }
    setImmediate(() => void this.drain().catch((err) => logger.error({ err: String(err) }, 'outbox drain failed')));
  }

  /** Processes due events until none remain or the time budget is spent. Returns the number handled. */
  async drain(options: { maxMs?: number; waitForScheduledMs?: number } = {}): Promise<number> {
    if (this.draining) {
      await this.draining.catch(() => undefined);
    }
    this.draining = this.drainLoop(options);
    try {
      return await this.draining;
    } finally {
      this.draining = undefined;
    }
  }

  private async drainLoop({ maxMs = 20_000, waitForScheduledMs = 0 }: { maxMs?: number; waitForScheduledMs?: number }): Promise<number> {
    const deadline = Date.now() + maxMs;
    let handled = 0;
    while (Date.now() < deadline) {
      const rows = await this.claim(10);
      if (rows.length === 0) {
        if (!waitForScheduledMs) break;
        const next = await this.prisma.client.outboxEvent.findFirst({ where: { status: 'PENDING' }, orderBy: { availableAt: 'asc' }, select: { availableAt: true } });
        if (!next) break;
        const wait = next.availableAt.getTime() - Date.now();
        if (wait > waitForScheduledMs || Date.now() + wait > deadline) break;
        await new Promise((r) => setTimeout(r, Math.max(wait, 50)));
        continue;
      }
      for (const row of rows) {
        await this.dispatch(row);
        handled++;
      }
    }
    return handled;
  }

  /** Test helper: drain until the outbox is quiet, including events that were scheduled with a delay. */
  async drainAll(maxRounds = 50): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      // Bring delayed events forward without disturbing their relative order.
      await this.prisma.client.$executeRaw`UPDATE outbox_events SET available_at = available_at - interval '1 day' WHERE status = 'PENDING' AND available_at > now()`;
      const n = await this.drainLoop({ maxMs: 30_000 });
      const pending = await this.prisma.client.outboxEvent.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } });
      if (n === 0 && pending === 0) return;
    }
    throw new Error('Outbox did not become quiet');
  }

  private async claim(limit: number): Promise<ClaimedRow[]> {
    const rows = await this.prisma.client.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events SET status = 'PROCESSING', locked_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE (status = 'PENDING' AND available_at <= now())
           OR (status = 'PROCESSING' AND locked_at < now() - make_interval(secs => ${STALE_LOCK_SECONDS}))
        ORDER BY available_at, sequence
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_type, payload, attempts, available_at, sequence`;
    // UPDATE … RETURNING does not preserve the subquery's order, so restore FIFO here.
    return rows.sort((a, b) => a.available_at.getTime() - b.available_at.getTime() || (a.sequence < b.sequence ? -1 : 1));
  }

  private async dispatch(row: ClaimedRow): Promise<void> {
    if (this.config.QUEUE_DRIVER === 'bullmq') {
      try {
        const queue = await this.getQueue();
        await withTimeout(
          queue.add(
            JOB_NAMES[row.event_type] ?? row.event_type,
            { outboxId: row.id, eventType: row.event_type, payload: row.payload },
            { jobId: row.id, attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: false },
          ),
          4000,
          'Redis did not accept the job in time',
        );
        await this.prisma.client.outboxEvent.update({ where: { id: row.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), lockedAt: null } });
      } catch (err) {
        // Redis unavailable: leave the event pending so it is published once Redis returns.
        await this.prisma.client.outboxEvent.update({
          where: { id: row.id },
          data: { status: 'PENDING', lockedAt: null, attempts: { decrement: 1 }, availableAt: new Date(Date.now() + 2000), lastError: String(err).slice(0, 1000) },
        });
        logger.error({ outboxId: row.id, err: String(err) }, 'outbox publish failed; will retry');
      }
      return;
    }
    await this.execute(row);
  }

  /** Inline execution with retry, exponential backoff and dead-lettering. */
  private async execute(row: ClaimedRow): Promise<void> {
    const handler = this.handlers.get(row.event_type);
    try {
      if (!handler) throw new Error(`No handler registered for "${row.event_type}"`);
      await handler(row.payload, { id: row.id, attempts: row.attempts });
      await this.prisma.client.outboxEvent.update({ where: { id: row.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), lockedAt: null, lastError: null } });
    } catch (err) {
      const dead = row.attempts >= MAX_ATTEMPTS || !handler;
      const backoffMs = this.config.NODE_ENV === 'test' ? 0 : 2000 * 2 ** (row.attempts - 1);
      await this.prisma.client.outboxEvent.update({
        where: { id: row.id },
        data: {
          status: dead ? 'FAILED' : 'PENDING',
          lockedAt: null,
          availableAt: new Date(Date.now() + backoffMs),
          lastError: (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 1000),
        },
      });
      logger.error({ outboxId: row.id, eventType: row.event_type, attempts: row.attempts, deadLettered: dead, err: String(err) }, 'job failed');
    }
  }

  // ── Long-lived process: poller + timers (inline) or relay + BullMQ workers ──

  async startBackground(): Promise<void> {
    if (this.config.isServerless || this.config.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => void this.drain().catch((err) => logger.error({ err: String(err) }, 'outbox poll failed')), this.config.OUTBOX_POLL_MS));

    if (this.config.QUEUE_DRIVER === 'bullmq') {
      // ExpireQuotes, RunReconciliation and friends become BullMQ repeatable jobs.
      await this.startBullWorker();
      await this.registerJobSchedulers();
    }
    for (const task of this.config.QUEUE_DRIVER === 'bullmq' ? [] : this.scheduled) {
      this.timers.push(setInterval(() => void task.fn().catch((err) => logger.error({ task: task.name, err: String(err) }, 'scheduled task failed')), task.everyMs));
    }
    logger.info({ driver: this.config.QUEUE_DRIVER, scheduled: this.scheduled.map((s) => s.name) }, 'background processing started');
  }

  async runScheduled(): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    for (const task of this.scheduled) {
      try {
        await task.fn();
        results[task.name] = 'ok';
      } catch (err) {
        results[task.name] = `error: ${String(err)}`;
        logger.error({ task: task.name, err: String(err) }, 'scheduled task failed');
      }
    }
    return results;
  }

  /** Producer connections fail fast so a Redis outage cannot stall request handling; worker connections must block. */
  private connection(role: 'producer' | 'worker' = 'worker') {
    const url = new URL(this.config.REDIS_URL!);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      ...(role === 'producer' ? { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000 } : { maxRetriesPerRequest: null }),
    };
  }

  private async getQueue(): Promise<Queue> {
    if (!this.queue) {
      const { Queue } = await import('bullmq');
      this.queue = new Queue(QUEUE, { connection: this.connection('producer'), prefix: this.config.QUEUE_PREFIX });
      this.deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection: this.connection('producer'), prefix: this.config.QUEUE_PREFIX });
      this.queue.on('error', (err) => logger.error({ err: String(err) }, 'queue error'));
      this.deadLetter.on('error', (err) => logger.error({ err: String(err) }, 'dead-letter queue error'));
    }
    return this.queue;
  }

  private async startBullWorker(): Promise<void> {
    const { Worker } = await import('bullmq');
    await this.getQueue();
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.data.scheduled) {
          const task = this.scheduled.find((s) => s.name === job.data.scheduled);
          if (!task) throw new Error(`Unknown scheduled task "${job.data.scheduled}"`);
          await task.fn();
          return;
        }
        const handler = this.handlers.get(job.data.eventType);
        if (!handler) throw new Error(`No handler registered for "${job.data.eventType}"`);
        await handler(job.data.payload, { id: job.data.outboxId, attempts: job.attemptsMade + 1 });
      },
      { connection: this.connection(), prefix: this.config.QUEUE_PREFIX, concurrency: 5 },
    );
    this.worker.on('error', (err) => logger.error({ err: String(err) }, 'worker error'));
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      logger.error({ jobId: job.id, name: job.name, attemptsMade: job.attemptsMade, err: String(err) }, 'job failed');
      if (!job.data.scheduled && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        // Dead-letter: keep the payload and the error where an operator can find and re-drive it.
        void this.deadLetter?.add(job.name, { ...job.data, error: String(err), failedAt: new Date().toISOString() }, { jobId: `dl-${job.id}` });
        void this.prisma.client.outboxEvent
          .update({ where: { id: job.data.outboxId }, data: { status: 'FAILED', lastError: String(err).slice(0, 1000), attempts: job.attemptsMade } })
          .catch((e) => logger.error({ err: String(e) }, 'failed to mark dead letter'));
      }
    });
  }

  /** One BullMQ job scheduler per recurring task. Upserting is idempotent, so every instance may call this. */
  async registerJobSchedulers(): Promise<string[]> {
    const { Queue } = await import('bullmq');
    // Scheduler registration uses a blocking connection: it should wait for Redis rather than fail at boot.
    const queue = new Queue(QUEUE, { connection: this.connection('worker'), prefix: this.config.QUEUE_PREFIX });
    try {
      for (const task of this.scheduled) {
        await queue.upsertJobScheduler(`scheduled:${task.name}`, { every: task.everyMs }, { name: task.name, data: { scheduled: task.name }, opts: { removeOnComplete: 20, removeOnFail: 50 } });
      }
      return (await queue.getJobSchedulers()).map((s) => s.key);
    } finally {
      await queue.close();
    }
  }

  // ── Operations ──

  listDeadLetters() {
    return this.prisma.client.outboxEvent.findMany({ where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async stats() {
    const rows = await this.prisma.client.outboxEvent.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(rows.map((r) => [r.status, r._count]));
  }

  /** Re-drive a dead-lettered event. Handlers are idempotent, so this is always safe. */
  async retry(id: string): Promise<boolean> {
    const res = await this.prisma.client.outboxEvent.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null } });
    return res.count === 1;
  }

  async onModuleDestroy(): Promise<void> {
    this.timers.forEach(clearInterval);
    await this.worker?.close();
    await this.queue?.close();
    await this.deadLetter?.close();
  }
}
