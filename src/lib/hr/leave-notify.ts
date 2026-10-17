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
// v2.33.0: CANCEL is now notified too - the v2.32.0 stance ("a self-action is
// noise") only covered the employee-self-cancel case. Two real gaps remained:
// when a MANAGER cancels a pending request the employee never hears about it,
// and when the employee self-cancels the approvals group still holds a slot
// on their radar until they stumble across the desk. The notifier therefore
// routes the copy in the OPPOSITE direction of who acted (see
// notifyLeaveRequestCancelled in leave-service.ts).

/** Marker written into Notification.metadata JSON - the feed query filters
 *  leave-decision rows from digest rows with a `contains` on this string. */
export const LEAVE_DECISION_METADATA_MARKER = 'leave_decision';

/** v2.43.0: marker for APPROVER-facing correction rows (the edit window's
 *  fan-out to the store's decision-capable users). The employee-facing
 *  correction row keeps 'leave_edited'; this kind addresses the approvals
 *  group whose slot on the request was silently re-based under them. */
export const LEAVE_CORRECTED_METADATA_MARKER = 'leave_corrected';

/** v2.32.0: marker for SUBMISSION rows (employee → manager direction). The
 *  feed's category-HR section pulls both markers and maps the feed type by
 *  the parsed `kind`. */
export const LEAVE_REQUEST_METADATA_MARKER = 'leave_request';

/** v2.33.0: marker for CANCEL rows (either direction - manager cancels a
 *  pending request, or the employee withdraws it). The feed maps the parsed
 *  `kind` to the 'leave_cancel' surface with violet accents. */
export const LEAVE_CANCEL_METADATA_MARKER = 'leave_cancel';

/** v2.38.0: marker for ON-BEHALF rows — the employee-facing notification
 *  written when HR files a leave request in the employee's name. The row
 *  deep-links the portal leave page so the employee can review (or
 *  withdraw, while PENDING) a request they never typed. */
export const LEAVE_ON_BEHALF_METADATA_MARKER = 'leave_on_behalf';

/** v2.40.0: marker for EDIT rows — the employee-facing notification written
 *  when HR corrects a PENDING request in place (dates, half-day, type,
 *  reason) instead of cancel + refile. The row deep-links the portal leave
 *  page so the employee can see the corrected values on their own card. */
export const LEAVE_EDITED_METADATA_MARKER = 'leave_edited';

export type LeaveNotificationKind =
  | 'leave_decision'
  | 'leave_request'
  | 'leave_cancel'
  | 'leave_on_behalf'
  | 'leave_edited'
  | 'leave_corrected'
  // v2.47.0: payroll-run approval digest rows share this feed section
  // (marker 'payroll_approved' lives in payroll/run-digest.ts).
  | 'payroll_approved'
  // v2.48.0: payroll-run posting digest rows share the same section
  // (marker 'payroll_posted' lives in payroll/run-digest.ts).
  | 'payroll_posted';

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
  /** Which direction the row came from - feed type selector. Rows written
   *  before v2.32.0 carry no kind and default to 'leave_decision'. */
  kind?: LeaveNotificationKind;
  leaveRequestId?: string;
  status?: string;
  decidedByLabel?: string;
  /** v2.33.0: who cancelled (display label) on leave_cancel rows. */
  cancelledByLabel?: string;
  /** v2.33.0: true when a manager cancelled (row addresses the employee);
   *  false/absent = employee self-withdrawal (row addresses approvers). */
  cancelledByManager?: boolean;
  /** v2.38.0: HR filer display name on leave_on_behalf rows (the employee
   *  notification for a request HR entered on their behalf). */
  enteredByName?: string;
  /** v2.40.0: HR editor display name on leave_edited rows (the employee
   *  notification for a request corrected in the edit window). */
  editedByName?: string;
  /** v2.47.0: delivery stamp on payroll_approved rows — drives the
   *  warning-vs-info severity in the feed mapping (FAILED → warning). */
  emailStatus?: string;
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
    if (
      rec.kind === 'leave_decision' ||
      rec.kind === 'leave_request' ||
      rec.kind === 'leave_cancel' ||
      rec.kind === 'leave_on_behalf' ||
      rec.kind === 'leave_edited' ||
      rec.kind === 'leave_corrected' ||
      rec.kind === 'payroll_approved' ||
      rec.kind === 'payroll_posted'
    )
      out.kind = rec.kind;
    if (typeof rec.leaveRequestId === 'string') out.leaveRequestId = rec.leaveRequestId;
    if (typeof rec.status === 'string') out.status = rec.status;
    if (typeof rec.decidedByLabel === 'string') out.decidedByLabel = rec.decidedByLabel;
    if (typeof rec.cancelledByLabel === 'string') out.cancelledByLabel = rec.cancelledByLabel;
    if (typeof rec.cancelledByManager === 'boolean') out.cancelledByManager = rec.cancelledByManager;
    if (typeof rec.enteredByName === 'string') out.enteredByName = rec.enteredByName;
    if (typeof rec.editedByName === 'string') out.editedByName = rec.editedByName;
    if (typeof rec.emailStatus === 'string') out.emailStatus = rec.emailStatus;
    return out;
  } catch {
    return {};
  }
}

