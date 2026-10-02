import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient, createPrismaClient } from '@paybridge/database';
import { AppConfig, CONFIG } from '../config';

export type Tx = Prisma.TransactionClient;
/** Either the root client or a transaction client. */
export type Db = PrismaClient | Tx;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.client = createPrismaClient(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
  }

  /** Runs `fn` in one database transaction (READ COMMITTED; contended rows are locked explicitly). */
  transaction<T>(fn: (tx: Tx) => Promise<T>, options: { timeoutMs?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {}): Promise<T> {
    return this.client.$transaction(fn, { maxWait: 10_000, timeout: options.timeoutMs ?? 20_000, isolationLevel: options.isolationLevel });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
