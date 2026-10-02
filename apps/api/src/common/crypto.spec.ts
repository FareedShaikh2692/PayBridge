import { decryptField, encryptField, hashPassword, hmacHex, signWebhook, verifyPassword, verifyWebhookSignature } from './crypto';
import { toErrorBody } from './http';
import { DomainError } from './errors';
import pino from 'pino';
import { loggerOptions, redact } from './logger';
import { InvalidTransitionError } from '@paybridge/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const KEY = Buffer.alloc(32, 3).toString('base64');
const SECRET = 'unit-test-webhook-secret-unit-test';

describe('password hashing', () => {
  it('verifies the right password, rejects the wrong one, and salts every hash', async () => {
    const a = await hashPassword('Correct-Horse-Battery-1', 1024);
    const b = await hashPassword('Correct-Horse-Battery-1', 1024);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$1024\$8\$3\$/);
    expect(await verifyPassword('Correct-Horse-Battery-1', a)).toBe(true);
    expect(await verifyPassword('correct-horse-battery-1', a)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});

describe('field encryption', () => {
  it('round-trips, uses a fresh IV each time and detects tampering', () => {
    const one = encryptField('000111222333', KEY);
    const two = encryptField('000111222333', KEY);
    expect(one).not.toBe(two);
    expect(one).not.toContain('000111222333');
    expect(decryptField(one, KEY)).toBe('000111222333');
    const parts = one.split(':');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('999999999999').toString('base64')].join(':');
    expect(() => decryptField(tampered, KEY)).toThrow();
    expect(() => decryptField(one, Buffer.alloc(32, 4).toString('base64'))).toThrow();
    expect(() => decryptField('v2:a:b:c', KEY)).toThrow(/Unsupported/);
  });
  it('fingerprints are stable and key-dependent', () => {
    expect(hmacHex('k1', 'TEST0001234|000111222333')).toBe(hmacHex('k1', 'TEST0001234|000111222333'));
    expect(hmacHex('k1', 'x')).not.toBe(hmacHex('k2', 'x'));
  });
});

describe('webhook signature', () => {
  const body = JSON.stringify({ event_id: 'evt_1', event_type: 'payment.paid' });
  const now = 1_800_000_000;
  const good = signWebhook(SECRET, now, body);

  it('accepts a valid signature inside the tolerance window', () => {
    expect(verifyWebhookSignature(SECRET, good, body, now, 300)).toEqual({ valid: true });
    expect(verifyWebhookSignature(SECRET, good, body, now + 300, 300)).toEqual({ valid: true });
  });
  it.each([
    ['wrong secret', signWebhook('another-secret-another-secret-xx', now, body), body, now, 'signature mismatch'],
    ['altered body', good, body.replace('paid', 'failed'), now, 'signature mismatch'],
    ['stale timestamp', good, body, now + 301, 'timestamp outside tolerance'],
    ['future timestamp', good, body, now - 301, 'timestamp outside tolerance'],
    ['missing header', undefined, body, now, 'missing signature header'],
    ['malformed header', 'v1=abc', body, now, 'malformed signature header'],
    ['timestamp swapped', good.replace(`t=${now}`, `t=${now + 1}`), body, now, 'signature mismatch'],
  ])('rejects: %s', (_name, header, raw, at, reason) => {
    expect(verifyWebhookSignature(SECRET, header as string | undefined, raw as string, at as number, 300)).toEqual({ valid: false, reason });
  });
});

describe('redaction', () => {
  it('removes secrets at any depth before a value is stored in the audit log', () => {
    const out = redact({ email: 'a@b.test', password: 'p', nested: { accountNumber: '000111222333', list: [{ token: 't', keep: 1 }] }, when: new Date(0) });
    expect(out).toEqual({ email: 'a@b.test', password: '[REDACTED]', nested: { accountNumber: '[REDACTED]', list: [{ token: '[REDACTED]', keep: 1 }] }, when: new Date(0) });
  });
  it('the logger never writes passwords, tokens or account numbers', () => {
    const chunks: string[] = [];
    const child = pino({ ...loggerOptions, level: 'info' }, { write: (line: string) => chunks.push(line) });
    child.info({ password: 'hunter2hunter2', body: { accountNumber: '000111222333', authorization: 'Bearer abc.def.ghi', refreshToken: 'r' } }, 'request');
    const line = chunks.join('');
    expect(line).not.toMatch(/hunter2|000111222333|abc\.def\.ghi/);
    expect(line).toContain('[REDACTED]');
  });
});

describe('error mapping', () => {
  it('maps domain errors to their catalogue status and message', () => {
    expect(toErrorBody(new DomainError('QUOTE_EXPIRED'))).toMatchObject({ status: 409, code: 'QUOTE_EXPIRED', message: 'The FX quote has expired.', unexpected: false });
    expect(toErrorBody(new DomainError('INSUFFICIENT_FUNDS'))).toMatchObject({ status: 422 });
    expect(toErrorBody(new InvalidTransitionError('payment', 'PAID', 'FAILED'))).toMatchObject({ status: 409, code: 'INVALID_STATE_TRANSITION' });
  });
  it('maps framework and database failures without leaking internals', () => {
    expect(toErrorBody(new BadRequestException(['email must be an email']))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: ['email must be an email'] });
    expect(toErrorBody(new NotFoundException())).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(toErrorBody(new Error('relation "users" does not exist; SELECT * FROM users'))).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', unexpected: true });
    expect(toErrorBody(Object.assign(new Error('x'), { code: 'P1001' }))).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(toErrorBody(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toMatchObject({ status: 503 });
    expect(toErrorBody(new Error('LEDGER_IMBALANCE: transaction x does not balance'))).toMatchObject({ status: 500, code: 'LEDGER_IMBALANCE' });
    expect(toErrorBody(new Error('violates check constraint "ledger_accounts_customer_non_negative"'))).toMatchObject({ status: 422, code: 'INSUFFICIENT_FUNDS' });
  });
});
