import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AMOUNT_REGEX, PAYMENT_STATUSES } from '@paybridge/shared';
import { Transform } from 'class-transformer';
import { IsISO8601, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PageQuery } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePaymentDto {
  @ApiProperty() @IsUUID() quoteId: string;
  @ApiProperty() @IsUUID() beneficiaryId: string;
  @ApiPropertyOptional({ example: 'Supplier invoice INV-1042' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) purpose?: string;
  @ApiPropertyOptional({ example: '10000.00', description: 'Optional assertion; must equal the quote amount.' })
  @IsOptional() @IsString() @Matches(AMOUNT_REGEX) sourceAmount?: string;
}

export class ReasonDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}
export class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reason?: string;
}

export class PaymentQuery extends PageQuery {
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES }) @IsOptional() @IsIn(PAYMENT_STATUSES as unknown as string[]) status?: (typeof PAYMENT_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() beneficiaryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(AMOUNT_REGEX) minAmount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(AMOUNT_REGEX) maxAmount?: string;
  @ApiPropertyOptional({ description: 'Search by payment reference or beneficiary name' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'Only payments awaiting maker-checker approval' }) @IsOptional() @IsIn(['true', 'false']) awaitingApproval?: string;
}
