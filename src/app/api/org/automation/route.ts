// GET /api/org/automation (v2.159.0)
//
// The org console's "Automation pulse" card: the last cron dispatch the
// ledger has on record, the 7-day failed-tick count, and the tick-gate
// posture. Automation that nobody can see is automation that can silently
// die — the v2.158.0 proxy fix made the production dispatcher reachable,
// this read makes it VISIBLE.
//
// AUTHORIZATION: SUPER_ADMIN and STORE_OWNER and ACCOUNTANT — the same
// ORG_ROLES contract as /api/org/summary (organization-wide telemetry;
// branch-only roles must never see it).
//
// READ-ONLY: no writes anywhere; the ledger rows are written by the
// dispatcher itself (CRON_DISPATCH_TICK, v2.159.0).

import { rawDb, runWithoutTenant } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];

// The two ledger actions the dispatcher writes (v2.159.0).
const TICK_ACTION = 'CRON_DISPATCH_TICK';
const PARTIAL_FAILURE_ACTION = 'CRON_DISPATCH_PARTIAL_FAILURE';

interface SubJobResult {
  name: string;
  ok: boolean;
  status: number;
  /** v2.164.0: the session-reaper's own honest count, promoted onto the
   *  tick ledger by the dispatcher (only when a non-negative finite
   *  number). Optional for every other sub-job and for pre-2.164 ticks -
   *  the card renders nothing when it is absent, never a guess. */
  deleted?: number;
}

async function orgAutomationHandler(_request: NextRequest): Promise<Response> {
  return runWithoutTenant(async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [latestTick, failedCount] = await Promise.all([
      rawDb.systemLog.findFirst({
        where: { action: TICK_ACTION },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, metadata: true },
      }),
      rawDb.systemLog.count({
        where: { action: PARTIAL_FAILURE_ACTION, createdAt: { gte: since } },
      }),
    ]);

    // The metadata column is a JSON string by contract (v2.159.0 dispatcher
    // writes { results: SubJobResult[] }; v2.165.0 adds the dispatcher's
    // name). A row that cannot be parsed is a
    // ledger row without sub-job detail - the tick itself still happened, so
    // the timestamp stays and the chips render nothing (never a guess).
    let subJobs: SubJobResult[] = [];
    let tickDispatcher: string | undefined;
    if (latestTick?.metadata) {
      try {
        const parsed: unknown = JSON.parse(latestTick.metadata);
        if (
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { results?: unknown }).results)
        ) {
          subJobs = ((parsed as { results: unknown[] }).results as SubJobResult[]).filter(
            (r): r is SubJobResult => {
              if (!r || typeof r !== 'object') return false;
              const job = r as SubJobResult;
              // deleted rides only when it is honestly absent or a real
              // non-negative number - a string "3" or a negative never does.
              // (Destructured once: TS cannot narrow a cast-property access
              // across a || / && chain, and no-non-null-assertion is house
              // lint policy.)
              const { name, ok, status, deleted } = job;
              if (typeof name !== 'string' || typeof ok !== 'boolean' || typeof status !== 'number') {
                return false;
              }
              if (deleted === undefined) return true;
              return typeof deleted === 'number' && Number.isFinite(deleted) && deleted >= 0;
            },
          );
          // v2.165.0: which dispatcher fired ('hourly' | 'nightly'). Rows
          // older than v2.165.0 lack the field - absent or garbage keeps it
          // undefined and the card renders no source label (never a guess).
          const rawDispatcher = (parsed as { dispatcher?: unknown }).dispatcher;
          if (typeof rawDispatcher === 'string' && rawDispatcher.length > 0) {
            tickDispatcher = rawDispatcher;
          }
        }
      } catch {
        subJobs = []; // tolerant read: the tick stamp still renders
      }
    }

    return Response.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        lastTick: latestTick
          ? {
              at: latestTick.createdAt.toISOString(),
              failedCount: failedCount,
              subJobs,
              // v2.165.0: present only when the ledger row named its
              // dispatcher - older ticks simply omit the field.
              ...(tickDispatcher ? { dispatcher: tickDispatcher } : {}),
            }
          : null,
        failedTicks7d: failedCount,
        // Honest tick-gate posture, read server-side: while CRON_SECRET is
        // unset the dispatcher accepts unauthenticated ticks (fail-open with
        // a WARN systemLog) — the card says so in amber until the human
        // arms the gate.
        secretConfigured: Boolean(process.env.CRON_SECRET),
        cadence: { vercelSchedule: '0 3 * * *', pingerWorkflow: 'cron-hourly.yml' },
      },
    });
  });
}

export const GET = withErrorBoundary(
  requireAuth(orgAutomationHandler, { roles: ORG_ROLES }),
  'ORG_AUTOMATION',
);
