import { Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WebhookEventStatus } from '@paybridge/database';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { Permissions, Public } from '../../common/decorators';
import { PageQuery } from '../../common/pagination';
import { WebhooksService } from './webhooks.service';

class WebhookQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'] }) @IsOptional() @IsIn(['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED']) status?: WebhookEventStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() paymentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() eventType?: string;
}

@ApiTags('Webhooks')
@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** Authenticated by HMAC signature, not by JWT. Always answers 200 for a verified event, duplicate or not. */
  @Post('webhooks/provider')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiHeader({ name: 'X-PayBridge-Signature', description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "t.rawBody">' })
  receive(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receive(req.rawBody, req.header('x-paybridge-signature'));
  }

  @Get('admin/webhook-events')
  @ApiBearerAuth()
  @Permissions('webhook.read')
  list(@Query() q: WebhookQuery) {
    return this.webhooks.list(q);
  }
}
