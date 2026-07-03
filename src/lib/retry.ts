// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Retry with Exponential Backoff & Jitter
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 4 — Error Handling & Resilience Framework
//
// This module is the CORE retry engine. It is intentionally free of any
// domain-specific imports (no Prisma, no Next.js, no DB) so it can be unit
// tested in isolation and reused by:
//
//   • `src/lib/retry-decorator.ts`  — HOF wrappers (withRetry, retryableFetch,
//                                       withPrismaTxRetry)
//   • `src/lib/circuit-breaker.ts`  — (Phase 5) wraps this engine so that
//                                       retries stop when a service is down
//   • Any call site that needs fine-grained control
//
// ── Why exponential backoff + jitter? ─────────────────────────────────────────
//
// When an external service (M-Pesa Daraja, Twilio, Resend) returns 503 or
// times out, naïve retry-with-fixed-delay causes the "thundering herd"
// problem: every concurrent client retries at the same instant, re-overloading
// the recovering service. Exponential backoff (delay grows with each attempt)
// spreads retries over time. FULL JITTER (delay = uniform random in
// [0, computed_exponential_delay)) additionally spreads retries across
// clients — this is the algorithm recommended by the AWS Architecture Blog
// ("Exponential Backoff and Jitter" — https://amzn.to/2x1M1Zh).
//
// ── Retryable error classification ────────────────────────────────────────────
//
// Not every error should be retried. Retrying a 400 (validation error) or a
// 409 (unique-constraint conflict) wastes resources and may duplicate side
// effects. We classify errors as retryable ONLY when:
//
//   • Network errors (TypeError from fetch, AbortError from timeout) — the
//     request may not have reached the server, so retrying is safe.
//   • HTTP 429 (Too Many Requests) — the server explicitly told us to slow
//     down; we honour the Retry-After header if present.
//   • HTTP 500, 502, 503, 504 — server-side transient failures.
//   • Prisma P2024 (pool timeout), P2034 (write-write tx conflict),
//     P2037 (too many connections) — all documented as transient by Prisma.
//
// NON-retryable (by design):
//   • 4xx (except 429) — client errors; retrying won't help.
//   • Prisma P2002 (unique constraint) — retrying will hit the same conflict.
//   • Prisma P2003 (foreign key) — data integrity issue, not transient.
//   • ZodError — validation; the input is wrong.
//   • AppError (ValidationError, NotFoundError, UnauthorizedError, etc.) —
//     these are deliberate control-flow signals, not transient failures.
//
// ── Cancellation ──────────────────────────────────────────────────────────────
//
// Every retry loop accepts an optional `AbortSignal`. If the caller aborts
// (e.g. the client disconnected, or a higher-level timeout fired), the loop
// exits immediately WITHOUT sleeping, and the last error is re-thrown. This
// prevents zombie retries from consuming resources after the caller has given
// up.
//
// ── Retry budget ──────────────────────────────────────────────────────────────
//
// A `RetryBudget` (token-bucket) is provided to cap the TOTAL number of
// retries across all callers in a rolling window. This prevents a retry
// storm: if 1000 requests fail simultaneously, each one would retry 3 times
// (3000 extra requests) — but with a budget of 500 tokens/min, only 500 of
// those retries actually fire; the rest fail fast. The budget is OPTIONAL —
// pass `null` or omit to disable.
//
// ─────────────────────────────────────────────────────────────────────────────

import { normaliseError, ERROR_CODES } from './error-handler';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Options that control the retry behaviour of `executeWithRetry`.
 *
 * All fields have sensible defaults (see `DEFAULT_RETRY_OPTIONS`), so most
 * callers only need to pass `{ maxAttempts: 3 }` or use a preset.
 */
export interface RetryOptions {
  /**
   * Maximum number of attempts (including the first). `maxAttempts: 1` means
   * "try once, no retries". Default: 3.
   */
  maxAttempts?: number;

