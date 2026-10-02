import { calculateQuote } from './fx';
import { checkBalanced, postings } from './ledger';
import { dec } from './money';
import { ROLE_PERMISSIONS, PERMISSIONS } from './permissions';
import { isValidAccountNumber, isValidIfsc, maskAccountNumber } from './validators';

const q = calculateQuote({ baseAmount: '10000', midRate: '22.70', spreadPct: '0.50', feeAmount: '25' });
const amounts = { sourceAmount: q.baseAmount, feeAmount: q.feeAmount, fxMarginAmount: q.fxMarginAmount, destinationAmount: q.recipientAmount };

describe('posting templates', () => {
  it.each(Object.keys(postings).filter((k) => !['walletTopup', 'nostroFunding'].includes(k)))('%s balances per currency', (name) => {
    const entries = (postings as any)[name](amounts);
    expect(checkBalanced(entries).problems).toEqual([]);
  });
  it('a payout return followed by the reversal undoes settlement and capture exactly', () => {
    const net: Record<string, number> = {};
    for (const e of [...postings.capture(amounts), ...postings.settlement(amounts), ...postings.payoutReturn(amounts), ...postings.reversal(amounts)]) {
      if (e.account === 'CUSTOMER_HOLD_AED' || e.account === 'CUSTOMER_WALLET_AED') continue;
      const minor = Number(BigInt(e.amount.replace('.', '')));
      net[e.account] = (net[e.account] ?? 0) + (e.direction === 'DEBIT' ? minor : -minor);
    }
    expect(Object.values(net).every((v) => v === 0)).toBe(true);
  });
  it('top-up and nostro funding balance', () => {
    expect(checkBalanced(postings.walletTopup('100000')).balanced).toBe(true);
    expect(checkBalanced(postings.nostroFunding('5000000')).balanced).toBe(true);
  });
  it('capture matches the worked example in LEDGER.md §5.3', () => {
    expect(postings.capture(amounts)).toEqual([
      { account: 'CUSTOMER_HOLD_AED', direction: 'DEBIT', amount: '10025.00', currency: 'AED' },
      { account: 'FEE_REVENUE', direction: 'CREDIT', amount: '25.00', currency: 'AED' },
      { account: 'FX_MARGIN_REVENUE', direction: 'CREDIT', amount: '50.00', currency: 'AED' },
      { account: 'FX_POSITION_AED', direction: 'CREDIT', amount: '9950.00', currency: 'AED' },
      { account: 'FX_POSITION_INR', direction: 'DEBIT', amount: '225865.00', currency: 'INR' },
      { account: 'INR_PAYOUT_PAYABLE', direction: 'CREDIT', amount: '225865.00', currency: 'INR' },
    ]);
  });
  it('reversal is the exact mirror of capture net of the hold', () => {
    const cap = postings.capture(amounts);
    const rev = postings.reversal(amounts);
    for (const e of cap.filter((x) => x.account !== 'CUSTOMER_HOLD_AED')) {
      expect(rev).toContainEqual({ ...e, direction: e.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT' });
    }
  });
  it('omits zero lines (zero fee, zero spread)', () => {
    const z = calculateQuote({ baseAmount: '100', midRate: '22.70', spreadPct: '0', feeAmount: '0' });
    const entries = postings.capture({ sourceAmount: z.baseAmount, feeAmount: z.feeAmount, fxMarginAmount: z.fxMarginAmount, destinationAmount: z.recipientAmount });
    expect(entries.every((e) => dec(e.amount).gt(0))).toBe(true);
    expect(checkBalanced(entries).balanced).toBe(true);
  });
});

describe('checkBalanced', () => {
  it('rejects unbalanced, single-entry, zero and negative postings', () => {
    expect(checkBalanced([{ direction: 'DEBIT', amount: '10', currency: 'AED' }, { direction: 'CREDIT', amount: '9.99', currency: 'AED' }]).balanced).toBe(false);
    expect(checkBalanced([{ direction: 'DEBIT', amount: '10', currency: 'AED' }]).balanced).toBe(false);
    expect(checkBalanced([{ direction: 'DEBIT', amount: '0', currency: 'AED' }, { direction: 'CREDIT', amount: '0', currency: 'AED' }]).balanced).toBe(false);
    expect(checkBalanced([{ direction: 'DEBIT', amount: '-1', currency: 'AED' }, { direction: 'CREDIT', amount: '-1', currency: 'AED' }]).balanced).toBe(false);
  });
  it('requires balance per currency, not across currencies', () => {
    const r = checkBalanced([{ direction: 'DEBIT', amount: '100', currency: 'AED' }, { direction: 'CREDIT', amount: '100', currency: 'INR' }]);
    expect(r.balanced).toBe(false);
  });
  it('rejects sub-minor-unit amounts', () => {
    expect(checkBalanced([{ direction: 'DEBIT', amount: '1.001', currency: 'AED' }, { direction: 'CREDIT', amount: '1.001', currency: 'AED' }]).balanced).toBe(false);
  });
});

describe('validators', () => {
  it('validates IFSC', () => {
    expect(isValidIfsc('TEST0001234')).toBe(true);
    expect(isValidIfsc('HDFC0ABC123')).toBe(true);
    expect(isValidIfsc('HDFC1234567')).toBe(false); // fifth character must be 0
    expect(isValidIfsc('test0001234')).toBe(false);
    expect(isValidIfsc('TEST000123')).toBe(false);
  });
  it('validates account numbers and masks them', () => {
    expect(isValidAccountNumber('000111222333')).toBe(true);
    expect(isValidAccountNumber('12345678')).toBe(false);
    expect(isValidAccountNumber('1234567890123456789')).toBe(false);
    expect(isValidAccountNumber('12345abc90')).toBe(false);
    expect(maskAccountNumber('2333')).toBe('XXXXXX2333');
  });
});

describe('permission matrix', () => {
  it('only uses catalogued permissions', () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSIONS).toContain(p);
  });
  it('enforces separation of duties', () => {
    expect(ROLE_PERMISSIONS.MAKER).not.toContain('payment.approve');
    expect(ROLE_PERMISSIONS.APPROVER).not.toContain('payment.create');
    expect(ROLE_PERMISSIONS.VIEWER.every((p) => p.endsWith('.read'))).toBe(true);
    expect(ROLE_PERMISSIONS.PLATFORM_ADMIN).not.toContain('payment.create');
    expect(ROLE_PERMISSIONS.COMPANY_ADMIN).not.toContain('compliance.review');
    expect(ROLE_PERMISSIONS.COMPANY_ADMIN).not.toContain('kyb.review');
  });
});
