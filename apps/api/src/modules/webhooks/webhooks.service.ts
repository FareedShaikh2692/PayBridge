import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, WebhookEventStatus } from '@paybridge/database';
import { Clock } from '../../common/clock';
import { verifyWebhookSignature } from '../../common/crypto';
import { DomainError } from '../../common/errors';
import { logger } from '../../common/logger';
import { PageQuery, paged, skipTake } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentsRepository } from '../payments/payments.repository';
import { PaymentsService } from '../payments/payments.service';
import { WebhooksRepository } from './webhooks.repository';

const EVENT_TYPES = ['payment.created', 'payment.compliance_review', 'payment.processing', 'payment.paid', 'payment.failed', 'payment.returned'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WebhookPayload {
  event_id: string;
  event_type: string;
  provider_payment_id: string;
  payment_id: string;
  timestamp: string;
  sequence?: number;
  data?: { amount?: string; currency?: string; failure_reason?: string | null };
}

@Injectable()
export class WebhooksService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: WebhooksRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // ProcessWebhooks job
    this.outbox.register('webhook.received', (payload) => this.process(payload.eventId));
  }

  /**
   * Receive: authenticate by signature over the raw bytes, store once, acknowledge. Processing happens
   * asynchronously, so a slow handler can never cause the provider to time out and resend.
   */
  async receive(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: true; duplicate: boolean }> {
    const raw = rawBody?.toString('utf8') ?? '';
    const verification = verifyWebhookSignature(this.config.WEBHOOK_SIGNING_SECRET, signature, raw, Math.floor(Date.now() / 1000), this.config.WEBHOOK_TOLERANCE_SECONDS);
    if (!verification.valid) {
      logger.warn({ reason: verification.reason }, 'webhook rejected');
      await this.audit.record(this.repo.db, { action: 'WEBHOOK_REJECTED', entityType: 'webhook_event', companyId: null, userId: null, newValue: { reason: verification.reason } });
      throw new DomainError('INVALID_WEBHOOK');
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new DomainError('INVALID_WEBHOOK', 'The webhook body is not valid JSON.');
    }
    const ok =
      payload && typeof payload.event_id === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(payload.event_id) &&
      typeof payload.event_type === 'string' && EVENT_TYPES.includes(payload.event_type) &&
      typeof payload.provider_payment_id === 'string' && payload.provider_payment_id.length <= 80 &&
      typeof payload.payment_id === 'string';
    if (!ok) throw new DomainError('INVALID_WEBHOOK', 'The webhook payload is malformed.');

    return this.prisma.transaction(async (tx) => {
      // INSERT … ON CONFLICT DO NOTHING on the unique event_id: the second copy of an event inserts nothing.
      const stored = await this.repo.insertOnce(tx, {
        eventId: payload.event_id,
        eventType: payload.event_type,
        providerPaymentId: payload.provider_payment_id,
        paymentId: UUID.test(payload.payment_id) ? payload.payment_id : null,
        payload: payload as unknown as Prisma.InputJsonValue,
        signatureValid: true,
      });
      if (!stored) return { received: true as const, duplicate: true };
      await this.audit.record(tx, { action: 'WEBHOOK_RECEIVED', entityType: 'webhook_event', entityId: payload.event_id, companyId: null, userId: null, newValue: { eventType: payload.event_type, paymentId: payload.payment_id } });
      await this.outbox.enqueue(tx, { eventType: 'webhook.received', aggregateType: 'webhook_event', aggregateId: payload.event_id, payload: { eventId: payload.event_id } });
      return { received: true as const, duplicate: false };
    });
  }

  /**
   * Apply an event exactly once. Three independent guards: the event's own status, the payment state machine
   * evaluated under a row lock, and the unique ledger posting key.
   */
  async process(eventId: string): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const event = await this.repo.lock(tx, eventId);
      if (!event) return;
      if (event.status === 'PROCESSED' || event.status === 'IGNORED') return;
      const payload = event.payload as unknown as WebhookPayload;

      const finish = (status: WebhookEventStatus, error: string | null) =>
        this.repo.finish(tx, event.id, status, error, this.clock.now());

      const exists = event.paymentId ? await this.paymentsRepo.exists(tx, event.paymentId) : null;
      if (!exists) {
        // Not retried: a webhook for a payment we do not know will not become valid by waiting.
        logger.error({ eventId, paymentId: payload.payment_id }, 'webhook references an unknown payment');
        await finish('FAILED', 'PAYMENT_NOT_FOUND');
        return;
      }
      const payment = await this.paymentsRepo.lock(tx, exists.id);
      const meta = { eventId, providerPaymentId: payload.provider_payment_id };

      if (payment.providerPaymentId === null) {
        await this.paymentsRepo.setProviderPaymentId(tx, payment.id, payload.provider_payment_id);
      } else if (payment.providerPaymentId !== payload.provider_payment_id) {
        await finish('IGNORED', `Provider payment id mismatch: expected ${payment.providerPaymentId}`);
        return;
      }

      switch (event.eventType) {
        case 'payment.paid':
          if (payment.status === 'PROCESSING') {
            await this.payments.applyPaid(tx, payment, meta);
            await finish('PROCESSED', null);
          } else {
            if (payment.status === 'FAILED') logger.error({ eventId, paymentId: payment.id }, 'conflicting webhook: paid after failed');
            await finish('IGNORED', `Not applicable: payment is ${payment.status}`);
          }
          return;
        case 'payment.failed':
          if (payment.status === 'PROCESSING') {
            await this.payments.applyFailed(tx, payment, payload.data?.failure_reason ?? 'PROVIDER_FAILED', meta);
            await finish('PROCESSED', null);
          } else {
            if (payment.status === 'PAID' || payment.status === 'RETURNED') logger.error({ eventId, paymentId: payment.id }, 'conflicting webhook: failed after paid');
            await finish('IGNORED', `Not applicable: payment is ${payment.status}`);
          }
          return;
        case 'payment.returned':
          if (payment.status === 'PAID') {
            await this.payments.applyReturned(tx, payment, payload.data?.failure_reason ?? 'PROVIDER_RETURNED', meta);
            await finish('PROCESSED', null);
          } else {
            await finish('IGNORED', `Not applicable: payment is ${payment.status}`);
          }
          return;
        default:
          // created / compliance_review / processing carry no internal state change.
          if (payment.status === 'PROCESSING') await finish('PROCESSED', null);
          else await finish('IGNORED', `Stale or out of order: payment is ${payment.status}`);
      }
    });
  }

  async list(q: PageQuery & { status?: WebhookEventStatus; paymentId?: string; eventType?: string }) {
    const where: Prisma.WebhookEventWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.paymentId ? { paymentId: q.paymentId } : {}), ...(q.eventType ? { eventType: q.eventType } : {}) };
    const { items, total } = await this.repo.list(where, skipTake(q).skip, skipTake(q).take);
    return paged(items, total, q);
  }
}
