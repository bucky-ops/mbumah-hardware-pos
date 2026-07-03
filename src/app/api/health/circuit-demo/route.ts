// GET /api/health/circuit-demo
//
// Phase 5 — Demonstrates the circuit breaker state machine in action.
//
// This is a PUBLIC health endpoint (no auth required) that drives a dedicated
// "demo" circuit breaker through the CLOSED → OPEN → HALF_OPEN → CLOSED
// lifecycle so you can observe the behaviour without touching real external
// services.
//
// The demo breaker uses SMALL thresholds so it trips quickly:
//   • failureThreshold: 0.5   (50% of recent calls fail)
//   • minCalls: 4              (need at least 4 calls before evaluating)
//   • slidingWindowSize: 8     (track the last 8 calls)
//   • cooldownMs: 2_000        (2s cooldown — short for demo)
//   • halfOpenMaxCalls: 2      (allow 2 probe calls in HALF_OPEN)
//
// Query params:
//   ?failCalls=4   — number of calls that should fail (default 4). Each failed
//                    call drives the breaker toward OPEN.
//   ?recoverCalls=3 — number of successful calls to make AFTER the breaker
//                    trips, to demonstrate the recovery path. Default 3.
//                    (1st triggers HALF_OPEN probe; on success the breaker
//                    closes; subsequent calls confirm CLOSED state.)
//   ?errorType=503 — type of error to throw: '503', '429', 'network',
//                    'timeout', '400' (non-retryable, also non-failure for
//                    the breaker — useful to show the `isFailure` filter).
//                    Default '503'.
//   ?reset=1       — if present, reset the demo breaker before running
//                    (useful for repeatable tests).
//
// Example:
//   curl /api/health/circuit-demo?failCalls=5&recoverCalls=3&errorType=503
//
// Response (200):
//   {
//     "success": true,
//     "data": {
//       "scenario": "trip-then-recover",
//       "errorType": "503",
//       "breakerName": "demo",
//       "initialState": "CLOSED",
//       "finalState": "CLOSED",
//       "calls": [
//         { "call": 1, "ok": false, "stateBefore": "CLOSED", "stateAfter": "CLOSED", "error": "..." },
//         { "call": 2, "ok": false, "stateBefore": "CLOSED", "stateAfter": "CLOSED", "error": "..." },
//         ...
//         { "call": 5, "ok": false, "stateBefore": "CLOSED", "stateAfter": "OPEN", "error": "..." },
//         { "call": 6, "ok": false, "stateBefore": "OPEN", "stateAfter": "OPEN",
//           "error": "Circuit \"demo\" is OPEN — requests are failing fast. ..." },
//         { "call": 7, "ok": true, "stateBefore": "HALF_OPEN", "stateAfter": "CLOSED", "value": "demo-success" },
//         ...
//       ],
//       "finalMetrics": { ...metrics after all calls }
//     }
//   }

import { type NextRequest } from 'next/server';
import { successResponse } from '@/lib/api-response';
import {
  circuitBreakerRegistry,
  CircuitOpenError,
  type CircuitBreaker,
  type CircuitBreakerMetrics,
  type CircuitState,
} from '@/lib/circuit-breaker';

export const dynamic = 'force-dynamic';

// ── Demo breaker ─────────────────────────────────────────────────────────────
//
// Created once per process and registered in the global registry (so the
// `/api/health/circuit-breaker` endpoint also reports its state). We use
// small thresholds so the demo trips quickly without waiting for many calls.
//
// `isFailure` excludes 4xx (non-429) so the `?errorType=400` scenario shows
// that client errors do NOT trip the breaker — only server/network errors do.
const demoBreaker: CircuitBreaker = circuitBreakerRegistry.getOrCreate({
  name: 'demo',
  failureThreshold: 0.5,
  minCalls: 4,
  slidingWindowSize: 8,
  cooldownMs: 2_000,
  halfOpenMaxCalls: 2,
  isFailure: (err) => {
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status: unknown }).status;
      if (typeof status === 'number') {
        // 4xx (non-429) = client error = service is up, request was bad.
        // Do NOT count these as failures.
        if (status >= 400 && status < 500 && status !== 429) return false;
        // 5xx, 429, network → count as failure.
        return true;
      }
    }
    // No status field → network error (TypeError, AbortError) → failure.
    return true;
  },
});

