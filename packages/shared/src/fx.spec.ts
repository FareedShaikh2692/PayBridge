import fc from 'fast-check';
import { calculateQuote } from './fx';
import { dec } from './money';

describe('calculateQuote', () => {
  it('matches the canonical vector from the brief', () => {
    const q = calculateQuote({ baseAmount: '10000', midRate: '22.70', spreadPct: '0.50', feeAmount: '25' });
    expect(q).toEqual({
      baseAmount: '10000.00',
      midMarketRate: '22.700000',
      spreadPercentage: '0.5000',
      customerRate: '22.586500',
      feeAmount: '25.00',
      recipientAmount: '225865.00',
      payoutCostAmount: '9950.00',
      fxMarginAmount: '50.00',
      totalDebitAmount: '10025.00',
    });
  });

  it('truncates the recipient amount (never rounds up)', () => {
    // 3333.33 × 22.5865 = 75288.258045 → 75288.25
    const q = calculateQuote({ baseAmount: '3333.33', midRate: '22.70', spreadPct: '0.50', feeAmount: '25' });
    expect(q.recipientAmount).toBe('75288.25');
  });

  it('truncates the customer rate at six decimals', () => {
    // 22.123457 × 0.9967 = 22.0504495919 → 22.050449
    const q = calculateQuote({ baseAmount: '100', midRate: '22.123457', spreadPct: '0.33', feeAmount: '0' });
    expect(q.customerRate).toBe('22.050449');
  });

  it('handles the smallest amount', () => {
    const q = calculateQuote({ baseAmount: '0.01', midRate: '22.70', spreadPct: '0.50', feeAmount: '25' });
    expect(q.recipientAmount).toBe('0.22');
    expect(dec(q.payoutCostAmount).plus(q.fxMarginAmount).toFixed(2)).toBe('0.01');
  });

  it('rejects floats, non-positive amounts and excess precision', () => {
    expect(() => calculateQuote({ baseAmount: 100 as any, midRate: '22.7', spreadPct: '0.5', feeAmount: '25' })).toThrow(TypeError);
    expect(() => calculateQuote({ baseAmount: '0', midRate: '22.7', spreadPct: '0.5', feeAmount: '25' })).toThrow(RangeError);
    expect(() => calculateQuote({ baseAmount: '-5', midRate: '22.7', spreadPct: '0.5', feeAmount: '25' })).toThrow(RangeError);
    expect(() => calculateQuote({ baseAmount: '10.001', midRate: '22.7', spreadPct: '0.5', feeAmount: '25' })).toThrow(RangeError);
    expect(() => calculateQuote({ baseAmount: '10', midRate: '0', spreadPct: '0.5', feeAmount: '25' })).toThrow(RangeError);
  });

  it('property: payout cost + margin = base, and the customer never gets more than mid', () => {
    const cents = fc.bigInt({ min: 1n, max: 100_000_000n }); // 0.01 … 1,000,000.00
    const rateMicros = fc.bigInt({ min: 1_000_000n, max: 100_000_000n }); // 1.000000 … 100.000000
    const spreadBp = fc.integer({ min: 0, max: 500 }); // 0 … 5 %
    fc.assert(
      fc.property(cents, rateMicros, spreadBp, (c, r, s) => {
        const base = dec(c.toString()).div(100).toFixed(2);
        const mid = dec(r.toString()).div(1_000_000).toFixed(6);
        const q = calculateQuote({ baseAmount: base, midRate: mid, spreadPct: dec(String(s)).div(100).toFixed(2), feeAmount: '25' });
        expect(dec(q.payoutCostAmount).plus(q.fxMarginAmount).eq(q.baseAmount)).toBe(true);
        expect(dec(q.totalDebitAmount).eq(dec(q.baseAmount).plus(q.feeAmount))).toBe(true);
        expect(dec(q.customerRate).lte(q.midMarketRate)).toBe(true);
        expect(dec(q.recipientAmount).lte(dec(q.baseAmount).mul(q.midMarketRate))).toBe(true);
        expect(dec(q.recipientAmount).decimalPlaces()).toBeLessThanOrEqual(2);
      }),
      { numRuns: 1000 },
    );
  });
});
