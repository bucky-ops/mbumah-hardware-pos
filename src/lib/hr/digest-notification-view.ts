// MBUMAH HARDWARE POS - digest notification view mapper (v2.27.0)
//
// Pure view mapping for the notification-center copies of HR report digests
// (rows written by report-schedule-service.writeDigestNotification). The
// Notification.metadata JSON string carries the schedule linkage and the
// delivery outcome; the /api/notifications route flattens those fields into
// the feed row so the client can render:
//   • a SENT/FAILED delivery chip (was the email actually delivered?)
//   • a "manual" marker (send-now vs the scheduled sweep)
//   • a "Manage schedule" deep link straight to the Schedules tab
//
// PURE module — no db, no server-only imports; unit-tested directly.

export interface DigestNotificationExtras {
  /** The schedule that produced this digest copy (when present). */
  scheduleId?: string;
  /** True when the copy came from a manual "Send now" (not the sweep). */
  manual?: boolean;
  /** Delivery outcome stamped by the email service (SENT / FAILED only). */
  emailStatus?: 'SENT' | 'FAILED';
}

/**
 * Parse the DigestNotificationExtras out of a Notification.metadata string.
 * Fail-soft by contract (the in-app copy must never break the feed): any
 * malformed payload degrades to an empty extras object, and fields with an
 * unexpected shape are dropped rather than coerced.
 */
export function parseDigestNotificationExtras(raw: unknown): DigestNotificationExtras {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const meta = parsed as Record<string, unknown>;

  const extras: DigestNotificationExtras = {};

  if (typeof meta.scheduleId === 'string' && meta.scheduleId.trim().length > 0) {
    extras.scheduleId = meta.scheduleId;
  }
  if (meta.manual === true) {
    extras.manual = true;
  }
  if (meta.emailStatus === 'SENT' || meta.emailStatus === 'FAILED') {
    extras.emailStatus = meta.emailStatus;
  }

  return extras;
}

/**
 * v2.28.0: notification-center "Email failed" filter predicate — true for
 * HR digest copies whose email delivery FAILED. Pure and fail-soft: any
 * non-row input (or a digest without a FAILED stamp) is simply not matched,
 * so the filter can never crash the feed, only narrow it.
 */
export function isFailedEmailDigest(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  return row.type === 'hr_digest' && row.emailStatus === 'FAILED';
}

/**
 * v2.57.0: notification-center "Retry delivery" affordance predicate — true
 * for HR digest copies whose email FAILED **and** which still name the
 * schedule that produced them (the retry endpoint is schedule-scoped:
 * POST /api/hr/reports/schedules/[id]/resend re-derives the missed set
 * server-side, so a row without a scheduleId cannot offer the action).
 *
 * Pure and fail-soft like every feed predicate: any non-row input, a
 * non-hr_digest row, a SENT copy, or a schedule-less failure is simply not
 * retryable — the predicate can never crash the feed, only narrow the rows
 * that show the amber affordance. Scope guard: payroll digest rows
 * (payroll_approved / payroll_posted / payroll_disbursed) deliberately do
 * NOT qualify — their delivery story lives on the Pay Runs desk, and this
 * endpoint re-computes HR report digests only.
 */
export function isRetryableDigestFailure(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  if (row.type !== 'hr_digest' || row.emailStatus !== 'FAILED') return false;
  return typeof row.scheduleId === 'string' && row.scheduleId.trim().length > 0;
}