interface DemoCallTrace {
  call: number;
  ok: boolean;
  stateBefore: CircuitState;
  stateAfter: CircuitState;
  error?: string;
  value?: string;
  shortCircuited?: boolean;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const failCalls = Math.max(0, Math.min(20, parseInt(url.searchParams.get('failCalls') || '4', 10)));
  const recoverCalls = Math.max(0, Math.min(20, parseInt(url.searchParams.get('recoverCalls') || '3', 10)));
  const errorType = (url.searchParams.get('errorType') || '503') as
    | '503'
    | '429'
    | 'network'
    | 'timeout'
    | '400';
  const shouldReset = url.searchParams.has('reset');

  // ── Optional reset (for repeatable tests) ──────────────────────────────
  if (shouldReset) {
    demoBreaker.reset();
  }

  const breakerName = demoBreaker.name;
  const initialState = demoBreaker.getState();
  const trace: DemoCallTrace[] = [];

  // ── Helper: build the synthetic error for each failure type ────────────
  function makeError(): Error {
    switch (errorType) {
      case '503': {
        const err = new Error('HTTP 503 Service Unavailable (simulated)') as Error & {
          status?: number;
        };
        err.status = 503;
        return err;
      }
      case '429': {
        const err = new Error('HTTP 429 Too Many Requests (simulated)') as Error & {
          status?: number;
        };
        err.status = 429;
        return err;
      }
      case 'network': {
        return new TypeError('fetch failed: ECONNREFUSED (simulated)');
      }
      case 'timeout': {
        return new DOMException(
          'The operation was aborted due to timeout (simulated)',
          'AbortError',
        );
      }
      case '400': {
        const err = new Error('HTTP 400 Bad Request (simulated, non-failure for breaker)') as Error & {
          status?: number;
        };
        err.status = 400;
        return err;
      }
      default:
        return new Error('Unknown simulated error');
    }
  }

  // ── Phase A: drive the breaker toward OPEN with `failCalls` failures ───
  // Each call is wrapped in the breaker. When the breaker trips (→ OPEN),
  // subsequent calls short-circuit with CircuitOpenError (no fn invocation).
  for (let i = 1; i <= failCalls; i++) {
    const stateBefore = demoBreaker.getState();
    const ok = false;
    let errorMessage: string | undefined;
    let shortCircuited = false;

    try {
      await demoBreaker.execute(async () => {
        throw makeError();
      });
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        shortCircuited = true;
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage = String(err);
      }
    }

    const stateAfter = demoBreaker.getState();
    trace.push({
      call: i,
      ok,
      stateBefore,
      stateAfter,
      error: errorMessage,
      shortCircuited,
    });
  }

  // ── Phase B: if the breaker is OPEN, wait for the cooldown to elapse ───
  // so the next call lands in HALF_OPEN. If `failCalls` was insufficient to
  // trip the breaker, this is a no-op (the breaker is still CLOSED).
  let waitedForCooldownMs = 0;
  const stateAfterFailures = demoBreaker.getState();
  if (stateAfterFailures === 'OPEN' && recoverCalls > 0) {
    const metrics = demoBreaker.getMetrics();
    waitedForCooldownMs = metrics.msUntilHalfOpen;
    if (waitedForCooldownMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitedForCooldownMs + 50));
    }
  }

  // ── Phase C: drive the recovery with `recoverCalls` successes ──────────
  // The first call after cooldown enters HALF_OPEN. If it succeeds, the
  // breaker transitions back to CLOSED. Subsequent calls confirm CLOSED.
  for (let i = 1; i <= recoverCalls; i++) {
    const stateBefore = demoBreaker.getState();
    let ok = false;
    let value: string | undefined;
    let errorMessage: string | undefined;
    let shortCircuited = false;

    try {
      const result = await demoBreaker.execute(async () => `demo-success-${i}`);
      ok = true;
      value = result;
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        shortCircuited = true;
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage = String(err);
      }
    }

    const stateAfter = demoBreaker.getState();
    trace.push({
      call: failCalls + i,
      ok,
      stateBefore,
      stateAfter,
      value,
      error: errorMessage,
      shortCircuited,
    });
  }

  const finalMetrics: CircuitBreakerMetrics = demoBreaker.getMetrics();
  const finalState = demoBreaker.getState();

  return successResponse({
    scenario: 'trip-then-recover',
    errorType,
    breakerName,
    initialState,
    finalState,
    failCalls,
    recoverCalls,
    waitedForCooldownMs,
    calls: trace,
    finalMetrics,
  });
}
