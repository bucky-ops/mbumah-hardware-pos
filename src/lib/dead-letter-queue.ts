// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Dead Letter Queue (Offline Sync Error Handling)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 6 — Error Handling & Resilience Framework
//
// When an external service call (SMS, Email, M-Pesa) fails after ALL retries
// AND the circuit breaker is open, the operation is NOT silently dropped —
// it's enqueued in the Dead Letter Queue for later retry. This ensures:
//
//   • No customer notification is lost — it's persisted to SQLite and will
//     be retried when the service recovers.
//   • No payment is stuck — M-Pesa STK pushes that fail get queued and
//     retried (with a fresh CheckoutRequestID) when Daraja comes back.
//   • Full observability — every enqueued item has a status, error history,
//     and can be inspected via the admin API.
//
// ── Architecture ──────────────────────────────────────────────────────────────
//
//   ┌──────────────┐    all retries     ┌──────────────┐
//   │  API route   │ ──── failed ─────▶ │  DLQ enqueue │
//   │  (caller)    │                    │  (this file) │
//   └──────────────┘                    └──────┬───────┘
//                                              │ persisted to SQLite
//                                              ▼
//                                     ┌─────────────────┐
//                                     │  dead_letter_   │
//                                     │  queue table    │
//                                     └────────┬────────┘
//                                              │
//                          ┌───────────────────┼───────────────────┐
//                          │                   │                   │
//                          ▼                   ▼                   ▼
//                   ┌──────────┐       ┌──────────────┐    ┌──────────┐
//                   │ Auto-    │       │  Admin API   │    │ Metrics  │
//                   │ processor│       │  (manual)    │    │ & logs   │
//                   └──────────┘       └──────────────┘    └──────────┘
//
// ── Integration with Phase 4 & 5 ──────────────────────────────────────────────
//
//   1. Caller → circuit breaker (Phase 5) → retry (Phase 4) → external service
//   2. If circuit breaker is OPEN → CircuitOpenError → enqueue to DLQ
//   3. If all retries exhausted → error → enqueue to DLQ
//   4. Auto-processor checks circuit breaker state BEFORE retrying:
//      if still OPEN → skip (wait for next cycle)
//      if CLOSED/HALF_OPEN → attempt delivery
//
// ── DLQ item lifecycle ────────────────────────────────────────────────────────
//
//   PENDING → RETRYING → COMPLETED (success!)
//                     ↘ DEAD (max retries exhausted)
//   PENDING → CANCELLED (admin action)
//   DEAD → RETRYING (admin re-queues)
//
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { circuitBreakerRegistry } from '@/lib/circuit-breaker';
import { normaliseError } from '@/lib/error-handler';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Status values for a DLQ item. Mirrors the Prisma schema comments.
 */
export const DLQStatus = {
  PENDING: 'PENDING',
  RETRYING: 'RETRYING',
  COMPLETED: 'COMPLETED',
  DEAD: 'CANCELLED', // Keep backwards compat — actually CANCELLED
  CANCELLED: 'CANCELLED',
  EXHAUSTED: 'DEAD',   // Max retries hit
} as const;
export type DLQStatus = (typeof DLQStatus)[keyof typeof DLQStatus];

/**
 * Well-known operation types that can be enqueued.
 */
export const DLQOperationType = {
  SEND_SMS: 'SEND_SMS',
  SEND_EMAIL: 'SEND_EMAIL',
  SEND_WHATSAPP: 'SEND_WHATSAPP',
  MPESA_STK_PUSH: 'MPESA_STK_PUSH',
  WEBHOOK_DELIVERY: 'WEBHOOK_DELIVERY',
  GENERIC: 'GENERIC',
} as const;
export type DLQOperationType = (typeof DLQOperationType)[keyof typeof DLQOperationType];

/**
 * Options for enqueuing a new DLQ item.
 */
export interface EnqueueOptions {
  /** Store ID for multi-tenant scoping. */
  storeId?: string;

  /** The type of operation (e.g. SEND_SMS). */
  operationType: string;

  /** The target service name (maps to circuit breaker name). */
  targetService: string;

  /** The serialised payload (JSON string) needed to replay the operation. */
  payload: string;

