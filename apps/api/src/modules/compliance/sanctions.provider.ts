import { Injectable } from '@nestjs/common';

export type ScreeningResult = 'CLEAR' | 'MATCH' | 'PEP_MATCH';
export interface ScreeningSubject {
  name: string;
  type: 'beneficiary' | 'company';
  country?: string;
}

export class ProviderTimeoutError extends Error {
  constructor(provider: string) {
    super(`${provider} did not respond in time`);
    this.name = 'ProviderTimeoutError';
  }
}

export abstract class SanctionsProvider {
  abstract screen(subject: ScreeningSubject): Promise<ScreeningResult>;
}

/**
 * Deterministic mock (docs/COMPLIANCE.md §6). It consults no watch-list: it recognises test tokens only,
 * and must never be used to screen real people or companies.
 */
@Injectable()
export class MockSanctionsProvider extends SanctionsProvider {
  async screen(subject: ScreeningSubject): Promise<ScreeningResult> {
    const name = subject.name.toUpperCase();
    if (name.includes('TEST-SCREEN-TIMEOUT')) throw new ProviderTimeoutError('mock-sanctions');
    if (name.includes('TEST-SANCTION')) return 'MATCH';
    if (name.includes('TEST-PEP')) return 'PEP_MATCH';
    return 'CLEAR';
  }
}
