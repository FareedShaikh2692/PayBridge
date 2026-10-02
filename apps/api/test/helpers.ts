import './env';
import { INestApplication } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient, bootstrapReferenceData } from '@paybridge/database';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { configureApp } from '../src/app.factory';
import { AppModule } from '../src/app.module';
import { Clock } from '../src/common/clock';
import { hashPassword, signWebhook } from '../src/common/crypto';
import { PrismaService } from '../src/common/prisma.service';
import { AppConfig, CONFIG } from '../src/config';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';

export const PASSWORD = 'Sandbox-Test-Pass-1!';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaClient;
  outbox: OutboxService;
  clock: Clock;
  config: AppConfig;
  url: string;
  close: () => Promise<void>;
}

/** `env` overrides apply only while this app is being built (configuration is read once, at start-up). */
export async function createTestApp(options: { env?: Record<string, string>; reset?: boolean } = {}): Promise<TestApp> {
  const saved = Object.fromEntries(Object.keys(options.env ?? {}).map((k) => [k, process.env[k]]));
  Object.assign(process.env, options.env ?? {});
  let moduleRef;
  try {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  configureApp(app);
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  const config = app.get<AppConfig>(CONFIG);
  config.WEBHOOK_TARGET_URL = url; // the mock provider delivers webhooks to this very server, over HTTP
  const prisma = app.get(PrismaService).client;
  try {
    if (options.reset !== false) await resetDb(app);
  } catch (err) {
    await app.close();
    throw err;
  }
  return { app, http: request(url), prisma, outbox: app.get(OutboxService), clock: app.get(Clock), config, url, close: () => app.close() };
}

export async function resetDb(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService).client;
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`); // eslint-disable-line no-restricted-syntax
  await bootstrapReferenceData(prisma);
  (app.get(LedgerService) as any).systemAccountIds.clear();
  app.get(Clock).reset();
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function login(t: TestApp, email: string, password = PASSWORD): Promise<string> {
  const res = await t.http.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

export async function createPlatformAdmin(t: TestApp, email = `admin-${randomUUID().slice(0, 8)}@platform.test`): Promise<{ token: string; userId: string }> {
  const role = await t.prisma.role.findUniqueOrThrow({ where: { name: 'PLATFORM_ADMIN' } });
  const user = await t.prisma.user.create({ data: { email, fullName: 'Platform Admin', passwordHash: await hashPassword(PASSWORD, 1024), platformRoleId: role.id } });
  return { token: await login(t, email), userId: user.id };
}

export interface Tenant {
  companyId: string;
  kybProfileId: string;
  admin: string;
  maker: string;
  approver: string;
  viewer: string;
  emails: { admin: string; maker: string; approver: string; viewer: string };
  userIds: Record<string, string>;
}

let licence = 0;

/** Registers a company with all four roles. By default KYB is approved and the wallet is funded. */
export async function createTenant(t: TestApp, adminToken: string, opts: { name?: string; approved?: boolean; fund?: string | null; makerChecker?: boolean } = {}): Promise<Tenant> {
  const tag = randomUUID().slice(0, 8);
  const emails = { admin: `admin-${tag}@co.test`, maker: `maker-${tag}@co.test`, approver: `approver-${tag}@co.test`, viewer: `viewer-${tag}@co.test` };
  await t.http.post('/api/v1/auth/register').send({ email: emails.admin, password: PASSWORD, fullName: 'Company Admin' }).expect(201);
  let admin = await login(t, emails.admin);
  const company = await t.http
    .post('/api/v1/companies')
    .set(auth(admin))
    .send({
      name: opts.name ?? `Test Trading ${tag} LLC`,
      country: 'AE',
      tradeLicenseNumber: `TEST-TL-${String(++licence).padStart(4, '0')}-${tag}`,
      tradeLicenseExpiry: '2099-12-31',
      registrationNumber: `TEST-REG-${tag}`,
      businessType: 'General Trading',
      registeredAddress: 'Test Tower, Dubai',
      contactEmail: `ops-${tag}@co.test`,
      contactPhone: '+971500000000',
    })
    .expect(201);
  const companyId = company.body.data.id;
  admin = await login(t, emails.admin);

  for (const role of ['maker', 'approver', 'viewer'] as const) {
    await t.http.post(`/api/v1/companies/${companyId}/users`).set(auth(admin)).send({ email: emails[role], fullName: `Test ${role}`, role: role.toUpperCase(), password: PASSWORD }).expect(201);
  }
  if (opts.makerChecker === false) await t.http.patch(`/api/v1/companies/${companyId}`).set(auth(admin)).send({ makerCheckerEnabled: false }).expect(200);

  const kyb = await t.prisma.kybProfile.findUniqueOrThrow({ where: { companyId } });
  if (opts.approved !== false) {
    await t.http.post('/api/v1/kyb/submit').set(auth(admin)).expect(200);
    await t.http.post(`/api/v1/kyb/${kyb.id}/approve`).set(auth(adminToken)).send({ riskLevel: 'LOW' }).expect(200);
    if (opts.fund !== null) await t.http.post('/api/v1/sandbox/wallet/topup').set(auth(admin)).send({ amount: opts.fund ?? '500000.00' }).expect(200);
  }
  const users = await t.prisma.user.findMany({ where: { email: { in: Object.values(emails) } } });
  const userIds = Object.fromEntries(Object.entries(emails).map(([role, email]) => [role, users.find((u) => u.email === email)!.id]));
  return { companyId, kybProfileId: kyb.id, admin, maker: await login(t, emails.maker), approver: await login(t, emails.approver), viewer: await login(t, emails.viewer), emails, userIds };
}

let account = 100000000;
export async function createBeneficiary(t: TestApp, token: string, name = 'Rahul Sharma'): Promise<any> {
  const res = await t.http.post('/api/v1/beneficiaries').set(auth(token)).send({ name, country: 'IN', bankName: 'Test Bank', accountNumber: String(++account) + '333', ifsc: 'TEST0001234', accountHolderName: name });
  if (res.status !== 201) throw new Error(`beneficiary: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function createQuote(t: TestApp, token: string, baseAmount = '10000.00'): Promise<any> {
  const res = await t.http.post('/api/v1/fx/quotes').set(auth(token)).send({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount });
  if (res.status !== 201) throw new Error(`quote: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export function postPayment(t: TestApp, token: string, body: { quoteId: string; beneficiaryId: string; purpose?: string; sourceAmount?: string }, key: string = randomUUID()) {
  return t.http.post('/api/v1/payments').set(auth(token)).set('Idempotency-Key', key).send(body);
}

/** Maker creates a payment from a fresh quote. */
export async function createPayment(t: TestApp, tenant: Tenant, opts: { amount?: string; beneficiaryId?: string; beneficiaryName?: string } = {}): Promise<any> {
  const beneficiaryId = opts.beneficiaryId ?? (await createBeneficiary(t, tenant.maker, opts.beneficiaryName)).id;
  const quote = await createQuote(t, tenant.maker, opts.amount ?? '10000.00');
  const res = await postPayment(t, tenant.maker, { quoteId: quote.id, beneficiaryId });
  if (res.status !== 201) throw new Error(`payment: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function getPayment(t: TestApp, token: string, id: string): Promise<any> {
  return (await t.http.get(`/api/v1/payments/${id}`).set(auth(token)).expect(200)).body.data;
}

export async function balance(t: TestApp, tenant: Tenant): Promise<{ available: string; reserved: string }> {
  return (await t.http.get(`/api/v1/ledger/${tenant.companyId}/balance`).set(auth(tenant.admin)).expect(200)).body.data;
}

export function signedWebhook(t: TestApp, payload: Record<string, unknown>, opts: { secret?: string; timestamp?: number } = {}) {
  const body = JSON.stringify(payload);
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  return t.http
    .post('/api/v1/webhooks/provider')
    .set('Content-Type', 'application/json')
    .set('X-PayBridge-Signature', signWebhook(opts.secret ?? t.config.WEBHOOK_SIGNING_SECRET, ts, body))
    .send(body);
}

/** Ledger-wide proof used after every scenario: balanced per transaction and currency, and no cached-balance drift. */
export async function expectLedgerSound(t: TestApp): Promise<void> {
  const tb = await t.app.get(LedgerService).trialBalance();
  expect(tb.unbalancedTransactions).toEqual([]);
  expect(tb.cachedBalanceDrift).toEqual([]);
  for (const c of tb.currencies) expect([c.currency, c.difference]).toEqual([c.currency, '0.00']);
  expect(tb.balanced).toBe(true);
}

/** Tunes the velocity rule through the admin API (rules are platform-wide). */
export async function setVelocityLimit(t: TestApp, adminToken: string, maxCount: number): Promise<void> {
  const rules = (await t.http.get('/api/v1/admin/compliance/rules').set(auth(adminToken)).expect(200)).body.data;
  const rule = rules.find((r: any) => r.code === 'VELOCITY_24H');
  await t.http.patch(`/api/v1/admin/compliance/rules/${rule.id}`).set(auth(adminToken)).send({ parameters: { maxCount, windowHours: 24 } }).expect(200);
}

type AnyFn = (...args: any[]) => any;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

/** Every route the application exposes, read from controller metadata. */
export function listRoutes(t: TestApp): { method: string; path: string; handler: AnyFn; controller: AnyFn; name: string }[] {
  const routes = [];
  for (const wrapper of t.app.get(DiscoveryService, { strict: false }).getControllers()) {
    const proto = Object.getPrototypeOf(wrapper.instance);
    const base = String(Reflect.getMetadata("path", wrapper.metatype as AnyFn) ?? '').replace(/^\/|\/$/g, '');
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const sub = Reflect.getMetadata('path', handler);
      if (sub === undefined) continue;
      const path = [base, String(sub).replace(/^\/|\/$/g, '')].filter(Boolean).join('/');
      routes.push({ method: HTTP_METHODS[Reflect.getMetadata('method', handler)], path: `/${path}`, handler, controller: wrapper.metatype as AnyFn, name: `${wrapper.name}.${name}` });
    }
  }
  return routes;
}
