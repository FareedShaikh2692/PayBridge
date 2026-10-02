import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Actor } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { CreatePaymentDto, OptionalReasonDto, PaymentQuery, ReasonDto } from './payments.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Permissions('payment.create')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per payment attempt; replays return the original payment.' })
  async create(@CurrentActor() actor: Actor, @Body() dto: CreatePaymentDto, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const { payment, replayed } = await this.payments.create(actor, dto, key);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return payment;
  }

  @Get()
  @Permissions('payment.read')
  list(@CurrentActor() actor: Actor, @Query() q: PaymentQuery) {
    return this.payments.list(actor, q);
  }

  @Get(':id')
  @Permissions('payment.read')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Permissions('payment.cancel')
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalReasonDto) {
    return this.payments.cancel(actor, id, dto.reason);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Permissions('payment.approve')
  approve(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalReasonDto) {
    return this.payments.approve(actor, id, dto.reason);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Permissions('payment.approve')
  reject(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.payments.reject(actor, id, dto.reason);
  }
}
