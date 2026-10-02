import { Reflector } from '@nestjs/core';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '@paybridge/shared';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { AUTH_ONLY, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../src/common/decorators';
import { PASSWORD, Tenant, TestApp, auth, createPlatformAdmin, createTenant, createTestApp, listRoutes, login } from './helpers';

describe('authentication, RBAC and API conventions', () => {
  let t: TestApp;
  let platform: { token: string; userId: string };
  let acme: Tenant;

  beforeAll(async () => {
    t = await createTestApp();
    platform = await createPlatformAdmin(t);
    acme = await createTenant(t, platform.token);
  });
  afterAll(() => t.close());

  describe('registration and login', () => {
    it('validates registration input and never returns the password', async () => {
      await t.http.post('/api/v1/auth/register').send({ email: 'not-an-email', password: PASSWORD, fullName: 'X Y' }).expect(400);
      const short = await t.http.post('/api/v1/auth/register').send({ email: 'a@b.test', password: 'short', fullName: 'X Y' }).expect(400);
      expect(short.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
      await t.http.post('/api/v1/auth/register').send({ email: 'a@b.test', password: 'password1234', fullName: 'X Y' }).expect(400);
      const ok = await t.http.post('/api/v1/auth/register').send({ email: 'New.User@B.test', password: PASSWORD, fullName: 'New User' }).expect(201);
      expect(ok.body.data.email).toBe('new.user@b.test');
      expect(JSON.stringify(ok.body)).not.toMatch(/password|scrypt/i);
      const dup = await t.http.post('/api/v1/auth/register').send({ email: 'new.user@b.test', password: PASSWORD, fullName: 'New User' }).expect(409);
      expect(dup.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
      const stored = await t.prisma.user.findUniqueOrThrow({ where: { email: 'new.user@b.test' } });
      expect(stored.passwordHash).toMatch(/^scrypt\$/);
      expect(stored.passwordHash).not.toContain(PASSWORD);
    });

    it('gives the same error for a wrong password and an unknown user', async () => {
      const wrong = await t.http.post('/api/v1/auth/login').send({ email: acme.emails.admin, password: 'wrong-password-123' }).expect(401);
      const unknown = await t.http.post('/api/v1/auth/login').send({ email: 'nobody@nowhere.test', password: 'wrong-password-123' }).expect(401);
      expect(wrong.body.error).toEqual(unknown.body.error);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects missing, tampered, wrongly-signed and expired tokens', async () => {
      await t.http.get('/api/v1/auth/me').expect(401);
      await t.http.get('/api/v1/auth/me').set(auth(acme.admin.slice(0, -3) + 'abc')).expect(401);
      const forged = jwt.sign({ typ: 'access' }, 'another-secret-another-secret-another', { subject: acme.userIds.admin, issuer: 'paybridge' });
      await t.http.get('/api/v1/auth/me').set(auth(forged)).expect(401);
      const expired = jwt.sign({ typ: 'access' }, t.config.JWT_SECRET, { subject: acme.userIds.admin, issuer: 'paybridge', expiresIn: -10 });
      await t.http.get('/api/v1/auth/me').set(auth(expired)).expect(401);
      const none = jwt.sign({ typ: 'access' }, '', { subject: acme.userIds.admin, issuer: 'paybridge', algorithm: 'none' });
      await t.http.get('/api/v1/auth/me').set(auth(none)).expect(401);
    });

    it('rotates refresh tokens and revokes the family when a rotated token is reused', async () => {
      const res = await t.http.post('/api/v1/auth/login').send({ email: acme.emails.viewer, password: PASSWORD }).expect(200);
      const first = res.headers['set-cookie'][0];
      expect(first).toMatch(/HttpOnly/i);
      expect(first).toMatch(/SameSite=Strict/i);
      expect(first).toMatch(/Path=\/api\/v1\/auth/);
      const cookie1 = first.split(';')[0];

      const r2 = await t.http.post('/api/v1/auth/refresh').set('Cookie', cookie1).expect(200);
      expect(r2.body.data.accessToken).toBeTruthy();
      const cookie2 = r2.headers['set-cookie'][0].split(';')[0];
      expect(cookie2).not.toBe(cookie1);

      await t.http.post('/api/v1/auth/refresh').set('Cookie', cookie1).expect(401); // reuse of a rotated token
      await t.http.post('/api/v1/auth/refresh').set('Cookie', cookie2).expect(401); // the whole family is now revoked
      await t.http.post('/api/v1/auth/refresh').expect(401);
    });

    it('refuses a cookie-authenticated refresh from a foreign origin', async () => {
      const res = await t.http.post('/api/v1/auth/login').send({ email: acme.emails.viewer, password: PASSWORD }).expect(200);
      const cookie = res.headers['set-cookie'][0].split(';')[0];
      await t.http.post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example').expect(403);
      await t.http.post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'http://localhost:3000').expect(200);
    });

    it('logout revokes the refresh token', async () => {
      const res = await t.http.post('/api/v1/auth/login').send({ email: acme.emails.viewer, password: PASSWORD }).expect(200);
      const cookie = res.headers['set-cookie'][0].split(';')[0];
      await t.http.post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
      await t.http.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('a user without a company is authenticated but holds no permissions', async () => {
      const email = `solo-${randomUUID().slice(0, 6)}@b.test`;
      await t.http.post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName: 'Solo User' }).expect(201);
      const token = await login(t, email);
      const me = (await t.http.get('/api/v1/auth/me').set(auth(token)).expect(200)).body.data;
      expect(me).toMatchObject({ company: null, permissions: [], role: null });
      await t.http.get('/api/v1/payments').set(auth(token)).expect(403);
      await t.http.get('/api/v1/beneficiaries').set(auth(token)).expect(403);
    });
  });

  describe('role-based access control', () => {
    it('stores exactly the permission matrix from PRD §5', async () => {
      const roles = await t.prisma.role.findMany({ include: { permissions: { include: { permission: true } } } });
      expect(roles.map((r) => r.name).sort()).toEqual([...ROLES].sort());
      for (const role of roles) {
        expect([role.name, role.permissions.map((p) => p.permission.key).sort()]).toEqual([role.name, [...ROLE_PERMISSIONS[role.name as keyof typeof ROLE_PERMISSIONS]].sort()]);
      }
      expect(await t.prisma.permission.count()).toBe(PERMISSIONS.length);
    });

    it('denies by default: every route is public, authenticated-only, or declares permissions', () => {
      const reflector = t.app.get(Reflector);
      const routes = listRoutes(t);
      expect(routes.length).toBeGreaterThan(50);
      const undecorated = routes
        .filter((r) => {
          const targets = [r.handler, r.controller];
          return !(reflector.getAllAndOverride(IS_PUBLIC, targets) || reflector.getAllAndOverride(AUTH_ONLY, targets) || reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets)?.length);
        })
        .map((r) => r.name);
      // A route without a decorator would be refused by the guard; none should exist by accident.
      expect(undecorated).toEqual([]);
    });

    // [method, path, roles allowed]. Anything else must receive 403.
    const A = 'admin', M = 'maker', P = 'approver', V = 'viewer', X = 'platform';
    const sweep: [string, string, string[]][] = [
      ['GET', '/api/v1/payments', [A, M, P, V, X]],
      ['GET', '/api/v1/beneficiaries', [A, M, P, V, X]],
      ['POST', '/api/v1/beneficiaries', [A, M]],
      ['POST', '/api/v1/fx/quotes', [A, M]],
      ['GET', '/api/v1/fx/quotes', [A, M, P, V, X]],
      ['POST', '/api/v1/payments', [A, M]],
      ['POST', `/api/v1/payments/${randomUUID()}/approve`, [A, P]],
      ['POST', `/api/v1/payments/${randomUUID()}/reject`, [A, P]],
      ['POST', `/api/v1/payments/${randomUUID()}/cancel`, [A, M]],
      ['POST', '/api/v1/kyb/submit', [A]],
      ['POST', `/api/v1/kyb/${randomUUID()}/approve`, [X]],
      ['POST', `/api/v1/kyb/${randomUUID()}/reject`, [X]],
      ['GET', '/api/v1/ledger/accounts', [A, P, V, X]],
      ['GET', '/api/v1/ledger/transactions', [A, P, V, X]],
      ['POST', '/api/v1/sandbox/wallet/topup', [A]],
      ['GET', '/api/v1/admin/compliance-queue', [X]],
      ['POST', `/api/v1/admin/compliance/${randomUUID()}/decision`, [X]],
      ['GET', '/api/v1/admin/compliance/rules', [X]],
      ['GET', '/api/v1/admin/webhook-events', [X]],
      ['GET', '/api/v1/admin/companies', [X]],
      ['GET', '/api/v1/admin/jobs', [X]],
      ['GET', '/api/v1/admin/ledger/trial-balance', [X]],
      ['GET', '/api/v1/reports/reconciliation', [X]],
      ['POST', '/api/v1/reports/reconciliation/run', [X]],
      ['GET', '/api/v1/audit-logs', [A, X]],
      ['POST', '/api/v1/compliance/preview', [A, M]],
      ['GET', '/api/v1/dashboard/summary', [A, M, P, V, X]],
    ];

    it.each(sweep)('%s %s is allowed only for the right roles', async (method, path, allowed) => {
      const tokens: Record<string, string> = { admin: acme.admin, maker: acme.maker, approver: acme.approver, viewer: acme.viewer, platform: platform.token };
      for (const [role, token] of Object.entries(tokens)) {
        const req = method === 'GET' ? t.http.get(path) : t.http.post(path).send({});
        const res = await req.set(auth(token));
        if (allowed.includes(role)) expect([role, res.status === 403 || res.status === 401]).toEqual([role, false]);
        else expect([role, res.status]).toEqual([role, 403]);
      }
    });

    it('company admins can manage users but can never grant a platform role', async () => {
      const res = await t.http.post(`/api/v1/companies/${acme.companyId}/users`).set(auth(acme.admin)).send({ email: 'x@co.test', fullName: 'X Y', role: 'PLATFORM_ADMIN', password: PASSWORD }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      await t.http.patch(`/api/v1/companies/${acme.companyId}/users/${acme.userIds.viewer}`).set(auth(acme.admin)).send({ role: 'PLATFORM_ADMIN' }).expect(400);
      await t.http.post(`/api/v1/companies/${acme.companyId}/users`).set(auth(acme.maker)).send({ email: 'y@co.test', fullName: 'X Y', role: 'VIEWER', password: PASSWORD }).expect(403);
      expect((await t.prisma.user.findMany({ where: { platformRoleId: { not: null } } })).length).toBe(1);
    });

    it('a role change takes effect immediately, without waiting for the token to expire', async () => {
      await t.http.post('/api/v1/fx/quotes').set(auth(acme.viewer)).send({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '500.00' }).expect(403);
      await t.http.patch(`/api/v1/companies/${acme.companyId}/users/${acme.userIds.viewer}`).set(auth(acme.admin)).send({ role: 'MAKER' }).expect(200);
      await t.http.post('/api/v1/fx/quotes').set(auth(acme.viewer)).send({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '500.00' }).expect(201);
      await t.http.patch(`/api/v1/companies/${acme.companyId}/users/${acme.userIds.viewer}`).set(auth(acme.admin)).send({ role: 'VIEWER' }).expect(200);
    });

    it('a suspended user is locked out at once, and the last administrator cannot be removed', async () => {
      await t.http.patch(`/api/v1/companies/${acme.companyId}/users/${acme.userIds.viewer}`).set(auth(acme.admin)).send({ status: 'SUSPENDED' }).expect(200);
      await t.http.get('/api/v1/payments').set(auth(acme.viewer)).expect(403);
      await t.http.patch(`/api/v1/companies/${acme.companyId}/users/${acme.userIds.viewer}`).set(auth(acme.admin)).send({ status: 'ACTIVE' }).expect(200);
      await t.http.get('/api/v1/payments').set(auth(acme.viewer)).expect(200);

      const last = await t.http.patch(`/api/v1/companies/${acme.companyId}/users/${acme.userIds.admin}`).set(auth(acme.admin)).send({ role: 'VIEWER' }).expect(409);
      expect(last.body.error.code).toBe('LAST_ADMIN');

      await t.prisma.user.update({ where: { id: acme.userIds.maker }, data: { status: 'SUSPENDED' } });
      await t.http.get('/api/v1/payments').set(auth(acme.maker)).expect(401);
      await t.http.post('/api/v1/auth/login').send({ email: acme.emails.maker, password: PASSWORD }).expect(401);
      await t.prisma.user.update({ where: { id: acme.userIds.maker }, data: { status: 'ACTIVE' } });
    });
  });

  describe('API conventions', () => {
    it('wraps responses in the envelope and carries request id and sandbox headers', async () => {
      const ok = await t.http.get('/api/v1/auth/me').set(auth(acme.admin)).set('X-Request-Id', 'req_client_supplied_1').expect(200);
      expect(ok.body.success).toBe(true);
      expect(ok.headers['x-request-id']).toBe('req_client_supplied_1');
      expect(ok.headers['x-paybridge-sandbox']).toBe('true');

      const err = await t.http.get(`/api/v1/payments/${randomUUID()}`).set(auth(acme.admin)).expect(404);
      expect(err.body).toEqual({ success: false, error: { code: 'PAYMENT_NOT_FOUND', message: expect.any(String) }, requestId: err.headers['x-request-id'] });
      expect(err.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);

      const list = await t.http.get('/api/v1/payments?page=1&pageSize=5').set(auth(acme.admin)).expect(200);
      expect(list.body.meta).toEqual({ page: 1, pageSize: 5, total: 0, totalPages: 1 });
    });

    it('rejects unknown properties (mass assignment), bad pagination and non-whitelisted sort fields', async () => {
      const extra = await t.http.post('/api/v1/beneficiaries').set(auth(acme.maker)).send({ name: 'Rahul Sharma', country: 'IN', bankName: 'Test Bank', accountNumber: '000111222333', ifsc: 'TEST0001234', accountHolderName: 'Rahul Sharma', companyId: randomUUID(), status: 'ACTIVE' }).expect(400);
      expect(JSON.stringify(extra.body.error.details)).toMatch(/companyId should not exist/);
      await t.http.get('/api/v1/payments?pageSize=1000').set(auth(acme.admin)).expect(400);
      await t.http.get('/api/v1/payments?sort=passwordHash:asc').set(auth(acme.admin)).expect(400);
      await t.http.get("/api/v1/payments?sort=createdAt:desc;drop table users").set(auth(acme.admin)).expect(400);
      await t.http.get('/api/v1/payments/not-a-uuid').set(auth(acme.admin)).expect(400);
      await t.http.get("/api/v1/beneficiaries?q=' OR 1=1 --").set(auth(acme.admin)).expect(200);
    });

    it('serves health endpoints outside the versioned prefix and Swagger under /api/docs', async () => {
      expect((await t.http.get('/health/live').expect(200)).body.data.status).toBe('ok');
      expect((await t.http.get('/health/ready').expect(200)).body.data).toEqual({ status: 'ok', checks: { database: 'up', redis: 'not_configured' } });
      expect((await t.http.get('/health').expect(200)).body.data.notice).toMatch(/No Real Money Movement/);
      const spec = (await t.http.get('/api/docs-json').expect(200)).body;
      expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/v1/payments', '/api/v1/fx/quotes', '/api/v1/webhooks/provider', '/api/v1/reports/reconciliation']));
      await t.http.get('/api/v1/internal/cron').expect(401);
    });

    it('sets security headers', async () => {
      const res = await t.http.get('/health/live').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});
