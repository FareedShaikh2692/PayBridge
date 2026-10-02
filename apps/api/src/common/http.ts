import { ArgumentsHost, CallHandler, Catch, ExceptionFilter, ExecutionContext, HttpException, Injectable, NestInterceptor, NestMiddleware } from '@nestjs/common';
import { ErrorCode, InvalidTransitionError, SANDBOX_LABEL, errorMessage, errorStatus } from '@paybridge/shared';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { ctx, requestContext } from './context';
import { DomainError } from './errors';
import { logger } from './logger';
import { Paged } from './pagination';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Assigns a request id, opens the async context, stamps sandbox headers and writes one structured log line per request. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : `req_${randomUUID().replace(/-/g, '')}`;
    const started = process.hrtime.bigint();
    const store = { requestId, ipAddress: req.ip, userAgent: req.header('user-agent')?.slice(0, 300) };

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-PayBridge-Sandbox', 'true');
    res.setHeader('X-PayBridge-Notice', encodeURIComponent(SANDBOX_LABEL));

    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      const line = {
        requestId,
        userId: store && (store as any).userId,
        companyId: store && (store as any).companyId,
        method: req.method,
        route: (req as any).route?.path ?? req.path,
        status: res.statusCode,
        duration: durationMs,
      };
      if (res.statusCode >= 500) logger.error(line, 'request');
      else logger.info(line, 'request');
    });

    requestContext.run(store, next);
  }
}

/** Wraps every successful response in the standard envelope. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => (data instanceof Paged ? { success: true, data: data.items, meta: data.meta } : { success: true, data: data ?? null })),
    );
  }
}

interface ErrorBody {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

const HTTP_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function known(code: ErrorCode, message?: string, details?: unknown): ErrorBody {
  return { status: errorStatus(code), code, message: message ?? errorMessage(code), details };
}

/** Maps anything thrown to the error envelope. Unknown errors are logged in full and returned as INTERNAL_ERROR. */
export function toErrorBody(exception: unknown): ErrorBody & { unexpected: boolean } {
  if (exception instanceof DomainError) return { ...known(exception.code, exception.message, exception.details), unexpected: exception.status >= 500 };
  if (exception instanceof InvalidTransitionError) return { ...known('INVALID_STATE_TRANSITION', exception.message), unexpected: false };

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse() as any;
    const code = HTTP_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
    if (status === 400 && Array.isArray(response?.message)) {
      return { status, code, message: errorMessage('VALIDATION_ERROR'), details: response.message, unexpected: false };
    }
    if (status >= 500) return { ...known('INTERNAL_ERROR'), status, unexpected: true };
    return { status, code, message: status === 400 && typeof response?.message === 'string' ? response.message : errorMessage(code), unexpected: false };
  }

  const err = exception as any;
  const text = `${err?.message ?? ''} ${err?.meta?.message ?? ''} ${err?.cause?.message ?? ''}`;
  // Database-level backstops surface as the same domain errors the services raise.
  if (text.includes('LEDGER_IMBALANCE')) return { ...known('LEDGER_IMBALANCE'), unexpected: true };
  if (text.includes('ledger_accounts_customer_non_negative')) return { ...known('INSUFFICIENT_FUNDS'), unexpected: false };
  if (err?.type === 'entity.too.large') return { status: 413, code: 'VALIDATION_ERROR', message: 'The request body is too large.', unexpected: false };
  if (err?.type === 'entity.parse.failed') return { ...known('VALIDATION_ERROR', 'The request body is not valid JSON.'), unexpected: false };
  if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(err?.code) || /ECONNREFUSED|Connection terminated|timeout exceeded when trying to connect/i.test(text)) {
    return { ...known('SERVICE_UNAVAILABLE'), unexpected: true };
  }
  return { ...known('INTERNAL_ERROR'), unexpected: true };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const body = toErrorBody(exception);
    const requestId = ctx()?.requestId ?? (res.getHeader('X-Request-Id') as string | undefined);

    if (body.unexpected) {
      logger.error({ requestId, code: body.code, path: req.path, err: exception instanceof Error ? { message: exception.message, stack: exception.stack } : String(exception) }, 'unhandled error');
    }
    if (body.status === 429) res.setHeader('Retry-After', '60');
    if (body.code === 'IDEMPOTENCY_IN_PROGRESS') res.setHeader('Retry-After', '1');

    res.status(body.status).json({
      success: false,
      error: { code: body.code, message: body.message, ...(body.details !== undefined ? { details: body.details } : {}) },
      requestId,
    });
  }
}
