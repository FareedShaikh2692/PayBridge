import { Inject, Injectable } from '@nestjs/common';
import { KybProfile, KybStatus, Prisma, RiskLevel } from '@paybridge/database';
import { kybMachine } from '@paybridge/shared';
import { Actor, assertCompanyAccess, requireCompany } from '../../common/actor';
import { Clock } from '../../common/clock';
import { DomainError } from '../../common/errors';
import { PrismaService, Tx } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { KybProvider } from './kyb.provider';

@Injectable()
export class KybService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly provider: KybProvider,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** The only place a KYB status is written. */
  async transition(tx: Tx, profile: KybProfile, to: KybStatus, data: Prisma.KybProfileUncheckedUpdateInput, action: string): Promise<KybProfile> {
    kybMachine.assert(profile.status, to);
    const updated = await tx.kybProfile.update({ where: { id: profile.id }, data: { ...data, status: to } });
    await this.audit.record(tx, {
      action,
      entityType: 'kyb_profile',
      entityId: profile.id,
      companyId: profile.companyId,
      oldValue: { status: profile.status },
      newValue: { status: to, riskLevel: updated.riskLevel, rejectionReason: updated.rejectionReason },
    });
    return updated;
  }

  async submit(actor: Actor) {
    const companyId = requireCompany(actor);
    const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: companyId }, include: { kybProfile: true } });
    const profile = company.kybProfile!;
    kybMachine.assert(profile.status, 'SUBMITTED');

    // The provider call happens outside any database transaction.
    const verification = await this.provider.verify({
      name: company.name,
      tradeLicenseNumber: company.tradeLicenseNumber,
      registrationNumber: company.registrationNumber,
      country: company.country,
    });

    return this.prisma.transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM kyb_profiles WHERE id = ${profile.id}::uuid FOR UPDATE`;
      let current = await tx.kybProfile.findUniqueOrThrow({ where: { id: locked.id } });
      current = await this.transition(tx, current, 'SUBMITTED', { submittedAt: this.clock.now(), rejectionReason: null, reviewedAt: null, reviewedById: null }, 'KYB_SUBMITTED');
      current = await this.transition(tx, current, 'UNDER_REVIEW', { verificationResult: verification as unknown as Prisma.InputJsonValue, riskLevel: verification.riskLevel }, 'KYB_UNDER_REVIEW');
      if (this.config.KYB_AUTO_APPROVE && verification.result === 'PASS' && verification.riskLevel === 'LOW') {
        current = await this.approveInTx(tx, current, null, 'LOW');
      }
      return this.view(current);
    });
  }

  /**
   * Records KYB document metadata. The sandbox stores no files: only the type, name, size and a SHA-256
   * checksum computed in the browser. Documents can be added only while the profile is open for editing.
   */
  async addDocument(actor: Actor, dto: { documentType: string; fileName: string; checksum?: string; sizeBytes?: number }) {
    const companyId = requireCompany(actor);
    return this.prisma.transaction(async (tx) => {
      const profile = await tx.kybProfile.findUniqueOrThrow({ where: { companyId } });
      if (!['DRAFT', 'REJECTED', 'EXPIRED'].includes(profile.status)) {
        throw new DomainError('INVALID_STATE_TRANSITION', `Documents cannot be added while KYB is ${profile.status}.`);
      }
      const document = await tx.kybDocument.create({ data: { kybProfileId: profile.id, documentType: dto.documentType, fileName: dto.fileName, checksum: dto.checksum, sizeBytes: dto.sizeBytes, uploadedById: actor.userId } });
      await this.audit.record(tx, { action: 'KYB_DOCUMENT_ADDED', entityType: 'kyb_profile', entityId: profile.id, companyId, newValue: { documentType: dto.documentType, fileName: dto.fileName } });
      return document;
    });
  }

  async get(actor: Actor, companyId: string) {
    assertCompanyAccess(actor, companyId);
    const profile = await this.prisma.client.kybProfile.findUnique({ where: { companyId }, include: { documents: { orderBy: { createdAt: 'asc' } }, reviewedBy: { select: { fullName: true } } } });
    if (!profile) throw new DomainError('COMPANY_NOT_FOUND');
    return this.view(profile);
  }

  async approve(actor: Actor, id: string, riskLevel?: RiskLevel, note?: string) {
    return this.prisma.transaction(async (tx) => {
      const profile = await this.lock(tx, id);
      const updated = await this.approveInTx(tx, profile, actor.userId, riskLevel ?? profile.riskLevel ?? 'LOW', note);
      return this.view(updated);
    });
  }

  async reject(actor: Actor, id: string, reason: string) {
    return this.prisma.transaction(async (tx) => {
      const profile = await this.lock(tx, id);
      const updated = await this.transition(tx, profile, 'REJECTED', { reviewedAt: this.clock.now(), reviewedById: actor.userId, rejectionReason: reason }, 'KYB_REJECTED');
      return this.view(updated);
    });
  }

  private async approveInTx(tx: Tx, profile: KybProfile, reviewerId: string | null, riskLevel: RiskLevel, note?: string) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: profile.companyId } });
    const updated = await this.transition(
      tx,
      profile,
      'APPROVED',
      { reviewedAt: this.clock.now(), reviewedById: reviewerId, riskLevel, rejectionReason: null, expiresAt: company.tradeLicenseExpiry },
      'KYB_APPROVED',
    );
    await this.ledger.provisionCompanyAccounts(tx, profile.companyId);
    if (note) await this.audit.record(tx, { action: 'KYB_REVIEW_NOTE', entityType: 'kyb_profile', entityId: profile.id, companyId: profile.companyId, newValue: { note } });
    return updated;
  }

  private async lock(tx: Tx, id: string): Promise<KybProfile> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM kyb_profiles WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new DomainError('NOT_FOUND', 'The KYB profile was not found.');
    return tx.kybProfile.findUniqueOrThrow({ where: { id } });
  }

  /** Called when company details are edited after a rejection or expiry: the profile returns to DRAFT for resubmission. */
  async reopenIfNeeded(tx: Tx, companyId: string): Promise<void> {
    const profile = await tx.kybProfile.findUniqueOrThrow({ where: { companyId } });
    if (profile.status === 'REJECTED' || profile.status === 'EXPIRED') {
      await this.transition(tx, profile, 'DRAFT', {}, 'KYB_REOPENED');
    }
  }

  /** Gate used by quoting, payments and top-ups. Also expires a profile whose trade licence has lapsed. */
  async assertApproved(companyId: string): Promise<void> {
    const profile = await this.prisma.client.kybProfile.findUnique({ where: { companyId } });
    if (!profile) throw new DomainError('COMPANY_NOT_FOUND');
    if (profile.status === 'APPROVED' && profile.expiresAt && this.endOfDay(profile.expiresAt) < this.clock.now()) {
      await this.prisma.transaction(async (tx) => {
        const current = await this.lock(tx, profile.id);
        if (current.status === 'APPROVED') await this.transition(tx, current, 'EXPIRED', {}, 'KYB_EXPIRED');
      });
      throw new DomainError('KYB_NOT_APPROVED', 'KYB has expired because the trade licence has lapsed.');
    }
    if (profile.status !== 'APPROVED') throw new DomainError('KYB_NOT_APPROVED');
  }

  /** Scheduled sweep (P1): expire every approved profile whose licence date has passed. */
  async expireLapsed(): Promise<number> {
    const lapsed = await this.prisma.client.kybProfile.findMany({ where: { status: 'APPROVED', expiresAt: { lt: new Date(this.clock.now().getTime() - 86_400_000) } }, select: { companyId: true } });
    for (const p of lapsed) await this.assertApproved(p.companyId).catch(() => undefined);
    return lapsed.length;
  }

  private endOfDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  }

  view(p: any) {
    return {
      id: p.id,
      companyId: p.companyId,
      status: p.status,
      submittedAt: p.submittedAt,
      reviewedAt: p.reviewedAt,
      reviewedBy: p.reviewedById,
      reviewedByName: p.reviewedBy?.fullName ?? null,
      riskLevel: p.riskLevel,
      verificationResult: p.verificationResult,
      rejectionReason: p.rejectionReason,
      expiresAt: p.expiresAt,
      documents: p.documents ?? [],
      updatedAt: p.updatedAt,
    };
  }
}
