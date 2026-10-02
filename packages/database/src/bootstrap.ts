import type { PrismaClient } from '@prisma/client';
import { ACCOUNTS, PERMISSIONS, ROLES, ROLE_PERMISSIONS, ROLE_SCOPE } from '@paybridge/shared';

/** docs/COMPLIANCE.md §3 */
export const DEFAULT_COMPLIANCE_RULES = [
  { code: 'AMOUNT_THRESHOLD', type: 'AMOUNT_THRESHOLD', name: 'Amount threshold', description: 'Payments above the threshold require review.', parameters: { currency: 'AED', threshold: '50000.00' }, outcome: 'REVIEW' },
  { code: 'VELOCITY_24H', type: 'VELOCITY', name: 'Velocity (24 hours)', description: 'More than five payments in 24 hours require review.', parameters: { maxCount: 5, windowHours: 24 }, outcome: 'REVIEW' },
  { code: 'DESTINATION_COUNTRY', type: 'DESTINATION_COUNTRY', name: 'Destination country', description: 'Only configured destination countries are permitted.', parameters: { allowed: ['IN'] }, outcome: 'REJECT' },
  { code: 'SANCTIONS_SCREEN', type: 'SANCTIONS', name: 'Sanctions screening (mock)', description: 'Mock sanctions screening of beneficiary and company.', parameters: { subjects: ['beneficiary', 'company'] }, outcome: 'REJECT' },
  { code: 'PEP_SCREEN', type: 'PEP', name: 'PEP screening (mock)', description: 'Mock politically-exposed-person screening.', parameters: { subjects: ['beneficiary'] }, outcome: 'REVIEW' },
] as const;

/**
 * Idempotently installs reference data the application cannot run without:
 * roles, permissions, the role → permission matrix, system ledger accounts and default compliance rules.
 */
export async function bootstrapReferenceData(prisma: PrismaClient): Promise<void> {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  for (const name of ROLES) {
    await prisma.role.upsert({ where: { name }, update: { scope: ROLE_SCOPE[name] }, create: { name, scope: ROLE_SCOPE[name] } });
  }
  const roles = await prisma.role.findMany();
  const permissions = await prisma.permission.findMany();
  for (const role of roles) {
    const wanted = new Set<string>(ROLE_PERMISSIONS[role.name as keyof typeof ROLE_PERMISSIONS] ?? []);
    const wantedIds = permissions.filter((p) => wanted.has(p.key)).map((p) => p.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wantedIds } } });
    await prisma.rolePermission.createMany({ data: wantedIds.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
  }

  for (const acc of Object.values(ACCOUNTS)) {
    if (acc.scope !== 'SYSTEM') continue;
    const existing = await prisma.ledgerAccount.findFirst({ where: { companyId: null, code: acc.code } });
    if (!existing) {
      await prisma.ledgerAccount.create({
        data: { code: acc.code, name: acc.name, type: acc.type, normalBalance: acc.normal, currency: acc.currency },
      });
    }
  }

  for (const rule of DEFAULT_COMPLIANCE_RULES) {
    await prisma.complianceRule.upsert({
      where: { code: rule.code },
      update: {},
      create: { code: rule.code, type: rule.type, name: rule.name, description: rule.description, parameters: rule.parameters as object, outcome: rule.outcome },
    });
  }
}
