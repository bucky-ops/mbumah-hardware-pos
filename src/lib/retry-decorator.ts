// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Retry Decorators (HOF wrappers)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 4 — Error Handling & Resilience Framework
//
// This module provides high-level, ergonomic wrappers around the core
// `executeWithRetry` engine in `src/lib/retry.ts`. The wrappers are designed
// to be drop-in replacements for existing code patterns:
//
//   • `withRetry(fn, opts)`           → wrap any async function
//   • `retryableFetch(input, init)`   → drop-in for global `fetch()`
//   • `withPrismaTxRetry(fn, opts)`   → wrap a Prisma `$transaction` callback
//   • `withNotificationRetry(fn)`     → for INotificationService methods
//
// ── Design principles ────────────────────────────────────────────────────────
//
// 1. ZERO-POLLUTION: Callers should not need to thread retry options through
//    every signature. The HOFs capture options at decoration time.
//
// 2. OBSERVABILITY: Every retry is logged via `systemLog` (when a request
//    context is active) with the attempt number, delay, error code, and
//    request ID. This makes retries visible in the SystemLog table and in
//    Sentry breadcrumbs.
//
// 3. IDEMPOTENCY-AWARE: `retryableFetch` defaults to retrying only GET/HEAD/
//    OPTIONS (idempotent methods). POST/PUT/DELETE require explicit opt-in
//    via `init.retryOnMethods` or an `Idempotency-Key` header (the standard
//    RFC draft header that lets servers dedupe retries).
//
// 4. NO HIDDEN TIMEOUTS: The wrappers do NOT add their own timeouts — the
//    caller controls timeouts via `init.signal` (fetch) or the `signal`
//    option (executeWithRetry). This avoids double-timeout confusion.
//
// ─────────────────────────────────────────────────────────────────────────────

import { executeWithRetry, defaultIsRetryable, RETRY_PRESETS, type RetryOptions, type RetryResult } from './retry';
import { normaliseError } from './error-handler';

// ── Lazy imports for server-only deps ────────────────────────────────────────
//
// `systemLog` lives in `@/lib/logger`, which is safe to import on both client
// and server, but we want to AVOID importing it at module top-level so that
// the retry primitives remain tree-shakeable for pure utility use. We use a
// dynamic import inside the onRetry hook.

// ── withRetry ────────────────────────────────────────────────────────────────

/**
 * Wrap an async function with retry logic. Returns a new function with the
 * same signature that retries on retryable errors.
 *
 * Usage:
 *   const fetchUser = withRetry(
 *     (id: string) => db.user.findUnique({ where: { id } }),
 *     { ...RETRY_PRESETS.DATABASE_TX, operation: 'fetchUser' }
 *   );
 *   const user = await fetchUser('user_123');
 *
 * @param fn     The function to wrap. Receives the attempt number (1-based)
 *               as the SECOND argument (so existing single-arg callers don't
 *               need to change).
 * @param opts   Retry options. Pass `operation` for log attribution.
 */
export function withRetry<A extends unknown[], R>(
  fn: (...args: [...A, number]) => Promise<R>,
  opts: RetryOptions & { operation?: string } = {},
): (...args: A) => Promise<RetryResult<R>> {
  const { operation, ...retryOpts } = opts;
  const onRetry = createOnRetryHook(operation, opts.onRetry);

  return async (...args: A): Promise<RetryResult<R>> => {
    return executeWithRetry(
      (attempt: number) => fn(...args, attempt),
      { ...retryOpts, onRetry },
    );
  };
}

/**
 * Like `withRetry`, but returns just the value (not the `RetryResult`
 * metadata). Use this when callers don't need the retry stats.
 */
export function withRetryValue<A extends unknown[], R>(
  fn: (...args: [...A, number]) => Promise<R>,
  opts: RetryOptions & { operation?: string } = {},
): (...args: A) => Promise<R> {
  const wrapped = withRetry(fn, opts);
  return async (...args: A): Promise<R> => (await wrapped(...args)).value;
}

// ── retryableFetch ───────────────────────────────────────────────────────────

/**
 * Extended `RequestInit` with retry-specific options. These are stripped
 * before the underlying `fetch()` is called (so the native fetch doesn't
 * complain about unknown properties).
 */
export interface RetryableFetchInit extends RequestInit {
  /**
   * Retry options. Defaults to `RETRY_PRESETS.EXTERNAL_API`. Set
   * `maxAttempts: 1` to disable retries for a specific call.
   */
  retry?: RetryOptions;

