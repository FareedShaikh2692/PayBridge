import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ReconciliationStatus } from '@paybridge/database';
import { IsISO8601, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Actor } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { PageQuery } from '../../common/pagination';
import { ReconciliationService } from './reconciliation.service';

const STATUSES = ['MATCHED', 'MISMATCH', 'MISSING', 'DUPLICATE', 'REVIEW_REQUIRED'];

class ReportQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() runId?: string;
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: ReconciliationStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() paymentId?: string;
  @ApiPropertyOptional({ description: 'Company id' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ example: 'AED' }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional({ description: 'Latest run started on this day (UTC)', example: '2026-10-02' }) @IsOptional() @IsISO8601() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}
class RunDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

@ApiTags('Reconciliation')
@ApiBearerAuth()
@Controller('reports/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get()
  @Permissions('reconciliation.read')
  report(@Query() q: ReportQuery) {
    return this.reconciliation.report(q);
  }

  @Get('runs')
  @Permissions('reconciliation.read')
  runs(@Query() q: PageQuery) {
    return this.reconciliation.runs(q);
  }

  @Post('run')
  @HttpCode(202)
  @Permissions('reconciliation.run')
  run(@CurrentActor() actor: Actor, @Body() dto: RunDto) {
    return this.reconciliation.request(actor.userId, dto.from, dto.to);
  }
}
