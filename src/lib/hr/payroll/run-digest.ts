// src/lib/hr/payroll/run-digest.ts
//
// v2.47.0: the payroll-run APPROVAL digest — copy builder + CSV attachment.
// v2.48.0: the payroll-run POSTING digest — the same machinery pointed at
// the moment the ledger closes (journal entry + payslips issued). Posting
// is THE point of no return for pay, so the maker and the payroll group
// hear about it the same way they heard about the approval, with a
// sky/indigo surface family so the two events never look alike in the
// bell feed.
// WHY: a payroll run's approval is the decision that fixes everyone's pay,
// yet the people who need to KNOW (the maker who prepared the run, the
// finance group who will post and disburse it) had to discover it by
// reopening the workspace. Every approval now (a) rings the relevant users'
// bells with the headline numbers and (b) emails the same numbers with a
// ready-to-file per-employee CSV attached — the exact attachment machinery
// v2.46.0 shipped for HR report digests, now pointed at the run ledger.
//
// WHO receives it is decided in run-service.ts (notifyPayrollRunApproved):
// the store's decision-capable payroll group plus the run's maker, minus
// the approver who just acted. THIS module is PURE: no db, no network, no
// env — same constraint as leave-notify.ts and digest-csv.ts, so unit
// tests run without any mocking. It reuses the RFC-4180 cell escaper and
// the DigestCsvAttachment contract from digest-csv.ts.
//
// PRIVACY CONTRACT: rows carry per-employee AGGREGATES (name, code, gross,
// deductions, net) — never national IDs, bank accounts, payslip line items
// or raw ids. Recipients are exactly the people who can already open the
// full run in the workspace; the email footer says so.

import { csvCell, type DigestCsvAttachment } from '@/lib/hr/digest-csv';

/** Feed-filter marker: notification rows carry this in metadata.kind. */
export const PAYROLL_APPROVED_METADATA_MARKER = 'payroll_approved';

/** v2.48.0: feed-filter marker for the POSTED digest rows (metadata.kind). */
export const PAYROLL_POSTED_METADATA_MARKER = 'payroll_posted';

/**
 * v2.49.0: feed-filter marker for the EMPLOYEE-facing "your payslip is
 * issued" rows (metadata.kind). These are PERSONAL rows — one per employee
 * with a linked portal account, carrying only that employee's own payslip
 * facts (payslip number + net) — never the group CSV, never anyone else's
 * numbers.
 */
export const PAYSLIP_ISSUED_METADATA_MARKER = 'payslip_issued';

/**
 * v2.50.0: feed-filter marker for the DISBURSEMENT digest rows
 * (metadata.kind). Money actually left the door — M-Pesa B2C (live or
 * simulated) or a manual bank-run confirmation — and the payroll group
 * gets the per-batch payment record.
 */
export const PAYROLL_DISBURSED_METADATA_MARKER = 'payroll_disbursed';

/** One per-employee aggregate row in the approval digest. */
export interface PayrollRunDigestEmployeeRow {
  /** Display name, e.g. "Grace Wanjiku". */
  employeeName: string;
  /** Staff number, e.g. "MBM-JUJ-E001" (null tolerated). */
  employeeCode: string | null;
  gross: number;
  deductions: number;
  net: number;
}

/** Run-level facts the copy and CSV are built from. */
export interface PayrollRunDigestMeta {
  /** Pay period label, e.g. "October 2026". */
  periodName: string;
  /** Store/branch name the run belongs to. */
  storeName: string;
  /** REGULAR / SUPPLEMENTARY / OFF_CYCLE / BONUS. */
  runType: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  /** Approver display label ("Grace Wanjiku" / email / "Approver"). */
  approvedByLabel: string;
  /** ISO timestamp of the approval decision. */
  approvedAtIso: string;
}

/** Notification copy bundle (same shape contract as leave-notify copies). */
export interface PayrollRunApprovalCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** v2.48.0: run-level facts the POSTING copy is built from. Same headline
 *  numbers as the approval digest plus what posting actually produced:
 *  the payslip count and the issued payslip-number range. */
export interface PayrollRunPostedMeta {
  /** Pay period label, e.g. "October 2026". */
  periodName: string;
  /** Store/branch name the run belongs to. */
  storeName: string;
  /** REGULAR / SUPPLEMENTARY / OFF_CYCLE / BONUS. */
  runType: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  /** Poster display label ("Grace Wanjiku" / email / "Poster"). */
  postedByLabel: string;
  /** ISO timestamp of the posting decision. */
  postedAtIso: string;
  /** Payslips issued with this posting (payslip numbers are stamped on post). */
  payslipCount: number;
  /** First/last issued payslip numbers, e.g. "PS-2026-00042" (null tolerated). */
  firstPayslipNumber: string | null;
  lastPayslipNumber: string | null;
}

/** v2.48.0: notification copy bundle for the posting digest (same shape). */
export interface PayrollRunPostedCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

// ── formatting helpers (self-contained, deterministic) ─────────────────────

/** KES money for prose: "Ksh 345,000.00" (deterministic 3-digit grouping). */
export function formatKesMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const neg = safe < 0;
  const fixed = Math.abs(safe).toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `Ksh ${neg ? '-' : ''}${grouped}.${cents}`;
}

