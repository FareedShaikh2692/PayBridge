import './env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { logger } from './common/logger';
import { OutboxService } from './modules/outbox/outbox.service';

/** Standalone worker: outbox relay, job processors and scheduled tasks, without an HTTP listener. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  await app.get(OutboxService).startBackground();
  logger.info('PayBridge worker started');
}

bootstrap().catch((err) => {
  logger.fatal({ err: String(err) }, 'worker failed to start');
  console.error(err);
  process.exit(1);
});
