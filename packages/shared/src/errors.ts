/** Domain error catalogue: code → HTTP status and a message that is safe to show to end users. */
export const ERROR_CATALOGUE = {
  VALIDATION_ERROR: [400, 'The request is invalid.'],
  IDEMPOTENCY_KEY_REQUIRED: [400, 'The Idempotency-Key header is required.'],
  INVALID_WEBHOOK: [401, 'The webhook could not be verified.'],
  UNAUTHENTICATED: [401, 'Authentication is required.'],
  INVALID_CREDENTIALS: [401, 'Email or password is incorrect.'],
  FORBIDDEN: [403, 'You do not have permission to perform this action.'],
  KYB_NOT_APPROVED: [403, 'The company has not completed KYB approval.'],
  SELF_APPROVAL_FORBIDDEN: [403, 'You cannot approve a payment you created.'],
  NOT_FOUND: [404, 'The resource was not found.'],
  COMPANY_NOT_FOUND: [404, 'The company was not found.'],
  BENEFICIARY_NOT_FOUND: [404, 'The beneficiary was not found.'],
  QUOTE_NOT_FOUND: [404, 'The FX quote was not found.'],
  PAYMENT_NOT_FOUND: [404, 'The payment was not found.'],
  USER_NOT_FOUND: [404, 'The user was not found.'],
  COMPANY_ALREADY_EXISTS: [409, 'A company with this trade licence number already exists.'],
  USER_ALREADY_HAS_COMPANY: [409, 'This user already belongs to a company.'],
  BENEFICIARY_ALREADY_EXISTS: [409, 'This beneficiary account already exists.'],
  EMAIL_ALREADY_REGISTERED: [409, 'This email address is already registered.'],
  QUOTE_EXPIRED: [409, 'The FX quote has expired.'],
  QUOTE_ALREADY_USED: [409, 'The FX quote has already been used.'],
  QUOTE_NOT_ACTIVE: [409, 'The FX quote is no longer active.'],
  IDEMPOTENCY_CONFLICT: [409, 'This Idempotency-Key was already used with a different request.'],
  IDEMPOTENCY_IN_PROGRESS: [409, 'A request with this Idempotency-Key is still being processed.'],
  INVALID_STATE_TRANSITION: [409, 'This action is not allowed in the current state.'],
  PAYMENT_ALREADY_PROCESSED: [409, 'The payment has already been processed.'],
  COMPLIANCE_REVIEW_REQUIRED: [409, 'The payment requires a compliance decision first.'],
  LAST_ADMIN: [409, 'A company must keep at least one active administrator.'],
  INSUFFICIENT_FUNDS: [422, 'The wallet balance is not sufficient for this payment.'],
  AMOUNT_MISMATCH: [422, 'The payment amount does not match the quote.'],
  BENEFICIARY_NOT_ACTIVE: [422, 'The beneficiary is not active.'],
  AMOUNT_OUT_OF_RANGE: [422, 'The amount is outside the permitted range.'],
  UNSUPPORTED_CORRIDOR: [422, 'Only AED to INR is supported.'],
  RATE_LIMITED: [429, 'Too many requests. Please try again shortly.'],
  LEDGER_IMBALANCE: [500, 'A ledger posting did not balance.'],
  INTERNAL_ERROR: [500, 'An unexpected error occurred.'],
  SERVICE_UNAVAILABLE: [503, 'The service is temporarily unavailable.'],
  PROVIDER_TIMEOUT: [503, 'The provider did not respond in time.'],
} as const satisfies Record<string, readonly [number, string]>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export function errorStatus(code: ErrorCode): number {
  return ERROR_CATALOGUE[code][0];
}
export function errorMessage(code: ErrorCode): string {
  return ERROR_CATALOGUE[code][1];
}
