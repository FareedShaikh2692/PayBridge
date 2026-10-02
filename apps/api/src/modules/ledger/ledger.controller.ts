import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Actor } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { PageQuery } from '../../common/pagination';
import { LedgerService } from './ledger.service';

const TYPES = ['WALLET_TOPUP', 'NOSTRO_FUNDING', 'PAYMENT_HOLD', 'PAYMENT_HOLD_RELEASE', 'PAYMENT_CAPTURE', 'PAYOUT_SETTLEMENT', 'PAYMENT_REVERSAL', 'PAYOUT_RETURN'] as const;

class TransactionsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() paymentId?: string;
  @ApiPropertyOptional({ enum: TYPES }) @IsOptional() @IsIn(TYPES as unknown as string[]) type?: (typeof TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
}
class AccountsQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
}

@ApiTags('Ledger')
@ApiBearerAuth()
@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('ledger/accounts')
  @Permissions('ledger.read')
  accounts(@CurrentActor() actor: Actor, @Query() q: AccountsQuery) {
    return this.ledger.listAccounts(actor, q.companyId);
  }

  @Get('ledger/transactions')
  @Permissions('ledger.read')
  transactions(@CurrentActor() actor: Actor, @Query() q: TransactionsQuery) {
    return this.ledger.listTransactions(actor, q);
  }

  @Get('ledger/accounts/:id')
  @Permissions('ledger.read')
  account(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    return this.ledger.getAccount(actor, id, q);
  }

  @Get('ledger/:companyId/balance')
  @Permissions('company.read')
  balance(@CurrentActor() actor: Actor, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.ledger.getBalance(actor, companyId);
  }

  @Get('admin/ledger/trial-balance')
  @Permissions('platform.admin', 'ledger.read')
  trialBalance() {
    return this.ledger.trialBalance();
  }
}
