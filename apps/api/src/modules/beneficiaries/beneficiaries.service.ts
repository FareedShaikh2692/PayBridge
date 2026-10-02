import { Inject, Injectable } from '@nestjs/common';
import { BeneficiaryStatus, Prisma } from '@paybridge/database';
import { maskAccountNumber } from '@paybridge/shared';
import { Actor, requireCompany } from '../../common/actor';
import { decryptField, encryptField, hmacHex } from '../../common/crypto';
import { DomainError } from '../../common/errors';
import { orderBy, paged, skipTake } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { AuditService } from '../audit/audit.service';
import { ComplianceEngine } from '../compliance/compliance.engine';
import { BeneficiaryQuery, CreateBeneficiaryDto, UpdateBeneficiaryDto } from './beneficiaries.dto';
import { BeneficiariesRepository } from './beneficiaries.repository';

@Injectable()
export class BeneficiariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BeneficiariesRepository,
    private readonly audit: AuditService,
    private readonly compliance: ComplianceEngine,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private fingerprint(ifsc: string, accountNumber: string): string {
    return hmacHex(this.config.FINGERPRINT_HMAC_KEY, `${ifsc}|${accountNumber}`);
  }

  /** Screens both names. MATCH blocks the beneficiary; PEP_MATCH leaves it active but every payment goes to review. */
  private async screen(name: string, holder: string): Promise<{ status: BeneficiaryStatus; screeningResult: string }> {
    const results = [await this.compliance.screenName(name)];
    if (holder !== name) results.push(await this.compliance.screenName(holder));
    if (results.includes('MATCH')) return { status: 'BLOCKED', screeningResult: 'MATCH' };
    if (results.includes('PEP_MATCH')) return { status: 'ACTIVE', screeningResult: 'PEP_MATCH' };
    if (results.includes('ERROR')) return { status: 'ACTIVE', screeningResult: 'PENDING' };
    return { status: 'ACTIVE', screeningResult: 'CLEAR' };
  }

  async create(actor: Actor, dto: CreateBeneficiaryDto) {
    const companyId = requireCompany(actor);
    const accountFingerprint = this.fingerprint(dto.ifsc, dto.accountNumber);
    if (await this.repo.findByFingerprint(companyId, accountFingerprint)) throw new DomainError('BENEFICIARY_ALREADY_EXISTS');
    const screening = await this.screen(dto.name, dto.accountHolderName);

    return this.prisma.transaction(async (tx) => {
      const created = await tx.beneficiary.create({
        data: {
          companyId,
          name: dto.name,
          country: dto.country,
          bankName: dto.bankName,
          accountNumberEncrypted: encryptField(dto.accountNumber, this.config.DATA_ENCRYPTION_KEY),
          accountNumberLast4: dto.accountNumber.slice(-4),
          accountFingerprint,
          ifsc: dto.ifsc,
          accountHolderName: dto.accountHolderName,
          createdById: actor.userId,
          ...screening,
        },
      });
      await this.audit.record(tx, { action: 'BENEFICIARY_CREATED', entityType: 'beneficiary', entityId: created.id, companyId, newValue: this.view(created) });
      if (screening.status === 'BLOCKED') {
        await this.audit.record(tx, { action: 'COMPLIANCE_FLAGGED', entityType: 'beneficiary', entityId: created.id, companyId, newValue: { screeningResult: screening.screeningResult } });
      }
      return this.view(created);
    });
  }

  async list(actor: Actor, q: BeneficiaryQuery) {
    const where: Prisma.BeneficiaryWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const { items, total } = await this.repo.list(actor, where, orderBy(q.sort, ['createdAt', 'name', 'status'] as const, { createdAt: 'desc' }), skipTake(q).skip, skipTake(q).take);
    return paged(items.map((b) => ({ ...this.view(b), companyName: b.company.name, paymentCount: b._count.payments })), total, q);
  }

  async get(actor: Actor, id: string) {
    const b = await this.repo.findById(actor, id);
    if (!b) throw new DomainError('BENEFICIARY_NOT_FOUND');
    return { ...this.view(b), paymentCount: await this.repo.countPayments(id) };
  }

  async update(actor: Actor, id: string, dto: UpdateBeneficiaryDto) {
    const companyId = requireCompany(actor);
    const existing = await this.repo.findById(actor, id);
    if (!existing) throw new DomainError('BENEFICIARY_NOT_FOUND');
    if (existing.status === 'BLOCKED' && dto.status) throw new DomainError('BENEFICIARY_NOT_ACTIVE', 'A blocked beneficiary cannot be reactivated.');

    const bankChange = dto.accountNumber !== undefined || dto.ifsc !== undefined || dto.bankName !== undefined || dto.accountHolderName !== undefined;
    if (bankChange && (await this.repo.countPayments(id)) > 0) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Bank details cannot change once a beneficiary has been paid. Create a new beneficiary instead.');
    }

    const data: Prisma.BeneficiaryUpdateInput = { name: dto.name, bankName: dto.bankName, accountHolderName: dto.accountHolderName, status: dto.status };
    if (dto.accountNumber !== undefined || dto.ifsc !== undefined) {
      const accountNumber = dto.accountNumber ?? decryptField(existing.accountNumberEncrypted, this.config.DATA_ENCRYPTION_KEY);
      const ifsc = dto.ifsc ?? existing.ifsc;
      const fp = this.fingerprint(ifsc, accountNumber);
      const dup = await this.repo.findByFingerprint(companyId, fp);
      if (dup && dup.id !== id) throw new DomainError('BENEFICIARY_ALREADY_EXISTS');
      Object.assign(data, { ifsc, accountFingerprint: fp, accountNumberLast4: accountNumber.slice(-4), accountNumberEncrypted: encryptField(accountNumber, this.config.DATA_ENCRYPTION_KEY) });
    }
    if (dto.name !== undefined || dto.accountHolderName !== undefined) {
      const screening = await this.screen(dto.name ?? existing.name, dto.accountHolderName ?? existing.accountHolderName);
      data.screeningResult = screening.screeningResult;
      if (screening.status === 'BLOCKED') data.status = 'BLOCKED';
    }

    return this.prisma.transaction(async (tx) => {
      const updated = await tx.beneficiary.update({ where: { id }, data });
      await this.audit.record(tx, { action: 'BENEFICIARY_UPDATED', entityType: 'beneficiary', entityId: id, companyId, oldValue: this.view(existing), newValue: this.view(updated) });
      return this.view(updated);
    });
  }

  /** The API never returns the account number — only the masked form. */
  view(b: any) {
    return {
      id: b.id,
      companyId: b.companyId,
      name: b.name,
      country: b.country,
      bankName: b.bankName,
      accountNumberMasked: maskAccountNumber(b.accountNumberLast4),
      ifsc: b.ifsc,
      accountHolderName: b.accountHolderName,
      status: b.status,
      screeningResult: b.screeningResult,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }
}