  /**
   * Base delay in milliseconds for the FIRST retry. Subsequent delays grow
   * exponentially: `baseDelayMs * backoffFactor^(attempt - 1)`. Default: 200ms.
   */
  baseDelayMs?: number;

  /**
   * Maximum delay in milliseconds. The computed exponential delay is clamped
   * to this value before jitter is applied. Default: 10_000ms (10s).
   */
  maxDelayMs?: number;

  /**
   * Backoff multiplier. `2` = double the delay each attempt (classic
   * exponential). `1.5` = gentler growth. Default: 2.
   */
  backoffFactor?: number;

  /**
   * Jitter strategy. Default: 'full' (recommended by AWS).
   *   • 'full'  — delay = random(0, min(maxDelay, exp_delay))
   *   • 'equal' — delay = random(exp_delay/2, exp_delay)  (decorrelated)
   *   • 'none'  — delay = min(maxDelay, exp_delay)  (no randomisation)
   */
  jitter?: 'full' | 'equal' | 'none';

  /**
   * Predicate that decides whether an error is retryable. Receives the
   * normalised error and the attempt number (1-based). Default:
   * `defaultIsRetryable`.
   *
   * Override this for domain-specific rules (e.g. "retry only on Tuesdays").
   */
  isRetryable?: (err: unknown, attempt: number) => boolean;

  /**
   * Called BEFORE each retry sleep. Useful for logging, metrics, or
   * conditional abort. If it throws, the retry loop aborts and the thrown
   * error propagates.
   *
   * @param err      The error that triggered the retry.
   * @param attempt  The attempt number that JUST failed (1-based).
   * @param nextDelayMs  The delay that will be slept before the next attempt.
   */
  onRetry?: (err: unknown, attempt: number, nextDelayMs: number) => void;

  /**
   * Optional `AbortSignal`. When aborted, the retry loop exits immediately
   * (without sleeping) and re-throws the last error. Use this to enforce a
   * hard deadline across all retries.
   */
  signal?: AbortSignal;

  /**
   * Optional retry budget. If the budget is exhausted (no tokens left), the
   * next retry fails fast with the last error. Default: `null` (no budget).
   */
  budget?: RetryBudget | null;
}

/**
 * Default retry options. Used when a field is omitted from `RetryOptions`.
 */
export const DEFAULT_RETRY_OPTIONS: Required<
  Omit<RetryOptions, 'onRetry' | 'signal' | 'budget' | 'isRetryable'>
> = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
  backoffFactor: 2,
  jitter: 'full',
};

// ── Retry presets ────────────────────────────────────────────────────────────
//
// These are battle-tested configurations for common scenarios. Use them to
// avoid magic numbers scattered through the codebase.
//
//   import { RETRY_PRESETS } from '@/lib/retry';
//   await withRetry(fn, RETRY_PRESETS.EXTERNAL_API);

