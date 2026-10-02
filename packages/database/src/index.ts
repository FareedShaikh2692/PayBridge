import { PrismaPg } from '@prisma/adapter-pg';
import { join } from 'node:path';
import { PrismaClient } from '../generated/client';

export * from '../generated/client';
export { bootstrapReferenceData, DEFAULT_COMPLIANCE_RULES } from './bootstrap';

/**
 * The generated client loads its query compiler from a .wasm file at runtime through a computed path, which
 * serverless file tracers cannot see. Naming the file with a static path here makes them include it.
 */
export const QUERY_COMPILER_WASM = join(__dirname, '../generated/client/query_compiler_bg.wasm');

/** Creates a Prisma client backed by node-postgres (no native query engine). */
export function createPrismaClient(connectionString = process.env.DATABASE_URL, options: { max?: number } = {}): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString, max: options.max ?? 10 });
  return new PrismaClient({ adapter });
}
