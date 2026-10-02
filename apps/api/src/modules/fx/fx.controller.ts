import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AMOUNT_REGEX, QUOTE_STATUSES } from '@paybridge/shared';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { Actor } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { PageQuery } from '../../common/pagination';
import { FxService } from './fx.service';

class CreateQuoteDto {
  @ApiProperty({ example: 'AED' }) @IsIn(['AED']) baseCurrency: string;
  @ApiProperty({ example: 'INR' }) @IsIn(['INR']) quoteCurrency: string;
  @ApiProperty({ example: '10000.00', description: 'Decimal string, at most two decimal places' })
  @IsString() @Matches(AMOUNT_REGEX, { message: 'baseAmount must be a decimal string with at most two decimal places.' }) baseAmount: string;
}
class QuoteQuery extends PageQuery {
  @ApiPropertyOptional({ enum: QUOTE_STATUSES }) @IsOptional() @IsIn(QUOTE_STATUSES as unknown as string[]) status?: string;
}

@ApiTags('FX')
@ApiBearerAuth()
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rates')
  @Permissions('quote.read')
  rates() {
    return this.fx.indicativeRates();
  }

  @Post('quotes')
  @Permissions('quote.create')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateQuoteDto) {
    return this.fx.createQuote(actor, dto);
  }

  @Get('quotes')
  @Permissions('quote.read')
  list(@CurrentActor() actor: Actor, @Query() q: QuoteQuery) {
    return this.fx.list(actor, q);
  }

  @Get('quotes/:id')
  @Permissions('quote.read')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.fx.get(actor, id);
  }
}
