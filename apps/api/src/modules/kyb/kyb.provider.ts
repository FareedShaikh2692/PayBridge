import { Injectable } from '@nestjs/common';

export interface KybSubject {
  name: string;
  tradeLicenseNumber: string;
  registrationNumber: string;
  country: string;
}
export interface KybVerification {
  provider: string;
  result: 'PASS' | 'FAIL';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  checkedAt: string;
}

export abstract class KybProvider {
  abstract verify(subject: KybSubject): Promise<KybVerification>;
}

/** Deterministic mock (docs/COMPLIANCE.md §6). It verifies nothing; it only recognises test tokens. */
@Injectable()
export class MockKYBProvider extends KybProvider {
  async verify(subject: KybSubject): Promise<KybVerification> {
    const haystack = `${subject.name} ${subject.tradeLicenseNumber}`.toUpperCase();
    const base = { provider: 'mock-kyb', checkedAt: new Date().toISOString() };
    if (haystack.includes('TEST-KYB-REJECT')) return { ...base, result: 'FAIL', riskLevel: 'HIGH', reasons: ['MOCK_REGISTRY_MISMATCH'] };
    if (haystack.includes('TEST-KYB-HIGHRISK')) return { ...base, result: 'PASS', riskLevel: 'HIGH', reasons: ['MOCK_HIGH_RISK_SECTOR'] };
    return { ...base, result: 'PASS', riskLevel: 'LOW', reasons: [] };
  }
}