/** CSV money cell: raw 2-decimal number (filing-friendly, no grouping). */
function csvMoney(amount: number): number | string {
  if (!Number.isFinite(amount)) return '0.00';
  return amount.toFixed(2);
}

/** HTML-escape for the self-contained email shell (leave-notify pattern). */
function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** UTC stamp used in subject + meta block, e.g. "2026-10-17 08:52 UTC". */
export function formatApprovedStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

// ── notification + email copy ───────────────────────────────────────────────

/**
 * Build the approval-digest copy: one bundle reused for the in-app bell
 * rows and the email (HTML + text) — the same numbers everywhere, so the
 * bell, the email body and the CSV can never disagree.
 */
export function payrollRunApprovalCopy(meta: PayrollRunDigestMeta): PayrollRunApprovalCopy {
  const period = meta.periodName || 'Payroll run';
  const money = {
    gross: formatKesMoney(meta.totalGross),
    deductions: formatKesMoney(meta.totalDeductions),
    net: formatKesMoney(meta.totalNet),
  };
  const when = formatApprovedStamp(meta.approvedAtIso);

  const title = `Payroll approved — ${period}`;
  const message =
    `${meta.storeName} · ${period} · ${meta.employeeCount} employee(s) · ` +
    `Net ${money.net}. Approved by ${meta.approvedByLabel} — the run is ready to post and disburse.`;

  const emailSubject =
    `Payroll approved — ${period} · ${meta.storeName} ` +
    `(${meta.employeeCount} employee(s), ${money.net} net)`;

  const emailText = [
    `${'MBUMAH HARDWARE'} — Payroll approval digest`,
    `${meta.storeName} · ${period} · ${meta.runType}`,
    '-'.repeat(48),
    `Employees: ${meta.employeeCount}`,
    `Gross: ${money.gross}`,
    `Deductions: ${money.deductions}`,
    `Net: ${money.net}`,
    `Approved by: ${meta.approvedByLabel}`,
    `Approved at: ${when}`,
    '',
    'The ready-to-file per-employee CSV is attached (name, staff number, gross, deductions, net).',
    'Next step: post the run (journal + payslips), then disburse.',
    '',
    'This digest carries per-employee aggregates and is sent only to the',
    'payroll approvers and the run\u2019s maker — it never contains national IDs,',
    'bank details or payslip line items.',
  ].join('\n');

  const rowsHtml = `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Employees</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${esc(meta.employeeCount)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Gross</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${esc(money.gross)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Deductions</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;color:#b91c1c;">${esc(money.deductions)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Net payable</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:800;font-size:14px;color:#047857;">${esc(money.net)}</td>
        </tr>`;

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#065f46;color:#ffffff;padding:14px 18px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">MBUMAH HARDWARE</div>
      <div style="font-size:17px;font-weight:700;margin-top:2px;">Payroll approved — ${esc(period)}</div>
    </div>
    <div style="padding:16px 18px;color:#1f2937;">
      <p style="margin:0 0 10px 0;font-size:13px;"><strong>${esc(meta.storeName)}</strong> &middot; ${esc(period)} &middot; ${esc(meta.runType)} run</p>
      <table style="width:100%;margin:12px 0;border-collapse:collapse;">${rowsHtml}</table>
      <p style="margin:10px 0;font-size:13px;">Approved by <strong>${esc(meta.approvedByLabel)}</strong> at ${esc(when)}.</p>
      <p style="margin:10px 0;font-size:13px;">The ready-to-file per-employee CSV (name, staff number, gross, deductions, net) is attached — open it in Excel or Google Sheets to reconcile before posting.</p>
      <p style="margin:14px 0 0 0;font-size:12px;color:#6b7280;">
        Next step: post the run (journal entry + payslips), then disburse salaries.<br/>
        Per-employee aggregates only — sent to the payroll approvers and the run&rsquo;s maker; never contains national IDs, bank details or payslip line items.
      </p>
    </div>
  </div>`;

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

// ── v2.48.0: posting digest copy ────────────────────────────────────────────

/**
 * Build the posting-digest copy: one bundle reused for the in-app bell rows
 * and the email (HTML + text) — the same "the ledger closed" facts
 * everywhere, so the bell, the email body and the CSV can never disagree.
 * Sky/indigo surface family (#0c4a6e header) so a posting never looks like
 * an approval in a crowded inbox; the numbers stay the contract.
 */
export function payrollRunPostedCopy(meta: PayrollRunPostedMeta): PayrollRunPostedCopy {
  const period = meta.periodName || 'Payroll run';
  const money = {
    gross: formatKesMoney(meta.totalGross),
    deductions: formatKesMoney(meta.totalDeductions),
    net: formatKesMoney(meta.totalNet),
  };
  const when = formatApprovedStamp(meta.postedAtIso);
  const payslips =
    meta.payslipCount > 0
      ? `${meta.payslipCount} payslip${meta.payslipCount === 1 ? '' : 's'}`
      : 'no payslips';
  const range =
    meta.firstPayslipNumber && meta.lastPayslipNumber
      ? meta.firstPayslipNumber === meta.lastPayslipNumber
        ? meta.firstPayslipNumber
        : `${meta.firstPayslipNumber} – ${meta.lastPayslipNumber}`
      : null;

  const title = `Payroll posted — ${period}`;
  const message =
    `${meta.storeName} · ${period} · ${payslips} issued · ` +
    `Net ${money.net}. Posted by ${meta.postedByLabel} — the journal is in the books; salaries are ready to disburse.`;

  const emailSubject =
    `Payroll posted — ${period} · ${meta.storeName} ` +
    `(${payslips}, ${money.net} net)`;

  const emailText = [
    `${'MBUMAH HARDWARE'} — Payroll posting digest`,
    `${meta.storeName} · ${period} · ${meta.runType}`,
    '-'.repeat(48),
    `Employees: ${meta.employeeCount}`,
    `Payslips issued: ${payslips}${range ? ` (${range})` : ''}`,
    `Gross: ${money.gross}`,
    `Deductions: ${money.deductions}`,
    `Net: ${money.net}`,
    `Posted by: ${meta.postedByLabel}`,
    `Posted at: ${when}`,
    '',
    'The ready-to-file per-employee CSV is attached (name, staff number, gross, deductions, net).',
    'Next step: disburse salaries (bank run or M-Pesa B2C), then lock the run.',
    '',
    'This digest carries per-employee aggregates and is sent only to the',
    'payroll group and the run\u2019s maker — it never contains national IDs,',
    'bank details or payslip line items.',
  ].join('\n');

  const rowsHtml = `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Employees</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${esc(meta.employeeCount)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Payslips issued</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${esc(payslips)}${range ? ` <span style="color:#6b7280;font-weight:400;">(${esc(range)})</span>` : ''}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Gross</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${esc(money.gross)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Deductions</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;color:#b91c1c;">${esc(money.deductions)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Net payable</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:800;font-size:14px;color:#047857;">${esc(money.net)}</td>
        </tr>`;

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#0c4a6e;color:#ffffff;padding:14px 18px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">MBUMAH HARDWARE</div>
      <div style="font-size:17px;font-weight:700;margin-top:2px;">Payroll posted — ${esc(period)}</div>
    </div>
    <div style="padding:16px 18px;color:#1f2937;">
      <p style="margin:0 0 10px 0;font-size:13px;"><strong>${esc(meta.storeName)}</strong> &middot; ${esc(period)} &middot; ${esc(meta.runType)} run</p>
      <table style="width:100%;margin:12px 0;border-collapse:collapse;">${rowsHtml}</table>
      <p style="margin:10px 0;font-size:13px;">Posted by <strong>${esc(meta.postedByLabel)}</strong> at ${esc(when)} — the journal entry is in the books and the payslip numbers are issued${range ? ` (${esc(range)})` : ''}.</p>
      <p style="margin:10px 0;font-size:13px;">The ready-to-file per-employee CSV (name, staff number, gross, deductions, net) is attached — reconcile it against the bank run before you disburse.</p>
      <p style="margin:14px 0 0 0;font-size:12px;color:#6b7280;">
        Next step: disburse salaries (bank run or M-Pesa B2C), then lock the run to freeze the period.<br/>
        Per-employee aggregates only — sent to the payroll group and the run&rsquo;s maker; never contains national IDs, bank details or payslip line items.
      </p>
    </div>
  </div>`;

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

// ── v2.49.0: employee-facing "your payslip is issued" notice ────────────────

/** v2.49.0: the PERSONAL facts one employee's notice is built from. */
export interface PayslipIssuedMeta {
  /** Pay period label, e.g. "October 2026". */
  periodName: string;
  /** Store/branch name the run belongs to. */
  storeName: string;
  /** The employee's own display name (used in the email greeting only). */
  employeeName: string;
  /** Issued payslip number, e.g. "PS-20261017-0006" (null tolerated —
   *  a run can post with payslips but a detail row always gets one; kept
   *  nullable for the same defensive posture as the posted digest). */
  payslipNumber: string | null;
  /** The employee's own net pay for the period. */
  netPay: number;
  /** PENDING / PAID / FAILED / HELD at posting time. */
  paymentStatus: string;
  /** ISO timestamp of the posting decision. */
  postedAtIso: string;
}

/** v2.49.0: notification copy bundle for the personal payslip notice. */
export interface PayslipIssuedCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/**
 * Build ONE employee's personalized "your payslip is issued" copy.
 *
 * PRIVACY CONTRACT: this notice is personal — it carries ONLY the
 * recipient's own payslip facts (payslip number, net, payment status).
 * It never contains other employees' data, never the group CSV, never
 * national IDs or bank details. Teal surface family (#0f766e header) so
 * a personal pay notice never looks like the group's emerald approval or
 * sky posting digest in a shared inbox.
 */
export function payslipIssuedCopy(meta: PayslipIssuedMeta): PayslipIssuedCopy {
  const period = meta.periodName || 'Payroll run';
  const net = formatKesMoney(meta.netPay);
  const when = formatApprovedStamp(meta.postedAtIso);
  const slip = meta.payslipNumber || null;
  const paid = meta.paymentStatus === 'PAID';

  const title = `Payslip issued — ${period}`;
  const message = slip
    ? `Your ${period} payslip ${slip} is ready · Net ${net}${paid ? ' · marked PAID' : ''} — open My Workspace → Payslips to view or download it.`
    : `Your ${period} payslip is ready · Net ${net} — open My Workspace → Payslips to view or download it.`;

  const firstName = meta.employeeName.split(/\s+/)[0] || 'there';
  const emailSubject = slip
    ? `Your payslip is ready — ${period} (${slip}, ${net} net)`
    : `Your payslip is ready — ${period} (${net} net)`;

  const emailText = [
    `${'MBUMAH HARDWARE'} — Your payslip is ready`,
    `${meta.storeName} · ${period}`,
    '-'.repeat(48),
    `Hello ${firstName},`,
    '',
    slip ? `Payslip number: ${slip}` : 'Payslip number: (being finalised)',
    `Net pay: ${net}`,
    `Payment status: ${meta.paymentStatus}`,
    `Issued at: ${when}`,
    '',
    'Open My Workspace → Payslips to view the full breakdown',
    '(earnings, statutory deductions and the printable copy).',
    '',
    'This notice is personal — it carries only your own payslip',
    'summary and is sent only to you.',
  ].join('\n');

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#0f766e;color:#ffffff;padding:14px 18px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">MBUMAH HARDWARE</div>
      <div style="font-size:17px;font-weight:700;margin-top:2px;">Your payslip is ready — ${esc(period)}</div>
    </div>
    <div style="padding:16px 18px;color:#1f2937;">
      <p style="margin:0 0 10px 0;font-size:13px;">Hello <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:10px 0;font-size:13px;">Your payslip for <strong>${esc(period)}</strong> at ${esc(meta.storeName)} has been issued${slip ? ` as <strong>${esc(slip)}</strong>` : ''}.</p>
      <table style="width:100%;margin:12px 0;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Payslip number</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${slip ? esc(slip) : '<span style="color:#6b7280;font-weight:400;">being finalised</span>'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Net pay</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:800;font-size:14px;color:#0f766e;">${esc(net)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Payment status</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${paid ? '<span style="color:#047857;">PAID</span>' : esc(meta.paymentStatus)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Issued at</td>
          <td style="padding:8px 12px;text-align:right;font-size:13px;">${esc(when)}</td>
        </tr>
      </table>
      <p style="margin:10px 0;font-size:13px;">Open <strong>My Workspace → Payslips</strong> to view the full breakdown — earnings, statutory deductions and the printable copy.</p>
      <p style="margin:14px 0 0 0;font-size:12px;color:#6b7280;">
        This notice is personal — it carries only your own payslip summary<br/>
        and is sent only to you. It never contains other employees&rsquo; data.
      </p>
    </div>
  </div>`;

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

// ── v2.50.0: disbursement digest (money leaves the door) ────────────────────

/** How the payment batch actually moved: live Daraja B2C, the dev/simulation
 *  B2C, or a manual bank-run confirmation stamped by hand. */
export type PayrollDisbursementMode = 'mpesa' | 'mpesa-mock' | 'manual';

/** Run-level facts the disbursement digest copy is built from. */
export interface PayrollRunDisbursedMeta {
  /** Pay period label, e.g. "October 2026". */
  periodName: string;
  /** Store/branch name the run belongs to. */
  storeName: string;
  /** REGULAR / SUPPLEMENTARY / OFF_CYCLE / BONUS. */
  runType: string;
  /** mpesa (live Daraja) / mpesa-mock (dev simulation) / manual (bank run). */
  mode: PayrollDisbursementMode;
  /** Payslips eligible for this batch (PENDING, net > 0). */
  eligible: number;
  /** B2C payment requests sent to M-Pesa this batch (0 on manual). */
  initiated: number;
  /** Payslips that were already in flight from an earlier batch. */
  alreadyInitiated: number;
  /** Payslips settled PAID during this batch (mock receipts / manual marks). */
  paidNow: number;
  /** B2C initiation failures this batch. */
  failed: number;
  /** Payslips skipped (typically: no M-Pesa phone on file). */
  skipped: number;
  /** v2.33.0 gate counters, carried through for the honest banner. */
  backoffSkipped?: number;
  maxAttemptSkipped?: number;
  /** Run-level net total (the money this batch settles). */
  totalNet: number;
  /** Disbursing actor's display label ("Grace Wanjiku" / email / "Disbursing user"). */
  disbursedByLabel: string;
  /** ISO timestamp of the disbursement batch. */
  disbursedAtIso: string;
  /** Manual payment reference (MANUAL-… / bank ref) when provided. */
  paymentRef?: string | null;
}

/** Notification copy bundle for the disbursement digest (same shape contract). */
export interface PayrollRunDisbursedCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** One per-payslip payment row in the disbursement CSV. */
export interface PayrollDisbursementRow {
  employeeName: string;
  employeeCode: string | null;
  net: number;
  /** PAID / SENT / FAILED / SKIPPED. */
  status: string;
  /** M-Pesa receipt (mock-settled) or manual payment reference (nullable). */
  receipt?: string | null;
}

/** Mode-specific prose so a live batch never reads like a simulation. */
function disbursementModeCopy(mode: PayrollDisbursementMode): { label: string; receiptLine: string } {
  if (mode === 'mpesa') {
    return {
      label: 'M-Pesa B2C',
      receiptLine: 'Receipts land as M-Pesa settles each payment (B2C result webhook).',
    };
  }
  if (mode === 'mpesa-mock') {
    return {
      label: 'simulated M-Pesa B2C',
      receiptLine: 'Simulation mode: every eligible payment settled immediately with a mock receipt.',
    };
  }
  return {
    label: 'manual confirmation',
    receiptLine: 'Marked paid by hand (bank run / cash) — this is a bookkeeping confirmation, not an M-Pesa send.',
  };
}

/**
 * Build the disbursement-digest copy: one bundle reused for the in-app bell
 * rows and the email (HTML + text) — the same "money left the door" facts
 * everywhere, so the bell, the email body and the CSV can never disagree.
 * Amber surface family (#92400e header) so a disbursement never looks like
 * the approval (emerald), the posting (sky) or a personal payslip notice
 * (teal) in a crowded inbox.
 */
export function payrollRunDisbursedCopy(meta: PayrollRunDisbursedMeta): PayrollRunDisbursedCopy {
  const period = meta.periodName || 'Payroll run';
  const net = formatKesMoney(meta.totalNet);
  const when = formatApprovedStamp(meta.disbursedAtIso);
  const mode = disbursementModeCopy(meta.mode);

  const sentNow =
    meta.mode === 'manual'
      ? `${meta.paidNow} payment${meta.paidNow === 1 ? '' : 's'} marked paid`
      : `${meta.initiated} payment${meta.initiated === 1 ? '' : 's'} sent`;
  const already = meta.alreadyInitiated ? ` · ${meta.alreadyInitiated} already in flight` : '';
  const problems =
    meta.failed || meta.skipped
      ? ` · ${[
          meta.failed ? `${meta.failed} failed` : null,
          meta.skipped ? `${meta.skipped} skipped` : null,
        ]
          .filter(Boolean)
          .join(', ')}`
      : '';
  const nextStep =
    meta.failed > 0
      ? 'Retry the failed payments from the run dialog, then lock.'
      : 'Lock the run to freeze the period.';

  const title = `Payroll disbursed — ${period}`;
  const message =
    `${meta.storeName} · ${period} · ${sentNow} via ${mode.label}${already}${problems} · ` +
    `Net ${net}. ${mode.receiptLine}`;

  const emailSubject =
    `Payroll disbursed — ${period} · ${meta.storeName} ` +
    `(${sentNow}${meta.failed ? `, ${meta.failed} failed` : ''}, ${net} net)`;

  const counter = (label: string, value: string | number, extra = ''): string =>
    `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${esc(label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;${extra}">${esc(value)}</td>
        </tr>`;

  const rowsHtml =
    counter('Payments sent', meta.mode === 'manual' ? `${meta.paidNow} marked paid` : meta.initiated) +
    (meta.alreadyInitiated ? counter('Already in flight', meta.alreadyInitiated) : '') +
    counter('Settled this batch', meta.paidNow) +
    (meta.failed ? counter('Failed', meta.failed, 'color:#b91c1c;') : '') +
    (meta.skipped ? counter('Skipped', meta.skipped) : '') +
    (meta.backoffSkipped ? counter('Backoff-blocked retries', meta.backoffSkipped) : '') +
    (meta.maxAttemptSkipped ? counter('At attempt ceiling', meta.maxAttemptSkipped, 'color:#b91c1c;') : '') +
    counter('Net settled', net, 'font-weight:800;font-size:14px;color:#047857;');

  const emailText = [
    `${'MBUMAH HARDWARE'} — Payroll disbursement digest`,
    `${meta.storeName} · ${period} · ${meta.runType}`,
    '-'.repeat(48),
    `Channel: ${mode.label}`,
    `Payments sent: ${meta.mode === 'manual' ? `${meta.paidNow} marked paid` : meta.initiated}`,
    ...(meta.alreadyInitiated ? [`Already in flight: ${meta.alreadyInitiated}`] : []),
    `Settled this batch: ${meta.paidNow}`,
    ...(meta.failed ? [`Failed: ${meta.failed}`] : []),
    ...(meta.skipped ? [`Skipped: ${meta.skipped}`] : []),
    ...(meta.backoffSkipped ? [`Backoff-blocked retries: ${meta.backoffSkipped}`] : []),
    ...(meta.maxAttemptSkipped ? [`At attempt ceiling: ${meta.maxAttemptSkipped}`] : []),
    `Net settled: ${net}`,
    `Disbursed by: ${meta.disbursedByLabel}`,
    `Disbursed at: ${when}`,
    ...(meta.paymentRef ? [`Payment ref: ${meta.paymentRef}`] : []),
    '',
    'The ready-to-file per-payslip payment CSV is attached (employee, staff',
    'number, net, status, receipt) — reconcile it against the M-Pesa',
    'statement or the bank run.',
    '',
    `Next step: ${nextStep}`,
    '',
    'This digest carries per-payslip payment aggregates and is sent only to',
    'the payroll group — it never contains national IDs, bank details or',
    'payslip line items.',
  ].join('\n');

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#92400e;color:#ffffff;padding:14px 18px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">MBUMAH HARDWARE</div>
      <div style="font-size:17px;font-weight:700;margin-top:2px;">Payroll disbursed — ${esc(period)}</div>
    </div>
    <div style="padding:16px 18px;color:#1f2937;">
      <p style="margin:0 0 10px 0;font-size:13px;"><strong>${esc(meta.storeName)}</strong> &middot; ${esc(period)} &middot; ${esc(meta.runType)} run</p>
      <table style="width:100%;margin:12px 0;border-collapse:collapse;">${rowsHtml}</table>
      <p style="margin:10px 0;font-size:13px;">Disbursed by <strong>${esc(meta.disbursedByLabel)}</strong> at ${esc(when)} via <strong>${esc(mode.label)}</strong>.${meta.paymentRef ? ` Payment ref: <strong>${esc(meta.paymentRef)}</strong>.` : ''}</p>
      <p style="margin:10px 0;font-size:13px;">${esc(mode.receiptLine)} The ready-to-file per-payslip payment CSV (employee, staff number, net, status, receipt) is attached — reconcile it against the M-Pesa statement or the bank run.</p>
      <p style="margin:14px 0 0 0;font-size:12px;color:#6b7280;">
        Next step: ${esc(nextStep)}<br/>
        Per-payslip payment aggregates only — sent to the payroll group; never contains national IDs,<br/>
        bank details or payslip line items.
      </p>
    </div>
  </div>`;

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

/**
 * Build the ready-to-file per-payslip payment CSV for a disbursement batch:
 * header block (report/organization/period/run type/channel/actor/stamp) →
 * per-payslip payment table (employee, staff number, net, status, receipt).
 * Returns null when there is nothing to file so an empty batch never ships
 * an empty spreadsheet.
 */
export function payrollDisbursementToCsv(
  rows: PayrollDisbursementRow[],
  meta: PayrollRunDisbursedMeta,
): DigestCsvAttachment | null {
  if (rows.length === 0) return null;
  const period = meta.periodName || 'payroll-run';
  const mode = disbursementModeCopy(meta.mode);
  const lines: string[] = [];

  lines.push(csvRow(['Report', 'Payroll disbursement summary']));
  lines.push(csvRow(['Organization', meta.storeName]));
  lines.push(csvRow(['Period', period]));
  lines.push(csvRow(['Run type', meta.runType]));
  lines.push(csvRow(['Channel', mode.label]));
  lines.push(csvRow(['Disbursed by', meta.disbursedByLabel]));
  lines.push(csvRow(['Disbursed-UTC', meta.disbursedAtIso]));
  if (meta.paymentRef) lines.push(csvRow(['Payment ref', meta.paymentRef]));
  lines.push('');

  lines.push(csvRow(['Employee', 'Staff number', 'Net (KES)', 'Status', 'Receipt']));
  for (const r of rows) {
    lines.push(
      csvRow([r.employeeName, r.employeeCode ?? '', csvMoney(r.net), r.status, r.receipt ?? '']),
    );
  }

  // RFC-4180: CRLF between records, trailing CRLF at end of file (same
  // framing as the approval/posted CSVs); byte size on the raw UTF-8 string.
  const csv = lines.join('\r\n') + '\r\n';
  return {
    filename: `mbumah-payroll-${slug(period)}-disbursement.csv`,
    content: Buffer.from(csv, 'utf8').toString('base64'),
    byteSize: Buffer.byteLength(csv, 'utf8'),
  };
}

// ── v2.51.0: employee-facing "you've been paid" notice ──────────────────────

/**
 * v2.51.0: feed-filter marker for the EMPLOYEE-facing "you've been paid"
 * rows (metadata.kind). The completion of the personal pay family: v2.49.0
 * told the employee "your payslip is issued"; THIS row tells them the money
 * actually settled — with their own receipt in hand. Personal rows only,
 * one per portal-linked employee whose payslip went PAID in this batch.
 */
export const PAYROLL_PAID_METADATA_MARKER = 'payroll_paid';

/** v2.51.0: the PERSONAL facts one employee's paid notice is built from. */
export interface PayrollRunPaidMeta {
  /** Pay period label, e.g. "October 2026". */
  periodName: string;
  /** Store/branch name the run belongs to. */
  storeName: string;
  /** The employee's own display name (used in the email greeting only). */
  employeeName: string;
  /** The employee's own net pay for the period. */
  netPay: number;
  /** Their payslip number, e.g. "PS-20261017-0006" (null tolerated). */
  payslipNumber: string | null;
  /** M-Pesa receipt / manual payment reference (MPESA-… / MANUAL-…).
   *  Null when the channel recorded no reference — the copy stays honest
   *  and points at the payslip instead of inventing a number. */
  receipt: string | null;
  /** mpesa (live Daraja webhook settle) / mpesa-mock (dev simulation) / manual. */
  mode: PayrollDisbursementMode;
  /** ISO timestamp of the settlement batch. */
  disbursedAtIso: string;
}

/** v2.51.0: notification copy bundle for the personal paid notice. */
export interface PayrollRunPaidCopy {
  title: string;
  message: string;
  notifType: 'INFO';
  priority: 'NORMAL';
  emailSubject: string;
  emailText: string;
  emailHtml: string;
}

/** Mode-specific prose so a settled batch never reads like a simulation and
 *  a manual mark never reads like an M-Pesa send. Same contract as the
 *  group's disbursement digest (v2.50.0), pointed at the employee. */
function paidModeCopy(mode: PayrollDisbursementMode): {
  label: string;
  channelLine: string;
  honestyLine: string;
} {
  if (mode === 'mpesa') {
    return {
      label: 'M-Pesa B2C',
      channelLine: 'has been sent to your M-Pesa via M-Pesa B2C',
      honestyLine: 'This receipt is our record — your M-Pesa message from Safaricom is the payment proof.',
    };
  }
  if (mode === 'mpesa-mock') {
    return {
      label: 'simulated M-Pesa B2C',
      channelLine: 'was settled via simulated M-Pesa B2C (test environment — no real money moved)',
      honestyLine: 'Simulation mode: this batch is a rehearsal, not a payment.',
    };
  }
  return {
    label: 'manual confirmation',
    channelLine: 'was marked paid via manual confirmation (bank run / cash)',
    honestyLine: 'This is a bookkeeping record, not an M-Pesa send — if the money has not reached your account, talk to HR.',
  };
}

/**
 * Build ONE employee's personalized "you've been paid" copy.
 *
 * PRIVACY CONTRACT: personal — carries ONLY the recipient's own pay facts
 * (net, receipt, payslip number). Never other employees' data, never the
 * group CSV, never national IDs or bank details. Emerald surface family
 * (#047857 header) so the settled-money moment reads as the completion of
 * the payslip family — teal for "issued" (v2.49.0), emerald for "paid"
 * (v2.51.0) — and never looks like the group's amber disbursement digest
 * or the approval digest in a shared inbox.
 */
export function payrollRunPaidCopy(meta: PayrollRunPaidMeta): PayrollRunPaidCopy {
  const period = meta.periodName || 'Payroll run';
  const net = formatKesMoney(meta.netPay);
  const when = formatApprovedStamp(meta.disbursedAtIso);
  const slip = meta.payslipNumber || null;
  const receipt = meta.receipt || null;
  const mode = paidModeCopy(meta.mode);

  const title = `You've been paid — ${period}`;
  const receiptSegment = receipt ? ` · receipt ${receipt}` : '';
  const slipSegment = slip ? `payslip ${slip}` : 'your payslip';
  const message =
    `${net} for ${period} ${mode.channelLine}${receiptSegment} — ` +
    `${slipSegment} is in My Workspace → Payslips.`;

  const firstName = meta.employeeName.split(/\s+/)[0] || 'there';
  const emailSubject =
    `You've been paid — ${period} (${net}${receipt ? ` · ${receipt}` : ''})`;

  const emailText = [
    `${'MBUMAH HARDWARE'} — Your payment is settled`,
    `${meta.storeName} · ${period}`,
    '-'.repeat(48),
    `Hello ${firstName},`,
    '',
    `Net pay: ${net}`,
    `Channel: ${mode.label}`,
    `Receipt: ${receipt ?? '(none recorded — your payslip carries the payment record)'}`,
    slip ? `Payslip number: ${slip}` : 'Payslip number: (see My Workspace → Payslips)',
    `Settled at: ${when}`,
    '',
    mode.honestyLine,
    '',
    'Open My Workspace → Payslips to view the full breakdown',
    '(earnings, statutory deductions and the printable copy).',
    '',
    'This notice is personal — it carries only your own payment',
    'summary and is sent only to you.',
  ].join('\n');

  const rowsHtml = `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Net pay</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:800;font-size:14px;color:#047857;">${esc(net)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Channel</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${esc(mode.label)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Receipt</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${receipt ? esc(receipt) : '<span style="color:#6b7280;font-weight:400;">none recorded — your payslip carries the payment record</span>'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">Payslip number</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${slip ? esc(slip) : '<span style="color:#6b7280;font-weight:400;">see My Workspace → Payslips</span>'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Settled at</td>
          <td style="padding:8px 12px;text-align:right;font-size:13px;">${esc(when)}</td>
        </tr>`;

  const emailHtml = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="background:#047857;color:#ffffff;padding:14px 18px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">MBUMAH HARDWARE</div>
      <div style="font-size:17px;font-weight:700;margin-top:2px;">You've been paid — ${esc(period)}</div>
    </div>
    <div style="padding:16px 18px;color:#1f2937;">
      <p style="margin:0 0 10px 0;font-size:13px;">Hello <strong>${esc(firstName)}</strong>,</p>
      <p style="margin:10px 0;font-size:13px;">Your net pay for <strong>${esc(period)}</strong> at ${esc(meta.storeName)} ${esc(mode.channelLine)}${receipt ? ` — receipt <strong>${esc(receipt)}</strong>` : ''}.</p>
      <table style="width:100%;margin:12px 0;border-collapse:collapse;">${rowsHtml}</table>
      <p style="margin:10px 0;font-size:13px;">${esc(mode.honestyLine)}</p>
      <p style="margin:10px 0;font-size:13px;">Open <strong>My Workspace → Payslips</strong> to view the full breakdown — earnings, statutory deductions and the printable copy.</p>
      <p style="margin:14px 0 0 0;font-size:12px;color:#6b7280;">
        This notice is personal — it carries only your own payment summary<br/>
        and is sent only to you. It never contains other employees&rsquo; data.
      </p>
    </div>
  </div>`;

  return { title, message, notifType: 'INFO', priority: 'NORMAL', emailSubject, emailText, emailHtml };
}

// ── CSV attachment ──────────────────────────────────────────────────────────

/**
 * Build the ready-to-file per-employee CSV. Header block (report/organization/
 * period/run type/approved or posted) → Summary (metric,value) → per-employee
 * table. Returns null when there is nothing to file (no rows AND all-zero
 * totals) so an approved or posted empty run never ships an empty spreadsheet.
 *
 * v2.48.0: variant 'posted' flips the header block to "Payroll posting
 * summary" / Posted by / Posted-UTC, adds the payslip range row and a
 * -posted filename suffix so an approval CSV and a posting CSV for the same
 * period can live in one inbox without colliding.
 */
export function payrollRunDigestToCsv(
  rows: PayrollRunDigestEmployeeRow[],
  meta: PayrollRunDigestMeta &
    Partial<
      Pick<
        PayrollRunPostedMeta,
        'postedByLabel' | 'postedAtIso' | 'payslipCount' | 'firstPayslipNumber' | 'lastPayslipNumber'
      >
    >,
  now: Date = new Date(),
  variant: 'approval' | 'posted' = 'approval',
): DigestCsvAttachment | null {
  const posted = variant === 'posted';
  const postedMeta = meta as Partial<PayrollRunPostedMeta>;
  const actorLabel = posted ? postedMeta.postedByLabel ?? meta.approvedByLabel : meta.approvedByLabel;
  // The posted variant stamps the POSTING time from meta; the generation
  // clock (`now`) is its fallback when a caller could not supply one. The
  // approval variant keeps the approval stamp (same-request facts).
  const actorStamp = posted ? postedMeta.postedAtIso ?? now.toISOString() : meta.approvedAtIso;
  const hasRows = rows.length > 0;
  const hasTotals =
    meta.totalGross !== 0 || meta.totalDeductions !== 0 || meta.totalNet !== 0 || meta.employeeCount !== 0;
  if (!hasRows && !hasTotals) return null;

  const period = meta.periodName || 'payroll-run';
  const lines: string[] = [];

  lines.push(csvRow(['Report', posted ? 'Payroll posting summary' : 'Payroll approval summary']));
  lines.push(csvRow(['Organization', meta.storeName]));
  lines.push(csvRow(['Period', period]));
  lines.push(csvRow(['Run type', meta.runType]));
  lines.push(csvRow([posted ? 'Posted by' : 'Approved by', actorLabel]));
  lines.push(csvRow([posted ? 'Posted-UTC' : 'Approved-UTC', actorStamp]));
  if (posted) {
    const range =
      meta.firstPayslipNumber && meta.lastPayslipNumber
        ? meta.firstPayslipNumber === meta.lastPayslipNumber
          ? meta.firstPayslipNumber
          : `${meta.firstPayslipNumber} - ${meta.lastPayslipNumber}`
        : null;
    lines.push(csvRow(['Payslips issued', range ? `${meta.payslipCount ?? 0} (${range})` : (meta.payslipCount ?? 0)]));
  }
  lines.push('');

  lines.push(csvRow(['Summary', 'Value']));
  lines.push(csvRow(['Employees', meta.employeeCount]));
  lines.push(csvRow(['Gross (KES)', csvMoney(meta.totalGross)]));
  lines.push(csvRow(['Deductions (KES)', csvMoney(meta.totalDeductions)]));
  lines.push(csvRow(['Net (KES)', csvMoney(meta.totalNet)]));

  if (hasRows) {
    lines.push('');
    lines.push(csvRow(['Employee', 'Staff number', 'Gross (KES)', 'Deductions (KES)', 'Net (KES)']));
    for (const r of rows) {
      lines.push(
        csvRow([
          r.employeeName,
          r.employeeCode ?? '',
          csvMoney(r.gross),
          csvMoney(r.deductions),
          csvMoney(r.net),
        ]),
      );
    }
  }

  // RFC-4180: CRLF between records, trailing CRLF at end of file (same
  // framing as digestToCsv); byte size measured on the raw UTF-8 string.
  const csv = lines.join('\r\n') + '\r\n';
  return {
    filename: `mbumah-payroll-${slug(period)}-${slug(meta.runType || 'run')}${posted ? '-posted' : ''}.csv`,
    content: Buffer.from(csv, 'utf8').toString('base64'),
    byteSize: Buffer.byteLength(csv, 'utf8'),
  };
}

/** Join one CSV record with CRLF framing (matches digestToCsv). */
function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

/** Lowercase, non-alphanumeric → '-' (same slug contract as digest-csv). */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
