import { ErrorCode, errorMessage, errorStatus } from '@paybridge/shared';

/** A business-rule failure with a stable code. The global filter turns it into the error envelope. */
export class DomainError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? errorMessage(code));
    this.name = 'DomainError';
    this.status = errorStatus(code);
  }
}
