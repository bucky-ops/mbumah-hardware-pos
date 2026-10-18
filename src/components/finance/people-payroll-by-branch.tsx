'use client';

// v2.109.0: "People & payroll by branch" — the SHARED panel.
//
// One implementation, two homes: the Expert Console (/console, collapsed by
// default so the expert-system density survives) and the Finance & Insights
// tab in the main SPA (open by default — there, it IS the content). Both
// read the SAME server truth: the additive hrPerStore block of
// /api/org/summary (ORG scope + HR module on + report permission only —
// the server fail-closes, the panel never widens it).
//
// Per branch: headcount, employment cost (KES, thousands separators),
// absence rate, latest payroll run (period + status + run date), expiry
// alerts (documents expiring in 90 days + overdue asset assignments).
// Every metric mirrors the org-level tile definitions exactly (v2.23.0
// contract); rows carry store names, never employee PII.
//
// Unavailable data never renders blank, undefined or a guessed number: a
// precise reason rides every gap (PAYROLL_RUN_NOT_AVAILABLE on a branch
// with no runs; the panel-level codes PERMISSION_DENIED /
// HR_DATA_SOURCE_UNAVAILABLE / API_ERROR_SAFE for the whole block), with
// the machine-readable code in the title and the human words in the cell.

import { useState } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import type { OrgSummaryData } from '@/components/org/primitives';

export type HrPerStoreRow = NonNullable<OrgSummaryData['hrPerStore']>[number];

/** KES with thousands separators (money cell contract). */
export function kesMoney(v: number): string {
  return `KES ${v.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The whole-block unavailable state. The code is machine-readable (title),
 * the words are human (body) — never undefined, never blank, never fake.
 */
export function PeoplePayrollUnavailable({ code, detail }: { code: string; detail: string }) {
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
      data-testid="people-payroll-unavailable"
      role="status"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            People &amp; payroll by branch
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {code}
          </p>
        </div>
      </div>
    </section>
  );
}

function LatestRunCell({ run }: { run: HrPerStoreRow['latestPayroll'] }) {
  if (!run) {
    return (
      <span className="text-xs text-slate-400 dark:text-slate-500" title="PAYROLL_RUN_NOT_AVAILABLE">
        no runs yet
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500 dark:text-slate-400" title={`Run recorded ${new Date(run.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}`}>
        {run.periodName}
      </span>
      <span
        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
          run.status === 'LOCKED' || run.status === 'POSTED'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
            : run.status === 'VOIDED'
              ? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
        }`}
      >
        {run.status.toLowerCase()}
      </span>
    </span>
  );
}

function ExpiryCell({ row }: { row: HrPerStoreRow }) {
  const alerts = row.expiryAlerts.documentsExpiring90Days + row.expiryAlerts.assetsOverdue;
  const title = `Expiring documents (90 days): ${row.expiryAlerts.documentsExpiring90Days} - overdue asset assignments: ${row.expiryAlerts.assetsOverdue}`;
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 tabular-nums ${
        alerts > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'
      }`}
      title={title}
    >
      {alerts}
    </span>
  );
}

export function PeoplePayrollByBranch({
  rows,
  defaultOpen = false,
  testIdPrefix = 'people-payroll',
}: {
  rows: HrPerStoreRow[];
  /** The console keeps its expert density (collapsed); the tab opens wide. */
  defaultOpen?: boolean;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
      data-testid={`${testIdPrefix}-panel`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${testIdPrefix}-body`}
        data-testid={`${testIdPrefix}-toggle`}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:hover:bg-slate-800/60"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Users className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
          People &amp; payroll by branch ({rows.length})
          <span className="hidden text-xs font-normal text-slate-400 sm:inline">
            &mdash; headcount, cost, absence, latest run, expiry alerts per branch
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={`${testIdPrefix}-body`} className="border-t border-slate-100 dark:border-slate-800">
          {/* Desktop: dense table with a sticky header (max height + scroll). */}
          <div className="hidden max-h-96 overflow-y-auto custom-scrollbar md:block" data-testid={`${testIdPrefix}-table-wrap`}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <th scope="col" className="px-4 py-2 font-medium">Branch</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Headcount</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Cost (month)</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Absence</th>
                  <th scope="col" className="px-3 py-2 font-medium">Latest payroll</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Expiry alerts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.storeId}
                    className="border-b border-slate-50 transition-colors last:border-0 hover:bg-orange-50/40 dark:border-slate-800/60 dark:hover:bg-orange-950/20"
                  >
                    <td className="px-4 py-2">
                      <a
                        href={`/hr/reports?tab=headcount&storeId=${row.storeId}`}
                        title={`Open the headcount report narrowed to ${row.storeName}`}
                        className="font-medium text-slate-700 underline-offset-2 hover:text-orange-600 hover:underline dark:text-slate-200 dark:hover:text-orange-400"
                      >
                        {row.storeName}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{row.headcountActive}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{kesMoney(row.monthEmploymentCost)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        row.monthAbsenceRatePct >= 10
                          ? 'font-semibold text-amber-600 dark:text-amber-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                      title="Absence rate: ABSENT days over all recorded days this month"
                    >
                      {row.monthAbsenceRatePct}%
                    </td>
                    <td className="px-3 py-2">
                      <LatestRunCell run={row.latestPayroll} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <ExpiryCell row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile: card list, no horizontal scroll, same numbers. */}
          <div className="space-y-2 p-3 md:hidden" data-testid={`${testIdPrefix}-cards`}>
            {rows.map((row) => {
              const alerts = row.expiryAlerts.documentsExpiring90Days + row.expiryAlerts.assetsOverdue;
              return (
                <div
                  key={row.storeId}
                  className="rounded-lg border border-slate-100 p-3 dark:border-slate-800"
                  data-testid={`${testIdPrefix}-card`}
                >
                  <a
                    href={`/hr/reports?tab=headcount&storeId=${row.storeId}`}
                    className="text-sm font-semibold text-slate-800 underline-offset-2 hover:text-orange-600 hover:underline dark:text-slate-100 dark:hover:text-orange-400"
                  >
                    {row.storeName}
                  </a>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-400">Headcount</dt>
                      <dd className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{row.headcountActive}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-400">Cost (month)</dt>
                      <dd className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{kesMoney(row.monthEmploymentCost)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-400">Absence</dt>
                      <dd className={`tabular-nums ${row.monthAbsenceRatePct >= 10 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {row.monthAbsenceRatePct}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-400">Expiry alerts</dt>
                      <dd className={`tabular-nums ${alerts > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {alerts}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[10px] uppercase tracking-wide text-slate-400">Latest payroll</dt>
                      <dd className="mt-0.5">
                        <LatestRunCell run={row.latestPayroll} />
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
