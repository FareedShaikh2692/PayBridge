/** IFSC: four letters, a literal zero, six alphanumerics. */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers are 9–18 digits. */
export const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;
export const AMOUNT_REGEX = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidIfsc(value: string): boolean {
  return IFSC_REGEX.test(value);
}
export function isValidAccountNumber(value: string): boolean {
  return ACCOUNT_NUMBER_REGEX.test(value);
}
/** Display form: only the last four digits are ever shown. */
export function maskAccountNumber(last4: string): string {
  return `XXXXXX${last4.slice(-4)}`;
}
