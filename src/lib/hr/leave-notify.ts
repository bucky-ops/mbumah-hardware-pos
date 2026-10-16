// src/lib/hr/leave-notify.ts
//
// Leave decision notification copy + metadata parsing (pure module - no
// 'use client', no imports, fully deterministic for unit tests).
//
// v2.31.0: when a manager APPROVEs or REJECTs a leave request, the decision
// used to be visible only on the HR Leave desk - the employee found out by
// refreshing their portal balances. This module generates the copy for the
// three delivery surfaces created by PUT /api/leaves (all best-effort, never
// blocking the decision itself):
//   1. A durable Notification row (category HR) addressed to the employee's
//      linked user - the feed section in /api/notifications reads it back as
//      type 'leave_decision'.
//   2. An email via the central email service (dev without RESEND_API_KEY
//      writes a visible FAILED row in the email log - QA-verifiable).
//   3. Metadata the notification-center row parser uses for the
//      Approved/Declined chips.
//
// CANCEL is intentionally not notified: it is a self-action by the employee,
// so a self-notification would be noise.

/** Marker written into Notification.metadata JSON - the feed query filters
 *  leave-decision rows from digest rows with a `contains` on this string. */
export const LEAVE_DECISION_METADATA_MARKER = 'leave_decision';

export type LeaveDecisionStatus = 'APPROVED' | 'REJECTED';

export interface LeaveDecisionCopyInput {
  status: LeaveDecisionStatus;
  firstName: string;
  lastName: string;
  leaveTypeName: string;
  /** ISO date strings as stored on the LeaveRequest row. */
  startDate: string;
  endDate: string;
  workingDays: number;
  rejectionReason?: string | null;
  /** Optional decider display name / email for the email footer. */
  decidedByLabel?: string | null;
}

export interface LeaveDecisionCopy {
  /** Notification.title - short, scannable in the bell feed. */
  title: string;
  /** Notification.message - the row body. */
  message: string;
  /** Notification.type - SUCCESS (approved) / WARNING (declined). */
  notifType: 'SUCCESS' | 'WARNING';
  /** Notification.priority - leave decisions are never urgent. */
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** Deterministic UTC date formatting ("2 Feb 2026") - no locale drift
 *  between the server that writes the copy and the tests that assert it. */
export function formatLeaveDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build every copy surface for one leave decision. */
export function leaveDecisionCopy(input: LeaveDecisionCopyInput): LeaveDecisionCopy {
  const {
    status,
    firstName,
    lastName,
    leaveTypeName,
    startDate,
    endDate,
    workingDays,
    rejectionReason,
    decidedByLabel,
  } = input;

  const approved = status === 'APPROVED';
  const name = `${firstName} ${lastName}`.trim();
  const range = `${formatLeaveDay(startDate)} - ${formatLeaveDay(endDate)}`;
  const days = `${workingDays} day${workingDays === 1 ? '' : 's'}`;

  const title = approved
    ? `Leave approved - ${leaveTypeName}`
    : `Leave declined - ${leaveTypeName}`;

  const reasonSuffix = !approved && rejectionReason ? ` Reason: ${rejectionReason}` : '';
  const message = approved
    ? `${name}: your ${leaveTypeName} request for ${days} (${range}) was approved.`
    : `${name}: your ${leaveTypeName} request for ${days} (${range}) was declined.${reasonSuffix}`;

  const emailSubject = approved
    ? `Leave approved - ${leaveTypeName} (${days})`
    : `Leave request declined - ${leaveTypeName}`;

  const accent = approved ? '#059669' : '#b45309';
  const accentBg = approved ? '#ecfdf5' : '#fffbeb';
  const accentBorder = approved ? '#a7f3d0' : '#fde68a';
  const heading = approved ? 'Leave request approved' : 'Leave request declined';

  const rows: Array<[string, string]> = [
    ['Employee', escapeHtml(name)],
    ['Leave type', escapeHtml(leaveTypeName)],
    ['Dates', escapeHtml(range)],
    ['Working days', escapeHtml(days)],
  ];
  if (!approved && rejectionReason) rows.push(['Reason', escapeHtml(rejectionReason)]);

  const footer = decidedByLabel ? `<p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Decided by ${escapeHtml(decidedByLabel)}.</p>` : '';

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
  <div style="background:${accentBg};padding:16px 20px;border-bottom:1px solid ${accentBorder};">
    <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${accent};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.02em;">${approved ? 'APPROVED' : 'DECLINED'}</span>
    <h2 style="margin:10px 0 0;font-size:18px;color:#111827;">${heading}</h2>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 20px;color:#6b7280;width:120px;white-space:nowrap;">${k}</td><td style="padding:8px 20px 8px 0;font-weight:600;color:#111827;">${v}</td></tr>`
      )
      .join('\n    ')}
  </table>
  <div style="padding:14px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;">
    <p style="margin:0;color:#6b7280;font-size:12px;">Open your self-service portal to review the decision and your updated leave balances.</p>
    ${footer}
  </div>
</div>`;

  const emailText = [
    `${heading} - MBUMAH HARDWARE`,
    ``,
    `Employee: ${name}`,
    `Leave type: ${leaveTypeName}`,
    `Dates: ${range}`,
    `Working days: ${days}`,
    ...(reasonSuffix ? [`Reason: ${rejectionReason}`] : []),
    ``,
    `Open your self-service portal to review the decision and your updated leave balances.`,
  ].join('\n');

  return { title, message, notifType: approved ? 'SUCCESS' : 'WARNING', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

export interface LeaveDecisionExtras {
  leaveRequestId?: string;
  status?: string;
  decidedByLabel?: string;
}

/** Fail-soft metadata parser for the notification feed (same contract as
 *  parseDigestNotificationExtras): malformed JSON simply yields no extras. */
export function parseLeaveDecisionExtras(metadata: unknown): LeaveDecisionExtras {
  if (typeof metadata !== 'string' || !metadata) return {};
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object') return {};
    const rec = parsed as Record<string, unknown>;
    const out: LeaveDecisionExtras = {};
    if (typeof rec.leaveRequestId === 'string') out.leaveRequestId = rec.leaveRequestId;
    if (typeof rec.status === 'string') out.status = rec.status;
    if (typeof rec.decidedByLabel === 'string') out.decidedByLabel = rec.decidedByLabel;
    return out;
  } catch {
    return {};
  }
}