export const RETRY_PRESETS: Record<string, RetryOptions> = {
  /**
   * For external HTTP APIs (M-Pesa Daraja, Twilio, Resend). 3 attempts,
   * 200ms base, 10s cap, full jitter. Aggressive enough to recover from a
   * brief blip, gentle enough not to hammer the provider.
   */
  EXTERNAL_API: {
    maxAttempts: 3,
    baseDelayMs: 200,
    maxDelayMs: 10_000,
    backoffFactor: 2,
    jitter: 'full',
  },

  /**
   * For network-only failures (TypeError from fetch, AbortError on timeout).
   * 4 attempts with a longer base delay — network issues often persist for
   * several seconds.
   */
  NETWORK: {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    backoffFactor: 2,
    jitter: 'full',
  },

  /**
   * For Prisma `$transaction` calls that may hit P2034 (write-write conflict)
   * or P2024 (pool timeout). 5 attempts with short delays — conflicts
   * typically resolve in milliseconds.
   */
  DATABASE_TX: {
    maxAttempts: 5,
    baseDelayMs: 50,
    maxDelayMs: 2_000,
    backoffFactor: 2,
    jitter: 'equal',
  },

  /**
   * For HTTP 429 (Too Many Requests). 3 attempts, honours Retry-After if the
   * error carries it. Longer base delay to give the rate limiter time to
   * refill.
   */
  RATE_LIMITED: {
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    backoffFactor: 2,
    jitter: 'full',
  },

  /**
   * For IDEMPOTENT writes (POST/PUT with an idempotency key). 3 attempts.
   * Only safe because the operation is idempotent — retrying a non-idempotent
   * POST could create duplicate resources.
   */
  IDEMPOTENT_WRITE: {
    maxAttempts: 3,
    baseDelayMs: 300,
    maxDelayMs: 8_000,
    backoffFactor: 2,
    jitter: 'full',
  },

  /**
   * "Off" — try once, never retry. Useful as a sentinel value when a feature
   * flag disables retries.
   */
  NONE: {
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    backoffFactor: 1,
    jitter: 'none',
  },
};

// ── Retryable error classification ───────────────────────────────────────────

/**
 * HTTP status codes that are considered retryable. 429 (rate limited) and
 * 5xx (server errors) are transient by definition. 4xx (except 429) are
 * client errors — retrying won't help.
 */
export const RETRYABLE_HTTP_STATUS = new Set<number>([408, 425, 429, 500, 502, 503, 504]);

/**
 * Prisma error codes that are documented as transient and safe to retry.
 *
 *   • P2024 — connection pool timeout (timed out fetching a connection)
 *   • P2034 — transaction write-write conflict (serialisable isolation)
 *   • P2037 — too many connections (Prisma can't open a new one)
 *
 * See: https://www.prisma.io/docs/orm/reference/error-reference#p2024
 */
export const RETRYABLE_PRISMA_CODES = new Set<string>(['P2024', 'P2034', 'P2037']);

/**
 * The default retryability predicate. Classifies an error as retryable if:
 *
 *   1. It's a network error (TypeError from fetch, AbortError from timeout).
 *   2. It carries a `status` field that's in `RETRYABLE_HTTP_STATUS`.
 *   3. It's a Prisma error with a code in `RETRYABLE_PRISMA_CODES`.
 *
 * Custom predicates can extend or override this (e.g. "retry only if the
 * response body contains 'temporarily_unavailable'").
 */
export function defaultIsRetryable(err: unknown): boolean {
  if (!err) return false;

  // ── String errors: retry if they mention transient keywords ──────────────
  if (typeof err === 'string') {
    const lower = err.toLowerCase();
    return (
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('temporarily') ||
      lower.includes('econnreset') ||
      lower.includes('socket hang up') ||
      lower.includes('network')
    );
  }

  if (err instanceof Error) {
    // ── Network errors: TypeError thrown by fetch() when DNS fails or the
    //    connection is refused. The Edge/Node fetch spec mandates TypeError
    //    (NOT a custom error class) for network-layer failures.
    if (err.name === 'TypeError') return true;

    // ── AbortError: the request was aborted (typically by a timeout). This
    //    is retryable IF the abort was due to a timeout, not a user-initiated
    //    cancel. We can't easily distinguish, so we err on the side of
    //    retrying — the outer `signal` option will short-circuit if the user
    //    explicitly cancelled.
    if (err.name === 'AbortError') return true;
  }

  // ── RAW error's `status` field takes precedence over normalised ──────────
  //
  // This MUST come before the `normaliseError()` check below. Why? Because
  // `normaliseError()` maps a GENERIC Error (one that isn't an AppError,
  // Prisma error, Zod error, etc.) to `statusCode: 500` (UNKNOWN_ERROR) —
  // and 500 is in `RETRYABLE_HTTP_STATUS`, so it would be wrongly
  // classified as retryable.
  //
  // If the raw error carries an explicit HTTP status (e.g. `err.status =
  // 400`), that's the GROUND TRUTH — a 400 is non-retryable, full stop.
  // We return the boolean directly (not just `true`) so non-retryable
  // statuses short-circuit to `false`.
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') {
      return RETRYABLE_HTTP_STATUS.has(status);
    }
  }

  // ── Normalised error: inspect code + statusCode + prismaCode ──────────────
  const normalised = normaliseError(err);
  if (normalised.prismaCode && RETRYABLE_PRISMA_CODES.has(normalised.prismaCode)) {
    return true;
  }
  // ── Error code signals (NETWORK, TIMEOUT, EXTERNAL_SERVICE) ───────────────
  // We check the CODE (not statusCode) because normaliseError() defaults
  // generic errors to statusCode=500 / code=UNKNOWN — checking the code is
  // more precise. A genuine server error (code=SERVER, statusCode=500) is
  // NOT automatically retryable unless it's explicitly classified as
  // EXTERNAL_SERVICE or NETWORK.
  if (
    normalised.code === ERROR_CODES.NETWORK ||
    normalised.code === ERROR_CODES.TIMEOUT ||
    normalised.code === ERROR_CODES.EXTERNAL_SERVICE
  ) {
    return true;
  }

  return false;
}

