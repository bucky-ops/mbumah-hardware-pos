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