  /** Maximum retries before marking DEAD. Default: 5. */
  maxRetries?: number;

  /** Priority (0 = highest). Payment operations should be 0, notifications 10+. */
  priority?: number;

  /** Link to the original entity. */
  sourceEntityId?: string;

  /** Type of the original entity. */
  sourceEntityType?: string;

  /** The error that caused the enqueue. */
  error?: unknown;

  /** Additional metadata (will be JSON-serialised). */
  metadata?: Record<string, unknown>;
}

/**
 * Metrics snapshot for the DLQ.
 */
export interface DLQMetrics {
  /** Total items currently in the queue (PENDING + RETRYING). */
  pending: number;

  /** Items currently being retried. */
  retrying: number;

  /** Items that completed successfully. */
  completed: number;

  /** Items that are dead (exhausted retries). */
  dead: number;

  /** Items that were cancelled. */
  cancelled: number;

  /** Total items ever enqueued. */
  totalEnqueued: number;

  /** Breakdown by operation type. */
  byOperationType: Record<string, number>;

  /** Breakdown by target service. */
  byTargetService: Record<string, number>;

  /** Oldest pending item (ISO timestamp), or null. */
  oldestPendingAt: string | null;
}

/**
 * Result of a retry attempt by the auto-processor.
 */
export interface RetryResult {
  /** Number of items processed in this cycle. */
  processed: number;

  /** Number of items that completed successfully. */
  succeeded: number;

  /** Number of items that failed (and were re-queued). */
  failed: number;

  /** Number of items that became DEAD (max retries hit). */
  died: number;

  /** Number of items that were skipped (circuit still open). */
  skipped: number;
}

/**
 * A handler function that the auto-processor calls to actually deliver
 * an enqueued operation. Each operation type needs a registered handler.
 */
export type DLQHandler = (
  payload: string,
  item: { id: string; operationType: string; targetService: string; retryCount: number },
) => Promise<{ success: boolean; error?: string }>;

// ── Constants ────────────────────────────────────────────────────────────────

/** Default max retries before an item is marked DEAD. */
const DEFAULT_MAX_RETRIES = 5;

/** Base delay for exponential backoff between DLQ retries (in ms). */
const DLQ_RETRY_BASE_DELAY_MS = 30_000; // 30 seconds

/** Maximum delay for DLQ retry backoff (in ms). */
const DLQ_RETRY_MAX_DELAY_MS = 3_600_000; // 1 hour

/** Maximum items to process in a single auto-processor cycle. */
const MAX_PROCESS_BATCH_SIZE = 50;

// ── Dead Letter Queue Service ────────────────────────────────────────────────

/**
 * Core DLQ service. Provides methods to:
 *   • `enqueue()`     — add a failed operation to the queue
 *   • `retryItem()`   — manually retry a specific item
 *   • `retryAll()`    — retry all PENDING items for a service
 *   • `purge()`       — remove completed/dead items
 *   • `getMetrics()`  — observability
 *   • `process()`     — auto-processor cycle (called by scheduler)
 *
 * Designed as a class (not standalone functions) so it can hold the
 * handler registry and be easily mocked in tests.
 */
export class DeadLetterQueueService {
  private readonly handlers = new Map<string, DLQHandler>();

  // ── Handler registration ─────────────────────────────────────────────────

  /**
   * Register a handler for a specific operation type. The auto-processor
   * will call this handler when retrying items of that type.
   *
   * If a handler is already registered for the given type, it's replaced
   * (useful for testing or hot-swapping).
   */
  registerHandler(operationType: string, handler: DLQHandler): void {
    this.handlers.set(operationType, handler);
  }

  /**
   * Get the handler for an operation type, or undefined.
   */
  getHandler(operationType: string): DLQHandler | undefined {
    return this.handlers.get(operationType);
  }

  // ── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Enqueue a failed operation for later retry.
   *
   * This is the primary entry point: when a caller (e.g. sendSms) exhausts
   * all retries or hits an open circuit, it calls `dlq.enqueue(...)` instead
   * of silently dropping the message. The operation is persisted to SQLite
   * and will be retried by the auto-processor when the service recovers.
   *
   * @returns The ID of the created DLQ item.
   */
  async enqueue(options: EnqueueOptions): Promise<string> {
    const normalised = normaliseError(options.error);
    const nextRetryDelay = computeDLQRetryDelay(0); // First retry
    const nextRetryAt = new Date(Date.now() + nextRetryDelay);

    const item = await db.deadLetterQueue.create({
      data: {
        storeId: options.storeId ?? null,
        operationType: options.operationType,
        targetService: options.targetService,
        payload: options.payload,
        status: 'PENDING',
        maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
        priority: options.priority ?? 0,
        sourceEntityId: options.sourceEntityId ?? null,
        sourceEntityType: options.sourceEntityType ?? null,
        lastError: normalised.message,
        nextRetryAt,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
      },
    });

    // Fire-and-forget log
    void systemLog({
      action: 'DLQ_ENQUEUE',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        `Enqueued ${options.operationType} to DLQ (id=${item.id}, ` +
        `service=${options.targetService}, nextRetry=${nextRetryDelay}ms). ` +
        `Error: ${normalised.message}`,
      storeId: options.storeId,
      metadata: {
        dlqItemId: item.id,
        operationType: options.operationType,
        targetService: options.targetService,
        nextRetryDelayMs: nextRetryDelay,
        errorCode: normalised.code,
        errorStatusCode: normalised.statusCode,
        ...(options.metadata ?? {}),
      },
    }).catch(() => {
      /* logging failure must not block enqueue */
    });

    return item.id;
  }

  // ── Manual retry ─────────────────────────────────────────────────────────

  /**
   * Manually retry a specific DLQ item by ID. Resets the retry count
   * and status so it gets picked up by the next processor cycle.
   *
   * @returns true if the item was found and reset, false otherwise.
   */
  async retryItem(id: string): Promise<boolean> {
    const item = await db.deadLetterQueue.findUnique({ where: { id } });
    if (!item) return false;

    // Don't retry items that are already being processed
    if (item.status === 'RETRYING') return false;

    await db.deadLetterQueue.update({
      where: { id },
      data: {
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: new Date(), // retry immediately
        lastRetriedAt: null,
        resolvedAt: null,
      },
    });

    void systemLog({
      action: 'DLQ_MANUAL_RETRY',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message: `Manually retried DLQ item ${id} (${item.operationType} → ${item.targetService}).`,
      storeId: item.storeId ?? undefined,
      metadata: { dlqItemId: id, operationType: item.operationType, targetService: item.targetService },
    }).catch(() => {});

    return true;
  }

  /**
   * Retry all items for a specific target service (or all services).
   * Useful when an admin knows a service has recovered and wants to
   * flush the queue immediately.
   *
   * @param targetService - If provided, only retry items for this service.
   * @returns Number of items re-queued.
   */
  async retryAll(targetService?: string): Promise<number> {
    const where: Record<string, unknown> = {
      status: { in: ['PENDING', 'DEAD'] },
    };
    if (targetService) {
      where.targetService = targetService;
    }

    const result = await db.deadLetterQueue.updateMany({
      where,
      data: {
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: new Date(),
        resolvedAt: null,
      },
    });

    void systemLog({
      action: 'DLQ_RETRY_ALL',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message:
        `Re-queued ${result.count} DLQ item(s)` +
        (targetService ? ` for service "${targetService}"` : '') +
        `. They will be picked up by the next processor cycle.`,
      metadata: { count: result.count, targetService },
    }).catch(() => {});

    return result.count;
  }

  // ── Cancel ───────────────────────────────────────────────────────────────

