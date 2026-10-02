import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import './env';

/** Applies migrations to the disposable test database before any suite runs. */
export default async function globalSetup(): Promise<void> {
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '../../../packages/database'),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
}
