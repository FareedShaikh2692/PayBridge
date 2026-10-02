import './env';
import 'reflect-metadata';
import { createApp } from './app.factory';
import { logger } from './common/logger';
import { AppConfig, CONFIG } from './config';
import { OutboxService } from './modules/outbox/outbox.service';

async function bootstrap() {
  const app = await createApp();
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(process.env.PORT ?? config.PORT);
  // In development the worker runs inside the API process; in production-style setups run `start:worker`.
  if (config.WORKER_INLINE) await app.get(OutboxService).startBackground();
  logger.info({ port: config.PORT, env: config.APP_ENV, queueDriver: config.QUEUE_DRIVER }, 'PayBridge API listening — Educational Sandbox, no real money movement');
}

bootstrap().catch((err) => {
  logger.fatal({ err: String(err) }, 'failed to start');
  console.error(err);
  process.exit(1);
});
