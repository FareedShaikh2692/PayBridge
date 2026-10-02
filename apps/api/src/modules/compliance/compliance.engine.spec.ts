import { Clock } from '../../common/clock';
import { statusFor } from '../reconciliation/reconciliation.service';
import { ComplianceEngine, aggregate } from './compliance.engine';
import { MockSanctionsProvider } from './sanctions.provider';
import { MockKYBProvider } from '../kyb/kyb.provider';
import { loadConfig } from '../../config';

const rule = (code: string, type: string, parameters: object, outcome: 'REVIEW' | 'REJECT') => ({ id: code, code, type, parameters, outcome, version: 1, name: code, enabled: true });
const RULES = [
  rule('AMOUNT_THRESHOLD', 'AMOUNT_THRESHOLD', { currency: 'AED', threshold: '50000.00' }, 'REVIEW'),
  rule('VELOCITY_24H', 'VELOCITY', { maxCount: 5, windowHours: 24 }, 'REVIEW'),
  rule('DESTINATION_COUNTRY', 'DESTINATION_COUNTRY', { allowed: ['IN'] }, 'REJECT'),
  rule('SANCTIONS_SCREEN', 'SANCTIONS', { subjects: ['beneficiary', 'company'] }, 'REJECT'),
  rule('PEP_SCREEN', 'PEP', { subjects: ['beneficiary'] }, 'REVIEW'),
];
const db = (recentPayments: number) => ({ complianceRule: { findMany: async () => RULES }, paymentOrder: { count: async () => recentPayments } }) as any;
const engine = new ComplianceEngine(new MockSanctionsProvider(), new Clock());
const ctx = (over: Partial<{ amount: string; name: string; holder: string; country: string; company: string }> = {}) => ({
  companyId: 'c1',
  companyName: over.company ?? 'Acme Trading LLC',
  beneficiary: { name: over.name ?? 'Rahul Sharma', accountHolderName: over.holder ?? over.name ?? 'Rahul Sharma', country: over.country ?? 'IN' },
  sourceAmount: over.amount ?? '10000.00',
  sourceCurrency: 'AED',
});
const fired = async (recent: number, over = {}) => {
  const r = await engine.evaluate(db(recent), ctx(over));
  return { result: r.result, fired: r.evaluations.filter((e) => e.triggered).map((e) => e.ruleCode), evaluated: r.evaluations.length };
};

describe('compliance rules', () => {
  it('evaluates every enabled rule and records the ones that did not fire', async () => {
    expect(await fired(0)).toEqual({ result: 'CLEAR', fired: [], evaluated: 5 });
  });
  it('amount threshold: strictly greater than', async () => {
    expect((await fired(0, { amount: '49999.99' })).result).toBe('CLEAR');
    expect((await fired(0, { amount: '50000.00' })).result).toBe('CLEAR');
    expect(await fired(0, { amount: '50000.01' })).toMatchObject({ result: 'REVIEW', fired: ['AMOUNT_THRESHOLD'] });
  });
  it('velocity: the sixth payment in the window is the first flagged', async () => {
    expect((await fired(4)).result).toBe('CLEAR');
    expect(await fired(5)).toMatchObject({ result: 'REVIEW', fired: ['VELOCITY_24H'] });
  });
  it('destination country allow-list', async () => {
    expect(await fired(0, { country: 'PK' })).toMatchObject({ result: 'REJECT', fired: ['DESTINATION_COUNTRY'] });
  });
  it('sanctions on beneficiary, account holder or company; PEP on beneficiary', async () => {
    expect(await fired(0, { name: 'test-sanction ltd' })).toMatchObject({ result: 'REJECT', fired: ['SANCTIONS_SCREEN'] });
    expect(await fired(0, { holder: 'Mr TEST-SANCTION' })).toMatchObject({ result: 'REJECT', fired: ['SANCTIONS_SCREEN'] });
    expect(await fired(0, { company: 'TEST-SANCTION Trading LLC' })).toMatchObject({ result: 'REJECT', fired: ['SANCTIONS_SCREEN'] });
    expect(await fired(0, { name: 'Ms TEST-PEP' })).toMatchObject({ result: 'REVIEW', fired: ['PEP_SCREEN'] });
  });
  it('fails safe: a screening outage holds the payment for review, never clears it', async () => {
    const r = await engine.evaluate(db(0), ctx({ name: 'TEST-SCREEN-TIMEOUT Ltd' }));
    expect(r.result).toBe('REVIEW');
    expect(r.evaluations.filter((e) => e.triggered).map((e) => [e.ruleCode, e.outcome])).toEqual([['SANCTIONS_SCREEN', 'REVIEW'], ['PEP_SCREEN', 'REVIEW']]);
  });
  it('aggregates REJECT over REVIEW over CLEAR', async () => {
    expect(aggregate([])).toBe('CLEAR');
    expect(aggregate(['CLEAR', 'REVIEW'])).toBe('REVIEW');
    expect(aggregate(['REVIEW', 'REJECT', 'CLEAR'])).toBe('REJECT');
    expect((await fired(9, { amount: '90000.00', name: 'TEST-SANCTION' })).result).toBe('REJECT');
  });
});

describe('mock KYB provider', () => {
  const p = new MockKYBProvider();
  const subject = (name: string) => ({ name, tradeLicenseNumber: 'TEST-TL-1', registrationNumber: 'TEST-REG-1', country: 'AE' });
  it('is deterministic', async () => {
    expect(await p.verify(subject('Acme Trading LLC'))).toMatchObject({ result: 'PASS', riskLevel: 'LOW' });
    expect(await p.verify(subject('TEST-KYB-REJECT LLC'))).toMatchObject({ result: 'FAIL', riskLevel: 'HIGH' });
    expect(await p.verify(subject('test-kyb-highrisk LLC'))).toMatchObject({ result: 'PASS', riskLevel: 'HIGH' });
  });
});

describe('reconciliation status precedence', () => {
  it('DUPLICATE > MISMATCH > MISSING > REVIEW_REQUIRED > MATCHED', () => {
    expect(statusFor([])).toBe('MATCHED');
    expect(statusFor(['STUCK_IN_PROCESSING'])).toBe('REVIEW_REQUIRED');
    expect(statusFor(['STUCK_IN_PROCESSING', 'LEDGER_ENTRY_MISSING'])).toBe('MISSING');
    expect(statusFor(['PROVIDER_PAYMENT_MISSING', 'AMOUNT_MISMATCH'])).toBe('MISMATCH');
    expect(statusFor(['PAID_BUT_PROVIDER_FAILED', 'DUPLICATE_PROVIDER_PAYMENT'])).toBe('DUPLICATE');
  });
});

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'j'.repeat(32), DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), FINGERPRINT_HMAC_KEY: 'f'.repeat(32), WEBHOOK_SIGNING_SECRET: 'w'.repeat(32) };
  it('refuses to start with a missing or weak secret', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' } as any)).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, DATA_ENCRYPTION_KEY: 'bm90LTMyLWJ5dGVz' } as any)).toThrow(/DATA_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined } as any)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, QUEUE_DRIVER: 'bullmq' } as any)).toThrow(/REDIS_URL/);
  });
  it('applies documented defaults', () => {
    expect(loadConfig(base as any)).toMatchObject({ QUOTE_TTL_SECONDS: 60, FX_MID_RATE_AED_INR: '22.70', FX_SPREAD_PCT: '0.50', FX_FEE_AED: '25.00', QUEUE_DRIVER: 'inline', KYB_AUTO_APPROVE: false, corsOrigins: ['http://localhost:3000'] });
  });
});
