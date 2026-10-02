import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { AMOUNT_REGEX, IDEMPOTENCY_KEY_REGEX } from '@paybridge/shared';
import { IsString, Matches } from 'class-validator';
import { Actor, requireCompany } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { DomainError } from '../../common/errors';
import { KybService } from '../kyb/kyb.service';
import { LedgerService } from '../ledger/ledger.service';

class TopupDto {
  @ApiProperty({ example: '100000.00', description: 'AED, decimal string' }) @IsString() @Matches(AMOUNT_REGEX) amount: string;
}

@ApiTags('Sandbox')
@ApiBearerAuth()
@Controller('sandbox')
export class SandboxController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly kyb: KybService,
  ) {}

  /** Simulates a customer funding their wallet. A ledger posting is made; no money moves anywhere. */
  @Post('wallet/topup')
  @HttpCode(200)
  @Permissions('wallet.topup')
  async topup(@CurrentActor() actor: Actor, @Body() dto: TopupDto, @Headers('idempotency-key') key?: string) {
    if (key && !IDEMPOTENCY_KEY_REGEX.test(key)) throw new DomainError('VALIDATION_ERROR', 'Idempotency-Key is malformed.');
    const companyId = requireCompany(actor);
    await this.kyb.assertApproved(companyId);
    return this.ledger.topup(actor, companyId, dto.amount, key);
  }
}
