import { Inject, Injectable } from '@nestjs/common';
import { KybStatus, Prisma } from '@paybridge/database';
import { COMPANY_ROLES, RoleName } from '@paybridge/shared';
import { Actor, assertCompanyAccess } from '../../common/actor';
import { Clock } from '../../common/clock';
import { hashPassword } from '../../common/crypto';
import { DomainError } from '../../common/errors';
import { PageQuery, paged, skipTake } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { AuditService } from '../audit/audit.service';
import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { KybService } from '../kyb/kyb.service';
import { CreateCompanyDto, CreateCompanyUserDto, UpdateCompanyDto, UpdateCompanyUserDto } from './companies.dto';
import { CompaniesRepository } from './companies.repository';

/** Fields that stay editable after KYB has been submitted. Everything else is frozen until a new review cycle. */
const ALWAYS_EDITABLE = ['contactEmail', 'contactPhone', 'website', 'makerCheckerEnabled'] as const;
const EDITABLE_KYB_STATES: KybStatus[] = ['DRAFT', 'REJECTED', 'EXPIRED'];

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CompaniesRepository,
    private readonly users: AuthRepository,
    private readonly audit: AuditService,
    private readonly kyb: KybService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async create(actor: Actor, dto: CreateCompanyDto) {
    if (actor.isPlatformAdmin) throw new DomainError('FORBIDDEN', 'Platform administrators cannot register companies.');
    if (actor.companyId) throw new DomainError('USER_ALREADY_HAS_COMPANY');
    const expiry = new Date(dto.tradeLicenseExpiry);
    if (expiry < this.clock.now()) {
      throw new DomainError('VALIDATION_ERROR', undefined, [{ field: 'tradeLicenseExpiry', message: 'The trade licence has already expired.' }]);
    }
    const duplicate = await this.repo.findByLicence(this.prisma.client, dto.tradeLicenseNumber);
    if (duplicate) throw new DomainError('COMPANY_ALREADY_EXISTS');

    return this.prisma.transaction(async (tx) => {
      const company = await this.repo.createWithAdmin(tx, { ...dto, tradeLicenseExpiry: expiry }, actor.userId);
      await this.audit.record(tx, { action: 'COMPANY_CREATED', entityType: 'company', entityId: company.id, companyId: company.id, newValue: dto });
      return this.view(company);
    });
  }

  async get(actor: Actor, id: string) {
    assertCompanyAccess(actor, id);
    const company = await this.repo.findWithKyb(this.prisma.client, id);
    if (!company) throw new DomainError('COMPANY_NOT_FOUND');
    return this.view(company);
  }

  async update(actor: Actor, id: string, dto: UpdateCompanyDto) {
    assertCompanyAccess(actor, id);
    return this.prisma.transaction(async (tx) => {
      const company = await this.repo.findWithKyb(tx, id);
      if (!company) throw new DomainError('COMPANY_NOT_FOUND');
      const kybStatus = company.kybProfile!.status;
      const changed = Object.keys(dto).filter((k) => (dto as any)[k] !== undefined);
      const frozen = changed.filter((k) => !(ALWAYS_EDITABLE as readonly string[]).includes(k));
      if (frozen.length && !EDITABLE_KYB_STATES.includes(kybStatus)) {
        throw new DomainError('INVALID_STATE_TRANSITION', `These fields cannot be changed while KYB is ${kybStatus}: ${frozen.join(', ')}.`);
      }
      if (dto.tradeLicenseNumber && dto.tradeLicenseNumber !== company.tradeLicenseNumber) {
        const dup = await this.repo.findByLicence(tx, dto.tradeLicenseNumber);
        if (dup) throw new DomainError('COMPANY_ALREADY_EXISTS');
      }
      const data: Prisma.CompanyUpdateInput = { ...dto, tradeLicenseExpiry: dto.tradeLicenseExpiry ? new Date(dto.tradeLicenseExpiry) : undefined };
      const updated = await this.repo.update(tx, id, data);
      const before = Object.fromEntries(changed.map((k) => [k, (company as any)[k]]));
      await this.audit.record(tx, { action: 'COMPANY_UPDATED', entityType: 'company', entityId: id, companyId: id, oldValue: before, newValue: dto });
      if (frozen.length) await this.kyb.reopenIfNeeded(tx, id);
      return this.view(await this.repo.findWithKyb(tx, updated.id));
    });
  }

  async listAll(q: PageQuery & { kybStatus?: KybStatus }) {
    const where: Prisma.CompanyWhereInput = q.kybStatus ? { kybProfile: { status: q.kybStatus } } : {};
    const { items, total } = await this.repo.listAll(where, skipTake(q).skip, skipTake(q).take);
    return paged(items.map((c) => ({ ...this.view(c), memberCount: c._count.members, paymentCount: c._count.payments })), total, q);
  }

  // ── Members ──

  async listUsers(actor: Actor, companyId: string) {
    assertCompanyAccess(actor, companyId);
    const members = await this.repo.members(companyId);
    return members.map((m) => this.memberView(m));
  }

  async addUser(actor: Actor, companyId: string, dto: CreateCompanyUserDto) {
    assertCompanyAccess(actor, companyId);
    this.assertAssignable(dto.role);
    AuthService.assertPasswordPolicy(dto.password);
    if (await this.users.findUserByEmail(dto.email)) throw new DomainError('EMAIL_ALREADY_REGISTERED');
    const passwordHash = await hashPassword(dto.password, this.config.PASSWORD_SCRYPT_N);
    return this.prisma.transaction(async (tx) => {
      const role = await this.repo.role(tx, dto.role);
      const user = await this.users.createUser(tx, { email: dto.email, fullName: dto.fullName, passwordHash });
      const member = await this.repo.addMember(tx, companyId, user.id, role.id);
      await this.audit.record(tx, { action: 'COMPANY_USER_ADDED', entityType: 'user', entityId: user.id, companyId, newValue: { email: dto.email, role: dto.role } });
      return this.memberView(member);
    });
  }

  async updateUser(actor: Actor, companyId: string, userId: string, dto: UpdateCompanyUserDto) {
    assertCompanyAccess(actor, companyId);
    if (dto.role) this.assertAssignable(dto.role);
    return this.prisma.transaction(async (tx) => {
      // Serialise membership changes per company so the last-admin check cannot race.
      await this.repo.lock(tx, companyId);
      const member = await this.repo.member(tx, companyId, userId);
      if (!member) throw new DomainError('USER_NOT_FOUND');
      const newRole = dto.role ? await this.repo.role(tx, dto.role) : member.role;
      const newStatus = dto.status ?? member.status;
      const losesAdmin = member.role.name === 'COMPANY_ADMIN' && member.status === 'ACTIVE' && (newRole.name !== 'COMPANY_ADMIN' || newStatus !== 'ACTIVE');
      if (losesAdmin) {
        if ((await this.repo.countActiveAdmins(tx, companyId)) <= 1) throw new DomainError('LAST_ADMIN');
      }
      const updated = await this.repo.updateMember(tx, member.id, { roleId: newRole.id, status: newStatus });
      if (dto.status === 'SUSPENDED') await this.users.revokeAllForUser(tx, userId, this.clock.now());
      await this.audit.record(tx, {
        action: 'COMPANY_USER_UPDATED',
        entityType: 'user',
        entityId: userId,
        companyId,
        oldValue: { role: member.role.name, status: member.status },
        newValue: { role: newRole.name, status: newStatus },
      });
      return this.memberView(updated);
    });
  }

  /** Company administrators may only hand out company-scoped roles — never a platform role. */
  private assertAssignable(role: string): void {
    if (!COMPANY_ROLES.includes(role as RoleName)) throw new DomainError('FORBIDDEN', 'This role cannot be assigned.');
  }

  private memberView(m: any) {
    return { userId: m.userId, email: m.user.email, fullName: m.user.fullName, role: m.role.name, status: m.status, lastLoginAt: m.user.lastLoginAt, createdAt: m.createdAt };
  }

  view(c: any) {
    return {
      id: c.id,
      name: c.name,
      country: c.country,
      tradeLicenseNumber: c.tradeLicenseNumber,
      tradeLicenseExpiry: c.tradeLicenseExpiry instanceof Date ? c.tradeLicenseExpiry.toISOString().slice(0, 10) : c.tradeLicenseExpiry,
      registrationNumber: c.registrationNumber,
      businessType: c.businessType,
      registeredAddress: c.registeredAddress,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      website: c.website,
      status: c.status,
      makerCheckerEnabled: c.makerCheckerEnabled,
      kybStatus: c.kybProfile?.status ?? 'DRAFT',
      kybProfileId: c.kybProfile?.id ?? null,
      kybRiskLevel: c.kybProfile?.riskLevel ?? null,
      kybSubmittedAt: c.kybProfile?.submittedAt ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
