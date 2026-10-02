import { Body, Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@paybridge/database';
import { AMOUNT_REGEX, calculateQuote, money } from '@paybridge/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Actor, requireCompany, tenantWhere } from '../../common/actor';
import { CurrentActor, Permissions } from '../../common/decorators';
import { DomainError } from '../../common/errors';
import { PageQuery, paged, skipTake } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { ComplianceEngine } from './compliance.engine';

class PreviewDto {
  @ApiProperty() @IsUUID() beneficiaryId: string;
  @ApiProperty({ example: '10000.00' }) @IsString() @Matches(AMOUNT_REGEX) baseAmount: string;
}
class DecisionDto {
  @ApiProperty({ enum: ['CLEAR', 'REJECT'] }) @IsIn(['CLEAR', 'REJECT']) decision: 'CLEAR' | 'REJECT';
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}
class UpdateRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: ['REVIEW', 'REJECT'] }) @IsOptional() @IsIn(['REVIEW', 'REJECT']) outcome?: 'REVIEW' | 'REJECT';
  @ApiPropertyOptional() @IsOptional() @IsObject() parameters?: Record<string, unknown>;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ComplianceEngine,
    private readonly audit: AuditService,
  ) {}

  /** Wizard step 4: evaluates the rules without persisting anything. */
  async preview(actor: Actor, dto: PreviewDto) {
    const companyId = requireCompany(actor);
    const [company, beneficiary] = await Promise.all([
      this.prisma.client.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.client.beneficiary.findFirst({ where: { id: dto.beneficiaryId, companyId } }),
    ]);
    if (!beneficiary) throw new DomainError('BENEFICIARY_NOT_FOUND');
    const verdict = await this.engine.evaluate(this.prisma.client, {
      companyId,
      companyName: company.name,
      beneficiary: { name: beneficiary.name, accountHolderName: beneficiary.accountHolderName, country: beneficiary.country },
      sourceAmount: dto.baseAmount,
      sourceCurrency: 'AED',
    });
    return {
      result: verdict.result,
      approvalRequired: company.makerCheckerEnabled,
      rules: verdict.evaluations.map((e) => ({ ruleCode: e.ruleCode, ruleName: e.ruleName, triggered: e.triggered, outcome: e.outcome })),
    };
  }

  async checks(actor: Actor, paymentId: string) {
    const payment = await this.prisma.client.paymentOrder.findFirst({ where: { id: paymentId, ...tenantWhere(actor) }, select: { id: true, complianceStatus: true } });
    if (!payment) throw new DomainError('PAYMENT_NOT_FOUND');
    const checks = await this.prisma.client.complianceCheck.findMany({
      where: { paymentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { rule: { select: { name: true, type: true } }, decidedBy: { select: { fullName: true } } },
    });
    return {
      paymentId,
      complianceStatus: payment.complianceStatus,
      checks: checks.map((c) => ({
        id: c.id,
        ruleCode: c.ruleCode,
        ruleName: c.rule?.name ?? 'Manual decision',
        ruleVersion: c.ruleVersion,
        triggered: c.triggered,
        outcome: c.outcome,
        details: actor.isPlatformAdmin || !['SANCTIONS', 'PEP'].includes(c.rule?.type ?? '') ? c.details : null,
        decidedByName: c.decidedBy?.fullName ?? null,
        decisionNote: c.decisionNote,
        createdAt: c.createdAt,
      })),
    };
  }

  async queue(q: PageQuery) {
    const where: Prisma.PaymentOrderWhereInput = { status: 'COMPLIANCE_REVIEW', complianceStatus: 'REVIEW' };
    const [items, total] = await Promise.all([
      this.prisma.client.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        ...skipTake(q),
        include: { company: { select: { name: true } }, beneficiary: { select: { name: true, country: true } }, complianceChecks: { where: { triggered: true }, include: { rule: { select: { name: true } } } } },
      }),
      this.prisma.client.paymentOrder.count({ where }),
    ]);
    return paged(
      items.map((p) => ({
        paymentId: p.id,
        reference: p.reference,
        companyId: p.companyId,
        companyName: p.company.name,
        beneficiaryName: p.beneficiary.name,
        destinationCountry: p.beneficiary.country,
        sourceAmount: money(p.sourceAmount),
        sourceCurrency: p.sourceCurrency,
        approvalStatus: p.approvalStatus,
        createdAt: p.createdAt,
        rulesFired: p.complianceChecks.map((c) => ({ ruleCode: c.ruleCode, ruleName: c.rule?.name ?? c.ruleCode, outcome: c.outcome, details: c.details })),
      })),
      total,
      q,
    );
  }

  listRules() {
    return this.prisma.client.complianceRule.findMany({ orderBy: { code: 'asc' } });
  }

  async updateRule(id: string, dto: UpdateRuleDto) {
    const rule = await this.prisma.client.complianceRule.findUnique({ where: { id } });
    if (!rule) throw new DomainError('NOT_FOUND', 'The rule was not found.');
    if (dto.parameters) this.validateParameters(rule.type, dto.parameters);
    return this.prisma.transaction(async (tx) => {
      const updated = await tx.complianceRule.update({
        where: { id },
        data: { enabled: dto.enabled, outcome: dto.outcome, parameters: dto.parameters as Prisma.InputJsonValue | undefined, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'COMPLIANCE_RULE_UPDATED',
        entityType: 'compliance_rule',
        entityId: id,
        companyId: null,
        oldValue: { enabled: rule.enabled, outcome: rule.outcome, parameters: rule.parameters, version: rule.version },
        newValue: { enabled: updated.enabled, outcome: updated.outcome, parameters: updated.parameters, version: updated.version },
      });
      return updated;
    });
  }

  private validateParameters(type: string, p: Record<string, unknown>): void {
    const fail = (message: string) => {
      throw new DomainError('VALIDATION_ERROR', message);
    };
    if (type === 'AMOUNT_THRESHOLD') {
      if (typeof p.threshold !== 'string' || !AMOUNT_REGEX.test(p.threshold) || p.currency !== 'AED') fail('AMOUNT_THRESHOLD needs { currency: "AED", threshold: "<decimal string>" }.');
      calculateQuote({ baseAmount: p.threshold as string, midRate: '1', spreadPct: '0', feeAmount: '0' }); // rejects zero and excess precision
    } else if (type === 'VELOCITY') {
      if (!Number.isInteger(p.maxCount) || (p.maxCount as number) < 1 || !Number.isInteger(p.windowHours) || (p.windowHours as number) < 1) fail('VELOCITY needs positive integer maxCount and windowHours.');
    } else if (type === 'DESTINATION_COUNTRY') {
      if (!Array.isArray(p.allowed) || !p.allowed.every((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c))) fail('DESTINATION_COUNTRY needs { allowed: ["IN", …] }.');
    } else if (!Array.isArray(p.subjects) || !p.subjects.every((s) => s === 'beneficiary' || s === 'company')) {
      fail('Screening rules need { subjects: ["beneficiary" | "company"] }.');
    }
  }
}

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller()
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('compliance/preview')
  @HttpCode(200)
  @Permissions('payment.create')
  preview(@CurrentActor() actor: Actor, @Body() dto: PreviewDto) {
    return this.compliance.preview(actor, dto);
  }

  @Get('compliance/checks/:paymentId')
  @Permissions('compliance.read')
  checks(@CurrentActor() actor: Actor, @Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.compliance.checks(actor, paymentId);
  }

  @Get('admin/compliance-queue')
  @Permissions('compliance.review')
  queue(@Query() q: PageQuery) {
    return this.compliance.queue(q);
  }

  /** `:id` is the payment id. The decision is final and requires a reason. */
  @Post('admin/compliance/:id/decision')
  @HttpCode(200)
  @Permissions('compliance.review')
  decide(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.payments.decideCompliance(actor, id, dto.decision, dto.reason);
  }

  @Get('admin/compliance/rules')
  @Permissions('compliance.review')
  rules() {
    return this.compliance.listRules();
  }

  @Patch('admin/compliance/rules/:id')
  @Permissions('compliance.review')
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRuleDto) {
    return this.compliance.updateRule(id, dto);
  }
}
