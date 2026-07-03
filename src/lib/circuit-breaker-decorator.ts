// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Circuit Breaker Decorators (HOF wrappers)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 5 — Error Handling & Resilience Framework
//
// This module provides ergonomic, higher-order wrappers around the
// `CircuitBreaker` class in `src/lib/circuit-breaker.ts`. The wrappers
// compose the circuit breaker (Phase 5) with the retry engine (Phase 4) so
// that each external service call gets BOTH layers of protection:
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │  withCircuitBreaker(name, preset, () =>                      │
//   │    executeWithRetry(() => callService(), retryPreset)        │
//   │  )                                                           │
//   └──────────────────────────────────────────────────────────────┘
//
//   • OUTER: Circuit breaker — fails fast if the service is known-down.
//   • INNER: Retry — handles transient blips without tripping the breaker.
//
// ── Why compose both? ────────────────────────────────────────────────────────
//
//   Retry alone:    A 5-min Daraja outage → every request retries 3x →
//                   3x the load on Daraja (which is already down) →
//                   connection pool exhaustion → app hangs.
//
//   Circuit alone:  A single 503 → breaker counts 1 failure → continues
//                   calling on the NEXT request (no retry of the current
//                   one) → user sees a failure for a transient blip.
//
//   Both together:  A single 503 → retry handles it → breaker sees SUCCESS.
//                   A 5-min outage → breaker trips after ~10 failures →
//                   subsequent requests fail INSTANTLY (no retry, no
//                   network call) → app stays responsive.
//
// ── Default logging hooks ────────────────────────────────────────────────────
//
// Every state transition (CLOSED→OPEN, OPEN→HALF_OPEN, HALF_OPEN→CLOSED) is
// logged to the SystemLog table with the breaker name + metrics snapshot.
// This makes outages visible in the admin UI and Sentry.
//
// ─────────────────────────────────────────────────────────────────────────────

import {
  CircuitOpenError,
  circuitBreakerRegistry,
  CIRCUIT_BREAKER_PRESETS,
  type CircuitBreakerOptions,
  type CircuitBreakerMetrics,
  type CircuitState,
} from './circuit-breaker';
import type { RetryOptions } from './retry';

// ── Lazy server-only imports (for logging) ───────────────────────────────────
//
// systemLog + LogSeverity + LogComponent are imported dynamically inside the
// hooks so this module remains safe to import on the client (e.g. for type
// definitions). The hooks no-op on the client.

// ── withCircuitBreaker ───────────────────────────────────────────────────────

/**
 * Options for `withCircuitBreaker`. Combines breaker config with optional
 * retry config so a single HOF can apply both layers.
 */
export interface WithCircuitBreakerOptions {
  /**
   * Circuit breaker config. Either a preset name (from
   * `CIRCUIT_BREAKER_PRESETS`) or a full `CircuitBreakerOptions` object.
   * The `name` field is REQUIRED (it identifies the breaker in the registry).
   */
  breaker: CircuitBreakerOptions | (keyof typeof CIRCUIT_BREAKER_PRESETS) & string;

  /**
   * Optional retry options. If provided, the wrapped function is also
   * wrapped in `executeWithRetry` (Phase 4). The retry runs INSIDE the
   * breaker — so a retried-and-succeeded call counts as a SUCCESS for the
   * breaker, and a retried-and-failed call counts as a single FAILURE.
   *
   * Pass `null` or omit to apply the breaker WITHOUT retry (useful when the
   * inner function already has its own retry).
   */
  retry?: RetryOptions | null;
}

/**
 * Wrap an async function with a circuit breaker (and optionally retry).
 *
 * Usage (breaker + retry):
 *   const sendSms = withCircuitBreaker(
 *     { breaker: { name: 'twilio-sms', ...CIRCUIT_BREAKER_PRESETS.TWILIO, name: 'twilio-sms' },
 *       retry: RETRY_PRESETS.EXTERNAL_API },
 *     (phone: string, msg: string) => twilioFetch(phone, msg)
 *   );
 *   await sendSms('+254712345678', 'Hello');
 *
 * Usage (breaker only, retry handled by caller):
 *   const callDaraja = withCircuitBreaker(
 *     { breaker: 'MPESA_DARAJA' },  // preset name (but name must be set)
 *     () => darajaCall()
 *   );
 *
 * @param opts  Breaker + optional retry config.
 * @param fn    The function to wrap. Receives the attempt number (1-based) as
 *              the LAST argument IF retry is enabled (mirrors `withRetry`).
 * @returns     A new function with the same arg signature (minus the attempt
 *              number) that returns the value or throws CircuitOpenError /
 *              the inner error.
 */
export function withCircuitBreaker<A extends unknown[], R>(
  opts: WithCircuitBreakerOptions,
  fn: (...args: [...A, number]) => Promise<R>,
): (...args: A) => Promise<R> {
  // ── Resolve breaker options ──────────────────────────────────────────────
  const breakerOpts: CircuitBreakerOptions =
    typeof opts.breaker === 'string'
      ? // Preset name — spread the preset, but the caller MUST provide the
        // name separately... actually the preset doesn't have a name. So
        // the preset-name form requires the caller to also pass `name`.
        // We handle this by requiring the full object form in practice.
        { ...CIRCUIT_BREAKER_PRESETS[opts.breaker] }
      : { ...opts.breaker };

  if (!breakerOpts.name) {
    throw new Error(
      'withCircuitBreaker: breaker.name is required (it identifies the breaker in the registry).',
    );
  }

  // ── Get or create the breaker (idempotent across hot reloads) ────────────
  const breaker = circuitBreakerRegistry.getOrCreate({
    ...breakerOpts,
    // Attach default logging hooks (composed with any caller-provided hooks).
    onOpen: composeHook(breakerOpts.onOpen, (m) => logTransition(breakerOpts.name, 'OPEN', m)),
    onClose: composeHook(breakerOpts.onClose, (m) =>
      logTransition(breakerOpts.name, 'CLOSED', m),
    ),
    onHalfOpen: composeHook(breakerOpts.onHalfOpen, (m) =>
      logTransition(breakerOpts.name, 'HALF_OPEN', m),
    ),
  });

  const retryOpts = opts.retry;

  return async (...args: A): Promise<R> => {
    // ── If retry is enabled, compose: breaker.execute(retry(fn)) ──────────
    if (retryOpts) {
      // We import executeWithRetry lazily to avoid a circular dependency
      // at module load (retry.ts imports from error-handler.ts, which is
      // fine, but keeping it lazy makes the dependency graph cleaner).
      const { executeWithRetry } = await import('./retry');
      return breaker.execute(async () => {
        const { value } = await executeWithRetry(
          (attempt: number) => fn(...args, attempt),
          retryOpts,
        );
        return value;
      });
    }

    // ── Breaker only — call fn with attempt=1 (for signature compat) ──────
    return breaker.execute(() => fn(...args, 1 as number));
  };
}

// ── Convenience: get breaker state without calling ───────────────────────────

/**
 * Get the current state of a named circuit breaker. Returns 'CLOSED' if the
 * breaker doesn't exist (defensive — treating unknown breakers as healthy
 * avoids false alarms).
 */
export function getCircuitState(name: string): CircuitState {
  return circuitBreakerRegistry.get(name)?.getState() ?? 'CLOSED';
}

/**
 * Check if a circuit breaker is currently OPEN (rejecting requests). Returns
 * false if the breaker doesn't exist.
 */
export function isCircuitOpen(name: string): boolean {
  return getCircuitState(name) === 'OPEN';
}

/**
 * Get a metrics snapshot for a named breaker, or null if it doesn't exist.
 */
export function getCircuitMetrics(name: string): CircuitBreakerMetrics | null {
  return circuitBreakerRegistry.get(name)?.getMetrics() ?? null;
}

// ── Hook composition helper ──────────────────────────────────────────────────

/**
 * Compose two hook functions. The caller's hook runs first; the default hook
 * (logging) runs second. Either can be undefined.
 */
function composeHook(
  userHook: ((m: CircuitBreakerMetrics) => void) | undefined,
  defaultHook: (m: CircuitBreakerMetrics) => void,
): (m: CircuitBreakerMetrics) => void {
  if (!userHook) return defaultHook;
  return (m: CircuitBreakerMetrics) => {
    try {
      userHook(m);
    } catch {
      // User hook threw — don't let it break the transition. The default
      // hook (logging) should still run.
    }
    defaultHook(m);
  };
}

// ── Default logging hook ─────────────────────────────────────────────────────

/**
 * Log a circuit breaker state transition to the SystemLog table (server-side)
 * and console (client-side). Fire-and-forget.
 */
function logTransition(name: string, state: CircuitState, metrics: CircuitBreakerMetrics): void {
  // ── Client-side: console.warn (no SystemLog in browser) ──────────────────
  if (typeof window !== 'undefined') {
    console.warn(`[CircuitBreaker] "${name}" → ${state}`, metrics);
    return;
  }

  // ── Server-side: systemLog ────────────────────────────────────────────────
  void (async () => {
    try {
      const { systemLog } = await import('@/lib/logger');
      const { LogSeverity, LogComponent } = await import('@/lib/types');

      const severity =
        state === 'OPEN' ? LogSeverity.ERROR :
        state === 'HALF_OPEN' ? LogSeverity.WARN :
        LogSeverity.INFO; // CLOSED (recovered)

      const action =
        state === 'OPEN' ? 'CIRCUIT_BREAKER_OPENED' :
        state === 'HALF_OPEN' ? 'CIRCUIT_BREAKER_HALF_OPEN' :
        'CIRCUIT_BREAKER_CLOSED';

      await systemLog({
        action,
        component: LogComponent.SYSTEM,
        severity,
        message:
          state === 'OPEN'
            ? `Circuit breaker "${name}" TRIPPED OPEN — failing fast. ` +
              `Failure rate: ${(metrics.failureRate * 100).toFixed(1)}% ` +
              `(${metrics.windowFailures}/${metrics.windowSize}). ` +
              `Cooldown: ${metrics.msUntilHalfOpen}ms. ` +
              `Total trips: ${metrics.totalTrips}.`
            : state === 'HALF_OPEN'
              ? `Circuit breaker "${name}" entering HALF_OPEN — probing with up to ` +
                `${CIRCUIT_BREAKER_PRESETS.EXTERNAL_API.halfOpenMaxCalls} trial calls.`
              : `Circuit breaker "${name}" RECOVERED → CLOSED. ` +
                `Total calls since reset: ${metrics.totalCalls} ` +
                `(${metrics.totalSuccesses} ok, ${metrics.totalFailures} failed).`,
        metadata: {
          circuitName: name,
          state,
          ...metrics,
        },
      });
    } catch {
      // Logging failed — fall back to console.
      console.warn(`[CircuitBreaker] "${name}" → ${state} (logging failed)`, metrics);
    }
  })();
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export {
  CircuitBreaker,
  CircuitOpenError,
  circuitBreakerRegistry,
  CIRCUIT_BREAKER_PRESETS,
  type CircuitBreakerOptions,
  type CircuitBreakerMetrics,
  type CircuitState,
} from './circuit-breaker';
