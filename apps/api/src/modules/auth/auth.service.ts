import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { Actor } from '../../common/actor';
import { Clock } from '../../common/clock';
import { ctx } from '../../common/context';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../../common/crypto';
import { DomainError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { AppConfig, CONFIG } from '../../config';
import { AuditService } from '../audit/audit.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthRepository } from './auth.repository';

const COMMON_PASSWORDS = new Set(['password1234', '123456789012', 'qwertyuiop12', 'passwordpassword', 'letmeinletmein', 'administrator', 'welcome12345', 'iloveyou1234']);

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  // A syntactically valid hash to verify against when the user does not exist, so timing does not reveal accounts.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AuthRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  static assertPasswordPolicy(password: string): void {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      throw new DomainError('VALIDATION_ERROR', 'This password is too common.', [{ field: 'password', message: 'Choose a less common password.' }]);
    }
  }

  async register(dto: RegisterDto) {
    AuthService.assertPasswordPolicy(dto.password);
    const existing = await this.repo.findUserByEmail(dto.email);
    if (existing) throw new DomainError('EMAIL_ALREADY_REGISTERED');
    const passwordHash = await hashPassword(dto.password, this.config.PASSWORD_SCRYPT_N);
    const user = await this.prisma.transaction(async (tx) => {
      const created = await this.repo.createUser(tx, { email: dto.email, fullName: dto.fullName, passwordHash });
      await this.audit.record(tx, { action: 'USER_REGISTERED', entityType: 'user', entityId: created.id, userId: created.id, newValue: { email: created.email } });
      return created;
    });
    return { id: user.id, email: user.email, fullName: user.fullName, status: user.status };
  }

  async login(dto: LoginDto): Promise<IssuedTokens & { userId: string }> {
    const user = await this.repo.findUserByEmail(dto.email);
    this.dummyHash ??= hashPassword('not-a-real-password', this.config.PASSWORD_SCRYPT_N);
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !ok || user.status !== 'ACTIVE') {
      await this.audit.record(this.repo.db, { action: 'LOGIN_FAILED', entityType: 'user', entityId: user?.id ?? null, userId: user?.id ?? null, companyId: null });
      throw new DomainError('INVALID_CREDENTIALS');
    }
    const tokens = await this.issue(user.id, randomUUID());
    await this.repo.recordLogin(user.id, this.clock.now());
    await this.audit.record(this.repo.db, { action: 'LOGIN_SUCCEEDED', entityType: 'user', entityId: user.id, userId: user.id, companyId: null });
    return { ...tokens, userId: user.id };
  }

  /** Rotates the refresh token. Presenting a token that was already rotated revokes the whole family. */
  async refresh(presented: string | undefined): Promise<IssuedTokens> {
    if (!presented) throw new DomainError('UNAUTHENTICATED');
    const row = await this.repo.findRefreshToken(sha256Hex(presented));
    if (!row) throw new DomainError('UNAUTHENTICATED');
    const now = this.clock.now();
    if (row.rotatedAt || row.revokedAt) {
      await this.repo.revokeFamily(row.familyId, now);
      await this.audit.record(this.repo.db, { action: 'REFRESH_TOKEN_REUSE_DETECTED', entityType: 'user', entityId: row.userId, userId: row.userId, companyId: null });
      throw new DomainError('UNAUTHENTICATED');
    }
    if (row.expiresAt <= now || row.user.status !== 'ACTIVE') throw new DomainError('UNAUTHENTICATED');
    // Compare-and-set so two concurrent refreshes cannot both succeed.
    if (!(await this.repo.claimRotation(row.id, now))) throw new DomainError('UNAUTHENTICATED');
    return this.issue(row.userId, row.familyId);
  }

  async logout(presented: string | undefined): Promise<void> {
    if (!presented) return;
    const row = await this.repo.findRefreshToken(sha256Hex(presented));
    if (!row) return;
    await this.repo.revokeFamily(row.familyId, this.clock.now());
    await this.audit.record(this.repo.db, { action: 'LOGOUT', entityType: 'user', entityId: row.userId, userId: row.userId });
  }

  async me(actor: Actor) {
    const company = actor.companyId
      ? await this.repo.companySummary(actor.companyId)
      : null;
    return {
      user: { id: actor.userId, email: actor.email, fullName: actor.fullName },
      role: actor.companyId || actor.isPlatformAdmin ? actor.role : null,
      isPlatformAdmin: actor.isPlatformAdmin,
      permissions: [...actor.permissions].sort(),
      company: company
        ? { id: company.id, name: company.name, kybStatus: company.kybProfile?.status ?? 'DRAFT', kybProfileId: company.kybProfile?.id ?? null, makerCheckerEnabled: company.makerCheckerEnabled }
        : null,
    };
  }

  private async issue(userId: string, familyId: string): Promise<IssuedTokens> {
    const accessToken = jwt.sign({ typ: 'access' }, this.config.JWT_SECRET, {
      algorithm: 'HS256',
      subject: userId,
      issuer: 'paybridge',
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      jwtid: randomUUID(),
    });
    const refreshToken = randomToken(32);
    const refreshExpiresAt = new Date(this.clock.now().getTime() + this.config.REFRESH_TTL_DAYS * 86_400_000);
    await this.repo.createRefreshToken({ userId, familyId, tokenHash: sha256Hex(refreshToken), expiresAt: refreshExpiresAt, ipAddress: ctx()?.ipAddress, userAgent: ctx()?.userAgent });
    return { accessToken, expiresIn: this.config.JWT_ACCESS_TTL_SECONDS, refreshToken, refreshExpiresAt };
  }
}
