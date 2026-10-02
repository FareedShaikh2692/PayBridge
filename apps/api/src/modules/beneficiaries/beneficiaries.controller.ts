import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Actor } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { BeneficiaryQuery, CreateBeneficiaryDto, UpdateBeneficiaryDto } from './beneficiaries.dto';
import { BeneficiariesService } from './beneficiaries.service';

@ApiTags('Beneficiaries')
@ApiBearerAuth()
@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly beneficiaries: BeneficiariesService) {}

  @Post()
  @Permissions('beneficiary.create')
  create(@CurrentActor() actor: Actor, @Body() dto: CreateBeneficiaryDto) {
    return this.beneficiaries.create(actor, dto);
  }

  @Get()
  @Permissions('beneficiary.read')
  list(@CurrentActor() actor: Actor, @Query() q: BeneficiaryQuery) {
    return this.beneficiaries.list(actor, q);
  }

  @Get(':id')
  @Permissions('beneficiary.read')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.beneficiaries.get(actor, id);
  }

  @Patch(':id')
  @Permissions('beneficiary.update')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBeneficiaryDto) {
    return this.beneficiaries.update(actor, id, dto);
  }
}
