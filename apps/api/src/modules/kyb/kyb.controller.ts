import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Actor } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { KybService } from './kyb.service';

class ApproveKybDto {
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class RejectKybDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export const KYB_DOCUMENT_TYPES = ['TRADE_LICENSE', 'MEMORANDUM_OF_ASSOCIATION', 'OWNER_ID', 'PROOF_OF_ADDRESS', 'OTHER'] as const;

class AddKybDocumentDto {
  @ApiProperty({ enum: KYB_DOCUMENT_TYPES }) @IsIn(KYB_DOCUMENT_TYPES as unknown as string[]) documentType: string;
  @ApiProperty({ example: 'trade-licence.pdf' }) @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(1) @MaxLength(200) @Matches(/^[^\\/\u0000-\u001f]+$/, { message: 'fileName must be a plain file name.' }) fileName: string;
  @ApiPropertyOptional({ description: 'SHA-256 of the file, hex' }) @IsOptional() @Matches(/^[0-9a-f]{64}$/) checksum?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(50_000_000) sizeBytes?: number;
}

@ApiTags('KYB')
@ApiBearerAuth()
@Controller('kyb')
export class KybController {
  constructor(private readonly kyb: KybService) {}

  @Post('submit')
  @HttpCode(200)
  @Permissions('kyb.submit')
  submit(@CurrentActor() actor: Actor) {
    return this.kyb.submit(actor);
  }

  /** Metadata only: no file is uploaded or stored. */
  @Post('documents')
  @Permissions('kyb.submit')
  addDocument(@CurrentActor() actor: Actor, @Body() dto: AddKybDocumentDto) {
    return this.kyb.addDocument(actor, dto);
  }

  @Get(':companyId')
  @Permissions('kyb.read')
  get(@CurrentActor() actor: Actor, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.kyb.get(actor, companyId);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Permissions('kyb.review')
  approve(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveKybDto) {
    return this.kyb.approve(actor, id, dto.riskLevel, dto.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Permissions('kyb.review')
  reject(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectKybDto) {
    return this.kyb.reject(actor, id, dto.reason);
  }
}