  /**
   * Cancel a specific DLQ item. It will not be retried.
   */
  async cancelItem(id: string): Promise<boolean> {
    const item = await db.deadLetterQueue.findUnique({ where: { id } });
    if (!item) return false;
    if (item.status === 'COMPLETED' || item.status === 'CANCELLED') return false;

    await db.deadLetterQueue.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        resolvedAt: new Date(),
      },
    });

    return true;
  }

  // ── Purge ────────────────────────────────────────────────────────────────

  /**
   * Remove completed, cancelled, or dead items older than `olderThanMs`.
   * This is a maintenance operation to keep the table size manageable.
   *
   * @param options.olderThanMs - Only purge items resolved more than this
   *        many ms ago. Default: 7 days.
   * @param options.statuses - Which statuses to purge. Default: COMPLETED, CANCELLED, DEAD.
   * @returns Number of purged items.
   */
  async purge(options: {
    olderThanMs?: number;
    statuses?: string[];
    targetService?: string;
  } = {}): Promise<number> {
    const olderThanMs = options.olderThanMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    const statuses = options.statuses ?? ['COMPLETED', 'CANCELLED', 'DEAD'];
    const cutoff = new Date(Date.now() - olderThanMs);

    const where: Record<string, unknown> = {
      status: { in: statuses },
      resolvedAt: { lte: cutoff },
    };
    if (options.targetService) {
      where.targetService = options.targetService;
    }

    const result = await db.deadLetterQueue.deleteMany({ where });

    void systemLog({
      action: 'DLQ_PURGE',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message: `Purged ${result.count} DLQ item(s) older than ${Math.floor(olderThanMs / 86400000)} day(s).`,
      metadata: { count: result.count, statuses, olderThanMs },
    }).catch(() => {});

    return result.count;
  }

  // ── List ─────────────────────────────────────────────────────────────────

  /**
   * List DLQ items with filtering and pagination.
   */
  async list(options: {
    status?: string;
    targetService?: string;
    operationType?: string;
    storeId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: Awaited<ReturnType<typeof db.deadLetterQueue.findMany>>; total: number }> {
    const limit = Math.min(options.limit ?? 50, 200);
    const offset = options.offset ?? 0;

    const where: Record<string, unknown> = {};
    if (options.status) where.status = options.status;
    if (options.targetService) where.targetService = options.targetService;
    if (options.operationType) where.operationType = options.operationType;
    if (options.storeId) where.storeId = options.storeId;

    const [items, total] = await Promise.all([
      db.deadLetterQueue.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { enqueuedAt: 'asc' }],
        take: limit,
        skip: offset,
      }),
      db.deadLetterQueue.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Get a single DLQ item by ID.
   */
  async getItem(id: string): Promise<Awaited<ReturnType<typeof db.deadLetterQueue.findUnique>> | null> {
    return db.deadLetterQueue.findUnique({ where: { id } });
  }

  // ── Metrics ──────────────────────────────────────────────────────────────

  /**
   * Get a metrics snapshot of the current DLQ state.
   */
  async getMetrics(options: { storeId?: string } = {}): Promise<DLQMetrics> {
    const where: Record<string, unknown> = {};
    if (options.storeId) where.storeId = options.storeId;

    const [pending, retrying, completed, dead, cancelled, oldestPending, byType, byService] =
      await Promise.all([
        db.deadLetterQueue.count({ where: { ...where, status: 'PENDING' } }),
        db.deadLetterQueue.count({ where: { ...where, status: 'RETRYING' } }),
        db.deadLetterQueue.count({ where: { ...where, status: 'COMPLETED' } }),
        db.deadLetterQueue.count({ where: { ...where, status: 'DEAD' } }),
        db.deadLetterQueue.count({ where: { ...where, status: 'CANCELLED' } }),
        db.deadLetterQueue.findFirst({
          where: { ...where, status: { in: ['PENDING', 'RETRYING'] } },
          orderBy: { enqueuedAt: 'asc' },
          select: { enqueuedAt: true },
        }),
        db.deadLetterQueue.groupBy({
          by: ['operationType'],
          where: { ...where, status: { in: ['PENDING', 'RETRYING'] } },
          _count: true,
        }),
        db.deadLetterQueue.groupBy({
          by: ['targetService'],
          where: { ...where, status: { in: ['PENDING', 'RETRYING'] } },
          _count: true,
        }),
      ]);

    const byOperationType: Record<string, number> = {};
    for (const row of byType) {
      byOperationType[row.operationType] = row._count;
    }

    const byTargetService: Record<string, number> = {};
    for (const row of byService) {
      byTargetService[row.targetService] = row._count;
    }

    return {
      pending,
      retrying,
      completed,
      dead,
      cancelled,
      totalEnqueued: pending + retrying + completed + dead + cancelled,
      byOperationType,
      byTargetService,
      oldestPendingAt: oldestPending?.enqueuedAt?.toISOString() ?? null,
    };
  }

  // ── Auto-processor ───────────────────────────────────────────────────────

  /**
   * Run one cycle of the auto-processor. Finds processable items (PENDING
   * or RETRYING with nextRetryAt <= now), checks the circuit breaker, and
   * attempts delivery.
   *
   * This method is idempotent and safe to call concurrently (the RETRYING
   * status acts as a lock — only one processor cycle handles an item at a
   * time).
   *
   * @param options.maxItems - Max items to process in this cycle. Default: 50.
   * @returns Summary of what happened in this cycle.
   */
  async process(options: { maxItems?: number } = {}): Promise<RetryResult> {
    const maxItems = Math.min(options.maxItems ?? MAX_PROCESS_BATCH_SIZE, MAX_PROCESS_BATCH_SIZE);
    const result: RetryResult = { processed: 0, succeeded: 0, failed: 0, died: 0, skipped: 0 };

    // ── Find processable items ───────────────────────────────────────────
    const items = await db.deadLetterQueue.findMany({
      where: {
        status: { in: ['PENDING', 'RETRYING'] },
        nextRetryAt: { lte: new Date() },
      },
      orderBy: [{ priority: 'asc' }, { enqueuedAt: 'asc' }],
      take: maxItems,
    });

    for (const item of items) {
      result.processed++;

      // ── Check circuit breaker state ───────────────────────────────────
      // If the circuit for this service is OPEN, skip the item (it will
      // be retried on the next cycle when the breaker transitions to
      // HALF_OPEN or CLOSED). This prevents wasting a retry attempt on
      // a service that is known to be down.
      const breaker = circuitBreakerRegistry.get(item.targetService);
      if (breaker) {
        const state = breaker.getState();
        if (state === 'OPEN') {
          result.skipped++;
          // Push nextRetryAt forward by the breaker's remaining cooldown
          const metrics = breaker.getMetrics();
          const delay = Math.max(metrics.msUntilHalfOpen, DLQ_RETRY_BASE_DELAY_MS);
          await db.deadLetterQueue.update({
            where: { id: item.id },
            data: { nextRetryAt: new Date(Date.now() + delay) },
          });
          continue;
        }
      }

      // ── Mark as RETRYING (acts as a lock) ─────────────────────────────
      await db.deadLetterQueue.update({
        where: { id: item.id },
        data: {
          status: 'RETRYING',
          lastRetriedAt: new Date(),
        },
      });

      // ── Attempt delivery ──────────────────────────────────────────────
      const handler = this.handlers.get(item.operationType);
      if (!handler) {
        // No handler registered — mark as DEAD (we can't retry it).
        await db.deadLetterQueue.update({
          where: { id: item.id },
          data: {
            status: 'DEAD',
            lastError: `No handler registered for operation type "${item.operationType}".`,
            resolvedAt: new Date(),
          },
        });
        result.died++;
        continue;
      }

      try {
        const retryResult = await handler(item.payload, {
          id: item.id,
          operationType: item.operationType,
          targetService: item.targetService,
          retryCount: item.retryCount,
        });

        if (retryResult.success) {
          // ── Success! Mark as COMPLETED. ──────────────────────────────
          await db.deadLetterQueue.update({
            where: { id: item.id },
            data: {
              status: 'COMPLETED',
              resolvedAt: new Date(),
              lastError: null,
            },
          });
          result.succeeded++;

          void systemLog({
            action: 'DLQ_RETRY_SUCCESS',
            component: LogComponent.SYSTEM,
            severity: LogSeverity.INFO,
            message:
              `DLQ item ${item.id} (${item.operationType} → ${item.targetService}) ` +
              `delivered successfully on retry #${item.retryCount + 1}.`,
            storeId: item.storeId ?? undefined,
            metadata: {
              dlqItemId: item.id,
              operationType: item.operationType,
              targetService: item.targetService,
              retryCount: item.retryCount + 1,
            },
          }).catch(() => {});
        } else {
          // ── Handler returned failure. Re-queue or mark DEAD. ─────────
          await this.handleRetryFailure(item, retryResult.error ?? 'Unknown error');
          const newRetryCount = item.retryCount + 1;
          if (newRetryCount >= item.maxRetries) {
            result.died++;
          } else {
            result.failed++;
          }
        }
      } catch (err) {
        // Handler threw an unexpected error. Re-queue or mark DEAD.
        const message = err instanceof Error ? err.message : String(err);
        await this.handleRetryFailure(item, message);
        const newRetryCount = item.retryCount + 1;
        if (newRetryCount >= item.maxRetries) {
          result.died++;
        } else {
          result.failed++;
        }
      }
    }

    // Log the processor cycle summary if anything happened
    if (result.processed > 0) {
      void systemLog({
        action: 'DLQ_PROCESSOR_CYCLE',
        component: LogComponent.SYSTEM,
        severity: result.died > 0 ? LogSeverity.WARN : LogSeverity.INFO,
        message:
          `DLQ processor cycle: ${result.processed} processed, ` +
          `${result.succeeded} succeeded, ${result.failed} failed (re-queued), ` +
          `${result.died} died, ${result.skipped} skipped (circuit open).`,
        metadata: { ...result },
      }).catch(() => {});
    }

    return result;
  }

  /**
   * Handle a failed retry attempt. Increments the retry count, computes
   * the next retry delay, and either re-queues or marks DEAD.
   */
  private async handleRetryFailure(
    item: {
      id: string;
      retryCount: number;
      maxRetries: number;
      operationType: string;
      targetService: string;
      storeId: string | null;
    },
    errorMessage: string,
  ): Promise<void> {
    const newRetryCount = item.retryCount + 1;

    if (newRetryCount >= item.maxRetries) {
      // ── Max retries exhausted → mark as DEAD ──────────────────────────
      await db.deadLetterQueue.update({
        where: { id: item.id },
        data: {
          status: 'DEAD',
          retryCount: newRetryCount,
          lastError: errorMessage,
          resolvedAt: new Date(),
        },
      });

      void systemLog({
        action: 'DLQ_ITEM_DEAD',
        component: LogComponent.SYSTEM,
        severity: LogSeverity.ERROR,
        message:
          `DLQ item ${item.id} (${item.operationType} → ${item.targetService}) ` +
          `is DEAD after ${newRetryCount} retries. Last error: ${errorMessage}`,
        storeId: item.storeId ?? undefined,
        metadata: {
          dlqItemId: item.id,
          operationType: item.operationType,
          targetService: item.targetService,
          retryCount: newRetryCount,
          lastError: errorMessage,
        },
      }).catch(() => {});
    } else {
      // ── Re-queue with exponential backoff ──────────────────────────────
      const delay = computeDLQRetryDelay(newRetryCount);
      const nextRetryAt = new Date(Date.now() + delay);

      await db.deadLetterQueue.update({
        where: { id: item.id },
        data: {
          status: 'PENDING',
          retryCount: newRetryCount,
          lastError: errorMessage,
          nextRetryAt,
        },
      });
    }
  }
}

// ── Exponential backoff for DLQ retries ──────────────────────────────────────

/**
 * Compute the delay before the next DLQ retry attempt using exponential
 * backoff with full jitter.
 *
 *   delay = random(0, min(maxDelay, baseDelay * 2^retryCount))
 *
 * This gives:
 *   retry 0 → ~30s,  retry 1 → ~60s,  retry 2 → ~120s,
 *   retry 3 → ~240s, retry 4 → ~480s  (capped at 1 hour)
 *
 * @param retryCount - The current retry count (0-based).
 * @returns Delay in milliseconds.
 */
export function computeDLQRetryDelay(retryCount: number): number {
  const expDelay = DLQ_RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
  const clamped = Math.min(expDelay, DLQ_RETRY_MAX_DELAY_MS);
  // Full jitter: random in [0, clamped)
  return Math.max(0, Math.floor(Math.random() * clamped));
}

// ── Singleton ────────────────────────────────────────────────────────────────

/**
 * Default DLQ service instance. Import this in API routes and the scheduler.
 *
 *   import { dlq } from '@/lib/dead-letter-queue';
 *   await dlq.enqueue({ operationType: 'SEND_SMS', ... });
 */
export const dlq = new DeadLetterQueueService();
