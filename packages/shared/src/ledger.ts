import { Currency, D, Dec, DecimalInput, dec, hasValidScale } from './money';

export type EntryDirection = 'DEBIT' | 'CREDIT';

/** docs/LEDGER.md §4 — chart of accounts. */
export const ACCOUNTS = {
  SAFEGUARDING_BANK_AED: { code: '1000', name: 'Safeguarding Bank AED', type: 'ASSET', normal: 'DEBIT', currency: 'AED', scope: 'SYSTEM' },
  NOSTRO_INR: { code: '1200', name: 'Nostro INR', type: 'ASSET', normal: 'DEBIT', currency: 'INR', scope: 'SYSTEM' },
  FX_POSITION_INR: { code: '1300', name: 'FX Position INR', type: 'ASSET', normal: 'DEBIT', currency: 'INR', scope: 'SYSTEM' },
  CUSTOMER_WALLET_AED: { code: '2000', name: 'Customer Wallet AED', type: 'LIABILITY', normal: 'CREDIT', currency: 'AED', scope: 'COMPANY' },
  CUSTOMER_HOLD_AED: { code: '2010', name: 'Customer Payment Hold AED', type: 'LIABILITY', normal: 'CREDIT', currency: 'AED', scope: 'COMPANY' },
  INR_PAYOUT_PAYABLE: { code: '2200', name: 'INR Payout Payable', type: 'LIABILITY', normal: 'CREDIT', currency: 'INR', scope: 'SYSTEM' },
  FX_POSITION_AED: { code: '2300', name: 'FX Position AED', type: 'LIABILITY', normal: 'CREDIT', currency: 'AED', scope: 'SYSTEM' },
  SANDBOX_EQUITY_INR: { code: '3000', name: 'Sandbox Equity INR', type: 'EQUITY', normal: 'CREDIT', currency: 'INR', scope: 'SYSTEM' },
  FEE_REVENUE: { code: '4000', name: 'Fee Revenue', type: 'REVENUE', normal: 'CREDIT', currency: 'AED', scope: 'SYSTEM' },
  FX_MARGIN_REVENUE: { code: '4010', name: 'FX Margin Revenue', type: 'REVENUE', normal: 'CREDIT', currency: 'AED', scope: 'SYSTEM' },
} as const satisfies Record<
  string,
  { code: string; name: string; type: string; normal: EntryDirection; currency: Currency; scope: 'SYSTEM' | 'COMPANY' }
>;

export type AccountKey = keyof typeof ACCOUNTS;

export interface TemplateEntry {
  account: AccountKey;
  direction: EntryDirection;
  amount: string;
  currency: Currency;
}

export interface BalancedCheck {
  balanced: boolean;
  byCurrency: Record<string, { debit: string; credit: string }>;
  problems: string[];
}

/** Validates the structural invariants of a ledger transaction (LEDGER.md §7 steps 1–2). */
export function checkBalanced(entries: { direction: EntryDirection; amount: DecimalInput; currency: string }[]): BalancedCheck {
  const problems: string[] = [];
  const totals: Record<string, { debit: Dec; credit: Dec }> = {};
  if (entries.length < 2) problems.push('A transaction needs at least two entries.');
  for (const e of entries) {
    const amount = dec(e.amount);
    if (amount.lte(0)) problems.push('Entry amounts must be strictly positive.');
    if ((e.currency === 'AED' || e.currency === 'INR') && !hasValidScale(amount, e.currency)) {
      problems.push(`Amount ${amount.toString()} has too many decimal places for ${e.currency}.`);
    }
    const t = (totals[e.currency] ??= { debit: new D(0), credit: new D(0) });
    if (e.direction === 'DEBIT') t.debit = t.debit.plus(amount);
    else t.credit = t.credit.plus(amount);
  }
  const byCurrency: BalancedCheck['byCurrency'] = {};
  for (const [ccy, t] of Object.entries(totals)) {
    byCurrency[ccy] = { debit: t.debit.toFixed(2), credit: t.credit.toFixed(2) };
    if (!t.debit.eq(t.credit)) problems.push(`${ccy}: debits ${t.debit.toFixed(2)} ≠ credits ${t.credit.toFixed(2)}.`);
  }
  return { balanced: problems.length === 0, byCurrency, problems };
}

export interface PaymentAmounts {
  sourceAmount: DecimalInput; // AED converted
  feeAmount: DecimalInput; // AED
  fxMarginAmount: DecimalInput; // AED
  destinationAmount: DecimalInput; // INR
}

const f = (v: DecimalInput) => dec(v).toFixed(2);

