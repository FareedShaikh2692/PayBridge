import { Permission, RoleName } from '@paybridge/shared';
import { DomainError } from './errors';

/** The authenticated caller and their tenant. Built once per request from the verified token and the database. */
export interface Actor {
  userId: string;
  email: string;
  fullName: string;
  companyId: string | null;
  role: RoleName;
  permissions: ReadonlySet<Permission>;
  isPlatformAdmin: boolean;
}

/** The caller's company. Platform admins and users without a company have none. */
export function requireCompany(actor: Actor): string {
  if (!actor.companyId) throw new DomainError('COMPANY_NOT_FOUND', 'You do not belong to a company yet.');
  return actor.companyId;
}

/** Prisma `where` fragment that confines a query to the caller's tenant. Platform admins see every tenant. */
export function tenantWhere(actor: Actor): { companyId?: string } {
  if (actor.isPlatformAdmin) return {};
  return { companyId: requireCompany(actor) };
}

/** A company id from a path or body is only ever compared with the caller's context, never trusted. */
export function assertCompanyAccess(actor: Actor, companyId: string): void {
  if (actor.isPlatformAdmin) return;
  if (actor.companyId !== companyId) throw new DomainError('COMPANY_NOT_FOUND');
}
