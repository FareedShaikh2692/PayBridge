import { Injectable } from '@nestjs/common';
import { ComplianceOutcome, ComplianceRule } from '@paybridge/database';
import { dec } from '@paybridge/shared';
import { Clock } from '../../common/clock';
import { logger } from '../../common/logger';
import { Db } from '../../common/prisma.service';
import { SanctionsProvider, ScreeningResult } from './sanctions.provider';

export interface ComplianceContext {
  companyId: string;
  companyName: string;
  beneficiary: { name: string; accountHolderName: string; country: string };
  sourceAmount: string;
  sourceCurrency: string;
  /** When re-screening an existing payment, leave it out of its own velocity count. */
  excludePaymentId?: string;
}

export interface RuleEvaluation {
  ruleId: string;
  ruleCode: string;
  ruleVersion: number;
  ruleName: string;
  triggered: boolean;
  outcome: ComplianceOutcome;
  details: Record<string, unknown>;
}

export interface ComplianceResult {
  result: ComplianceOutcome;
  evaluations: RuleEvaluation[];
}

/** REJECT outranks REVIEW outranks CLEAR. */
export function aggregate(outcomes: ComplianceOutcome[]): ComplianceOutcome {
  if (outcomes.includes('REJECT')) return 'REJECT';
  if (outcomes.includes('REVIEW')) return 'REVIEW';
  return 'CLEAR';
}

/**
 * Configurable rules engine (docs/COMPLIANCE.md). Rules are rows; each evaluation — including rules that did
 * not fire — is returned so the caller can persist what was checked, not only what failed.
 */
@Injectable()
export class ComplianceEngine {
  constructor(
    private readonly sanctions: SanctionsProvider,
    private readonly clock: Clock,
  ) {}

  async evaluate(db: Db, context: ComplianceContext): Promise<ComplianceResult> {
    const rules = await db.complianceRule.findMany({ where: { enabled: true }, orderBy: { code: 'asc' } });
    const screening = new Map<string, ScreeningResult | 'ERROR'>();
    const screen = async (name: string, type: 'beneficiary' | 'company'): Promise<ScreeningResult | 'ERROR'> => {
      const key = `${type}:${name}`;
      if (!screening.has(key)) {
        try {
          screening.set(key, await this.sanctions.screen({ name, type }));
        } catch (err) {
          // Fail safe: if screening is unavailable the payment is held for review, never waved through.
          logger.error({ err: String(err), type }, 'screening provider failed');
          screening.set(key, 'ERROR');
        }
      }
      return screening.get(key)!;
    };

    const evaluations: RuleEvaluation[] = [];
    for (const rule of rules) {
      const { triggered, details, outcomeOverride } = await this.run(db, rule, context, screen);
      evaluations.push({
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleVersion: rule.version,
        ruleName: rule.name,
        triggered,
        outcome: triggered ? (outcomeOverride ?? rule.outcome) : 'CLEAR',
        details,
      });
    }
    return { result: aggregate(evaluations.map((e) => e.outcome)), evaluations };
  }

  private async run(
    db: Db,
    rule: ComplianceRule,
    c: ComplianceContext,
    screen: (name: string, type: 'beneficiary' | 'company') => Promise<ScreeningResult | 'ERROR'>,
  ): Promise<{ triggered: boolean; details: Record<string, unknown>; outcomeOverride?: ComplianceOutcome }> {
    const p = rule.parameters as any;
    switch (rule.type) {
      case 'AMOUNT_THRESHOLD': {
        const triggered = c.sourceCurrency === p.currency && dec(c.sourceAmount).gt(dec(String(p.threshold)));
        return { triggered, details: { amount: c.sourceAmount, currency: c.sourceCurrency, threshold: String(p.threshold) } };
      }
      case 'VELOCITY': {
        const since = new Date(this.clock.now().getTime() - Number(p.windowHours) * 3_600_000);
        const count = await db.paymentOrder.count({ where: { companyId: c.companyId, createdAt: { gte: since }, status: { not: 'CANCELLED' }, ...(c.excludePaymentId ? { id: { not: c.excludePaymentId } } : {}) } });
        // "More than maxCount payments in the window": this payment would be number count + 1.
        return { triggered: count >= Number(p.maxCount), details: { paymentsInWindow: count, maxCount: p.maxCount, windowHours: p.windowHours } };
      }
      case 'DESTINATION_COUNTRY': {
        const allowed: string[] = p.allowed ?? [];
        return { triggered: !allowed.includes(c.beneficiary.country), details: { country: c.beneficiary.country, allowed } };
      }
      case 'SANCTIONS':
      case 'PEP': {
        const wanted: ScreeningResult = rule.type === 'SANCTIONS' ? 'MATCH' : 'PEP_MATCH';
        const subjects: string[] = p.subjects ?? ['beneficiary'];
        const results: Record<string, string> = {};
        if (subjects.includes('beneficiary')) {
          results.beneficiary = await screen(c.beneficiary.name, 'beneficiary');
          if (c.beneficiary.accountHolderName !== c.beneficiary.name) results.accountHolder = await screen(c.beneficiary.accountHolderName, 'beneficiary');
        }
        if (subjects.includes('company')) results.company = await screen(c.companyName, 'company');
        const values = Object.values(results);
        if (values.includes(wanted)) return { triggered: true, details: { screening: results } };
        if (values.includes('ERROR')) return { triggered: true, details: { screening: results, note: 'Screening unavailable; held for review.' }, outcomeOverride: 'REVIEW' };
        return { triggered: false, details: { screening: results } };
      }
      default:
        return { triggered: false, details: {} };
    }
  }

  /** Name screening used when a beneficiary is created or renamed. */
  async screenName(name: string): Promise<ScreeningResult | 'ERROR'> {
    try {
      return await this.sanctions.screen({ name, type: 'beneficiary' });
    } catch (err) {
      logger.error({ err: String(err) }, 'screening provider failed');
      return 'ERROR';
    }
  }
}
