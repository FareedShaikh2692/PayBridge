import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config';
import { logger } from './logger';

interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Rate-limit counters. With Redis configured the counters are shared by every API instance, so the limit holds
 * across a scaled-out deployment. Without Redis — or while Redis is unreachable — it falls back to counters in
 * process memory, which still limit each instance.
 */
@Injectable()
export class RateLimitStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly redis?: Redis;
  private readonly memory = new ThrottlerStorageService();
  private warned = false;

  constructor(@Inject(CONFIG) config: Pick<AppConfig, 'REDIS_URL'>) {
    if (!config.REDIS_URL) return;
    this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000, retryStrategy: (times) => Math.min(times * 500, 10_000) });
    this.redis.on('error', (err) => {
      if (!this.warned) logger.warn({ err: String(err) }, 'rate-limit store unreachable; using in-memory counters');
      this.warned = true;
    });
    this.redis.on('ready', () => (this.warned = false));
  }

  get shared(): boolean {
    return this.redis?.status === 'ready';
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerRecord> {
    if (this.redis?.status === 'ready') {
      try {
        const redisKey = `paybridge:ratelimit:${throttlerName}:${key}`;
        const totalHits = await this.redis.incr(redisKey);
        let remaining = totalHits === 1 ? -1 : await this.redis.pttl(redisKey);
        if (remaining < 0) {
          await this.redis.pexpire(redisKey, ttl);
          remaining = ttl;
        }
        const seconds = Math.ceil(remaining / 1000);
        const isBlocked = totalHits > limit;
        return { totalHits, timeToExpire: seconds, isBlocked, timeToBlockExpire: isBlocked ? seconds : 0 };
      } catch {
        // fall through to the in-memory counters
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  onModuleDestroy(): void {
    this.memory.onApplicationShutdown();
    this.redis?.disconnect();
  }
}
