// GET /api/health/retry-demo
//
// Phase 4 — Demonstrates the retry framework with exponential backoff.
// This is a PUBLIC health endpoint (no auth required) that simulates a
// flaky operation: it fails the first N times, then succeeds. The response
// includes the full retry trace so you can observe the backoff + jitter
// behaviour in action.
//
// Query params:
//   ?failTimes=2   — Number of times to fail before succeeding (default 2).
//                    The function will throw a synthetic 503 on attempts
//                    1..failTimes, then succeed on attempt failTimes+1.
//   ?maxAttempts=5 — Max retry attempts (default 5).
//   ?baseDelay=50  — Base delay in ms (default 50, kept small for demo).
//   ?errorType=503 — Type of error to throw: '503', '429', 'network',
//                    'timeout', '400' (non-retryable). Default '503'.
//
// Example:
//   curl /api/health/retry-demo?failTimes=3&errorType=503
//
// Response (200):
//   {
//     "success": true,
//     "data": {
//       "attempts": 4,                  // total attempts (1 + 3 retries)
//       "totalDelayMs": 312,            // sum of all sleep delays
//       "trace": [                      // per-attempt log
//         { "attempt": 1, "ok": false, "delayMs": 47, "error": "HTTP 503 ..." },
//         { "attempt": 2, "ok": false, "delayMs": 89, "error": "HTTP 503 ..." },
//         { "attempt": 3, "ok": false, "delayMs": 176, "error": "HTTP 503 ..." },
//         { "attempt": 4, "ok": true, "value": "success-after-4-attempts" }
//       ]
//     },
//     "requestId": "...",
//     "timestamp": "..."
//   }
//
// Response (500) — when all attempts fail:
//   {
//     "success": false,
//     "error": "HTTP 503 ...",
//     "code": "EXTERNAL_SERVICE_ERROR",
//     "attempts": 5,
//     "requestId": "...",
//     "timestamp": "..."
//   }

import { type NextRequest } from 'next/server';
import { executeWithRetry, type RetryOptions } from '@/lib/retry';
import { normaliseError } from '@/lib/error-handler';
import { successResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

interface AttemptTrace {
  attempt: number;
  ok: boolean;
  delayMs?: number;
  error?: string;
  value?: string;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const failTimes = Math.max(0, Math.min(10, parseInt(url.searchParams.get('failTimes') || '2', 10)));
  const maxAttempts = Math.max(1, Math.min(10, parseInt(url.searchParams.get('maxAttempts') || '5', 10)));
  const baseDelay = Math.max(0, Math.min(5000, parseInt(url.searchParams.get('baseDelay') || '50', 10)));
  const errorType = (url.searchParams.get('errorType') || '503') as '503' | '429' | 'network' | 'timeout' | '400';

  // ── Synthetic flaky operation ──────────────────────────────────────────
  // Each invocation increments a counter. While the counter is <= failTimes,
  // we throw the requested error type. After that, we succeed.
  let callCount = 0;
  const trace: AttemptTrace[] = [];

  function makeError(): Error {
    switch (errorType) {
      case '503': {
        const err = new Error('HTTP 503 Service Unavailable (simulated)') as Error & { status?: number };
        err.status = 503;
        return err;
      }
      case '429': {
        const err = new Error('HTTP 429 Too Many Requests (simulated)') as Error & { status?: number };
        err.status = 429;
        return err;
      }
      case 'network': {
        // fetch() throws a TypeError on network failure. Our classifier
        // treats TypeError as retryable.
        const err = new TypeError('fetch failed: ECONNREFUSED (simulated)');
        return err;
      }
      case 'timeout': {
        // AbortError is thrown when fetch() is aborted by a timeout.
        const err = new DOMException('The operation was aborted due to timeout (simulated)', 'AbortError');
        return err;
      }
      case '400': {
        // 400 is NON-retryable — the loop should fail fast.
        const err = new Error('HTTP 400 Bad Request (simulated, non-retryable)') as Error & { status?: number };
        err.status = 400;
        return err;
      }
      default:
        return new Error('Unknown simulated error');
    }
  }

  const opts: RetryOptions = {
    maxAttempts,
    baseDelayMs: baseDelay,
    maxDelayMs: 5000,
    backoffFactor: 2,
    jitter: 'full',
    onRetry: (err, attempt, nextDelayMs) => {
      // Record the failed attempt + the delay that will be slept.
      trace.push({
        attempt,
        ok: false,
        delayMs: nextDelayMs,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  };

  try {
    const { value, attempts, totalDelayMs } = await executeWithRetry(async () => {
      callCount++;
      if (callCount <= failTimes) {
        throw makeError();
      }
      return `success-after-${callCount}-attempts`;
    }, opts);

    // Record the final successful attempt.
    trace.push({
      attempt: attempts,
      ok: true,
      value,
    });

    return successResponse(
      {
        attempts,
        totalDelayMs,
        failTimesRequested: failTimes,
        errorType,
        maxAttempts,
        baseDelayMs: baseDelay,
        trace,
      },
      { status: 200 },
    );
  } catch (err) {
    // All retries exhausted (or non-retryable error).
    const normalised = normaliseError(err);
    const requestId = request.headers.get('X-Request-ID') ?? undefined;
    return Response.json(
      {
        success: false,
        error: normalised.message,
        code: normalised.code,
        statusCode: normalised.statusCode,
        attempts: trace.length + 1, // +1 for the final failed attempt (not in trace)
        errorType,
        failTimesRequested: failTimes,
        maxAttempts,
        trace,
        requestId,
        timestamp: new Date().toISOString(),
      },
      {
        status: normalised.statusCode >= 400 && normalised.statusCode < 600 ? normalised.statusCode : 500,
        headers: requestId ? { 'X-Request-ID': requestId } : {},
      },
    );
  }
}