// ── Delay computation ────────────────────────────────────────────────────────

/**
 * Compute the delay (in milliseconds) for a given attempt, applying
 * exponential backoff and the requested jitter strategy.
 *
 * @param attempt  The attempt number that JUST FAILED (1-based). The delay
 *                 is for the NEXT attempt (attempt + 1).
 * @param opts     Retry options (uses defaults if fields are missing).
 * @returns        The delay in milliseconds. Always >= 0.
 */
export function computeDelay(
  attempt: number,
  opts: RetryOptions = {},
): number {
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs;
  const backoffFactor = opts.backoffFactor ?? DEFAULT_RETRY_OPTIONS.backoffFactor;
  const jitter = opts.jitter ?? DEFAULT_RETRY_OPTIONS.jitter;

  // ── Exponential component: base * factor^(attempt - 1) ────────────────────
  // attempt=1 → base, attempt=2 → base*factor, attempt=3 → base*factor^2...
  const expDelay = baseDelayMs * Math.pow(backoffFactor, Math.max(0, attempt - 1));
  const clamped = Math.min(expDelay, maxDelayMs);

  // ── Jitter ────────────────────────────────────────────────────────────────
  switch (jitter) {
    case 'none':
      return Math.max(0, Math.floor(clamped));
    case 'equal':
      // "Equal jitter": delay = clamped/2 + random(0, clamped/2)
      // Spreads retries in [clamped/2, clamped] — preserves the average delay
      // while still randomising.
      return Math.max(0, Math.floor(clamped / 2 + Math.random() * (clamped / 2)));
    case 'full':
    default:
      // "Full jitter": delay = random(0, clamped)
      // Maximum spread — recommended by AWS Architecture Blog.
      return Math.max(0, Math.floor(Math.random() * clamped));
  }
}

// ── Cancellable sleep ────────────────────────────────────────────────────────

/**
 * Sleep for `ms` milliseconds, resolving early if `signal` is aborted.
 *
 * @returns `true` if the sleep completed normally, `false` if aborted.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ── Retry budget (token bucket) ──────────────────────────────────────────────

/**
 * A simple token-bucket retry budget. Caps the TOTAL number of retries
 * across all callers in a rolling window. Prevents retry storms when many
 * requests fail simultaneously.
 *
 * Usage:
 *   const budget = new RetryBudget({ capacity: 100, refillPerMs: 1000/60 });
 *   await executeWithRetry(fn, { budget });
 *
 * The bucket starts full (`capacity` tokens). Each retry consumes 1 token.
 * Tokens refill at `refillPerMs` (tokens per millisecond) up to `capacity`.
 * When the bucket is empty, retries fail fast.
 */
