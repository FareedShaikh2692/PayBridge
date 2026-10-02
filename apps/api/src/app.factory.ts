import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SANDBOX_LABEL } from '@paybridge/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, CONFIG } from './config';

const SWAGGER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14';

/** Everything that shapes the HTTP surface, shared by the server entry point and the integration tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(CONFIG);
  const express = app as NestExpressApplication;

  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: '64kb' });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'X-PayBridge-Sandbox', 'Retry-After'],
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  // whitelist + forbidNonWhitelisted: unknown properties are rejected, which blocks mass assignment.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));

  if (config.SWAGGER_ENABLED) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('PayBridge API')
        .setDescription(`${SANDBOX_LABEL}. A simulated UAE → India SME payments platform. Amounts and rates are decimal strings; timestamps are ISO 8601 UTC.`)
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'PayBridge API — Sandbox',
      customCssUrl: `${SWAGGER_CDN}/swagger-ui.min.css`,
      customJs: [`${SWAGGER_CDN}/swagger-ui-bundle.min.js`, `${SWAGGER_CDN}/swagger-ui-standalone-preset.min.js`],
    });
  }
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: false, logger: ['error', 'warn'] });
  configureApp(app);
  app.enableShutdownHooks();
  return app;
}
