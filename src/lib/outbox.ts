// Transactional outbox — reliable background side effects on serverless.
//
// AUDIT REFERENCE — FINANCIAL_MODULE_AUDIT_REPORT.md (F8-4):
//   Vercel serverless functions freeze shortly after the HTTP response is
//   returned. Any fire-and-forget promise started inside a route handler —
//   the old server-side STK push `fetch(...).catch(() => {})`, post-commit
//   loyalty writes, notification sends — can silently die half-done.
//
// Pattern:
//   1. Inside the business `$transaction`, call `enqueueOutbox(tx, ...)` to
//      INSERT an OutboxEvent row. It commits atomically with the business
//      change — no lost events, no duplicates.
//   2. `pumpOutbox(db)` runs from a cron-driven route (/api/cron/outbox) and
//      ALSO opportunistically after checkout commits. It claims due events
//      with a guarded `updateMany` (concurrency-safe), executes the handler,
//      and retries with exponential backoff until `maxAttempts`, then DEAD.
//
// Server-only module.

import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

/** Minimal tx surface for enqueueing inside an interactive transaction. */
type OutboxTx = {
  outboxEvent: {
    create: (args: {
      data: {
        storeId: string;
        kind: string;
        payload: string;
        availableAt?: Date;
        maxAttempts?: number;
      };
    }) => Promise<unknown>;
  };
};

/** Handler signature for a delivered event. */
export type OutboxHandler = (event: {
  id: string;
  storeId: string;
  kind: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

/** Registry of event kinds → handlers. Extend as new flows adopt the outbox. */
const handlers: Record<string, OutboxHandler> = {};

export function registerOutboxHandler(kind: string, handler: OutboxHandler): void {
  handlers[kind] = handler;
}

/**
 * Enqueue a side-effect to be delivered after the surrounding transaction
 * commits. MUST be called with the interactive transaction client so the
 * event commits atomically with the business data.
 */
export async function enqueueOutbox(
  tx: OutboxTx,
  opts: {
    storeId: string;
    kind: string;
    payload: Record<string, unknown>;
    /** Delay before first delivery attempt (backoff scheduling). */
    availableAt?: Date;
    maxAttempts?: number;
  }
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      storeId: opts.storeId,
      kind: opts.kind,
      payload: JSON.stringify(opts.payload),
      availableAt: opts.availableAt,
      maxAttempts: opts.maxAttempts,
    },
  });
}

/** Backoff schedule in minutes for attempt N (1-based). */
function backoffMinutes(attempt: number): number {
  // 1 → 1min, 2 → 2min, 3 → 4min, 4 → 8min … capped at 60.
  return Math.min(2 ** (attempt - 1), 60);
}

/** Batch size per pump invocation — keeps lambda duration bounded. */
const BATCH = 25;

/**
 * Deliver due outbox events. Concurrency-safe: claiming uses a guarded
 * `updateMany` status flip (PENDING+due → PROCESSING) so two concurrent
 * pumps never double-process an event.
 */
export async function pumpOutbox(): Promise<{
  processed: number;
  dead: number;
  failed: number;
}> {
  const now = new Date();
  const due = await db.outboxEvent.findMany({
    where: { status: 'PENDING', availableAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  let processed = 0;
  let failed = 0;
  let dead = 0;

  for (const event of due) {
    // Claim: atomic compare-and-set on status. count===0 ⇒ another pump won.
    const claimed = await db.outboxEvent.updateMany({
      where: { id: event.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count === 0) continue;

    try {
      const handler = handlers[event.kind];
      if (!handler) throw new Error(`No outbox handler registered for kind ${event.kind}`);
      const payload = JSON.parse(event.payload || '{}') as Record<string, unknown>;
      await handler({ id: event.id, storeId: event.storeId, kind: event.kind, payload });
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'COMPLETED', processedAt: new Date(), lastError: null },
      });
      processed++;
    } catch (err) {
      const attempts = event.attempts + 1;
      const exhausted = attempts >= event.maxAttempts;
      const message = err instanceof Error ? err.message : String(err);
      await db.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: exhausted ? 'DEAD' : 'PENDING',
          attempts,
          lastError: message.slice(0, 500),
          availableAt: new Date(Date.now() + backoffMinutes(attempts) * 60_000),
        },
      });
      if (exhausted) dead++;
      else failed++;
      await systemLog({
        action: 'OUTBOX_EVENT_FAILED',
        component: LogComponent.SYSTEM,
        severity: exhausted ? LogSeverity.ERROR : LogSeverity.WARN,
        message: `Outbox ${event.kind} attempt ${attempts}/${event.maxAttempts} failed: ${message.slice(0, 200)}`,
        storeId: event.storeId,
        metadata: { outboxId: event.id, kind: event.kind, dead: exhausted },
      }).catch(() => {});
    }
  }

  return { processed, failed, dead };
}
