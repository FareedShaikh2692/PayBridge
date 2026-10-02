import './env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './app.factory';
import { AppModule } from './app.module';
import { logger } from './common/logger';
import { AppConfig, CONFIG } from './config';
import { OutboxService } from './modules/outbox/outbox.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: ['error', 'warn'] });
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(process.env.PORT ?? config.PORT);
  // In development the worker runs inside the API process; in production-style setups run `start:worker`.
  // On serverless there is no long-lived process: the outbox drains after each request and from the daily cron.
  if (config.WORKER_INLINE) await app.get(OutboxService).startBackground();
  logger.info({ port: config.PORT, env: config.APP_ENV, queueDriver: config.QUEUE_DRIVER }, 'PayBridge API listening — Educational Sandbox, no real money movement');
}

bootstrap().catch((err) => {
  logger.fatal({ err: String(err) }, 'failed to start');
  console.error(err);
  process.exit(1);
});
