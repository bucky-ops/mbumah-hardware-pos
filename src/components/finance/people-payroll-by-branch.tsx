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
import { ChevronDown, ExternalLink, SlidersHorizontal, Users } from 'lucide-react';
import type { OrgSummaryData } from '@/components/org/primitives';
import { buildAbsenceReportHref, buildExpiringEmployeesHref, buildOverdueAssetsHref, buildRunDeepLinkHref } from '@/lib/workspace/links';
import { ASSET_LIST_READ_ROLES, EMPLOYEE_LIST_READ_ROLES } from '@/lib/app-config';
import { useAuthStore } from '@/lib/stores';

export type HrPerStoreRow = NonNullable<OrgSummaryData['hrPerStore']>[number];

/**
 * v2.110.0: the per-branch filter, as a pure function — the panel's table
 * and its mobile cards render EXACTLY what this returns, so the unit test
 * pins the one truth both surfaces share. '' (or an unknown id) = all rows,
 * original order preserved (the filter narrows, it never reorders).
 */
export function filterBranchRows(rows: HrPerStoreRow[], branchId: string): HrPerStoreRow[] {
  if (!branchId) return rows;
  return rows.filter((r) => r.storeId === branchId);
}

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

function LatestRunCell({ run, storeName }: { run: HrPerStoreRow['latestPayroll']; storeName: string }) {
  if (!run) {
    return (
      <span className="text-xs text-slate-400 dark:text-slate-500" title="PAYROLL_RUN_NOT_AVAILABLE">
        no runs yet
      </span>
    );
  }
  // v2.113.0: a run WITH an id is a door — one click opens /hr/payroll with
  // ?run=<id> and the run detail dialog (the dialog fetches by id and
  // fail-closes on its own). Stale summaries without an id degrade to the
  // same honest text as before — never a dead link.
  const statusBadge = (
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
  );
  if (run.runId) {
    return (
      <a
        href={buildRunDeepLinkHref(run.runId)}
        data-testid="people-payroll-run-door"
        aria-label={`Open the payroll run detail for ${run.periodName} — ${storeName}`}
        title={`Open the ${run.periodName} run detail (recorded ${new Date(run.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })})`}
        className="inline-flex flex-wrap items-center gap-1.5 rounded-md text-xs text-slate-600 underline-offset-2 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:text-slate-300 dark:hover:text-orange-400"
      >
        <span>{run.periodName}</span>
        {statusBadge}
        <ExternalLink className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      </a>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500 dark:text-slate-400" title={`Run recorded ${new Date(run.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}`}>
        {run.periodName}
      </span>
      {statusBadge}
    </span>
  );
}

function AbsenceCell({ row }: { row: HrPerStoreRow }) {
  // v2.193.0: the absence door — the amber voice the cell has worn since
  // v2.110.0 becomes the affordance at the 10% attention threshold: the rate
  // opens the HR reports desk on the absence tab, narrowed to this branch
  // (the destination's OWN established deep-link contract — the tab key +
  // the v2.23.0 storeId param — via the links lib's ONE writer). No role
  // gate: every viewer of this panel passes the reports API's guard
  // (SUPER_ADMIN via the hrGuard bypass, STORE_OWNER and ACCOUNTANT are
  // REPORT_ROLES members) — a door that 403s is a lie, and this one cannot.
  // Below the threshold the calm plain text keeps the exact voice this
  // release replaces. ONE cell, two mounts (the table and the mobile card)
  // — the panel renders EXACTLY one absence vocabulary.
  if (row.monthAbsenceRatePct >= 10) {
    return (
      <a
        href={buildAbsenceReportHref(row.storeId)}
        data-testid="people-payroll-absence-door"
        aria-label={`${row.monthAbsenceRatePct}% absence rate at ${row.storeName} this month — open the absence report narrowed to ${row.storeName}`}
        title="Absence rate: ABSENT days over all recorded days this month — open the absence report narrowed to this branch"
        className="inline-flex items-center gap-1 rounded-md font-semibold text-amber-700 underline-offset-2 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:text-amber-400 dark:hover:text-orange-400"
      >
        {row.monthAbsenceRatePct}%
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
      </a>
    );
  }
  return (
    <span
      className="text-slate-700 dark:text-slate-300"
      title="Absence rate: ABSENT days over all recorded days this month"
    >
      {row.monthAbsenceRatePct}%
    </span>
  );
}

function ExpiryCell({ row }: { row: HrPerStoreRow }) {
  // v2.113.0: the alert count splits honestly. The DOCUMENTS half is a door
  // into the employees list pre-filtered to expiring documents for that
  // branch — but ONLY for the roles the list actually answers (the spec
  // grants ACCOUNTANT payroll reads and reports, not the roster: a door that
  // 403s is a lie). v2.114.0: the ASSETS half opens its own door too —
  // /hr/assets?overdue=1&storeId=<id> — gated on exactly the roles the
  // assets list answers (ASSET_LIST_READ_ROLES mirrors hr.asset.manage); for
  // every other role it stays the same honest text as before. Zero halves
  // never render as links.
  const role = useAuthStore((s) => s.user?.role);
  const canOpenDocs = EMPLOYEE_LIST_READ_ROLES.includes(role || '');
  const canOpenAssets = ASSET_LIST_READ_ROLES.includes(role || '');
  const docs = row.expiryAlerts.documentsExpiring90Days;
  const assets = row.expiryAlerts.assetsOverdue;
  const docTitle = `Documents expiring within 90 days: ${docs} — open the branch's employees list pre-filtered`;
  const docTitlePlain = `Documents expiring within 90 days: ${docs}`;
  const assetsTitle = `Overdue asset assignments: ${assets} — open the branch's assets list pre-filtered`;
  const doorClass =
    'inline-flex items-center gap-1 rounded-md font-semibold text-amber-700 underline-offset-2 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:text-amber-400 dark:hover:text-orange-400';
  if (docs > 0 && canOpenDocs) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
        <a
          href={buildExpiringEmployeesHref(row.storeId)}
          data-testid="people-payroll-expiry-door"
          aria-label={`${docs} document${docs === 1 ? '' : 's'} expiring within 90 days at ${row.storeName} — open the pre-filtered employees list`}
          title={docTitle}
          className={doorClass}
        >
          {docs}
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
        </a>
        {assets > 0 && canOpenAssets && (
          <a
            href={buildOverdueAssetsHref(row.storeId)}
            data-testid="people-payroll-assets-door"
            aria-label={`${assets} overdue asset assignment${assets === 1 ? '' : 's'} at ${row.storeName} — open the pre-filtered assets list`}
            title={assetsTitle}
            className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-amber-700 underline-offset-2 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:text-amber-400 dark:hover:text-orange-400"
          >
            +{assets}
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          </a>
        )}
        {assets > 0 && !canOpenAssets && (
          <span
            className="text-xs text-slate-500 dark:text-slate-400"
            title={`Overdue asset assignments: ${assets} — see the Assets page`}
          >
            +{assets}
          </span>
        )}
      </span>
    );
  }
  // No documents door (zero docs or a role the list would 403): the assets
  // half can still be the door when the role may cross it.
  if (assets > 0 && canOpenAssets) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
        {docs > 0 && (
          <span className="text-slate-700 dark:text-slate-300" title={docTitlePlain}>
            {docs}
          </span>
        )}
        {docs > 0 && (
          <span className="text-slate-400 dark:text-slate-500" aria-hidden="true">
            +
          </span>
        )}
        <a
          href={buildOverdueAssetsHref(row.storeId)}
          data-testid="people-payroll-assets-door"
          aria-label={`${assets} overdue asset assignment${assets === 1 ? '' : 's'} at ${row.storeName} — open the pre-filtered assets list`}
          title={assetsTitle}
          className={doorClass}
        >
          {assets}
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
        </a>
      </span>
    );
  }
  const title = `Expiring documents (90 days): ${docs} - overdue asset assignments: ${assets}`;
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 tabular-nums ${
        assets > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'
      }`}
      title={title}
    >
      {docs + assets}
    </span>
  );
}

export function PeoplePayrollByBranch({
  rows,
  defaultOpen = false,
  testIdPrefix = 'people-payroll',
  defaultBranchId = '',
  onBranchFilterChange,
}: {
  rows: HrPerStoreRow[];
  /** The console keeps its expert density (collapsed); the tab opens wide. */
  defaultOpen?: boolean;
  testIdPrefix?: string;
  /** v2.111.0: a deep link (?branch=<storeId>) may open the panel pre-filtered. */
  defaultBranchId?: string;
  /** v2.111.0: the tab mirrors filter changes into the URL (replaceState). */
  onBranchFilterChange?: (branchId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // v2.110.0: the branch filter lives INSIDE the shared panel, so both homes
  // (the Finance & Insights tab AND the Expert Console) get it from one
  // implementation. '' = every branch; a storeId narrows table AND cards.
  // v2.111.0: a deep link can seed the filter (defaultBranchId); every user
  // change reports through onBranchFilterChange so the URL stays the truth.
  const [branchId, setBranchId] = useState(defaultBranchId);
  // The "(from link)" hint is honest only while the user has not overridden
  // the seeded value — the first manual change retires it for good.
  const [userTouched, setUserTouched] = useState(false);
  const changeBranch = (id: string) => {
    setBranchId(id);
    setUserTouched(true);
    onBranchFilterChange?.(id);
  };
  const visible = filterBranchRows(rows, branchId);
  const filtered = branchId !== '';
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
          <span className="hidden text-xs font-normal text-slate-500 dark:text-slate-400 sm:inline">
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
          {/* v2.110.0: the branch filter — a native select (keyboard + mobile
              friendly), styled to the panel's design system. Filtering narrows
              the rows, never reorders them; Reset returns the whole org. */}
          <div
            className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/60"
            data-testid={`${testIdPrefix}-filter-row`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <label htmlFor={`${testIdPrefix}-branch-filter`} className="text-xs text-slate-500 dark:text-slate-400">
              Branch
            </label>
            <select
              id={`${testIdPrefix}-branch-filter`}
              value={branchId}
              onChange={(e) => changeBranch(e.target.value)}
              data-testid={`${testIdPrefix}-branch-filter`}
              className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-sm outline-none transition-colors focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="">All branches</option>
              {rows.map((r) => (
                <option key={r.storeId} value={r.storeId}>
                  {r.storeName}
                </option>
              ))}
            </select>
            {filtered && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500" data-testid={`${testIdPrefix}-filter-count`}>
                showing {visible.length} of {rows.length}
                {defaultBranchId && branchId === defaultBranchId && !userTouched ? ' (from link)' : ''}
              </span>
            )}
            {filtered && (
              <button
                type="button"
                onClick={() => changeBranch('')}
                data-testid={`${testIdPrefix}-filter-reset`}
                className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium text-orange-600 underline-offset-2 transition-colors hover:bg-orange-50 hover:underline dark:text-orange-400 dark:hover:bg-orange-950/40"
              >
                Reset
              </button>
            )}
          </div>
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
                {visible.map((row) => (
                  <tr
                    key={row.storeId}
                    className="border-b border-slate-50 transition-colors last:border-0 hover:bg-orange-50/40 dark:border-slate-800/60 dark:hover:bg-orange-950/20"
                  >
                    <td className="px-4 py-2">
                      <a
                        href={`/hr/reports?tab=headcount&storeId=${row.storeId}`}
                        title={`Open the headcount report narrowed to ${row.storeName}`}
                        className="font-medium text-slate-700 underline-offset-2 hover:text-orange-800 hover:underline dark:text-slate-200 dark:hover:text-orange-400"
                      >
                        {row.storeName}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{row.headcountActive}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{kesMoney(row.monthEmploymentCost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <AbsenceCell row={row} />
                    </td>
                    <td className="px-3 py-2">
                      <LatestRunCell run={row.latestPayroll} storeName={row.storeName} />
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
            {visible.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-500" data-testid={`${testIdPrefix}-cards-empty`}>
                No branches match this filter.
              </p>
            ) : (
              visible.map((row) => {
              return (
                <div
                  key={row.storeId}
                  className="rounded-lg border border-slate-100 p-3 transition-shadow hover:shadow-sm dark:border-slate-800"
                  data-testid={`${testIdPrefix}-card`}
                >
                  <a
                    href={`/hr/reports?tab=headcount&storeId=${row.storeId}`}
                    className="text-sm font-semibold text-slate-800 underline-offset-2 hover:text-orange-800 hover:underline dark:text-slate-100 dark:hover:text-orange-400"
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
                      <dd className="mt-0.5 text-right tabular-nums">
                        <AbsenceCell row={row} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-slate-400">Expiry alerts</dt>
                      <dd className="mt-0.5 text-right">
                        <ExpiryCell row={row} />
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[10px] uppercase tracking-wide text-slate-400">Latest payroll</dt>
                      <dd className="mt-0.5">
                        <LatestRunCell run={row.latestPayroll} storeName={row.storeName} />
                      </dd>
                    </div>
                  </dl>
                </div>
              );
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
