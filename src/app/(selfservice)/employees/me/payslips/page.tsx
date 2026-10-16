// MBUMAH HARDWARE POS - /employees/me/payslips (v2.29.0, SERVER-RENDERED)
// Own payslips with a full breakdown dialog, a plain-language trace, and an
// SSR year switcher (?year=YYYY — "All" shows the latest window).
//
// v2.28.0 SSR COMPLETION (docs/hr/self-service.md): the list used to be
// fetched client-side after paint (with a localStorage cache for offline);
// it now server-renders through the SAME listMyPayslips service the API
// route exposes, so payslips are in the initial HTML (LCP ≈ FCP). The
// offline contract is preserved: a tiny client island mirrors the fresh
// list into the SAME localStorage key (mbt_self_payslips_cache_v1), and the
// breakdown dialog still opens from the device cache when offline
// (payslips-view.tsx). The API route stays for client detail fetches.
//
// v2.29.0 YEAR SWITCHER: the page reads ?year=YYYY (validated, anything
// else falls back to the unfiltered window) and renders an SSR segmented
// control built from listMyPayslipYears — switching years is a plain
// navigation, so every view server-renders too. The view also gains a
// per-year summary line (payslip count + total net) for at-a-glance payroll
// totals.

import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { listMyPayslips, listMyPayslipYears } from '@/lib/hr/self-service';
import { ErrorNote } from '@/components/hr/self-service-ui';
import { formatKes } from '@/components/hr/self-service-format';
import { SelfPageHeader, loadSelfPortal } from '../self-portal';
import { PayslipsView, type PayslipListItem } from './payslips-view';
import { PayslipsCacheWriter } from './payslips-cache-writer';

export const dynamic = 'force-dynamic';

function parseYearParam(raw: string | undefined): number | null {
  return raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
}

export default async function MyPayslips({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const guard = await loadSelfPortal('hr.payroll.read.own');
  if (!guard.ok) return guard.note;

  const { year: yearParam } = await searchParams;
  const year = parseYearParam(yearParam);

  let list: PayslipListItem[];
  let years: number[];
  try {
    // Same services the API routes render - identical DTO shapes (JSON-safe
    // values), so the cache-writer mirror stays compatible.
    [list, years] = await Promise.all([
      listMyPayslips(guard.employee, year ?? undefined) as unknown as Promise<PayslipListItem[]>,
      listMyPayslipYears(guard.employee),
    ]);
  } catch {
    return (
      <div className="space-y-4">
        <SelfPageHeader
          icon={<Wallet className="h-5 w-5" />}
          tone="from-emerald-500/15 to-teal-500/15 text-emerald-600 dark:text-emerald-400"
          title="My payslips"
          description="Net pay, deductions, and the full computation for every period."
        />
        <ErrorNote message="Could not load your payslips. Try again in a moment." />
      </div>
    );
  }

  const totalNet = list.reduce((acc, p) => acc + Number(p.netPay), 0);

  return (
    <div className="space-y-4">
      <PayslipsCacheWriter data={list} />
      <SelfPageHeader
        icon={<Wallet className="h-5 w-5" />}
        tone="from-emerald-500/15 to-teal-500/15 text-emerald-600 dark:text-emerald-400"
        title="My payslips"
        description="Net pay, deductions, and the full computation for every period."
      />

      {/* v2.29.0: SSR year switcher — plain navigation, every view is
          server-rendered. "All years" shows the latest 60-payslip window. */}
      {years.length > 0 ? (
        <nav aria-label="Filter payslips by year" className="flex flex-wrap items-center gap-1.5">
          {(['all', ...years] as const).map((entry) => {
            const active = entry === 'all' ? year === null : year === entry;
            const href = entry === 'all' ? '/employees/me/payslips' : `/employees/me/payslips?year=${entry}`;
            const label = entry === 'all' ? 'All years' : String(entry);
            return (
              <Link
                key={label}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${
                  active
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted/60'
                }`}
              >
                {label}
              </Link>
            );
          })}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {list.length} payslip{list.length === 1 ? '' : 's'} · {formatKes(totalNet)} net
          </span>
        </nav>
      ) : null}

      <PayslipsView initialList={list} />
    </div>
  );
}
