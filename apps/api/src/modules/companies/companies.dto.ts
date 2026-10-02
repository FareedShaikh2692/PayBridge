import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { COMPANY_ROLES } from '@paybridge/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class CreateCompanyDto {
  @ApiProperty({ example: 'Acme Trading LLC' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) name: string;
  @ApiProperty({ example: 'AE' }) @IsIn(['AE'], { message: 'Only UAE (AE) companies are supported.' }) country: string;
  @ApiProperty({ example: 'TEST-TL-000001' }) @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9-]{4,40}$/) tradeLicenseNumber: string;
  @ApiProperty({ example: '2028-12-31' }) @IsISO8601({ strict: true }) tradeLicenseExpiry: string;
  @ApiProperty({ example: 'TEST-REG-000001' }) @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9-]{4,40}$/) registrationNumber: string;
  @ApiProperty({ example: 'General Trading' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) businessType: string;
  @ApiProperty({ example: 'Test Tower, Sheikh Zayed Road, Dubai' }) @Transform(trim) @IsString() @MinLength(5) @MaxLength(500) registeredAddress: string;
  @ApiProperty({ example: 'ops@acme.test' }) @Transform(lower) @IsEmail() contactEmail: string;
  @ApiProperty({ example: '+971500000000' }) @Transform(trim) @Matches(/^\+?[0-9 ()-]{7,20}$/) contactPhone: string;
  @ApiPropertyOptional({ example: 'https://acme.test' }) @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(200) website?: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() makerCheckerEnabled?: boolean;
}

export class CreateCompanyUserDto {
  @ApiProperty() @Transform(lower) @IsEmail() email: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @ApiProperty({ enum: COMPANY_ROLES }) @IsIn(COMPANY_ROLES as string[]) role: string;
  @ApiProperty({ minLength: 12, description: 'Initial password (sandbox: there is no email invitation flow)' }) @IsString() @MinLength(12) @MaxLength(128) password: string;
}

export class UpdateCompanyUserDto {
  @ApiPropertyOptional({ enum: COMPANY_ROLES }) @IsOptional() @IsIn(COMPANY_ROLES as string[]) role?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
}
