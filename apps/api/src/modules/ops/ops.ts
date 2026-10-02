import { Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { SANDBOX_LABEL } from '@paybridge/shared';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { Permissions, Public } from '../../common/decorators';
import { DomainError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { FxService } from '../fx/fx.service';
import { KybService } from '../kyb/kyb.service';
import { OutboxService } from '../outbox/outbox.service';

type Check = 'up' | 'down' | 'not_configured';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async database(): Promise<Check> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async redis(): Promise<Check> {
    if (!this.config.REDIS_URL) return 'not_configured';
    const { default: Redis } = await import('ioredis');
    const client = new Redis(this.config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1500, enableOfflineQueue: false, retryStrategy: () => null });
    client.on('error', () => undefined);
    try {
      await client.connect();
      return (await client.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      client.disconnect();
    }
  }

  @Get()
  @Public()
  health() {
    return { status: 'ok', service: 'paybridge-api', notice: SANDBOX_LABEL, env: this.config.APP_ENV, queueDriver: this.config.QUEUE_DRIVER, time: new Date().toISOString() };
  }

  /** Liveness: the process is running. */
  @Get('live')
  @Public()
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: 503 when PostgreSQL is unreachable. Redis being down only degrades the service — the outbox
   * keeps accepting work and drains when Redis returns.
   */
  @Get('ready')
  @Public()
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([this.database(), this.redis()]);
    const status = database === 'down' ? 'unavailable' : redis === 'down' ? 'degraded' : 'ok';
    if (database === 'down') res.status(503);
    return { status, checks: { database, redis } };
  }
}

@ApiTags('Operations')
@Controller()
export class OpsController {
  constructor(
    private readonly outbox: OutboxService,
    private readonly fx: FxService,
    private readonly kyb: KybService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    // ExpireQuotes job
    this.outbox.registerScheduled('ExpireQuotes', 15_000, () => this.fx.sweepExpired());
    this.outbox.registerScheduled('ExpireKyb', 3_600_000, () => this.kyb.expireLapsed());
  }

  /** Invoked by a scheduler on serverless deployments, where no long-lived worker exists. */
  @Get('internal/cron')
  @Public()
  @ApiExcludeEndpoint()
  async cron(@Headers('authorization') authorization?: string) {
    const secret = this.config.CRON_SECRET;
    const presented = Buffer.from(authorization ?? '');
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    if (!secret || presented.length !== expected.length || !timingSafeEqual(presented, expected)) throw new DomainError('UNAUTHENTICATED');
    const scheduled = await this.outbox.runScheduled();
    const drained = await this.outbox.drain({ maxMs: 25_000, waitForScheduledMs: 5_000 });
    return { scheduled, drained };
  }

  @Get('admin/jobs')
  @ApiBearerAuth()
  @Permissions('platform.admin')
  async jobs() {
    return { driver: this.config.QUEUE_DRIVER, counts: await this.outbox.stats(), deadLetters: await this.outbox.listDeadLetters() };
  }

  /** Re-drive a dead-lettered job. Handlers are idempotent, so this is always safe. */
  @Post('admin/jobs/:id/retry')
  @HttpCode(200)
  @ApiBearerAuth()
  @Permissions('platform.admin')
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.outbox.retry(id))) throw new DomainError('NOT_FOUND', 'No dead-lettered job with this id.');
    return { requeued: true };
  }
}
