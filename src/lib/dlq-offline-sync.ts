// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — DLQ Offline Sync (Auto-Retry Processor + Handler Registry)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 6 — Error Handling & Resilience Framework
//
// This module provides:
//   1. Convenience enqueue helpers (enqueueFailedSms, enqueueFailedEmail, etc.)
//   2. Auto-processor management (startDLQProcessor, stopDLQProcessor)
//   3. Handler registration for the auto-processor
//   4. `withOfflineSync()` HOF for wrapping external service calls
//
// ── IMPORTANT: No circular imports ────────────────────────────────────────────
//
// This module does NOT import from notification-helpers.ts (which imports this
// module). Handler registration is done LAZILY — the DLQ service accepts handler
// functions, and the actual notification service calls are injected at runtime
// by `registerDLQHandlers()` which is called from the processor start or the
// demo endpoint. This breaks the circular dependency chain.
//
// ─────────────────────────────────────────────────────────────────────────────

import { dlq, DLQOperationType } from './dead-letter-queue';
import { CircuitOpenError } from './circuit-breaker';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

// ── Handler registration ─────────────────────────────────────────────────────

/** Whether handlers have been registered (idempotent guard). */
let handlersRegistered = false;

/**
 * Register all DLQ handlers for the known operation types.
 *
 * IMPORTANT: This function lazy-imports notification-helpers.ts to break
 * the circular dependency (notification-helpers → dlq-offline-sync →
*  notification-helpers). It's safe to call multiple times (idempotent).
 */
