import { CURRENCY_SCALE, DecimalInput, RATE_SCALE, dec, money, rate, roundHalfEven, truncate } from './money';

export interface QuoteInput {
  baseAmount: DecimalInput; // AED to convert
  midRate: DecimalInput; // INR per 1 AED, mid-market
  spreadPct: DecimalInput; // e.g. "0.50" for 0.50 %
  feeAmount: DecimalInput; // flat AED fee, charged on top
}

export interface QuoteResult {
  baseAmount: string;
  midMarketRate: string;
  spreadPercentage: string;
  customerRate: string;
  feeAmount: string;
  recipientAmount: string; // INR
  payoutCostAmount: string; // AED value of the INR payout at mid rate
  fxMarginAmount: string; // AED
  totalDebitAmount: string; // AED
}

/**
 * Quote formulas (docs/LEDGER.md §3):
 *
 *   customer_rate    = truncate(mid × (1 − spread/100), 6)
 *   recipient_amount = truncate(base × customer_rate, 2)        [INR]
 *   payout_cost_aed  = round_half_even(recipient / mid, 2)      [AED]
 *   fx_margin        = base − payout_cost_aed                   [AED]
 *   total_debit      = base + fee                               [AED]
 *
 * The margin is a residual, so payout_cost + margin = base holds exactly for every input.
 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  const base = dec(input.baseAmount);
  const mid = dec(input.midRate);
  const spread = dec(input.spreadPct);
  const fee = dec(input.feeAmount);

  if (base.lte(0)) throw new RangeError('baseAmount must be positive');
  if (base.decimalPlaces() > CURRENCY_SCALE.AED) throw new RangeError('baseAmount has too many decimal places');
  if (mid.lte(0)) throw new RangeError('midRate must be positive');
  if (spread.lt(0) || spread.gte(100)) throw new RangeError('spreadPct must be in [0, 100)');
  if (fee.lt(0)) throw new RangeError('feeAmount must not be negative');

  const customerRate = truncate(mid.mul(dec('1').minus(spread.div(100))), RATE_SCALE);
  const recipient = truncate(base.mul(customerRate), CURRENCY_SCALE.INR);
  const payoutCost = roundHalfEven(recipient.div(mid), CURRENCY_SCALE.AED);
  const margin = base.minus(payoutCost);
  const totalDebit = base.plus(fee);

  return {
    baseAmount: money(base, 'AED'),
    midMarketRate: rate(mid),
    spreadPercentage: spread.toFixed(4),
    customerRate: rate(customerRate),
    feeAmount: money(fee, 'AED'),
    recipientAmount: money(recipient, 'INR'),
    payoutCostAmount: money(payoutCost, 'AED'),
    fxMarginAmount: money(margin, 'AED'),
    totalDebitAmount: money(totalDebit, 'AED'),
  };
}
