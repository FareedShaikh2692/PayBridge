import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ProviderPayment, ProviderPaymentStatus } from '@paybridge/database';
import { money } from '@paybridge/shared';
import { randomBytes } from 'node:crypto';
import { decryptField, signWebhook } from '../../common/crypto';
import { logger } from '../../common/logger';
import { PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { ProviderTimeoutError } from '../compliance/sanctions.provider';
import { OutboxService } from '../outbox/outbox.service';

// ───────────────────────── Port ─────────────────────────

export interface CreateProviderPayment {
  idempotencyKey: string; // the internal payment id: resubmitting can never create a second payout
  paymentId: string;
  amount: string;
  currency: string;
  beneficiary: { name: string; accountNumber: string; ifsc: string; bankName: string };
}
export interface ProviderPaymentView {
  providerPaymentId: string;
  paymentId: string | null;
  status: ProviderPaymentStatus;
  amount: string;
  currency: string;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The only surface the platform uses to talk to a payout provider. No real provider adapter exists. */
export abstract class PaymentProvider {
  abstract createPayment(request: CreateProviderPayment): Promise<ProviderPaymentView>;
  abstract getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentView | null>;
  /** Statement feed used by reconciliation. */
  abstract listPayments(period: { from: Date; to: Date }): Promise<ProviderPaymentView[]>;
}

// ───────────────────────── Mock adapter ─────────────────────────

type Scenario = 'SUCCESS' | 'FAIL' | 'TIMEOUT' | 'DUPLICATE_WEBHOOK' | 'OUT_OF_ORDER';
type EventType = 'payment.created' | 'payment.processing' | 'payment.paid' | 'payment.failed';

function scenarioFor(name: string): Scenario {
  const n = name.toUpperCase();
  if (n.includes('TEST-FAIL')) return 'FAIL';
  if (n.includes('TEST-TIMEOUT')) return 'TIMEOUT';
  if (n.includes('TEST-DUPLICATE-WEBHOOK')) return 'DUPLICATE_WEBHOOK';
  if (n.includes('TEST-OUT-OF-ORDER')) return 'OUT_OF_ORDER';
  return 'SUCCESS';
}

const EVENT_STATUS: Record<EventType, ProviderPaymentStatus> = {
  'payment.created': 'CREATED',
  'payment.processing': 'PROCESSING',
  'payment.paid': 'PAID',
  'payment.failed': 'FAILED',
};

/**
 * Simulated payout provider. It keeps its own book of record (`provider_payments`), which payment business
 * logic never reads, and reports progress only through signed webhooks sent over real HTTP — the same path an
 * external provider would use. Behaviour is deterministic and selected by tokens in the beneficiary name.
 * Nothing leaves the sandbox: no bank, no rail, no money.
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  onModuleInit(): void {
    this.outbox.register('mockprovider.webhook.deliver', (payload) => this.deliver(payload));
  }

  async createPayment(request: CreateProviderPayment): Promise<ProviderPaymentView> {
    const existing = await this.prisma.client.providerPayment.findFirst({ where: { idempotencyKey: request.idempotencyKey } });
    if (existing) return this.view(existing); // idempotent replay

    const scenario = scenarioFor(request.beneficiary.name);
    const providerPaymentId = `pp_${randomBytes(10).toString('hex')}`;
    const delay = this.config.MOCK_PROVIDER_DELAY_MS;
    // Offsets are strictly increasing, so the intended order survives even when the delay is zero.
    const order: EventType[] =
      scenario === 'FAIL'
        ? ['payment.created', 'payment.processing', 'payment.failed']
        : scenario === 'OUT_OF_ORDER'
          ? ['payment.created', 'payment.paid', 'payment.processing']
          : ['payment.created', 'payment.processing', 'payment.paid'];
    const plan: { type: EventType; at: number; eventId?: string }[] = order.map((type, i) => ({ type, at: Math.round((delay * i) / 2) + i }));
    if (scenario === 'DUPLICATE_WEBHOOK') {
      const last = plan[plan.length - 1];
      last.eventId = `evt_${randomBytes(10).toString('hex')}`;
      plan.push({ ...last, at: last.at + 1 }); // the very same event, delivered twice
    }

    const created = await this.prisma.transaction(async (tx) => {
      const row = await tx.providerPayment.create({
        data: { providerPaymentId, paymentId: request.paymentId, idempotencyKey: request.idempotencyKey, amount: request.amount, currency: request.currency, status: 'CREATED', scenario },
      });
      for (const [index, step] of plan.entries()) {
        await this.outbox.enqueue(tx, {
          eventType: 'mockprovider.webhook.deliver',
          aggregateType: 'provider_payment',
          aggregateId: providerPaymentId,
          delayMs: step.at,
          payload: {
            eventId: step.eventId ?? `evt_${randomBytes(10).toString('hex')}`,
            eventType: step.type,
            providerPaymentId,
            paymentId: request.paymentId,
            sequence: index + 1,
            amount: money(request.amount, 'INR'),
            currency: request.currency,
            failureReason: step.type === 'payment.failed' ? 'MOCK_BENEFICIARY_ACCOUNT_CLOSED' : null,
          },
        });
      }
      return row;
    });

    if (scenario === 'TIMEOUT') {
      // The request was accepted but the response is "lost": the caller must retry with the same key.
      throw new ProviderTimeoutError('mock-payment-provider');
    }
    return this.view(created);
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentView | null> {
    const row = await this.prisma.client.providerPayment.findUnique({ where: { providerPaymentId } });
    return row ? this.view(row) : null;
  }

  async listPayments(period: { from: Date; to: Date }): Promise<ProviderPaymentView[]> {
    const rows = await this.prisma.client.providerPayment.findMany({ where: { createdAt: { gte: period.from, lte: period.to } }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.view(r));
  }

  /** Provider-side step: advance the provider's own record, then notify the platform with a signed webhook. */
  private async deliver(p: { eventId: string; eventType: EventType; providerPaymentId: string; paymentId: string; sequence: number; amount: string; currency: string; failureReason: string | null }): Promise<void> {
    const current = await this.prisma.client.providerPayment.findUnique({ where: { providerPaymentId: p.providerPaymentId } });
    if (current && current.status !== 'PAID' && current.status !== 'FAILED') {
      await this.prisma.client.providerPayment.update({ where: { providerPaymentId: p.providerPaymentId }, data: { status: EVENT_STATUS[p.eventType], failureReason: p.failureReason } });
    }
    const body = JSON.stringify({
      event_id: p.eventId,
      event_type: p.eventType,
      provider_payment_id: p.providerPaymentId,
      payment_id: p.paymentId,
      sequence: p.sequence,
      timestamp: new Date().toISOString(),
      data: { amount: p.amount, currency: p.currency, failure_reason: p.failureReason },
    });
    const target = `${this.config.WEBHOOK_TARGET_URL ?? `http://localhost:${this.config.PORT}`}/api/v1/webhooks/provider`;
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paybridge-signature': signWebhook(this.config.WEBHOOK_SIGNING_SECRET, Math.floor(Date.now() / 1000), body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.warn({ eventId: p.eventId, status: response.status }, 'webhook delivery rejected; the provider will retry');
      throw new Error(`Webhook delivery failed with HTTP ${response.status}`);
    }
  }

  private view(r: ProviderPayment): ProviderPaymentView {
    return { providerPaymentId: r.providerPaymentId, paymentId: r.paymentId, status: r.status, amount: money(r.amount, 'INR'), currency: r.currency.trim(), failureReason: r.failureReason, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }
}

// ───────────────────────── Submission ─────────────────────────

/** Submits captured payments to the provider. Retried by the queue with exponential backoff; idempotent throughout. */
@Injectable()
export class ProviderSubmissionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly outbox: OutboxService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // RetryFailedProviderRequest job: the same handler runs for the first attempt and every retry.
    this.outbox.register('provider.submit', (payload) => this.submit(payload.paymentId));
  }

  async submit(paymentId: string): Promise<void> {
    const payment = await this.prisma.client.paymentOrder.findUnique({ where: { id: paymentId }, include: { beneficiary: true } });
    if (!payment || payment.providerPaymentId) return;
    if (payment.status === 'CREATED' || payment.status === 'COMPLIANCE_REVIEW' || payment.status === 'APPROVED' || payment.status === 'CANCELLED') return;

    // The full account number exists in memory only here, for the duration of the provider call.
    const result = await this.provider.createPayment({
      idempotencyKey: payment.id,
      paymentId: payment.id,
      amount: payment.destinationAmount.toString(),
      currency: payment.destinationCurrency,
      beneficiary: {
        name: payment.beneficiary.name,
        accountNumber: decryptField(payment.beneficiary.accountNumberEncrypted, this.config.DATA_ENCRYPTION_KEY),
        ifsc: payment.beneficiary.ifsc,
        bankName: payment.beneficiary.bankName,
      },
    });
    await this.prisma.client.paymentOrder.updateMany({ where: { id: payment.id, providerPaymentId: null }, data: { providerPaymentId: result.providerPaymentId } });
  }
}