  /**
   * HTTP methods that are eligible for retry. Defaults to `['GET', 'HEAD',
   * 'OPTIONS']` (RFC 9110 idempotent methods). POST/PUT/DELETE are NOT
   * retried unless explicitly listed here OR the request carries an
   * `Idempotency-Key` header (which lets the server dedupe).
   */
  retryOnMethods?: string[];

  /**
   * When true, retries are also allowed on methods NOT in `retryOnMethods`
   * IF the request has an `Idempotency-Key` header. Default: true.
   */
  respectIdempotencyKey?: boolean;
}

/** Default methods that are safe to retry without an idempotency key. */
const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Drop-in replacement for the global `fetch()` that retries on transient
 * failures (network errors, 429, 5xx).
 *
 * Behaviour:
 *   • GET/HEAD/OPTIONS are retried by default (idempotent).
 *   • POST/PUT/DELETE are retried ONLY if `retryOnMethods` includes them
 *     OR the request has an `Idempotency-Key` header.
 *   • 429 retries honour the `Retry-After` header (seconds or HTTP-date).
 *   • Network errors (TypeError from fetch) are retried.
 *   • 4xx (except 429) are NOT retried.
 *
 * Usage:
 *   // Drop-in replacement — works exactly like fetch()
 *   const res = await retryableFetch('https://api.example.com/users');
 *
 *   // With retry options
 *   const res = await retryableFetch(url, {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *     headers: { 'Idempotency-Key': crypto.randomUUID() },
 *     retry: { ...RETRY_PRESETS.EXTERNAL_API, maxAttempts: 5 },
 *   });
 *
 * @returns The FIRST successful Response. If all attempts fail, the last
 *          error/Response is thrown.
 */
export async function retryableFetch(
  input: string | URL | Request,
  init: RetryableFetchInit = {},
): Promise<Response> {
  const {
    retry = RETRY_PRESETS.EXTERNAL_API,
    retryOnMethods = DEFAULT_RETRY_METHODS,
    respectIdempotencyKey = true,
    ...fetchInit
  } = init;

  // ── Determine the HTTP method (default GET) ──────────────────────────────
  const method = (fetchInit.method || 'GET').toUpperCase();

  // ── Check idempotency: is this method safe to retry? ─────────────────────
  const isMethodRetryable = retryOnMethods.includes(method);
  const hasIdempotencyKey =
    respectIdempotencyKey &&
    typeof fetchInit.headers === 'object' &&
    fetchInit.headers !== null &&
    // Headers can be a plain object, a Map-like, or a Headers instance.
    ((fetchInit.headers instanceof Headers &&
      fetchInit.headers.has('Idempotency-Key')) ||
      (Array.isArray(fetchInit.headers) &&
        fetchInit.headers.some(
          ([k]) => k.toLowerCase() === 'idempotency-key',
        )) ||
      (!Array.isArray(fetchInit.headers) &&
        !(fetchInit.headers instanceof Headers) &&
        'Idempotency-Key' in fetchInit.headers));

  const eligibleForRetry = isMethodRetryable || hasIdempotencyKey;

  // ── If not eligible, do a single fetch with no retry ─────────────────────
  if (!eligibleForRetry) {
    return fetch(input, fetchInit);
  }

  // ── Retryable execution ──────────────────────────────────────────────────
  // We use executeWithRetry with a custom isRetryable that:
  //   1. Uses the default classifier (network errors, 5xx, etc.)
  //   2. ALSO treats the Response itself as retryable if its status is in
  //      RETRYABLE_HTTP_STATUS (so we can retry on 503 even though fetch
  //      doesn't throw on 5xx — it resolves with res.ok === false).
  const { value: response } = await executeWithRetry(
    async (attempt: number) => {
      const res = await fetch(input, fetchInit);

      // ── 2xx success — return immediately ─────────────────────────────
      if (res.ok) {
        return res;
      }

      // ── 429: honour Retry-After ─────────────────────────────────────────
      // We don't sleep here (the retry engine handles sleeping). Instead we
      // throw so the engine catches it, classifies it as retryable, and
      // sleeps. We pass the Retry-After hint via a custom error.
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const err = new RetryableHttpError(
          `HTTP 429 Too Many Requests`,
          429,
          attempt,
          retryAfter ? parseRetryAfter(retryAfter) : undefined,
        );
        throw err;
      }

      // ── 5xx: throw a RetryableHttpError so the engine can retry ──────
      if (res.status >= 500) {
        // Clone the response so the caller can still read the body if all
        // retries fail (the original res will be consumed by reading it).
        const bodyText = await res.clone().text().catch(() => '');
        throw new RetryableHttpError(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
          attempt,
          undefined,
          bodyText,
        );
      }

      // ── 4xx (non-429): NOT retryable. Return the response so the caller
      //    can handle it. We do NOT throw — the engine would retry it.
      //    Instead, we wrap it in a non-retryable error to stop the loop,
      //    but the caller wants the Response object, so we return it via
      //    a special sentinel.
      //
      // Trick: return the response directly. Since res.ok is false, the
      // engine's `isRetryable` won't trigger (we throw on 429/5xx above;
      // 4xx falls through to here). The executeWithRetry loop will treat
      // this as a successful resolution and return the response.
      return res;
    },
    {
      ...retry,
      // Override isRetryable: our RetryableHttpError is classified by
      // `defaultIsRetryable` (it has a `status` field in
      // RETRYABLE_HTTP_STATUS). Network TypeErrors are also caught.
      isRetryable: (err, attempt) => {
        // RetryableHttpError carries an optional `retryAfterMs` hint.
        if (err instanceof RetryableHttpError && err.retryAfterMs) {
          // The onRetry hook will use this to override the computed delay.
          return true;
        }
        return defaultIsRetryable(err, attempt);
      },
      onRetry: createOnRetryHook('retryableFetch', retry.onRetry, input),
    },
  );

  return response;
}