export async function registerDLQHandlers(): Promise<void> {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Lazy import to break circular dependency
  const { notificationService } = await import('./notification-helpers');

  // ── SEND_SMS handler ───────────────────────────────────────────────────
  dlq.registerHandler(DLQOperationType.SEND_SMS, async (payload) => {
    try {
      const { to, message } = JSON.parse(payload) as { to: string; message: string };
      const result = await notificationService.sendSms(to, message);
      return { success: result.success, error: result.errorMessage };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── SEND_EMAIL handler ─────────────────────────────────────────────────
  dlq.registerHandler(DLQOperationType.SEND_EMAIL, async (payload) => {
    try {
      const { to, subject, html } = JSON.parse(payload) as {
        to: string;
        subject: string;
        html: string;
      };
      const result = await notificationService.sendEmail(to, subject, html);
      return { success: result.success, error: result.errorMessage };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── SEND_WHATSAPP handler ──────────────────────────────────────────────
  dlq.registerHandler(DLQOperationType.SEND_WHATSAPP, async (payload) => {
    try {
      const { to, message } = JSON.parse(payload) as { to: string; message: string };
      const result = await notificationService.sendWhatsApp(to, message);
      return { success: result.success, error: result.errorMessage };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── MPESA_STK_PUSH handler ─────────────────────────────────────────────
  // M-Pesa STK pushes can't be trivially retried from the DLQ because:
  //   1. The CheckoutRequestID is per-request (each STK push generates a new one)
  //   2. The OAuth token may have expired
  //   3. The original transaction may have been resolved by callback already
  //
  // Instead, we mark the item as needing manual intervention. The admin
  // dashboard will show these items with a "retry" button that re-initiates
  // the STK push with fresh credentials.
  dlq.registerHandler(DLQOperationType.MPESA_STK_PUSH, async (_payload) => {
    return {
      success: false,
      error: 'M-Pesa STK Push requires manual retry (fresh OAuth token + callback state).',
    };
  });

  // ── WEBHOOK_DELIVERY handler (generic) ─────────────────────────────────
  dlq.registerHandler(DLQOperationType.WEBHOOK_DELIVERY, async (payload) => {
    try {
      const { url, method, headers, body } = JSON.parse(payload) as {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(url, {
          method: method ?? 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
          body: body ?? '',
          signal: controller.signal,
        });

        if (res.ok) {
          return { success: true };
        }
        return {
          success: false,
          error: `Webhook delivery failed: HTTP ${res.status} ${res.statusText}`,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── GENERIC handler ────────────────────────────────────────────────────
  dlq.registerHandler(DLQOperationType.GENERIC, async (_payload, item) => {
    return {
      success: false,
      error: `Generic operation "${item.operationType}" requires manual retry.`,
    };
  });

  void systemLog({
    action: 'DLQ_HANDLERS_REGISTERED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: 'DLQ handlers registered for: SEND_SMS, SEND_EMAIL, SEND_WHATSAPP, MPESA_STK_PUSH, WEBHOOK_DELIVERY, GENERIC.',
  }).catch(() => {});
}

// ── Auto-processor ───────────────────────────────────────────────────────────

/** Handle for the processor interval timer. */
let processorTimer: ReturnType<typeof setInterval> | null = null;

/** Default interval between processor cycles (in ms). */
const DEFAULT_PROCESSOR_INTERVAL_MS = 60_000; // 1 minute

/**
 * Start the DLQ auto-processor. It periodically calls `dlq.process()` to
 * retry enqueued items whose `nextRetryAt` has passed and whose target
 * service's circuit breaker is not OPEN.
 *
 * @param intervalMs - How often to run the processor. Default: 60s.
 * @returns A stop function that clears the interval.
 */
export function startDLQProcessor(
  intervalMs: number = DEFAULT_PROCESSOR_INTERVAL_MS,
): () => void {
  if (processorTimer) {
    // Already running — no-op (idempotent).
    return () => stopDLQProcessor();
  }

  // Register handlers asynchronously (lazy import)
  void registerDLQHandlers();

  void systemLog({
    action: 'DLQ_PROCESSOR_START',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `DLQ auto-processor started (interval: ${intervalMs}ms).`,
    metadata: { intervalMs },
  }).catch(() => {});

  processorTimer = setInterval(async () => {
    try {
      await dlq.process();
    } catch (err) {
      // The processor itself should never throw (errors are caught inside
      // process()), but guard against unexpected failures.
      console.error('[DLQ Processor] Unexpected error:', err);
    }
  }, intervalMs);

  // Don't prevent the process from exiting if only the timer is running.
  if (processorTimer && typeof processorTimer === 'object' && 'unref' in processorTimer) {
    processorTimer.unref();
  }

  return () => stopDLQProcessor();
}

/**
 * Stop the DLQ auto-processor.
 */
export function stopDLQProcessor(): void {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;

    void systemLog({
      action: 'DLQ_PROCESSOR_STOP',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message: 'DLQ auto-processor stopped.',
    }).catch(() => {});
  }
}

/**
 * Check if the DLQ processor is currently running.
 */
export function isDLQProcessorRunning(): boolean {
  return processorTimer !== null;
}

// ── withOfflineSync HOF ──────────────────────────────────────────────────────

/**
 * Options for the `withOfflineSync` wrapper.
 */
export interface OfflineSyncOptions {
  /** Operation type (e.g. 'SEND_SMS'). */
  operationType: string;

  /** Target service (maps to circuit breaker name). */
  targetService: string;

  /** Store ID for multi-tenant scoping. */
  storeId?: string;

  /** The serialised payload to enqueue if the operation fails. */
  payload: string;

  /** Max DLQ retries. Default: 5. */
  maxRetries?: number;

  /** Priority (0 = highest). Default: 0. */
  priority?: number;

  /** Link to the original entity. */
  sourceEntityId?: string;

  /** Type of the original entity. */
  sourceEntityType?: string;

  /** Additional metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Wrap an async function with offline sync support. If the function fails
 * (throws), the operation is automatically enqueued to the DLQ for later
 * retry.
 */
export async function withOfflineSync<T>(
  fn: () => Promise<T>,
  options: OfflineSyncOptions,
): Promise<{ delivered: true; result: T } | { delivered: false; dlqItemId: string }> {
  try {
    const result = await fn();
    return { delivered: true, result };
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      const dlqItemId = await dlq.enqueue({
        ...options,
        error: err,
        metadata: {
          ...options.metadata,
          circuitOpen: true,
          msUntilHalfOpen: err.metrics.msUntilHalfOpen,
        },
      });
      return { delivered: false, dlqItemId };
    }

    const dlqItemId = await dlq.enqueue({
      ...options,
      error: err,
    });
    return { delivered: false, dlqItemId };
  }
}

// ── Convenience: enqueue helpers for common operation types ───────────────────

/**
 * Enqueue a failed SMS send for later retry.
 */
export async function enqueueFailedSms(
  to: string,
  message: string,
  options: { storeId?: string; error?: unknown; sourceEntityId?: string; sourceEntityType?: string } = {},
): Promise<string> {
  return dlq.enqueue({
    operationType: DLQOperationType.SEND_SMS,
    targetService: 'twilio-sms',
    storeId: options.storeId,
    payload: JSON.stringify({ to, message }),
    priority: 10,
    error: options.error,
    sourceEntityId: options.sourceEntityId,
    sourceEntityType: options.sourceEntityType,
  });
}

/**
 * Enqueue a failed email send for later retry.
 */
export async function enqueueFailedEmail(
  to: string,
  subject: string,
  html: string,
  options: { storeId?: string; error?: unknown; sourceEntityId?: string; sourceEntityType?: string } = {},
): Promise<string> {
  return dlq.enqueue({
    operationType: DLQOperationType.SEND_EMAIL,
    targetService: 'resend-email',
    storeId: options.storeId,
    payload: JSON.stringify({ to, subject, html }),
    priority: 10,
    error: options.error,
    sourceEntityId: options.sourceEntityId,
    sourceEntityType: options.sourceEntityType,
  });
}

/**
 * Enqueue a failed WhatsApp send for later retry.
 */
export async function enqueueFailedWhatsApp(
  to: string,
  message: string,
  options: { storeId?: string; error?: unknown; sourceEntityId?: string; sourceEntityType?: string } = {},
): Promise<string> {
  return dlq.enqueue({
    operationType: DLQOperationType.SEND_WHATSAPP,
    targetService: 'twilio-whatsapp',
    storeId: options.storeId,
    payload: JSON.stringify({ to, message }),
    priority: 10,
    error: options.error,
    sourceEntityId: options.sourceEntityId,
    sourceEntityType: options.sourceEntityType,
  });
}

/**
 * Enqueue a failed M-Pesa STK push for later retry.
 */
export async function enqueueFailedMpesaStkPush(
  phone: string,
  amount: number,
  accountReference: string,
  transactionDesc: string,
  options: { storeId?: string; error?: unknown; sourceEntityId?: string; sourceEntityType?: string } = {},
): Promise<string> {
  return dlq.enqueue({
    operationType: DLQOperationType.MPESA_STK_PUSH,
    targetService: 'mpesa-daraja',
    storeId: options.storeId,
    payload: JSON.stringify({ phone, amount, accountReference, transactionDesc }),
    priority: 0,
    error: options.error,
    sourceEntityId: options.sourceEntityId,
    sourceEntityType: options.sourceEntityType,
  });
}
