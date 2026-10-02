import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, RoleName } from '@paybridge/shared';
import * as jwt from 'jsonwebtoken';
import { AppConfig, CONFIG } from '../config';
import { Actor } from './actor';
import { ctx } from './context';
import { AUTH_ONLY, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators';
import { DomainError } from './errors';
import { PrismaService } from './prisma.service';

/**
 * Global guard. Deny by default: a route must be @Public(), @Authenticated() or declare @Permissions(...).
 * Permissions are resolved from the database on every request, so a role change takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHENTICATED');

    let userId: string;
    try {
      const payload = jwt.verify(header.slice(7), this.config.JWT_SECRET, { algorithms: ['HS256'], issuer: 'paybridge' }) as jwt.JwtPayload;
      if (!payload.sub || payload.typ !== 'access') throw new Error('invalid token');
      userId = payload.sub;
    } catch {
      throw new DomainError('UNAUTHENTICATED');
    }

    const actor = await this.loadActor(userId);
    req.actor = actor;
    const store = ctx();
    if (store) {
      store.userId = actor.userId;
      store.companyId = actor.companyId;
    }

    const authOnly = this.reflector.getAllAndOverride<boolean>(AUTH_ONLY, targets);
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets);
    if (required?.length) {
      if (!required.every((p) => actor.permissions.has(p))) throw new DomainError('FORBIDDEN');
      return true;
    }
    if (authOnly) return true;
    throw new DomainError('FORBIDDEN'); // undecorated route: fail closed
  }

  async loadActor(userId: string): Promise<Actor> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: {
        platformRole: { include: { permissions: { include: { permission: true } } } },
        memberships: {
          where: { status: 'ACTIVE', company: { status: 'ACTIVE' } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user || user.status !== 'ACTIVE') throw new DomainError('UNAUTHENTICATED');

    const base = { userId: user.id, email: user.email, fullName: user.fullName };
    if (user.platformRole) {
      return {
        ...base,
        companyId: null,
        role: user.platformRole.name as RoleName,
        permissions: new Set(user.platformRole.permissions.map((rp) => rp.permission.key as Permission)),
        isPlatformAdmin: true,
      };
    }
    const membership = user.memberships[0];
    if (!membership) {
      // Registered but not yet attached to a company: authenticated, no permissions.
      return { ...base, companyId: null, role: 'VIEWER', permissions: new Set(), isPlatformAdmin: false };
    }
    return {
      ...base,
      companyId: membership.companyId,
      role: membership.role.name as RoleName,
      permissions: new Set(membership.role.permissions.map((rp) => rp.permission.key as Permission)),
      isPlatformAdmin: false,
    };
  }
}