/**
 * Error thrown by `retryableFetch` for HTTP 429 and 5xx responses. Carries
 * the status code and (for 429) the parsed `Retry-After` value so the retry
 * engine can honour it.
 */
export class RetryableHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly attempt: number,
    readonly retryAfterMs?: number,
    readonly bodyText?: string,
  ) {
    super(message);
    this.name = 'RetryableHttpError';
  }
}

/**
 * Parse an HTTP `Retry-After` header value into milliseconds.
 *
 * The header can be either:
 *   • A non-negative integer (seconds to wait): `Retry-After: 120`
 *   • An HTTP-date (when to retry): `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`
 *
 * Returns `undefined` if the value can't be parsed.
 */
export function parseRetryAfter(value: string): number | undefined {
  const trimmed = value.trim();

  // ── Integer seconds ───────────────────────────────────────────────────────
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000;
  }

  // ── HTTP-date ─────────────────────────────────────────────────────────────
  const date = Date.parse(trimmed);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

// ── withPrismaTxRetry ────────────────────────────────────────────────────────

/**
 * Wrap a Prisma `$transaction` callback so that P2034 (write-write conflict)
 * and P2024 (pool timeout) trigger an automatic retry.
 *
 * Prisma's `$transaction` with the default isolation level can throw P2034
 * when two concurrent transactions conflict. The recommended fix (per
 * Prisma docs) is to retry the WHOLE transaction — this wrapper does that
 * automatically.
 *
 * Usage:
 *   const result = await withPrismaTxRetry(
 *     () => db.$transaction(async (tx) => {
 *       const account = await tx.account.findUnique({ where: { id } });
 *       await tx.account.update({ where: { id }, data: { balance: account.balance + amount } });
 *       await tx.transaction.create({ data: { ... } });
 *       return account;
 *     }),
 *     { operation: 'transferFunds' }
 *   );
 *
 * IMPORTANT: The callback MUST be idempotent — it may execute more than once.
 * Avoid side effects outside the transaction (e.g. sending an email) inside
 * the callback.
 */
export async function withPrismaTxRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions & { operation?: string } = {},
): Promise<T> {
  const { operation, ...retryOpts } = opts;
  const mergedOpts: RetryOptions = {
    ...RETRY_PRESETS.DATABASE_TX,
    ...retryOpts,
    onRetry: createOnRetryHook(operation ?? 'prisma-tx', retryOpts.onRetry),
  };

  return (await executeWithRetry(fn, mergedOpts)).value;
}

// ── withNotificationRetry ────────────────────────────────────────────────────

