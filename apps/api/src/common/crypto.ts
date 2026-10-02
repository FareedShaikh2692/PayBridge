import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// ── Passwords: scrypt (memory-hard KDF from node:crypto; no native add-on to ship) ──
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const KEY_LEN = 64;

function scryptAsync(password: string, salt: Buffer, N: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, { N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string, N = 32768): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N);
  return `scrypt$${N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, , , saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), Number(n));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ── Field encryption: AES-256-GCM, versioned so keys can rotate ──
export function encryptField(plaintext: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptField(payload: string, keyB64: string): string {
  const [version, iv, tag, ct] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

export function hmacHex(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// ── Webhook signatures: "t=<unix>,v1=<hex hmac of `t.rawBody`>" ──
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}

export type WebhookVerification = { valid: true } | { valid: false; reason: string };

export function verifyWebhookSignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  nowSeconds: number,
  toleranceSeconds: number,
): WebhookVerification {
  if (!header) return { valid: false, reason: 'missing signature header' };
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return { valid: false, reason: 'malformed signature header' };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { valid: false, reason: 'timestamp outside tolerance' };
  const expected = Buffer.from(hmacHex(secret, `${t}.${rawBody}`), 'hex');
  const actual = Buffer.from(v1, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { valid: false, reason: 'signature mismatch' };
  return { valid: true };
}
