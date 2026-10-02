/**
 * API client. The access token lives in memory only (never in localStorage); a page reload obtains a new
 * one from the HttpOnly refresh cookie. Requests go to this origin and are proxied to the API.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field-level messages from validation errors, when the API supplied them. */
  get fieldMessages(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.map((d) => (typeof d === 'string' ? d : d?.message ? `${d.field ? `${d.field}: ` : ''}${d.message}` : JSON.stringify(d)));
  }
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  idempotencyKey?: string;
  /** Skip the automatic refresh-and-retry on 401 (used by the auth calls themselves). */
  noRetry?: boolean;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function onSessionLost(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * A non-secret hint that this browser has signed in before. It holds no credential — the refresh token is an
 * HttpOnly cookie — and only saves a pointless request (and a 401 in the console) for first-time visitors.
 */
const SESSION_HINT = 'paybridge.session';
export function setSessionHint(present: boolean): void {
  try {
    if (present) window.localStorage.setItem(SESSION_HINT, '1');
    else window.localStorage.removeItem(SESSION_HINT);
  } catch {
    /* storage unavailable: the hint is only an optimisation */
  }
}
function hasSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT) === '1';
  } catch {
    return true;
  }
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  if (!hasSessionHint()) return Promise.resolve(false);
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        if (res.status === 401) setSessionHint(false);
        return false;
      }
      const json = await res.json();
      accessToken = json.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshInFlight = null), 0);
    }
  })();
  return refreshInFlight;
}

async function raw(path: string, opts: Options): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`/api/v1${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: 'same-origin' });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body (e.g. a proxy error page) */
  }
  return { status: res.status, json };
}

async function request(path: string, opts: Options = {}): Promise<any> {
  let { status, json } = await raw(path, opts);
  if (status === 401 && !opts.noRetry && json?.error?.code === 'UNAUTHENTICATED') {
    if (await refreshSession()) ({ status, json } = await raw(path, opts));
    else {
      accessToken = null;
      listeners.forEach((fn) => fn());
    }
  }
  if (!json || json.success !== true) {
    const err = json?.error;
    throw new ApiError(status, err?.code ?? 'NETWORK_ERROR', err?.message ?? (status >= 500 || !json ? 'The service is unavailable. Please try again.' : 'Request failed.'), err?.details, json?.requestId);
  }
  return json;
}

export const api = {
  get: async <T>(path: string): Promise<T> => (await request(path)).data,
  page: async <T>(path: string): Promise<Page<T>> => {
    const json = await request(path);
    return { items: json.data, meta: json.meta };
  },
  post: async <T>(path: string, body?: unknown, opts: Pick<Options, 'idempotencyKey' | 'noRetry'> = {}): Promise<T> => (await request(path, { method: 'POST', body: body ?? {}, ...opts })).data,
  patch: async <T>(path: string, body: unknown): Promise<T> => (await request(path, { method: 'PATCH', body })).data,
};

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.fieldMessages.length ? `${err.message} ${err.fieldMessages.join(' · ')}` : err.message;
  return 'Something went wrong. Please try again.';
}