/**
 * Wrap an `INotificationService` send method (sendSms, sendWhatsApp,
 * sendEmail) with retry. Uses the `EXTERNAL_API` preset.
 *
 * Notification sends are inherently idempotent from the app's perspective:
 *   • SMS/WhatsApp: Twilio dedupes based on the `To` + `Body` hash within a
 *     short window (5+ minutes). Even if a duplicate slips through, the
 *     customer simply receives two identical messages — annoying but not
 *     dangerous.
 *   • Email: Resend does NOT dedupe, so we rely on the caller passing an
 *     `Idempotency-Key` (or accept the small risk of duplicate emails).
 *
 * The wrapper retries on:
 *   • Network errors (TypeError from fetch)
 *   • HTTP 429 (Twilio/Resend rate limit)
 *   • HTTP 5xx (Twilio/Resend server error)
 *
 * It does NOT retry on:
 *   • 4xx (non-429) — auth failures, invalid phone, etc.
 *   • The notification service's own `success: false` return value (that's
 *     a deliberate failure, not a transient one).
 */
export function withNotificationRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  operation: string,
  opts: RetryOptions = {},
): (...args: TArgs) => Promise<TResult> {
  const mergedOpts: RetryOptions = {
    ...RETRY_PRESETS.EXTERNAL_API,
    ...opts,
    onRetry: createOnRetryHook(operation, opts.onRetry),
  };

  return async (...args: TArgs): Promise<TResult> => {
    return (await executeWithRetry(() => fn(...args), mergedOpts)).value;
  };
}

// ── onRetry hook factory ─────────────────────────────────────────────────────

/**
 * Create an `onRetry` callback that:
 *   1. Logs the retry to the SystemLog table (via `systemLog`) with the
 *      attempt number, delay, error code, and request context.
 *   2. Delegates to the caller's `onRetry` (if provided).
 *
 * The `systemLog` call is fire-and-forget (void) so it never blocks the
 * retry loop.
 */
function createOnRetryHook(
  operation: string | undefined,
  userOnRetry?: RetryOptions['onRetry'],
  fetchInput?: string | URL | Request,
): NonNullable<RetryOptions['onRetry']> {
  return (err: unknown, attempt: number, nextDelayMs: number) => {
    // ── Delegate to the user's hook first (may throw to abort) ──────────────
    if (userOnRetry) {
      userOnRetry(err, attempt, nextDelayMs);
    }

    // ── Log the retry ────────────────────────────────────────────────────────
    // Fire-and-forget — never blocks the retry loop.
    void logRetryAttempt(err, attempt, nextDelayMs, operation, fetchInput).catch(
      () => {
        // Logging failed — nothing we can do. The retry proceeds.
      },
    );
  };
}

/**
 * Log a retry attempt to the SystemLog table (server-side) and console.
 * Client-side, this is a no-op (no SystemLog table in the browser).
 */
async function logRetryAttempt(
  err: unknown,
  attempt: number,
  nextDelayMs: number,
  operation: string | undefined,
  fetchInput?: string | URL | Request,
): Promise<void> {
  // ── Client-side: just console.warn ───────────────────────────────────────
  if (typeof window !== 'undefined') {
    console.warn(`[Retry] ${operation ?? 'unknown'} attempt ${attempt} failed, retrying in ${nextDelayMs}ms`, err);
    return;
  }

  // ── Server-side: systemLog ────────────────────────────────────────────────
  try {
    const { systemLog } = await import('@/lib/logger');
    const { LogSeverity, LogComponent } = await import('@/lib/types');
    const normalised = normaliseError(err);

    await systemLog({
      action: 'RETRY_ATTEMPT',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message: `Retrying ${operation ?? 'unknown'} (attempt ${attempt + 1}) after ${nextDelayMs}ms — last error: ${normalised.message}`,
      metadata: {
        operation: operation ?? 'unknown',
        attempt,
        nextDelayMs,
        errorCode: normalised.code,
        errorStatusCode: normalised.statusCode,
        prismaCode: normalised.prismaCode,
        fetchUrl: typeof fetchInput === 'string' ? fetchInput : fetchInput?.toString(),
        errorMessage: normalised.message,
      },
    });
  } catch {
    // systemLog failed — fall back to console.
    console.warn(`[Retry] ${operation ?? 'unknown'} attempt ${attempt} failed (logging also failed)`, err);
  }
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export {
  executeWithRetry,
  retry,
  computeDelay,
  sleep,
  defaultIsRetryable,
  RETRY_PRESETS,
  RETRYABLE_HTTP_STATUS,
  RETRYABLE_PRISMA_CODES,
  RetryBudget,
  type RetryOptions,
  type RetryResult,
} from './retry';
