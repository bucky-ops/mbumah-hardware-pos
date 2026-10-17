// src/lib/hr/payroll/run-digest.ts
//
// v2.47.0: the payroll-run APPROVAL digest — copy builder + CSV attachment.
//
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

/** UTC stamp used in subject + meta block, e.g. "17 Oct 2026, 08:52 UTC". */
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

// ── CSV attachment ──────────────────────────────────────────────────────────

/**
 * Build the ready-to-file per-employee CSV. Header block (report/organization/
 * period/run type/approved) → Summary (metric,value) → per-employee table.
 * Returns null when there is nothing to file (no rows AND all-zero totals)
 * so an approved empty run never ships an empty spreadsheet.
 */
export function payrollRunDigestToCsv(
  rows: PayrollRunDigestEmployeeRow[],
  meta: PayrollRunDigestMeta,
  now: Date = new Date(),
): DigestCsvAttachment | null {
  const hasRows = rows.length > 0;
  const hasTotals =
    meta.totalGross !== 0 || meta.totalDeductions !== 0 || meta.totalNet !== 0 || meta.employeeCount !== 0;
  if (!hasRows && !hasTotals) return null;

  const period = meta.periodName || 'payroll-run';
  const lines: string[] = [];

  lines.push(csvRow(['Report', 'Payroll approval summary']));
  lines.push(csvRow(['Organization', meta.storeName]));
  lines.push(csvRow(['Period', period]));
  lines.push(csvRow(['Run type', meta.runType]));
  lines.push(csvRow(['Approved by', meta.approvedByLabel]));
  lines.push(csvRow(['Approved-UTC', now.toISOString()]));
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
    filename: `mbumah-payroll-${slug(period)}-${slug(meta.runType || 'run')}.csv`,
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