/** Posting templates — docs/LEDGER.md §5. Zero-amount lines are omitted. */
export const postings = {
  walletTopup: (amount: DecimalInput): TemplateEntry[] => [
    { account: 'SAFEGUARDING_BANK_AED', direction: 'DEBIT', amount: f(amount), currency: 'AED' },
    { account: 'CUSTOMER_WALLET_AED', direction: 'CREDIT', amount: f(amount), currency: 'AED' },
  ],
  nostroFunding: (amount: DecimalInput): TemplateEntry[] => [
    { account: 'NOSTRO_INR', direction: 'DEBIT', amount: f(amount), currency: 'INR' },
    { account: 'SANDBOX_EQUITY_INR', direction: 'CREDIT', amount: f(amount), currency: 'INR' },
  ],
  hold: (p: PaymentAmounts): TemplateEntry[] => {
    const total = dec(p.sourceAmount).plus(dec(p.feeAmount));
    return [
      { account: 'CUSTOMER_WALLET_AED', direction: 'DEBIT', amount: f(total), currency: 'AED' },
      { account: 'CUSTOMER_HOLD_AED', direction: 'CREDIT', amount: f(total), currency: 'AED' },
    ];
  },
  holdRelease: (p: PaymentAmounts): TemplateEntry[] => {
    const total = dec(p.sourceAmount).plus(dec(p.feeAmount));
    return [
      { account: 'CUSTOMER_HOLD_AED', direction: 'DEBIT', amount: f(total), currency: 'AED' },
      { account: 'CUSTOMER_WALLET_AED', direction: 'CREDIT', amount: f(total), currency: 'AED' },
    ];
  },
  capture: (p: PaymentAmounts): TemplateEntry[] => {
    const total = dec(p.sourceAmount).plus(dec(p.feeAmount));
    const payoutCost = dec(p.sourceAmount).minus(dec(p.fxMarginAmount));
    return nonZero([
      { account: 'CUSTOMER_HOLD_AED', direction: 'DEBIT', amount: f(total), currency: 'AED' },
      { account: 'FEE_REVENUE', direction: 'CREDIT', amount: f(p.feeAmount), currency: 'AED' },
      { account: 'FX_MARGIN_REVENUE', direction: 'CREDIT', amount: f(p.fxMarginAmount), currency: 'AED' },
      { account: 'FX_POSITION_AED', direction: 'CREDIT', amount: f(payoutCost), currency: 'AED' },
      { account: 'FX_POSITION_INR', direction: 'DEBIT', amount: f(p.destinationAmount), currency: 'INR' },
      { account: 'INR_PAYOUT_PAYABLE', direction: 'CREDIT', amount: f(p.destinationAmount), currency: 'INR' },
    ]);
  },
  settlement: (p: PaymentAmounts): TemplateEntry[] => [
    { account: 'INR_PAYOUT_PAYABLE', direction: 'DEBIT', amount: f(p.destinationAmount), currency: 'INR' },
    { account: 'NOSTRO_INR', direction: 'CREDIT', amount: f(p.destinationAmount), currency: 'INR' },
  ],
  /** The provider returned a payout that had been paid: the INR comes back and is owed again (LEDGER.md §5.7). */
  payoutReturn: (p: PaymentAmounts): TemplateEntry[] => [
    { account: 'NOSTRO_INR', direction: 'DEBIT', amount: f(p.destinationAmount), currency: 'INR' },
    { account: 'INR_PAYOUT_PAYABLE', direction: 'CREDIT', amount: f(p.destinationAmount), currency: 'INR' },
  ],
  /** Mirror of capture, refunded straight to the wallet (fee included). */
  reversal: (p: PaymentAmounts): TemplateEntry[] => {
    const total = dec(p.sourceAmount).plus(dec(p.feeAmount));
    const payoutCost = dec(p.sourceAmount).minus(dec(p.fxMarginAmount));
    return nonZero([
      { account: 'FEE_REVENUE', direction: 'DEBIT', amount: f(p.feeAmount), currency: 'AED' },
      { account: 'FX_MARGIN_REVENUE', direction: 'DEBIT', amount: f(p.fxMarginAmount), currency: 'AED' },
      { account: 'FX_POSITION_AED', direction: 'DEBIT', amount: f(payoutCost), currency: 'AED' },
      { account: 'CUSTOMER_WALLET_AED', direction: 'CREDIT', amount: f(total), currency: 'AED' },
      { account: 'INR_PAYOUT_PAYABLE', direction: 'DEBIT', amount: f(p.destinationAmount), currency: 'INR' },
      { account: 'FX_POSITION_INR', direction: 'CREDIT', amount: f(p.destinationAmount), currency: 'INR' },
    ]);
  },
};

function nonZero(entries: TemplateEntry[]): TemplateEntry[] {
  return entries.filter((e) => !dec(e.amount).isZero());
}

export const postingKey = {
  topup: (id: string) => `topup:${id}`,
  hold: (paymentId: string) => `payment:${paymentId}:hold`,
  release: (paymentId: string) => `payment:${paymentId}:release`,
  capture: (paymentId: string) => `payment:${paymentId}:capture`,
  settle: (paymentId: string) => `payment:${paymentId}:settle`,
  reverse: (paymentId: string) => `payment:${paymentId}:reverse`,
  payoutReturn: (paymentId: string) => `payment:${paymentId}:return`,
  refund: (paymentId: string) => `payment:${paymentId}:refund`,
};
