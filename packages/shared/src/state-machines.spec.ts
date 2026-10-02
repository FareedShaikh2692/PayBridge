import {
  InvalidTransitionError,
  KYB_STATUSES,
  KYB_TRANSITIONS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  QUOTE_STATUSES,
  QUOTE_TRANSITIONS,
  gatesClosed,
  kybMachine,
  paymentMachine,
  quoteMachine,
} from './state-machines';

const LEGAL_PAYMENT = [
  'CREATED>COMPLIANCE_REVIEW', 'CREATED>APPROVED', 'CREATED>CANCELLED',
  'COMPLIANCE_REVIEW>APPROVED', 'COMPLIANCE_REVIEW>CANCELLED',
  'APPROVED>PROCESSING', 'APPROVED>CANCELLED',
  'PROCESSING>PAID', 'PROCESSING>FAILED',
];

describe('payment state machine', () => {
  it('accepts exactly the documented transitions (exhaustive 7×7)', () => {
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        expect([`${from}>${to}`, paymentMachine.can(from, to)]).toEqual([`${from}>${to}`, LEGAL_PAYMENT.includes(`${from}>${to}`)]);
      }
    }
  });
  it('treats PAID, FAILED and CANCELLED as terminal', () => {
    expect(PAYMENT_STATUSES.filter((s) => paymentMachine.isTerminal(s))).toEqual(['PAID', 'FAILED', 'CANCELLED']);
  });
  it('throws a typed error on an illegal transition', () => {
    expect(() => paymentMachine.assert('PROCESSING', 'CANCELLED')).toThrow(InvalidTransitionError);
    expect(() => paymentMachine.assert('CREATED', 'PROCESSING')).toThrow(InvalidTransitionError);
    expect(() => paymentMachine.assert('PAID', 'FAILED')).toThrow(InvalidTransitionError);
  });
  it('has a transition row for every state', () => {
    expect(Object.keys(PAYMENT_TRANSITIONS).sort()).toEqual([...PAYMENT_STATUSES].sort());
  });
});

describe('approval gates', () => {
  it('requires both gates to be closed', () => {
    expect(gatesClosed('CLEAR', 'NOT_REQUIRED')).toBe(true);
    expect(gatesClosed('CLEAR', 'APPROVED')).toBe(true);
    expect(gatesClosed('CLEARED_BY_ADMIN', 'APPROVED')).toBe(true);
    expect(gatesClosed('CLEAR', 'PENDING')).toBe(false);
    expect(gatesClosed('REVIEW', 'APPROVED')).toBe(false);
    expect(gatesClosed('REJECT', 'APPROVED')).toBe(false);
    expect(gatesClosed('REJECTED_BY_ADMIN', 'APPROVED')).toBe(false);
    expect(gatesClosed('CLEAR', 'REJECTED')).toBe(false);
  });
});

describe('KYB state machine', () => {
  const legal = ['DRAFT>SUBMITTED', 'SUBMITTED>UNDER_REVIEW', 'UNDER_REVIEW>APPROVED', 'UNDER_REVIEW>REJECTED', 'APPROVED>EXPIRED', 'REJECTED>DRAFT', 'EXPIRED>DRAFT'];
  it('accepts exactly the documented transitions', () => {
    for (const from of KYB_STATUSES) for (const to of KYB_STATUSES) expect(kybMachine.can(from, to)).toBe(legal.includes(`${from}>${to}`));
    expect(Object.keys(KYB_TRANSITIONS)).toHaveLength(KYB_STATUSES.length);
  });
  it('cannot skip review', () => {
    expect(kybMachine.can('DRAFT', 'APPROVED')).toBe(false);
    expect(kybMachine.can('SUBMITTED', 'APPROVED')).toBe(false);
  });
});

describe('quote state machine', () => {
  it('only ACTIVE can change, and all targets are terminal', () => {
    for (const from of QUOTE_STATUSES) for (const to of QUOTE_STATUSES) expect(quoteMachine.can(from, to)).toBe(from === 'ACTIVE' && to !== 'ACTIVE');
    expect(QUOTE_TRANSITIONS.USED).toHaveLength(0);
  });
});
