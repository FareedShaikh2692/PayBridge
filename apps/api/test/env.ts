// Test configuration. Throwaway values; nothing here is a real secret.
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://paybridge@localhost:54329/paybridge_test';
process.env.DATABASE_POOL_MAX = '15';
process.env.QUEUE_DRIVER = 'inline';
process.env.JWT_SECRET = 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.FINGERPRINT_HMAC_KEY = 'test-fingerprint-key-test-fingerprint-key';
process.env.WEBHOOK_SIGNING_SECRET = 'test-webhook-secret-test-webhook-secret';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.MOCK_PROVIDER_DELAY_MS = '0';
process.env.PASSWORD_SCRYPT_N = '1024';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.KYB_AUTO_APPROVE = 'false';
delete process.env.REDIS_URL;
