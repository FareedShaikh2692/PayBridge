export const PAYMENT_STATUSES = ['CREATED', 'COMPLIANCE_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const KYB_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export type KybStatus = (typeof KYB_STATUSES)[number];

export const QUOTE_STATUSES = ['ACTIVE', 'EXPIRED', 'USED', 'CANCELLED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

type Transitions<S extends string> = Record<S, readonly S[]>;

/** docs/ARCHITECTURE.md §6.1 */
export const PAYMENT_TRANSITIONS: Transitions<PaymentStatus> = {
  CREATED: ['COMPLIANCE_REVIEW', 'APPROVED', 'CANCELLED'],
  COMPLIANCE_REVIEW: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PAID', 'FAILED'],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
};

/** docs/ARCHITECTURE.md §6.2 */
export const KYB_TRANSITIONS: Transitions<KybStatus> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['EXPIRED'],
  REJECTED: ['DRAFT'],
  EXPIRED: ['DRAFT'],
};

/** docs/ARCHITECTURE.md §6.3 */
export const QUOTE_TRANSITIONS: Transitions<QuoteStatus> = {
  ACTIVE: ['USED', 'EXPIRED', 'CANCELLED'],
  USED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`${machine}: transition ${from} → ${to} is not allowed`);
    this.name = 'InvalidTransitionError';
  }
}

function makeMachine<S extends string>(name: string, table: Transitions<S>) {
  return {
    can: (from: S, to: S): boolean => table[from]?.includes(to) ?? false,
    assert: (from: S, to: S): void => {
      if (!(table[from]?.includes(to) ?? false)) throw new InvalidTransitionError(name, from, to);
    },
    isTerminal: (state: S): boolean => (table[state]?.length ?? 0) === 0,
    next: (from: S): readonly S[] => table[from] ?? [],
  };
}

export const paymentMachine = makeMachine('payment', PAYMENT_TRANSITIONS);
export const kybMachine = makeMachine('kyb', KYB_TRANSITIONS);
export const quoteMachine = makeMachine('quote', QUOTE_TRANSITIONS);

export type PaymentComplianceStatus = 'CLEAR' | 'REVIEW' | 'REJECT' | 'CLEARED_BY_ADMIN' | 'REJECTED_BY_ADMIN';
export type PaymentApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

/** Both gates must be closed before a payment may move to APPROVED. */
export function gatesClosed(compliance: PaymentComplianceStatus, approval: PaymentApprovalStatus): boolean {
  const complianceOk = compliance === 'CLEAR' || compliance === 'CLEARED_BY_ADMIN';
  const approvalOk = approval === 'NOT_REQUIRED' || approval === 'APPROVED';
  return complianceOk && approvalOk;
}

/** A human-readable label derived from status and gates, for timelines and badges. */
export function paymentDisplayStatus(
  status: PaymentStatus,
  compliance: PaymentComplianceStatus,
  approval: PaymentApprovalStatus,
): string {
  if (status === 'CREATED' && approval === 'PENDING') return 'Awaiting approval';
  if (status === 'COMPLIANCE_REVIEW' && compliance === 'REVIEW') return 'Compliance review';
  if (status === 'COMPLIANCE_REVIEW' && approval === 'PENDING') return 'Awaiting approval';
  const labels: Record<PaymentStatus, string> = {
    CREATED: 'Created',
    COMPLIANCE_REVIEW: 'Compliance review',
    APPROVED: 'Approved',
    PROCESSING: 'Processing',
    PAID: 'Paid',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
  };
  return labels[status];
}
