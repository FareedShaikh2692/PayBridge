import { randomUUID } from 'node:crypto';
import { PASSWORD, Tenant, TestApp, auth, createBeneficiary, createPayment, createPlatformAdmin, createQuote, createTenant, createTestApp, listRoutes, postPayment } from './helpers';

/**
 * Invariant I8 — Company A cannot access Company B's data.
 *
 * The table below must name every route that carries a path parameter. A new parameterised route added
 * without an isolation case fails the coverage test at the bottom.
 */
describe('I8: tenant isolation', () => {
  let t: TestApp;
  let platform: { token: string; userId: string };
  let a: Tenant;
  let b: Tenant;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    platform = await createPlatformAdmin(t);
    a = await createTenant(t, platform.token, { name: 'Acme Trading LLC' });
    b = await createTenant(t, platform.token, { name: 'Gulf Imports LLC' });

    await createPayment(t, a);
    const bPayment = await createPayment(t, b, { amount: '60000.00' }); // in compliance review, awaiting approval
    ids.payment = bPayment.id;
    ids.beneficiary = bPayment.beneficiaryId;
    ids.quote = bPayment.quoteId;
    ids.freshQuote = (await createQuote(t, b.maker)).id;
    ids.company = b.companyId;
    ids.kyb = b.kybProfileId;
    ids.user = b.userIds.viewer;
    ids.account = (await t.prisma.ledgerAccount.findFirstOrThrow({ where: { companyId: b.companyId, code: '2000' } })).id;
    ids.systemAccount = (await t.prisma.ledgerAccount.findFirstOrThrow({ where: { companyId: null, code: '4000' } })).id;
  });
  afterAll(() => t.close());

  // [method, route pattern, concrete path builder, body, expected status for every Company A role that reaches the handler]
  const cases: [string, string, () => string, object | undefined][] = [
    ['GET', '/companies/:id', () => `/companies/${ids.company}`, undefined],
    ['PATCH', '/companies/:id', () => `/companies/${ids.company}`, { contactPhone: '+971511111111' }],
    ['GET', '/companies/:id/users', () => `/companies/${ids.company}/users`, undefined],
    ['POST', '/companies/:id/users', () => `/companies/${ids.company}/users`, { email: `intruder-${randomUUID().slice(0, 6)}@co.test`, fullName: 'Intruder', role: 'COMPANY_ADMIN', password: PASSWORD }],
    ['PATCH', '/companies/:id/users/:userId', () => `/companies/${ids.company}/users/${ids.user}`, { role: 'COMPANY_ADMIN' }],
    ['GET', '/kyb/:companyId', () => `/kyb/${ids.company}`, undefined],
    ['GET', '/beneficiaries/:id', () => `/beneficiaries/${ids.beneficiary}`, undefined],
    ['PATCH', '/beneficiaries/:id', () => `/beneficiaries/${ids.beneficiary}`, { name: 'Hijacked' }],
    ['GET', '/fx/quotes/:id', () => `/fx/quotes/${ids.quote}`, undefined],
    ['GET', '/payments/:id', () => `/payments/${ids.payment}`, undefined],
    ['POST', '/payments/:id/cancel', () => `/payments/${ids.payment}/cancel`, {}],
    ['POST', '/payments/:id/approve', () => `/payments/${ids.payment}/approve`, {}],
    ['POST', '/payments/:id/reject', () => `/payments/${ids.payment}/reject`, { reason: 'not mine to reject' }],
    ['GET', '/compliance/checks/:paymentId', () => `/compliance/checks/${ids.payment}`, undefined],
    ['GET', '/ledger/accounts/:id', () => `/ledger/accounts/${ids.account}`, undefined],
    ['GET', '/ledger/:companyId/balance', () => `/ledger/${ids.company}/balance`, undefined],
  ];
  // Platform-only parameterised routes: a tenant must be refused before any lookup happens.
  const platformOnly: [string, string, () => string, object | undefined][] = [
    ['POST', '/kyb/:id/approve', () => `/kyb/${ids.kyb}/approve`, { riskLevel: 'LOW' }],
    ['POST', '/kyb/:id/reject', () => `/kyb/${ids.kyb}/reject`, { reason: 'not allowed' }],
    ['POST', '/admin/compliance/:id/decision', () => `/admin/compliance/${ids.payment}/decision`, { decision: 'CLEAR', reason: 'self-service' }],
    ['PATCH', '/admin/compliance/rules/:id', () => `/admin/compliance/rules/${randomUUID()}`, { enabled: false }],
    ['POST', '/admin/jobs/:id/retry', () => `/admin/jobs/${randomUUID()}/retry`, {}],
    ['POST', '/admin/compliance/:id/rescreen', () => `/admin/compliance/${ids.payment}/rescreen`, {}],
    ['POST', '/sandbox/provider/payments/:paymentId/return', () => `/sandbox/provider/payments/${ids.payment}/return`, {}],
  ];

  const call = (method: string, path: string, token: string, body?: object) => {
    const req = method === 'GET' ? t.http.get(`/api/v1${path}`) : method === 'PATCH' ? t.http.patch(`/api/v1${path}`).send(body) : t.http.post(`/api/v1${path}`).send(body);
    return req.set(auth(token));
  };

  it.each(cases)('%s %s on another tenant returns 404 (or 403 without the permission) and leaks nothing', async (method, _pattern, path, body) => {
    for (const role of ['admin', 'maker', 'approver', 'viewer'] as const) {
      const res = await call(method, path(), a[role], body);
      expect([role, [403, 404].includes(res.status)]).toEqual([role, true]);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/Gulf Imports|accountNumberMasked|sourceAmount|available/);
    }
    // The administrator holds every company permission, so for them the refusal must be the tenant check itself.
    expect((await call(method, path(), a.admin, body)).status).toBe(404);
  });

  it.each(platformOnly)('%s %s is refused for every tenant role', async (method, _pattern, path, body) => {
    for (const role of ['admin', 'maker', 'approver', 'viewer'] as const) {
      expect((await call(method, path(), a[role], body)).status).toBe(403);
    }
  });

  it('nothing in Company B changed', async () => {
    const payment = await t.prisma.paymentOrder.findUniqueOrThrow({ where: { id: ids.payment } });
    expect(payment).toMatchObject({ status: 'COMPLIANCE_REVIEW', approvalStatus: 'PENDING', complianceStatus: 'REVIEW' });
    expect((await t.prisma.beneficiary.findUniqueOrThrow({ where: { id: ids.beneficiary } })).name).not.toBe('Hijacked');
    expect(await t.prisma.companyUser.count({ where: { companyId: b.companyId } })).toBe(4);
    expect((await t.prisma.kybProfile.findUniqueOrThrow({ where: { id: ids.kyb } })).status).toBe('APPROVED');
  });

  it('covers every parameterised route', () => {
    const covered = new Set([...cases, ...platformOnly].map(([method, pattern]) => `${method} ${pattern}`));
    const parameterised = listRoutes(t).filter((r) => r.path.includes(':')).map((r) => `${r.method} ${r.path}`);
    expect(parameterised.length).toBeGreaterThan(15);
    expect(parameterised.filter((r) => !covered.has(r))).toEqual([]);
  });

  it('list endpoints return only the caller\'s own rows', async () => {
    for (const path of ['/payments', '/beneficiaries', '/fx/quotes', '/ledger/transactions', '/audit-logs?pageSize=100']) {
      const res = await call('GET', path, a.admin).expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) expect([path, row.companyId]).toEqual([path, a.companyId]);
    }
    const accounts = (await call('GET', '/ledger/accounts', a.admin).expect(200)).body.data;
    expect(accounts.map((x: any) => x.code).sort()).toEqual(['2000', '2010']); // no system accounts, no other tenant
    expect(accounts.every((x: any) => x.companyId === a.companyId)).toBe(true);
    // A system account is not readable by a tenant either.
    await call('GET', `/ledger/accounts/${ids.systemAccount}`, a.admin).expect(404);
  });

  it('filters that name another tenant are ignored, not honoured', async () => {
    const payments = (await call('GET', `/payments?companyId=${b.companyId}`, a.admin).expect(200)).body.data;
    expect(payments.every((p: any) => p.companyId === a.companyId)).toBe(true);
    const accounts = (await call('GET', `/ledger/accounts?companyId=${b.companyId}`, a.admin).expect(200)).body.data;
    expect(accounts.every((x: any) => x.companyId === a.companyId)).toBe(true);
    const audit = (await call('GET', `/audit-logs?companyId=${b.companyId}`, a.admin).expect(200)).body.data;
    expect(audit.every((x: any) => x.companyId === a.companyId)).toBe(true);
    const byBeneficiary = (await call('GET', `/payments?beneficiaryId=${ids.beneficiary}`, a.admin).expect(200)).body.data;
    expect(byBeneficiary).toEqual([]);
  });

  it("cannot pay with another tenant's beneficiary or quote", async () => {
    const ownBeneficiary = await createBeneficiary(t, a.maker, 'Mumbai Supplies Pvt Ltd');
    const ownQuote = await createQuote(t, a.maker);
    const foreignBeneficiary = await postPayment(t, a.maker, { quoteId: ownQuote.id, beneficiaryId: ids.beneficiary }).expect(404);
    expect(foreignBeneficiary.body.error.code).toBe('BENEFICIARY_NOT_FOUND');
    const foreignQuote = await postPayment(t, a.maker, { quoteId: ids.freshQuote, beneficiaryId: ownBeneficiary.id }).expect(404);
    expect(foreignQuote.body.error.code).toBe('QUOTE_NOT_FOUND');
    // Company B's quote is untouched and still usable by Company B.
    expect((await t.prisma.fxQuote.findUniqueOrThrow({ where: { id: ids.freshQuote } })).status).toBe('ACTIVE');
    await postPayment(t, a.maker, { quoteId: ownQuote.id, beneficiaryId: ownBeneficiary.id }).expect(201);
  });

  it('the database itself refuses a cross-tenant reference (composite foreign keys)', async () => {
    const quote = await createQuote(t, a.maker);
    await expect(
      t.prisma.paymentOrder.create({
        data: {
          reference: `PB-X-${randomUUID().slice(0, 8)}`, companyId: a.companyId, beneficiaryId: ids.beneficiary, quoteId: quote.id,
          sourceCurrency: 'AED', sourceAmount: '10000', destinationCurrency: 'INR', destinationAmount: '225865', feeAmount: '25', fxMarginAmount: '50',
          totalDebitAmount: '10025', exchangeRate: '22.5865', complianceStatus: 'CLEAR', approvalStatus: 'NOT_REQUIRED', idempotencyKey: randomUUID(), createdById: a.userIds.maker,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });

  it('the same idempotency key in two companies creates two independent payments', async () => {
    const key = randomUUID();
    const pa = (await postPayment(t, a.maker, { quoteId: (await createQuote(t, a.maker)).id, beneficiaryId: (await createBeneficiary(t, a.maker)).id }, key).expect(201)).body.data;
    const pb = (await postPayment(t, b.maker, { quoteId: (await createQuote(t, b.maker)).id, beneficiaryId: (await createBeneficiary(t, b.maker)).id }, key).expect(201)).body.data;
    expect(pa.id).not.toBe(pb.id);
    expect([pa.companyId, pb.companyId]).toEqual([a.companyId, b.companyId]);
  });

  it('platform administrators can read across tenants but cannot transact for them', async () => {
    const payments = (await call('GET', '/payments?pageSize=100', platform.token).expect(200)).body.data;
    expect(new Set(payments.map((p: any) => p.companyId))).toEqual(new Set([a.companyId, b.companyId]));
    await call('GET', `/payments/${ids.payment}`, platform.token).expect(200);
    await call('POST', '/beneficiaries', platform.token, { name: 'X Y', country: 'IN', bankName: 'Test Bank', accountNumber: '000111222333', ifsc: 'TEST0001234', accountHolderName: 'X Y' }).expect(403);
    await call('POST', `/payments/${ids.payment}/approve`, platform.token, {}).expect(403);
    await call('POST', '/companies', platform.token, {}).expect(400);
  });
});
