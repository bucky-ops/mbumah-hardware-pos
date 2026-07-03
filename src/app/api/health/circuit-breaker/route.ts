// GET  /api/health/circuit-breaker
// POST /api/health/circuit-breaker
//
// Phase 5 — External Service Circuit Breaker observability + admin endpoint.
//
// GET (any authenticated user):
//   Returns the current state + metrics for every registered circuit breaker
//   in the process. This is the read-only "operations dashboard" view — it
//   shows which external services (Twilio, Resend, M-Pesa Daraja) are
//   currently healthy, degraded, or known-down.
//
//   Response 200:
//     {
//       "success": true,
//       "data": {
//         "total": 4,
//         "openCount": 1,
//         "halfOpenCount": 0,
//         "closedCount": 3,
//         "breakers": [
//           {
//             "name": "twilio-sms",
//             "state": "CLOSED",
//             "totalCalls": 142,
//             "totalSuccesses": 138,
//             "totalFailures": 4,
//             "totalTrips": 0,
//             "windowSize": 20,
//             "windowFailures": 1,
//             "failureRate": 0.05,
//             "lastFailureAt": "2026-...",
//             "lastSuccessAt": "2026-...",
//             "openedAt": null,
//             "msUntilHalfOpen": 0,
//             "halfOpenInFlight": 0
//           },
//           ...
//         ]
//       },
//       "requestId": "...",
//       "timestamp": "..."
//     }
//
// POST (SUPER_ADMIN only):
//   Administrative actions to manually manage breaker state. Useful for:
//     • Forcing a breaker OPEN during planned maintenance (e.g. Twilio
//       sandbox reset) so the app fails fast instead of timing out.
//     • Resetting a breaker after a manual investigation (clears the
//       sliding window + counters).
//     • Resetting ALL breakers ("panic button") after a full recovery.
//
//   Body:
//     { "action": "reset" | "resetAll" | "forceOpen" | "forceClose",
//       "name"?: "twilio-sms" }   // required for reset/forceOpen/forceClose
//
//   Response 200:
//     {
//       "success": true,
//       "data": {
//         "action": "reset",
//         "name": "twilio-sms",
//         "affected": 1,
//         "breaker": { ...metrics after action }
//       }
//     }
//
//   Response 404 (breaker name not found):
//     { "success": false, "error": "Circuit breaker 'foo' not found.", ... }

import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorFromThrown } from '@/lib/api-response';
import { normaliseError } from '@/lib/error-handler';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  circuitBreakerRegistry,
  type CircuitBreakerMetrics,
  type CircuitState,
} from '@/lib/circuit-breaker';

export const dynamic = 'force-dynamic';

// ── GET: list all breakers ───────────────────────────────────────────────────

export const GET = requireAuth(async (_request, _session) => {
  try {
    const allMetrics = circuitBreakerRegistry.getAllMetrics();
    const openCount = allMetrics.filter((m) => m.state === 'OPEN').length;
    const halfOpenCount = allMetrics.filter((m) => m.state === 'HALF_OPEN').length;
    const closedCount = allMetrics.filter((m) => m.state === 'CLOSED').length;

    // Sort: OPEN breakers first (most urgent), then HALF_OPEN, then CLOSED.
    // Within each tier, sort by name for stable display.
    const stateRank: Record<CircuitState, number> = {
      OPEN: 0,
      HALF_OPEN: 1,
      CLOSED: 2,
    };
    const breakers = [...allMetrics].sort((a, b) => {
      const rankDiff = stateRank[a.state] - stateRank[b.state];
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    });

    return successResponse({
      total: allMetrics.length,
      openCount,
      halfOpenCount,
      closedCount,
      breakers,
    });
  } catch (err) {
    return errorFromThrown(err, { context: 'CIRCUIT_BREAKER_LIST' });
  }
});

// ── POST: admin actions ──────────────────────────────────────────────────────

type AdminAction = 'reset' | 'resetAll' | 'forceOpen' | 'forceClose';

interface AdminBody {
  action: AdminAction;
  name?: string;
}

const VALID_ACTIONS = new Set<AdminAction>(['reset', 'resetAll', 'forceOpen', 'forceClose']);

export const POST = requireAuth(
  async (request: NextRequest, session) => {
    try {
      const body = (await request.json()) as AdminBody;

      // ── Validate action ─────────────────────────────────────────────────
      if (!body.action || !VALID_ACTIONS.has(body.action)) {
        return Response.json(
          {
            success: false,
            error: `Invalid action. Must be one of: ${Array.from(VALID_ACTIONS).join(', ')}.`,
          },
          { status: 400 },
        );
      }

      const action = body.action;

      // ── resetAll: panic button ──────────────────────────────────────────
      if (action === 'resetAll') {
        const affected = circuitBreakerRegistry.resetAll();
        await logAdminAction(session.userId, action, undefined, affected);
        return successResponse({
          action,
          affected,
          breakers: circuitBreakerRegistry.getAllMetrics(),
        });
      }

      // ── name required for the other actions ────────────────────────────
      if (!body.name) {
        return Response.json(
          {
            success: false,
            error: `Breaker "name" is required for action "${action}".`,
          },
          { status: 400 },
        );
      }

      const breaker = circuitBreakerRegistry.get(body.name);
      if (!breaker) {
        return Response.json(
          {
            success: false,
            error: `Circuit breaker "${body.name}" not found.`,
            code: 'NOT_FOUND',
            availableNames: circuitBreakerRegistry.list().map((b) => b.name),
          },
          { status: 404 },
        );
      }

      // ── Apply the action ───────────────────────────────────────────────
      switch (action) {
        case 'reset':
          breaker.reset();
          break;
        case 'forceOpen':
          breaker.forceOpen();
          break;
        case 'forceClose':
          // "forceClose" = same as reset (CLOSED + cleared counters). We
          // expose it as a separate action because operators semantically
          // distinguish "I want to clear stats" (reset) from "I want the
          // breaker to allow traffic again" (forceClose).
          breaker.reset();
          break;
      }

      const metrics: CircuitBreakerMetrics = breaker.getMetrics();
      await logAdminAction(session.userId, action, body.name, 1, metrics);

      return successResponse({
        action,
        name: body.name,
        affected: 1,
        breaker: metrics,
      });
    } catch (err) {
      return errorFromThrown(err, { context: 'CIRCUIT_BREAKER_ADMIN' });
    }
  },
  { roles: ['SUPER_ADMIN'] },
);

// ── Audit log helper ─────────────────────────────────────────────────────────

async function logAdminAction(
  userId: string,
  action: AdminAction,
  name: string | undefined,
  affected: number,
  metrics?: CircuitBreakerMetrics,
): Promise<void> {
  try {
    await systemLog({
      action: 'CIRCUIT_BREAKER_ADMIN',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        `Admin manually applied "${action}" to ` +
        (name ? `breaker "${name}"` : `ALL breakers`) +
        ` (${affected} affected).` +
        (metrics ? ` New state: ${metrics.state}.` : ''),
      userId,
      metadata: {
        adminAction: action,
        breakerName: name,
        affected,
        metrics: metrics
          ? {
              state: metrics.state,
              totalCalls: metrics.totalCalls,
              totalTrips: metrics.totalTrips,
              failureRate: metrics.failureRate,
            }
          : undefined,
      },
    });
  } catch {
    // Audit logging is best-effort — never block the admin action.
  }
}

// ── Re-export for downstream use (avoids circular import concerns) ───────────

export { normaliseError };
