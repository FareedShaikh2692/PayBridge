import { Injectable } from '@nestjs/common';
import { Prisma } from '@paybridge/database';
import { Db, PrismaService } from '../../common/prisma.service';

/** Data access for identities and refresh tokens. Tokens are stored only as SHA-256 hashes. */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  get db(): Db {
    return this.prisma.client;
  }

  findUserByEmail(email: string) {
    return this.prisma.client.user.findUnique({ where: { email } });
  }

  createUser(db: Db, data: Prisma.UserUncheckedCreateInput) {
    return db.user.create({ data });
  }

  recordLogin(userId: string, at: Date) {
    return this.prisma.client.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
  }

  findRefreshToken(tokenHash: string) {
    return this.prisma.client.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  }

  createRefreshToken(data: Prisma.RefreshTokenUncheckedCreateInput) {
    return this.prisma.client.refreshToken.create({ data });
  }

  /** Compare-and-set: succeeds for exactly one of any number of concurrent refresh attempts. */
  async claimRotation(id: string, at: Date): Promise<boolean> {
    return (await this.prisma.client.refreshToken.updateMany({ where: { id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: at } })).count === 1;
  }

  revokeFamily(familyId: string, at: Date) {
    return this.prisma.client.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at } });
  }

  revokeAllForUser(db: Db, userId: string, at: Date) {
    return db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
  }

  companySummary(companyId: string) {
    return this.prisma.client.company.findUnique({ where: { id: companyId }, include: { kybProfile: { select: { id: true, status: true } } } });
  }
}