export interface LeaveSubmissionCopyInput {
  firstName: string;
  lastName: string;
  leaveTypeName: string;
  /** ISO date strings as stored on the LeaveRequest row. */
  startDate: string;
  endDate: string;
  workingDays: number;
  /** Optional employee reason (the request note). */
  reason?: string | null;
  /** Optional submitter display label ("submitted by …" footer). */
  submittedByLabel?: string | null;
  /** v2.38.0: display name of the HR filer when the request was entered on
   *  behalf of the employee. Adds an "Entered by" email row and a footer
   *  note so approvers know the employee never typed this request. */
  enteredByLabel?: string | null;
}

export interface LeaveSubmissionCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** Build every copy surface for one leave REQUEST submission (the
 *  employee → manager direction added in v2.32.0). Managers get a bell row
 *  that deep-links their workspace's Payroll tab (targetTab, set by the
 *  route) and one grouped email. */
export function leaveSubmissionCopy(input: LeaveSubmissionCopyInput): LeaveSubmissionCopy {
  const { firstName, lastName, leaveTypeName, startDate, endDate, workingDays, reason, submittedByLabel, enteredByLabel } = input;

  const name = `${firstName} ${lastName}`.trim();
  const range = `${formatLeaveDay(startDate)} - ${formatLeaveDay(endDate)}`;
  const days = `${workingDays} day${workingDays === 1 ? '' : 's'}`;

  const title = `New leave request - ${name}`;
  const reasonSuffix = reason ? ` Reason: ${reason}` : '';
  const onBehalfSuffix = enteredByLabel ? ` Entered by HR (${enteredByLabel}).` : '';
  const message = `${name} requested ${leaveTypeName} for ${days} (${range}). Review it on the Leave desk.${reasonSuffix}${onBehalfSuffix}`;

  const emailSubject = `Leave request pending review - ${name} (${days} ${leaveTypeName})`;
  const accent = '#0369a1';
  const accentBg = '#f0f9ff';
  const accentBorder = '#bae6fd';

  const rows: Array<[string, string]> = [
    ['Employee', escapeHtml(name)],
    ['Leave type', escapeHtml(leaveTypeName)],
    ['Dates', escapeHtml(range)],
    ['Working days', escapeHtml(days)],
  ];
  if (reason) rows.push(['Reason', escapeHtml(reason)]);
  if (enteredByLabel) rows.push(['Entered by', `${escapeHtml(enteredByLabel)} (HR — on behalf of the employee)`]);

  const footer = enteredByLabel
    ? `<p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Entered by HR (${escapeHtml(enteredByLabel)}) on behalf of the employee — the employee has been notified.</p>`
    : submittedByLabel
      ? `<p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Submitted by ${escapeHtml(submittedByLabel)}.</p>`
      : '';

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
  <div style="background:${accentBg};padding:16px 20px;border-bottom:1px solid ${accentBorder};">
    <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${accent};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.02em;">PENDING REVIEW</span>
    <h2 style="margin:10px 0 0;font-size:18px;color:#111827;">New leave request</h2>
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
    <p style="margin:0;color:#6b7280;font-size:12px;">Open the Payroll tab - Leave desk to approve or decline this request.</p>
    ${footer}
  </div>
</div>`;

  const emailText = [
    `New leave request - MBUMAH HARDWARE`,
    ``,
    `Employee: ${name}`,
    `Leave type: ${leaveTypeName}`,
    `Dates: ${range}`,
    `Working days: ${days}`,
    ...(reason ? [`Reason: ${reason}`] : []),
    ``,
    `Open the Payroll tab - Leave desk to approve or decline this request.`,
  ].join('\n');

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

export interface LeaveCancelCopyInput {
  firstName: string;
  lastName: string;
  leaveTypeName: string;
  /** ISO date strings as stored on the LeaveRequest row. */
  startDate: string;
  endDate: string;
  workingDays: number;
  /** Who cancelled: "employee" (self-withdrawal) or a display label for a
   *  manager cancel - drives the email badge copy. */
  cancelledByManager: boolean;
  /** Optional actor display label ("cancelled by …" footer). */
  cancelledByLabel?: string | null;
}

export interface LeaveCancelCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** v2.33.0: build every copy surface for one leave CANCELLATION. One pure
 *  builder serves BOTH routing directions (see notifyLeaveRequestCancelled):
 *  the badge and footer wording adapts to who cancelled, everything else is
 *  shared. Violet accents (#7c3aed family) - the fourth leave surface color
 *  after emerald/amber (decisions) and sky (submissions). */
export function leaveCancelledCopy(input: LeaveCancelCopyInput): LeaveCancelCopy {
  const { firstName, lastName, leaveTypeName, startDate, endDate, workingDays, cancelledByManager, cancelledByLabel } =
    input;

  const name = `${firstName} ${lastName}`.trim();
  const range = `${formatLeaveDay(startDate)} - ${formatLeaveDay(endDate)}`;
  const days = `${workingDays} day${workingDays === 1 ? '' : 's'}`;

  const title = cancelledByManager
    ? `Leave request cancelled - ${leaveTypeName}`
    : `Leave request withdrawn - ${leaveTypeName}`;

  const message = cancelledByManager
    ? `${name}: your ${leaveTypeName} request for ${days} (${range}) was cancelled by a manager. The days are back in your available balance.`
    : `${name} withdrew their ${leaveTypeName} request for ${days} (${range}). The pending days are released back to their balance - no decision needed.`;

  const emailSubject = cancelledByManager
    ? `Leave request cancelled - ${name} (${days} ${leaveTypeName})`
    : `Leave request withdrawn - ${name} (${days} ${leaveTypeName})`;
  const accent = '#6d28d9';
  const accentBg = '#f5f3ff';
  const accentBorder = '#ddd6fe';
  const badge = cancelledByManager ? 'CANCELLED' : 'WITHDRAWN';
  const heading = cancelledByManager ? 'Leave request cancelled' : 'Leave request withdrawn';

  const rows: Array<[string, string]> = [
    ['Employee', escapeHtml(name)],
    ['Leave type', escapeHtml(leaveTypeName)],
    ['Dates', escapeHtml(range)],
    ['Working days', escapeHtml(days)],
  ];

  const footer = cancelledByLabel
    ? `<p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Cancelled by ${escapeHtml(cancelledByLabel)}.</p>`
    : '';

  const closing = cancelledByManager
    ? 'Open your self-service portal to review your leave balances.'
    : 'No action needed - the request no longer appears on the Leave desk.';

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
  <div style="background:${accentBg};padding:16px 20px;border-bottom:1px solid ${accentBorder};">
    <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${accent};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.02em;">${badge}</span>
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
    <p style="margin:0;color:#6b7280;font-size:12px;">${closing}</p>
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
    ``,
    closing,
  ].join('\n');

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

// ── v2.38.0: ON-BEHALF SUBMISSION (employee-facing copy) ──────────────────

export interface LeaveOnBehalfCopyInput {
  /** The EMPLOYEE's name (the person the request is FOR). */
  firstName: string;
  lastName: string;
  leaveTypeName: string;
  /** ISO date strings as stored on the LeaveRequest row. */
  startDate: string;
  endDate: string;
  workingDays: number;
  /** Display name of the HR filer ("Filed by <name>"). */
  enteredByLabel: string;
  /** Optional reason the HR filer recorded for the employee. */
  reason?: string | null;
}

export interface LeaveOnBehalfCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** Build every copy surface for the employee-facing notification written
 *  when HR files a leave request in the employee's name (v2.38.0). Violet
 *  accent language to match the "Entered by HR" chips on every surface —
 *  this is the only leave surface addressed to the employee that they did
 *  NOT originate, so the copy is explicit about who filed it and what
 *  happens next (pending review, withdrawable while PENDING). */
export function leaveOnBehalfCopy(input: LeaveOnBehalfCopyInput): LeaveOnBehalfCopy {
  const { firstName, lastName, leaveTypeName, startDate, endDate, workingDays, enteredByLabel, reason } = input;

  const name = `${firstName} ${lastName}`.trim();
  const range = `${formatLeaveDay(startDate)} - ${formatLeaveDay(endDate)}`;
  const days = `${workingDays} day${workingDays === 1 ? '' : 's'}`;

  const title = `Leave request filed for you - ${leaveTypeName}`;
  const reasonSuffix = reason ? ` Reason recorded: "${reason}".` : '';
  const message = `${enteredByLabel} filed a ${leaveTypeName} request for you (${days}, ${range}). It is now pending manager review.${reasonSuffix}`;

  const emailSubject = `Leave request filed for you - ${name} (${days} ${leaveTypeName})`;
  const accent = '#6d28d9';
  const accentBg = '#f5f3ff';
  const accentBorder = '#ddd6fe';

  const rows: Array<[string, string]> = [
    ['Leave type', escapeHtml(leaveTypeName)],
    ['Dates', escapeHtml(range)],
    ['Working days', escapeHtml(days)],
    ['Filed by', `${escapeHtml(enteredByLabel)} (HR)`],
  ];
  if (reason) rows.push(['Reason', escapeHtml(reason)]);

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
  <div style="background:${accentBg};padding:16px 20px;border-bottom:1px solid ${accentBorder};">
    <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${accent};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.02em;">ENTERED BY HR</span>
    <h2 style="margin:10px 0 0;font-size:18px;color:#111827;">Leave request filed for you</h2>
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
    <p style="margin:0;color:#6b7280;font-size:12px;">The request is pending manager review. You can withdraw it from your self-service portal while it is still pending.</p>
  </div>
</div>`;

  const emailText = [
    `Leave request filed for you - MBUMAH HARDWARE`,
    ``,
    `Leave type: ${leaveTypeName}`,
    `Dates: ${range}`,
    `Working days: ${days}`,
    `Filed by: ${enteredByLabel} (HR)`,
    reason ? `Reason: ${reason}` : null,
    ``,
    `The request is pending manager review. You can withdraw it from your self-service portal while it is still pending.`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

// ── v2.43.0: EDIT WINDOW (approver-facing copy) ────────────────────────────

export interface LeaveCorrectedCopyInput {
  /** The EMPLOYEE's name (the person the request is FOR). */
  firstName: string;
  lastName: string;
  /** Corrected (current) values of the request. */
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  /** Values BEFORE the correction - approvers were notified of THESE. */
  previousLeaveTypeName?: string | null;
  previousStartDate: string;
  previousEndDate: string;
  previousWorkingDays: number;
  /** Display name of the HR editor ("corrected by …" footer). */
  editedByLabel: string;
  /** Optional note from the editor explaining the correction. */
  editNote?: string | null;
}

export interface LeaveCorrectedCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** Build every copy surface for the APPROVER-facing notification written
 *  when a PENDING request that was already fanned out to the approvals
 *  group gets corrected in place (v2.43.0). Without this row an approver
 *  could approve on the ORIGINAL dates they were notified of. Amber
 *  accents - the "re-check before deciding" direction; the copy always
 *  states what the request LOOKS LIKE NOW vs what the approver was told,
 *  who made the correction and that the request still awaits a decision. */
export function leaveCorrectedCopy(input: LeaveCorrectedCopyInput): LeaveCorrectedCopy {
  const {
    firstName,
    lastName,
    leaveTypeName,
    startDate,
    endDate,
    workingDays,
    previousLeaveTypeName,
    previousStartDate,
    previousEndDate,
    previousWorkingDays,
    editedByLabel,
    editNote,
  } = input;

  const name = `${firstName} ${lastName}`.trim();
  const range = `${formatLeaveDay(startDate)} - ${formatLeaveDay(endDate)}`;
  const days = `${workingDays} day${workingDays === 1 ? '' : 's'}`;
  const oldRange = `${formatLeaveDay(previousStartDate)} - ${formatLeaveDay(previousEndDate)}`;
  const oldDays = `${previousWorkingDays} day${previousWorkingDays === 1 ? '' : 's'}`;
  const typeChanged = !!previousLeaveTypeName && previousLeaveTypeName !== leaveTypeName;
  const oldTypePrefix = typeChanged ? `${previousLeaveTypeName} ` : '';

  const title = `Leave request corrected - ${name}`;
  const noteSuffix = editNote ? ` Note: "${editNote}".` : '';
  const message = `${name}'s ${oldTypePrefix}leave request (${oldDays}, ${oldRange}) was corrected by ${editedByLabel} — it is now ${leaveTypeName} for ${days} (${range}) and still awaits a decision.${noteSuffix}`;

  const emailSubject = `Corrected: ${name}'s leave request (now ${days} ${leaveTypeName})`;
  const accent = '#b45309';
  const accentBg = '#fffbeb';
  const accentBorder = '#fde68a';

  const rows: Array<[string, string]> = [
    ['Employee', escapeHtml(name)],
    ['Leave type', `${escapeHtml(leaveTypeName)}${typeChanged ? ` (was ${escapeHtml(previousLeaveTypeName ?? '')})` : ''}`],
    ['Dates', `${escapeHtml(range)} (was ${escapeHtml(oldRange)})`],
    ['Working days', `${escapeHtml(days)} (was ${escapeHtml(oldDays)})`],
  ];
  if (editNote) rows.push(['Note', escapeHtml(editNote)]);

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
  <div style="background:${accentBg};padding:16px 20px;border-bottom:1px solid ${accentBorder};">
    <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${accent};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.02em;">CORRECTED</span>
    <h2 style="margin:10px 0 0;font-size:18px;color:#111827;">A pending request you were notified of was corrected</h2>
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
    <p style="margin:0;color:#6b7280;font-size:12px;">The request keeps its pending status - review the corrected details on the Leave desk before deciding, so the approval lands on the real dates.</p>
    <p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Corrected by ${escapeHtml(editedByLabel)} (HR).</p>
  </div>
</div>`;

  const emailText = [
    `Leave request corrected - MBUMAH HARDWARE`,
    ``,
    `Employee: ${name}`,
    `Leave type: ${leaveTypeName}${typeChanged ? ` (was ${previousLeaveTypeName})` : ''}`,
    `Dates: ${range} (was ${oldRange})`,
    `Working days: ${days} (was ${oldDays})`,
    ...(editNote ? [`Note: ${editNote}`] : []),
    ``,
    `The request keeps its pending status - review the corrected details on the Leave desk before deciding.`,
    `Corrected by ${editedByLabel} (HR).`,
  ].join('\n');

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

// ── v2.40.0: EDIT WINDOW (employee-facing copy) ────────────────────────────

export interface LeaveEditedCopyInput {
  /** The EMPLOYEE's name (the person the request is FOR). */
  firstName: string;
  lastName: string;
  /** Corrected (current) values of the request. */
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  /** Values BEFORE the correction - rendered as the "was" line so the
   *  employee sees exactly what changed without guessing. */
  previousLeaveTypeName?: string | null;
  previousStartDate: string;
  previousEndDate: string;
  previousWorkingDays: number;
  /** Display name of the HR editor ("corrected by …" footer). */
  editedByLabel: string;
  /** Optional note from the editor explaining the correction. */
  editNote?: string | null;
}

export interface LeaveEditedCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** Build every copy surface for the employee-facing notification written
 *  when HR corrects their PENDING request in place (v2.40.0). Indigo
 *  accents — the fifth leave surface color, distinct from decisions
 *  (emerald/amber), submissions (sky) and cancel/on-behalf (violet): the
 *  copy always states what the request LOOKS LIKE NOW vs BEFORE, who made
 *  the correction and that the status stays pending (no re-approval
 *  needed, days keep their pending reservation). */
export function leaveEditedCopy(input: LeaveEditedCopyInput): LeaveEditedCopy {
  const {
    firstName,
    lastName,
    leaveTypeName,
    startDate,
    endDate,
    workingDays,
    previousLeaveTypeName,
    previousStartDate,
    previousEndDate,
    previousWorkingDays,
    editedByLabel,
    editNote,
  } = input;

  const name = `${firstName} ${lastName}`.trim();
  const range = `${formatLeaveDay(startDate)} - ${formatLeaveDay(endDate)}`;
  const days = `${workingDays} day${workingDays === 1 ? '' : 's'}`;
  const oldRange = `${formatLeaveDay(previousStartDate)} - ${formatLeaveDay(previousEndDate)}`;
  const oldDays = `${previousWorkingDays} day${previousWorkingDays === 1 ? '' : 's'}`;
  const typeChanged = !!previousLeaveTypeName && previousLeaveTypeName !== leaveTypeName;
  const oldTypePrefix = typeChanged ? `${previousLeaveTypeName} ` : '';

  const title = `Leave request corrected - ${leaveTypeName}`;
  const noteSuffix = editNote ? ` Note: "${editNote}".` : '';
  const message = `${name}: your ${oldTypePrefix}leave request was corrected by HR — it is now ${leaveTypeName} for ${days} (${range}), previously ${oldDays} (${oldRange}). It stays pending manager review.${noteSuffix}`;

  const emailSubject = `Leave request corrected - ${name} (now ${days} ${leaveTypeName})`;
  const accent = '#4338ca';
  const accentBg = '#eef2ff';
  const accentBorder = '#c7d2fe';

  const rows: Array<[string, string]> = [
    ['Employee', escapeHtml(name)],
    ['Leave type', `${escapeHtml(leaveTypeName)}${typeChanged ? ` (was ${escapeHtml(previousLeaveTypeName ?? '')})` : ''}`],
    ['Dates', `${escapeHtml(range)} (was ${escapeHtml(oldRange)})`],
    ['Working days', `${escapeHtml(days)} (was ${escapeHtml(oldDays)})`],
  ];
  if (editNote) rows.push(['Note', escapeHtml(editNote)]);

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
  <div style="background:${accentBg};padding:16px 20px;border-bottom:1px solid ${accentBorder};">
    <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${accent};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.02em;">CORRECTED</span>
    <h2 style="margin:10px 0 0;font-size:18px;color:#111827;">Leave request corrected by HR</h2>
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
    <p style="margin:0;color:#6b7280;font-size:12px;">The corrected request keeps its pending status - no action is needed. You can still withdraw it from your self-service portal while it is pending.</p>
    <p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Corrected by ${escapeHtml(editedByLabel)} (HR).</p>
  </div>
</div>`;

  const emailText = [
    `Leave request corrected by HR - MBUMAH HARDWARE`,
    ``,
    `Employee: ${name}`,
    `Leave type: ${leaveTypeName}${typeChanged ? ` (was ${previousLeaveTypeName})` : ''}`,
    `Dates: ${range} (was ${oldRange})`,
    `Working days: ${days} (was ${oldDays})`,
    ...(editNote ? [`Note: ${editNote}`] : []),
    ``,
    `The corrected request keeps its pending status - no action is needed. You can still withdraw it from your self-service portal while it is pending.`,
    `Corrected by ${editedByLabel} (HR).`,
  ].join('\n');

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}
