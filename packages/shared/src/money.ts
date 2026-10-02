import Decimal from 'decimal.js';

/** Isolated Decimal constructor: 40 significant digits, banker's rounding by default. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = Decimal;
export type DecimalInput = string | Decimal | { toString(): string };

export const CURRENCIES = ['AED', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Minor-unit scale per currency. Both corridor currencies use two decimal places. */
export const CURRENCY_SCALE: Record<Currency, number> = { AED: 2, INR: 2 };
export const RATE_SCALE = 6;

/**
 * Parse a monetary or rate value. JavaScript numbers are rejected on purpose:
 * money must arrive as a decimal string or Decimal so it never passes through binary floating point.
 */
export function dec(value: DecimalInput): Decimal {
  if (typeof value === 'number') {
    throw new TypeError('Floating-point numbers are not accepted for money; pass a string or Decimal.');
  }
  const d = new D(value.toString());
  if (!d.isFinite()) throw new TypeError(`Invalid decimal value: ${value.toString()}`);
  return d;
}

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** Fixed-scale string for the wire and for display, e.g. "10000.00". */
export function money(value: DecimalInput, currency: Currency = 'AED'): string {
  return dec(value).toFixed(CURRENCY_SCALE[currency]);
}

export function rate(value: DecimalInput): string {
  return dec(value).toFixed(RATE_SCALE);
}

/** True when the value has no more decimal places than the currency allows. */
export function hasValidScale(value: DecimalInput, currency: Currency): boolean {
  return dec(value).decimalPlaces() <= CURRENCY_SCALE[currency];
}

export function truncate(value: DecimalInput, dp: number): Decimal {
  return dec(value).toDecimalPlaces(dp, Decimal.ROUND_DOWN);
}

export function roundHalfEven(value: DecimalInput, dp: number): Decimal {
  return dec(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_EVEN);
}
