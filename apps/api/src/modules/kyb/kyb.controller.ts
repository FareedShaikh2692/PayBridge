import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
