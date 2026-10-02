import { randomUUID } from 'node:crypto';
import { PASSWORD, TestApp, auth, createPlatformAdmin, createTenant, createTestApp, login } from './helpers';

const company = (over: Record<string, unknown> = {}) => ({
  name: 'Acme Trading LLC', country: 'AE', tradeLicenseNumber: `TEST-TL-${randomUUID().slice(0, 8)}`, tradeLicenseExpiry: '2099-12-31', registrationNumber: `TEST-REG-${randomUUID().slice(0, 8)}`,
  businessType: 'General Trading', registeredAddress: 'Test Tower, Sheikh Zayed Road, Dubai', contactEmail: 'ops@acme.test', contactPhone: '+971500000000', website: 'https://acme.test', ...over,
});
const beneficiary = (over: Record<string, unknown> = {}) => ({ name: 'Rahul Sharma', country: 'IN', bankName: 'Test Bank', accountNumber: '000111222333', ifsc: 'TEST0001234', accountHolderName: 'Rahul Sharma', ...over });

describe('onboarding: company, KYB, beneficiaries and quotes', () => {
  let t: TestApp;
  let platform: { token: string; userId: string };

  const newUser = async () => {
    const email = `user-${randomUUID().slice(0, 8)}@co.test`;
    await t.http.post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName: 'Company Admin' }).expect(201);
    return { email, token: await login(t, email) };
  };

  beforeAll(async () => {
    t = await createTestApp();
    platform = await createPlatformAdmin(t);
  });
  afterAll(() => t.close());
  afterEach(() => t.clock.reset());

  describe('company registration', () => {
    it('creates the company with KYB in DRAFT and makes the creator its administrator', async () => {
      const u = await newUser();
      const res = (await t.http.post('/api/v1/companies').set(auth(u.token)).send(company()).expect(201)).body.data;
      expect(res).toMatchObject({ name: 'Acme Trading LLC', kybStatus: 'DRAFT', makerCheckerEnabled: true, tradeLicenseExpiry: '2099-12-31' });
      const me = (await t.http.get('/api/v1/auth/me').set(auth(u.token)).expect(200)).body.data;
      expect(me).toMatchObject({ role: 'COMPANY_ADMIN', company: { id: res.id, kybStatus: 'DRAFT' } });
      const audit = (await t.http.get('/api/v1/audit-logs?action=COMPANY_CREATED').set(auth(u.token)).expect(200)).body.data;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityType: 'company', entityId: res.id, companyId: res.id, requestId: expect.stringMatching(/^req_/) });
      // One company per user in the MVP.
      expect((await t.http.post('/api/v1/companies').set(auth(u.token)).send(company()).expect(409)).body.error.code).toBe('USER_ALREADY_HAS_COMPANY');
    });

    it('rejects a duplicate trade licence, an expired licence, a non-UAE country and malformed input', async () => {
      const first = await newUser();
      const data = company();
      await t.http.post('/api/v1/companies').set(auth(first.token)).send(data).expect(201);
      const second = await newUser();
      expect((await t.http.post('/api/v1/companies').set(auth(second.token)).send(company({ tradeLicenseNumber: data.tradeLicenseNumber })).expect(409)).body.error.code).toBe('COMPANY_ALREADY_EXISTS');
      const expired = await t.http.post('/api/v1/companies').set(auth(second.token)).send(company({ tradeLicenseExpiry: '2020-01-01' })).expect(400);
      expect(expired.body.error.details[0].field).toBe('tradeLicenseExpiry');
      await t.http.post('/api/v1/companies').set(auth(second.token)).send(company({ country: 'IN' })).expect(400);
      await t.http.post('/api/v1/companies').set(auth(second.token)).send(company({ contactEmail: 'nope' })).expect(400);
      await t.http.post('/api/v1/companies').set(auth(second.token)).send(company({ status: 'ACTIVE' })).expect(400);
      await t.http.post('/api/v1/companies').set(auth(second.token)).send({ name: 'Only A Name LLC' }).expect(400);
    });
  });

  describe('KYB workflow', () => {
    it('DRAFT → UNDER_REVIEW on submission, then APPROVED by a platform admin, provisioning the wallet', async () => {
      const u = await newUser();
      const c = (await t.http.post('/api/v1/companies').set(auth(u.token)).send(company()).expect(201)).body.data;
      const submitted = (await t.http.post('/api/v1/kyb/submit').set(auth(u.token)).expect(200)).body.data;
      expect(submitted).toMatchObject({ status: 'UNDER_REVIEW', riskLevel: 'LOW', verificationResult: { provider: 'mock-kyb', result: 'PASS' } });
      expect(submitted.submittedAt).toBeTruthy();
      expect((await t.http.post('/api/v1/kyb/submit').set(auth(u.token)).expect(409)).body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect((await t.http.get(`/api/v1/ledger/${c.id}/balance`).set(auth(u.token)).expect(200)).body.data.provisioned).toBe(false);

      await t.http.post(`/api/v1/kyb/${submitted.id}/approve`).set(auth(u.token)).send({}).expect(403); // a company cannot approve itself
      const approved = (await t.http.post(`/api/v1/kyb/${submitted.id}/approve`).set(auth(platform.token)).send({ riskLevel: 'MEDIUM', note: 'Documents consistent' }).expect(200)).body.data;
      expect(approved).toMatchObject({ status: 'APPROVED', riskLevel: 'MEDIUM', reviewedBy: platform.userId });
      expect((await t.http.get(`/api/v1/ledger/${c.id}/balance`).set(auth(u.token)).expect(200)).body.data).toMatchObject({ provisioned: true, available: '0.00', reserved: '0.00' });
      expect((await t.http.post(`/api/v1/kyb/${submitted.id}/approve`).set(auth(platform.token)).send({}).expect(409)).body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect((await t.http.post(`/api/v1/kyb/${submitted.id}/reject`).set(auth(platform.token)).send({ reason: 'too late' }).expect(409)).body.error.code).toBe('INVALID_STATE_TRANSITION');

      const actions = (await t.http.get(`/api/v1/audit-logs?entityId=${submitted.id}&sort=createdAt:asc`).set(auth(platform.token)).expect(200)).body.data.map((a: any) => a.action);
      expect(actions).toEqual(['KYB_SUBMITTED', 'KYB_UNDER_REVIEW', 'KYB_APPROVED', 'KYB_REVIEW_NOTE']);
    });

    it('cannot be approved before it is submitted', async () => {
      const u = await newUser();
      const c = (await t.http.post('/api/v1/companies').set(auth(u.token)).send(company()).expect(201)).body.data;
      expect((await t.http.post(`/api/v1/kyb/${c.kybProfileId}/approve`).set(auth(platform.token)).send({}).expect(409)).body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('rejection needs a reason; editing the company afterwards reopens the profile for resubmission', async () => {
      const u = await newUser();
      const c = (await t.http.post('/api/v1/companies').set(auth(u.token)).send(company({ name: 'TEST-KYB-REJECT Trading LLC' })).expect(201)).body.data;
      const submitted = (await t.http.post('/api/v1/kyb/submit').set(auth(u.token)).expect(200)).body.data;
      expect(submitted).toMatchObject({ status: 'UNDER_REVIEW', riskLevel: 'HIGH', verificationResult: { result: 'FAIL', reasons: ['MOCK_REGISTRY_MISMATCH'] } });

      // While under review the legal details are frozen; contact details are not.
      expect((await t.http.patch(`/api/v1/companies/${c.id}`).set(auth(u.token)).send({ name: 'Renamed LLC' }).expect(409)).body.error.code).toBe('INVALID_STATE_TRANSITION');
      await t.http.patch(`/api/v1/companies/${c.id}`).set(auth(u.token)).send({ contactPhone: '+971522222222' }).expect(200);

      await t.http.post(`/api/v1/kyb/${submitted.id}/reject`).set(auth(platform.token)).send({}).expect(400);
      const rejected = (await t.http.post(`/api/v1/kyb/${submitted.id}/reject`).set(auth(platform.token)).send({ reason: 'Registry mismatch' }).expect(200)).body.data;
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'Registry mismatch' });
      expect((await t.http.post('/api/v1/kyb/submit').set(auth(u.token)).expect(409)).body.error.code).toBe('INVALID_STATE_TRANSITION');

      const edited = (await t.http.patch(`/api/v1/companies/${c.id}`).set(auth(u.token)).send({ name: 'Corrected Trading LLC' }).expect(200)).body.data;
      expect(edited).toMatchObject({ name: 'Corrected Trading LLC', kybStatus: 'DRAFT' });
      expect((await t.http.post('/api/v1/kyb/submit').set(auth(u.token)).expect(200)).body.data).toMatchObject({ status: 'UNDER_REVIEW', riskLevel: 'LOW', rejectionReason: null });
    });

    it('records document metadata while the profile is open, and never a file', async () => {
      const u = await newUser();
      const c = (await t.http.post('/api/v1/companies').set(auth(u.token)).send(company()).expect(201)).body.data;
      const doc = { documentType: 'TRADE_LICENSE', fileName: 'trade-licence.pdf', checksum: 'a'.repeat(64), sizeBytes: 48211 };
      const created = (await t.http.post('/api/v1/kyb/documents').set(auth(u.token)).send(doc).expect(201)).body.data;
      expect(created).toMatchObject({ documentType: 'TRADE_LICENSE', fileName: 'trade-licence.pdf', sizeBytes: 48211 });
      await t.http.post('/api/v1/kyb/documents').set(auth(u.token)).send({ ...doc, documentType: 'PASSPORT_SCAN' }).expect(400);
      await t.http.post('/api/v1/kyb/documents').set(auth(u.token)).send({ ...doc, fileName: '../../etc/passwd' }).expect(400);
      await t.http.post('/api/v1/kyb/documents').set(auth(u.token)).send({ ...doc, checksum: 'not-a-hash' }).expect(400);
      await t.http.post('/api/v1/kyb/documents').set(auth(u.token)).send({ ...doc, content: 'JVBERi0xLjQK' }).expect(400); // no file bodies
      expect((await t.http.get(`/api/v1/kyb/${c.id}`).set(auth(u.token)).expect(200)).body.data.documents).toHaveLength(1);

      await t.http.post('/api/v1/kyb/submit').set(auth(u.token)).expect(200);
      expect((await t.http.post('/api/v1/kyb/documents').set(auth(u.token)).send(doc).expect(409)).body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect((await t.http.get('/api/v1/audit-logs?action=KYB_DOCUMENT_ADDED').set(auth(u.token)).expect(200)).body.data).toHaveLength(1);
    });

    it('expires when the trade licence lapses, which blocks new quotes', async () => {
      const tenant = await createTenant(t, platform.token);
      await t.prisma.company.update({ where: { id: tenant.companyId }, data: { tradeLicenseExpiry: new Date(Date.now() + 5 * 86_400_000) } });
      await t.prisma.kybProfile.update({ where: { companyId: tenant.companyId }, data: { expiresAt: new Date(Date.now() + 5 * 86_400_000) } });
      const quote = () => t.http.post('/api/v1/fx/quotes').set(auth(tenant.maker)).send({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '1000.00' });
      await quote().expect(201);
      t.clock.advance(7 * 86_400_000);
      expect((await quote().expect(403)).body.error.code).toBe('KYB_NOT_APPROVED');
      expect((await t.http.get(`/api/v1/kyb/${tenant.companyId}`).set(auth(tenant.admin)).expect(200)).body.data.status).toBe('EXPIRED');
    });

    it('lists companies for the platform admin, filterable by KYB status', async () => {
      const review = (await t.http.get('/api/v1/admin/companies?kybStatus=UNDER_REVIEW').set(auth(platform.token)).expect(200)).body;
      expect(review.data.length).toBeGreaterThan(0);
      expect(review.data.every((c: any) => c.kybStatus === 'UNDER_REVIEW')).toBe(true);
    });
  });

  describe('beneficiaries', () => {
    it('masks the account number everywhere and encrypts it at rest', async () => {
      const tenant = await createTenant(t, platform.token);
      const created = (await t.http.post('/api/v1/beneficiaries').set(auth(tenant.maker)).send(beneficiary({ accountNumber: '918273645546372' })).expect(201)).body.data;
      expect(created).toMatchObject({ accountNumberMasked: 'XXXXXX6372', status: 'ACTIVE', screeningResult: 'CLEAR', ifsc: 'TEST0001234' });

      const everywhere = [
        JSON.stringify(created),
        JSON.stringify((await t.http.get(`/api/v1/beneficiaries/${created.id}`).set(auth(tenant.viewer)).expect(200)).body),
        JSON.stringify((await t.http.get('/api/v1/beneficiaries').set(auth(tenant.viewer)).expect(200)).body),
        JSON.stringify((await t.http.get('/api/v1/audit-logs?pageSize=100').set(auth(tenant.admin)).expect(200)).body),
        JSON.stringify(await t.prisma.auditLog.findMany({ where: { companyId: tenant.companyId } })),
      ];
      for (const text of everywhere) expect(text).not.toContain('918273645546372');

      const row = await t.prisma.beneficiary.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.accountNumberEncrypted).toMatch(/^v1:/);
      expect(row.accountNumberEncrypted).not.toContain('918273645546372');
      expect(row.accountFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.accountNumberLast4).toBe('6372');
    });

    it('validates IFSC, account number and country, and refuses duplicates', async () => {
      const tenant = await createTenant(t, platform.token);
      const post = (body: object) => t.http.post('/api/v1/beneficiaries').set(auth(tenant.maker)).send(body);
      const badIfsc = await post(beneficiary({ ifsc: 'HDFC1234567' })).expect(400);
      expect(JSON.stringify(badIfsc.body.error.details)).toMatch(/ifsc/);
      await post(beneficiary({ ifsc: 'TEST00012' })).expect(400);
      await post(beneficiary({ accountNumber: '12345678' })).expect(400);
      await post(beneficiary({ accountNumber: '1234567890123456789' })).expect(400);
      await post(beneficiary({ accountNumber: '12345ABC90' })).expect(400);
      await post(beneficiary({ country: 'AE' })).expect(400);
      await post(beneficiary({ ifsc: 'test0001234' })).expect(201); // normalised to upper case
      expect((await post(beneficiary()).expect(409)).body.error.code).toBe('BENEFICIARY_ALREADY_EXISTS');
      await post(beneficiary({ accountNumber: '000111222334' })).expect(201); // a different account is fine
      const other = await createTenant(t, platform.token);
      await t.http.post('/api/v1/beneficiaries').set(auth(other.maker)).send(beneficiary()).expect(201); // uniqueness is per company
    });

    it('blocks a sanctions match, flags a PEP, and never lets a blocked beneficiary be reactivated', async () => {
      const tenant = await createTenant(t, platform.token);
      const post = (body: object) => t.http.post('/api/v1/beneficiaries').set(auth(tenant.maker)).send(body);
      const blocked = (await post(beneficiary({ name: 'TEST-SANCTION Trading', accountNumber: '111222333444' })).expect(201)).body.data;
      expect(blocked).toMatchObject({ status: 'BLOCKED', screeningResult: 'MATCH' });
      const holder = (await post(beneficiary({ accountHolderName: 'Mr test-sanction', accountNumber: '111222333445' })).expect(201)).body.data;
      expect(holder.status).toBe('BLOCKED');
      const pep = (await post(beneficiary({ name: 'TEST-PEP Person', accountNumber: '111222333446' })).expect(201)).body.data;
      expect(pep).toMatchObject({ status: 'ACTIVE', screeningResult: 'PEP_MATCH' });
      const pending = (await post(beneficiary({ name: 'TEST-SCREEN-TIMEOUT Ltd', accountNumber: '111222333447' })).expect(201)).body.data;
      expect(pending).toMatchObject({ status: 'ACTIVE', screeningResult: 'PENDING' });

      expect((await t.http.patch(`/api/v1/beneficiaries/${blocked.id}`).set(auth(tenant.maker)).send({ status: 'ACTIVE' }).expect(422)).body.error.code).toBe('BENEFICIARY_NOT_ACTIVE');
      await t.http.patch(`/api/v1/beneficiaries/${blocked.id}`).set(auth(tenant.maker)).send({ status: 'BLOCKED' }).expect(400);
      // Renaming re-screens.
      const clean = (await post(beneficiary({ name: 'Clean Supplier', accountNumber: '111222333448' })).expect(201)).body.data;
      expect((await t.http.patch(`/api/v1/beneficiaries/${clean.id}`).set(auth(tenant.maker)).send({ name: 'TEST-SANCTION Supplier' }).expect(200)).body.data.status).toBe('BLOCKED');
      const flagged = (await t.http.get('/api/v1/audit-logs?action=COMPLIANCE_FLAGGED').set(auth(tenant.admin)).expect(200)).body.data;
      expect(flagged.length).toBeGreaterThanOrEqual(2);
    });

    it('is deactivated rather than deleted', async () => {
      const tenant = await createTenant(t, platform.token);
      const b = (await t.http.post('/api/v1/beneficiaries').set(auth(tenant.maker)).send(beneficiary()).expect(201)).body.data;
      expect([404, 405]).toContain((await t.http.delete(`/api/v1/beneficiaries/${b.id}`).set(auth(tenant.admin))).status);
      expect((await t.http.patch(`/api/v1/beneficiaries/${b.id}`).set(auth(tenant.maker)).send({ status: 'INACTIVE' }).expect(200)).body.data.status).toBe('INACTIVE');
      expect((await t.http.get('/api/v1/beneficiaries?status=INACTIVE').set(auth(tenant.viewer)).expect(200)).body.data).toHaveLength(1);
      await t.http.patch(`/api/v1/beneficiaries/${b.id}`).set(auth(tenant.viewer)).send({ status: 'ACTIVE' }).expect(403);
    });
  });

  describe('FX quotes', () => {
    it('prices the canonical example and records an audit entry', async () => {
      const tenant = await createTenant(t, platform.token);
      const rates = (await t.http.get('/api/v1/fx/rates').set(auth(tenant.viewer)).expect(200)).body.data;
      expect(rates).toMatchObject({ midMarketRate: '22.700000', spreadPercentage: '0.5000', customerRate: '22.586500', feeAmount: '25.00', quoteTtlSeconds: 60 });

      const q = (await t.http.post('/api/v1/fx/quotes').set(auth(tenant.maker)).send({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '10000' }).expect(201)).body.data;
      expect(q).toMatchObject({ baseAmount: '10000.00', midMarketRate: '22.700000', spreadPercentage: '0.5000', customerRate: '22.586500', feeAmount: '25.00', fxMarginAmount: '50.00', recipientAmount: '225865.00', totalDebitAmount: '10025.00', status: 'ACTIVE' });
      expect(new Date(q.expiresAt).getTime() - new Date(q.createdAt).getTime()).toBe(60_000);
      expect(q.id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await t.http.get('/api/v1/audit-logs?action=QUOTE_CREATED').set(auth(tenant.admin)).expect(200)).body.data[0].entityId).toBe(q.id);

      t.clock.advance(20_000);
      expect((await t.http.get(`/api/v1/fx/quotes/${q.id}`).set(auth(tenant.maker)).expect(200)).body.data.secondsRemaining).toBe(40);
    });

    it('rejects amounts that are out of range, over-precise or not strings, and other corridors', async () => {
      const tenant = await createTenant(t, platform.token);
      const post = (body: object) => t.http.post('/api/v1/fx/quotes').set(auth(tenant.maker)).send(body);
      expect((await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '99.99' }).expect(422)).body.error.code).toBe('AMOUNT_OUT_OF_RANGE');
      await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '1000000.01' }).expect(422);
      await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '100.001' }).expect(400);
      await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: 1000 }).expect(400);
      await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '-100.00' }).expect(400);
      await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '1e5' }).expect(400);
      await post({ baseCurrency: 'USD', quoteCurrency: 'INR', baseAmount: '1000.00' }).expect(400);
      await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '1000.00', customerRate: '99' }).expect(400);
      await post({ baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: '100.00' }).expect(201);
    });
  });
});
