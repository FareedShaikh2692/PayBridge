import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDto {
  @ApiProperty({ example: 'admin@acme.test' }) @Transform(lower) @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ minLength: 12 }) @IsString() @MinLength(12) @MaxLength(128) password: string;
  @ApiProperty({ example: 'Aisha Khan' }) @IsString() @MinLength(2) @MaxLength(120) fullName: string;
}

export class LoginDto {
  @ApiProperty({ example: 'admin@acme.test' }) @Transform(lower) @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password: string;
}
