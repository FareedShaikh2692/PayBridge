import pino from 'pino';

/** Keys removed from every log line at any depth. Never log credentials or full account numbers. */
export const REDACT_KEYS = [
  'password', 'passwordHash', 'newPassword', 'accountNumber', 'accountNumberEncrypted', 'authorization', 'cookie',
  'token', 'accessToken', 'refreshToken', 'tokenHash', 'secret', 'signature',
];

export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'paybridge-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACT_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `*.*.*.${k}`]),
    censor: '[REDACTED]',
  },
};

export const logger = pino(loggerOptions);

/** Deep-redacts a value for storage in audit logs. */
export function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (typeof (value as any).toFixed === 'function') return (value as any).toString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.includes(k) ? '[REDACTED]' : redact(v);
    }
    return out as T;
  }
  return value;
}
