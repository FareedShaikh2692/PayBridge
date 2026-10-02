import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ACCOUNT_NUMBER_REGEX, IFSC_REGEX } from '@paybridge/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PageQuery } from '../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class CreateBeneficiaryDto {
  @ApiProperty({ example: 'Rahul Sharma' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(140) name: string;
  @ApiProperty({ example: 'IN' }) @Transform(upper) @IsIn(['IN'], { message: 'Only beneficiaries in India (IN) are supported.' }) country: string;
  @ApiProperty({ example: 'Test Bank' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(140) bankName: string;
  @ApiProperty({ example: '000111222333', description: '9–18 digits. Stored encrypted; never returned.' })
  @Transform(trim) @Matches(ACCOUNT_NUMBER_REGEX, { message: 'accountNumber must be 9 to 18 digits.' }) accountNumber: string;
  @ApiProperty({ example: 'TEST0001234' }) @Transform(upper) @Matches(IFSC_REGEX, { message: 'ifsc must be 4 letters, a zero, then 6 letters or digits.' }) ifsc: string;
  @ApiProperty({ example: 'Rahul Sharma' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(140) accountHolderName: string;
}

export class UpdateBeneficiaryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(140) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(140) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(ACCOUNT_NUMBER_REGEX) accountNumber?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(upper) @Matches(IFSC_REGEX) ifsc?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(140) accountHolderName?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class BeneficiaryQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'BLOCKED']) status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  @ApiPropertyOptional({ description: 'Name search' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}
