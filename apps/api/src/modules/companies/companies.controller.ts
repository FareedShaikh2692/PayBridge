import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { KYB_STATUSES } from '@paybridge/shared';
import { IsIn, IsOptional } from 'class-validator';
import { Actor } from '../../common/actor';
import { Authenticated, CurrentActor, Permissions } from '../../common/decorators';
import { PageQuery } from '../../common/pagination';
import { CreateCompanyDto, CreateCompanyUserDto, UpdateCompanyDto, UpdateCompanyUserDto } from './companies.dto';
import { CompaniesService } from './companies.service';

class AdminCompaniesQuery extends PageQuery {
  @ApiPropertyOptional({ enum: KYB_STATUSES }) @IsOptional() @IsIn(KYB_STATUSES as unknown as string[]) kybStatus?: (typeof KYB_STATUSES)[number];
}

@ApiTags('Companies')
@ApiBearerAuth()
@Controller()
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  /** Any authenticated user without a company may create one and becomes its administrator. */
  @Post('companies')
  @Authenticated()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateCompanyDto) {
    return this.companies.create(actor, dto);
  }

  @Get('companies/:id')
  @Permissions('company.read')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(actor, id);
  }

  @Patch('companies/:id')
  @Permissions('company.update')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(actor, id, dto);
  }

  @Get('companies/:id/users')
  @Permissions('user.manage')
  listUsers(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.listUsers(actor, id);
  }

  @Post('companies/:id/users')
  @Permissions('user.manage')
  addUser(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCompanyUserDto) {
    return this.companies.addUser(actor, id, dto);
  }

  @Patch('companies/:id/users/:userId')
  @Permissions('user.manage')
  updateUser(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateCompanyUserDto) {
    return this.companies.updateUser(actor, id, userId, dto);
  }

  @Get('admin/companies')
  @Permissions('platform.admin')
  listAll(@Query() q: AdminCompaniesQuery) {
    return this.companies.listAll(q);
  }
}
