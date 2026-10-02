import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { bootstrapReferenceData, DEFAULT_COMPLIANCE_RULES } from './bootstrap';

/** Creates a Prisma client backed by node-postgres (no native query engine). */
export function createPrismaClient(connectionString = process.env.DATABASE_URL, options: { max?: number } = {}): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString, max: options.max ?? 10 });
  return new PrismaClient({ adapter });
}