export class RetryBudget {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume one token. Returns true if a token was available (and
   * consumed), false if the bucket is empty.
   */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Current token count (after refilling). For observability. */
  availableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /** Refill tokens based on elapsed time since the last refill. */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

// ── Core executor ────────────────────────────────────────────────────────────

/**
 * The result of a retryable execution. Carries metadata about the retries
 * for observability (logs, metrics, Sentry breadcrumbs).
 */
export interface RetryResult<T> {
  /** The successful return value of `fn`. */
  value: T;
  /** Total number of attempts made (1 = no retries, 3 = retried twice). */
  attempts: number;
  /** Total time spent sleeping between retries, in milliseconds. */
  totalDelayMs: number;
  /** The last error before success (undefined if succeeded on first try). */
  lastError?: unknown;
}

/**
 * Execute an async function with retry. This is the CORE function — all
 * higher-level wrappers (`withRetry`, `retryableFetch`, `withPrismaTxRetry`)
 * delegate to it.
 *
 * Behaviour:
 *   1. Call `fn(attempt)`. If it resolves, return `{ value, attempts, ... }`.
 *   2. If it rejects, classify the error via `isRetryable`.
 *   3. If non-retryable, OR we've exhausted `maxAttempts`, OR the budget is
 *      empty, OR the signal is aborted — re-throw the error.
 *   4. Otherwise, compute the delay, call `onRetry`, sleep, and retry.
 *
 * @param fn    The function to execute. Receives the attempt number (1-based)
 *              so it can adjust its behaviour (e.g. log "retry 2/3").
 * @param opts  Retry options. Missing fields use defaults.
 * @returns     A `RetryResult` with the value + retry metadata.
 * @throws      The last error if all attempts fail or the error is
 *              non-retryable.
 */
export async function executeWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<RetryResult<T>> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_RETRY_OPTIONS.maxAttempts;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;
  const signal = opts.signal;
  const budget = opts.budget;

  let attempt = 0;
  let lastError: unknown;
  let totalDelayMs = 0;

  while (true) {
    attempt++;

    // ── Abort check (before each attempt) ─────────────────────────────────
    if (signal?.aborted) {
      throw lastError ?? new DOMException('Aborted', 'AbortError');
    }

    try {
      const value = await fn(attempt);
      return { value, attempts: attempt, totalDelayMs, lastError: attempt > 1 ? lastError : undefined };
    } catch (err) {
      lastError = err;

      // ── Exhausted attempts? ──────────────────────────────────────────────
      if (attempt >= maxAttempts) {
        throw err;
      }

      // ── Non-retryable? ───────────────────────────────────────────────────
      if (!isRetryable(err, attempt)) {
        throw err;
      }

      // ── Budget exhausted? Fail fast (don't sleep) ────────────────────────
      if (budget && !budget.tryConsume()) {
        throw err;
      }

      // ── Compute delay for the NEXT attempt ───────────────────────────────
      const nextDelayMs = computeDelay(attempt, opts);

      // ── onRetry hook (may throw to abort) ────────────────────────────────
      if (opts.onRetry) {
        opts.onRetry(err, attempt, nextDelayMs);
      }

      // ── Sleep (cancellable) ──────────────────────────────────────────────
      const slept = await sleep(nextDelayMs, signal);
      if (!slept) {
        // Aborted during sleep — re-throw immediately.
        throw err;
      }
      totalDelayMs += nextDelayMs;
    }
  }
}

// ── Convenience: executeWithRetry without the metadata wrapper ───────────────

/**
 * Execute `fn` with retry and return just the value. Shorthand for
 * `(await executeWithRetry(fn, opts)).value`. Use this when you don't care
 * about the retry metadata.
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  return (await executeWithRetry(fn, opts)).value;
}
