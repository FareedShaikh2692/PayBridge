import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { RateLimitStorage } from '../src/common/throttler.storage';
import { PASSWORD, TestApp, createPayment, createPlatformAdmin, createTenant, createTestApp, expectLedgerSound, getPayment } from './helpers';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
const DEAD_REDIS = 'redis://127.0.0.1:1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('failure scenarios', () => {
  describe('database unavailable', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ env: { DATABASE_URL: 'postgresql://paybridge@127.0.0.1:1/paybridge_down' }, reset: false });
    });
    afterAll(() => t.close());

    it('stays alive, reports not ready, and answers 503 without leaking internals or writing anything', async () => {
      expect((await t.http.get('/health/live').expect(200)).body.data.status).toBe('ok');
      const ready = await t.http.get('/health/ready').expect(503);
      expect(ready.body.data).toEqual({ status: 'unavailable', checks: { database: 'down', redis: 'not_configured' } });

      const login = await t.http.post('/api/v1/auth/login').send({ email: 'someone@co.test', password: PASSWORD }).expect(503);
      expect(login.body).toEqual({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' }, requestId: login.headers['x-request-id'] });
      expect(JSON.stringify(login.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|prisma|postgres/i);
      const register = await t.http.post('/api/v1/auth/register').send({ email: 'a@b.test', password: PASSWORD, fullName: 'A B' }).expect(503);
      expect(register.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('Redis unavailable (BullMQ driver)', () => {
    let t: TestApp;
    const prefix = `pbtest-${randomUUID().slice(0, 8)}`;
    beforeAll(async () => {
      t = await createTestApp({ env: { QUEUE_DRIVER: 'bullmq', REDIS_URL: DEAD_REDIS, QUEUE_PREFIX: prefix } });
    });
    afterAll(async () => {
      await t.close();
      const redis = new Redis(REDIS_URL);
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    });

    it('keeps accepting payments, loses nothing, and finishes the work once Redis is back', async () => {
      const platform = await createPlatformAdmin(t);
      const tenant = await createTenant(t, platform.token, { makerChecker: false });

      // Redis is down: the request still succeeds, because follow-up work is recorded in the database first.
      const payment = await createPayment(t, tenant);
      expect(payment.status).toBe('APPROVED');
      const ready = (await t.http.get('/health/ready').expect(200)).body.data;
      expect(ready).toEqual({ status: 'degraded', checks: { database: 'up', redis: 'down' } });

      await t.outbox.drain({ maxMs: 15_000 });
      const pending = await t.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: payment.id, eventType: 'payment.approved' } });
      expect(pending.status).toBe('PENDING'); // not lost, not failed: waiting for Redis
      expect(pending.lastError).toBeTruthy();
      expect((await getPayment(t, tenant.admin, payment.id)).status).toBe('APPROVED');

      // Redis returns.
      t.config.REDIS_URL = REDIS_URL;
      const outbox = t.outbox as any;
      await outbox.queue?.close().catch(() => undefined);
      await outbox.deadLetter?.close().catch(() => undefined);
      outbox.queue = outbox.deadLetter = undefined;
      await outbox.startBullWorker();
      expect(await t.outbox.registerJobSchedulers()).toEqual(expect.arrayContaining(['scheduled:ExpireQuotes', 'scheduled:RunReconciliation']));

      let status = 'APPROVED';
      for (let i = 0; i < 100 && status !== 'PAID'; i++) {
        await t.prisma.$executeRaw`UPDATE outbox_events SET available_at = now() WHERE status = 'PENDING'`;
        await t.outbox.drain({ maxMs: 5_000 }); // the relay publishes; BullMQ workers execute
        await sleep(150);
        status = (await getPayment(t, tenant.admin, payment.id)).status;
      }
      expect(status).toBe('PAID');
      expect(await t.prisma.ledgerTransaction.count({ where: { paymentId: payment.id, type: 'PAYMENT_CAPTURE' } })).toBe(1);
      expect(await t.prisma.providerPayment.count({ where: { paymentId: payment.id } })).toBe(1);
      expect(await t.prisma.outboxEvent.count({ where: { status: 'FAILED' } })).toBe(0);
      await expectLedgerSound(t);
    });
  });

  describe('rate limiting', () => {
    it('shares counters between instances through Redis and falls back to memory when Redis is down', async () => {
      const key = `test-${randomUUID()}`;
      const a = new RateLimitStorage({ REDIS_URL });
      const b = new RateLimitStorage({ REDIS_URL });
      for (let i = 0; i < 50 && !(a.shared && b.shared); i++) await sleep(50);
      expect(a.shared && b.shared).toBe(true);
      expect((await a.increment(key, 60_000, 3, 0, 'default')).totalHits).toBe(1);
      expect((await b.increment(key, 60_000, 3, 0, 'default')).totalHits).toBe(2); // a second "instance" sees the first one's hit
      expect((await a.increment(key, 60_000, 3, 0, 'default')).isBlocked).toBe(false);
      const fourth = await b.increment(key, 60_000, 3, 0, 'default');
      expect(fourth).toMatchObject({ totalHits: 4, isBlocked: true });
      expect(fourth.timeToExpire).toBeGreaterThan(50);
      a.onModuleDestroy();
      b.onModuleDestroy();

      const down = new RateLimitStorage({ REDIS_URL: DEAD_REDIS });
      expect(down.shared).toBe(false);
      expect((await down.increment(key, 60_000, 3, 0, 'default')).totalHits).toBe(1); // in-memory counter, starting fresh
      expect((await down.increment(key, 60_000, 3, 0, 'default')).totalHits).toBe(2);
      down.onModuleDestroy();
    });

    it('answers 429 RATE_LIMITED with Retry-After once the login limit is exceeded', async () => {
      const t = await createTestApp();
      process.env.RATE_LIMIT_DISABLED = 'false';
      try {
        const statuses: number[] = [];
        let last: any;
        for (let i = 0; i < 12; i++) {
          last = await t.http.post('/api/v1/auth/login').send({ email: 'nobody@co.test', password: 'wrong-password-123' });
          statuses.push(last.status);
        }
        expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
        expect(statuses.slice(10)).toEqual([429, 429]);
        expect(last.body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
        expect(last.headers['retry-after']).toBeTruthy();
        // Health checks are exempt.
        expect((await t.http.get('/health/live')).status).toBe(200);
      } finally {
        process.env.RATE_LIMIT_DISABLED = 'true';
        await t.close();
      }
    });
  });
});
