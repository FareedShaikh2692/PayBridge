import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  REDIS_URL: z.string().optional(),
  /** inline = the outbox table is the queue (serverless-friendly); bullmq = Redis-backed workers. */
  QUEUE_DRIVER: z.enum(['inline', 'bullmq']).default('inline'),
  WORKER_INLINE: bool(true),
  OUTBOX_POLL_MS: z.coerce.number().int().default(1000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().default(7),
  DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  FINGERPRINT_HMAC_KEY: z.string().min(32),
  WEBHOOK_SIGNING_SECRET: z.string().min(32),
  WEBHOOK_TARGET_URL: z.string().url().optional(),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().default(300),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: bool(false),
  FX_MID_RATE_AED_INR: z.string().default('22.70'),
  FX_SPREAD_PCT: z.string().default('0.50'),
  FX_FEE_AED: z.string().default('25.00'),
  FX_MIN_AMOUNT: z.string().default('100.00'),
  FX_MAX_AMOUNT: z.string().default('1000000.00'),
  QUOTE_TTL_SECONDS: z.coerce.number().int().default(60),
  KYB_AUTO_APPROVE: bool(false),
  MOCK_PROVIDER_DELAY_MS: z.coerce.number().int().default(2000),
  PASSWORD_SCRYPT_N: z.coerce.number().int().default(32768),
  RATE_LIMIT_DISABLED: bool(false),
  CRON_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SWAGGER_ENABLED: bool(true),
});

export type AppConfig = z.infer<typeof schema> & { corsOrigins: string[]; isServerless: boolean };

export const CONFIG = Symbol('CONFIG');

/** Validates the environment at boot. The process refuses to start with a missing or weak secret. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.QUEUE_DRIVER === 'bullmq' && !cfg.REDIS_URL) throw new Error('Invalid configuration:\n  - REDIS_URL is required when QUEUE_DRIVER=bullmq');
  return {
    ...cfg,
    corsOrigins: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isServerless: Boolean(env.VERCEL),
  };
}
