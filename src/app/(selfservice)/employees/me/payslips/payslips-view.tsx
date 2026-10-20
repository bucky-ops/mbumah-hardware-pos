'use client';

// MBUMAH HARDWARE POS - payslips client view (v2.28.0)
//
// The interactive half of the SSR payslips page: the LIST is server-rendered
// and arrives as `initialList`, while the breakdown dialog keeps its original
// behavior - fetch the detail through the API on open, fall back to this
// device's cache when offline ("Offline view of cached payslips", spec
// acceptance 8). The offline banner tracks the browser's actual connection:
// the list in view was loaded with the page render.

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileDown, WifiOff } from 'lucide-react';
import {
  apiGet,
  EmptyState,
  ErrorNote,
  StatusBadge,
  formatKes,
} from '@/components/hr/self-service-ui';

export interface PayslipListItem {
  id: string;
  payslipNumber: string | null;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  runType: string;
  runStatus: string;
  // v2.161.0: the honest issuance flag — true only after the run posts and
  // the payslip number was stamped. Old cached lists lack it (undefined),
  // which simply hides the issued-date line — never a false promise.
  issued?: boolean;
  grossPay: string;
  totalDeductions: string;
  netPay: string;
  daysWorked: number;
  overtimeHours: string;
  issuedAt: string;
}

interface PayslipDetail {
  id: string;
  payslipNumber: string | null;
  periodName: string;
  earnings: Record<string, string>;
  deductions: Record<string, string>;
  netPay: string;
  stats: { daysWorked: number; daysPresent: number; daysAbsent: number; daysOnLeave: number; overtimeHours: string };
  statutoryIds: Record<string, string> | null;
  breakdown: Record<string, unknown>;
  // v2.161.0: drives the dialog's PDF affordance. undefined (a detail cached
  // by an older build) renders neither the download nor the note.
  issued?: boolean;
}

export const DETAIL_CACHE_PREFIX = 'mbt_self_payslip_v1:';

export function readJsonCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJsonCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

const EARNING_LABELS: Record<string, string> = {
  basicSalary: 'Basic salary',
  houseAllowance: 'House allowance',
  transportAllowance: 'Transport allowance',
  medicalAllowance: 'Medical allowance',
  otherAllowances: 'Other allowances',
  overtimePay: 'Overtime pay',
  grossPay: 'Gross pay',
};

const DEDUCTION_LABELS: Record<string, string> = {
  paye: 'PAYE (income tax)',
  nssf: 'NSSF',
  shif: 'SHIF (health insurance)',
  housingLevy: 'Housing levy',
  payeArrears: 'PAYE arrears',
  loanDeduction: 'Loan / advance',
  otherDeductions: 'Other deductions',
  totalDeductions: 'Total deductions',
};

export function PayslipsView({ initialList }: { initialList: PayslipListItem[] }) {
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PayslipDetail | null>(null);
  const [detailOffline, setDetailOffline] = useState(false);

  useEffect(() => {
    // The list is SSR'd; this island only tracks the connection so the
    // offline banner and the cache-first dialog stay honest about where the
    // numbers on screen came from.
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const openDetail = async (id: string) => {
    setDetailOffline(false);
    setError('');
    const cachedDetail = readJsonCache<PayslipDetail>(DETAIL_CACHE_PREFIX + id);
    if (cachedDetail) setDetail(cachedDetail);
    try {
      const d = await apiGet<PayslipDetail>(`/api/self-service/me/payslips/${id}`);
      setDetail(d);
      writeJsonCache(DETAIL_CACHE_PREFIX + id, d);
    } catch {
      if (!cachedDetail) {
        setError('Could not load the payslip. It will open from cache next time you are online.');
      } else {
        setDetailOffline(true);
      }
    }
  };

  return (
    <div className="space-y-4">
      {offline ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
          <WifiOff className="h-4 w-4" aria-hidden /> Offline — showing the payslips loaded with this page; breakdowns open from the cached copy on this device.
        </div>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}

      {initialList.length === 0 ? (
        <EmptyState
          icon={<FileDown className="h-8 w-8" aria-hidden />}
          title="No payslips yet"
          hint="Payslips appear here after your first payroll run is posted."
        />
      ) : (
        <ul className="space-y-3" aria-label="Payslip list">
          {initialList.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => void openDetail(p.id)}
                className={`group w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${
                  p.runStatus === 'POSTED'
                    ? 'border-l-4 border-l-emerald-400 dark:border-l-emerald-600'
                    : p.runStatus === 'LOCKED'
                      ? 'border-l-4 border-l-amber-400 dark:border-l-amber-600'
                      : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.periodName}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.payslipNumber ?? 'Payslip'} · {p.runType.toLowerCase()} run · {Number(p.overtimeHours).toFixed(0)}h OT
                      {p.issued ? ` · Issued ${new Date(p.issuedAt).toISOString().slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">{formatKes(p.netPay)}</p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      gross {formatKes(p.grossPay)} · ded {formatKes(p.totalDeductions)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <StatusBadge status={p.runStatus} />
                  <span className="flex items-center gap-1 text-[11px] font-medium text-sky-700 transition-colors group-hover:text-sky-700 dark:text-sky-400">
                    <FileDown className="h-3 w-3" aria-hidden /> View breakdown
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Detail dialog */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>Payslip {detail.payslipNumber ?? ''} — {detail.periodName}</DialogTitle>
                <DialogDescription>
                  {detailOffline ? 'Loaded from this device (offline).' : 'Every line comes from the stored computation — nothing is re-derived on screen.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <section aria-label="Earnings" className="rounded-xl border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Earnings</p>
                  <dl className="space-y-1.5">
                    {Object.entries(detail.earnings)
                      .filter(([key]) => key !== 'grossPay')
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between text-sm">
                          <dt className="text-muted-foreground">{EARNING_LABELS[key] ?? key}</dt>
                          <dd className="font-medium tabular-nums">{formatKes(value)}</dd>
                        </div>
                      ))}
                    <div className="flex justify-between border-t pt-1.5 text-sm font-semibold">
                      <dt>Gross pay</dt>
                      <dd className="tabular-nums">{formatKes(detail.earnings.grossPay ?? '0')}</dd>
                    </div>
                  </dl>
                </section>

                <section aria-label="Deductions" className="rounded-xl border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">Deductions</p>
                  <dl className="space-y-1.5">
                    {Object.entries(detail.deductions)
                      .filter(([key]) => key !== 'totalDeductions')
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between text-sm">
                          <dt className="text-muted-foreground">{DEDUCTION_LABELS[key] ?? key}</dt>
                          <dd className="font-medium tabular-nums">{formatKes(value)}</dd>
                        </div>
                      ))}
                    <div className="flex justify-between border-t pt-1.5 text-sm font-semibold">
                      <dt>Total deductions</dt>
                      <dd className="tabular-nums">{formatKes(detail.deductions.totalDeductions ?? '0')}</dd>
                    </div>
                  </dl>
                </section>

                <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-emerald-500/10 to-sky-500/10 p-3.5">
                  <span className="text-sm font-semibold">Net pay</span>
                  <span className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{formatKes(detail.netPay)}</span>
                </div>

                <section aria-label="Period stats" className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ['Days', String(detail.stats.daysWorked)],
                    ['Present', String(detail.stats.daysPresent)],
                    ['On leave', String(detail.stats.daysOnLeave)],
                    ['OT hours', Number(detail.stats.overtimeHours).toFixed(0)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-muted/60 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="text-sm font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </section>

                {detail.statutoryIds ? (
                  <p className="text-center text-[11px] text-muted-foreground">
                    Statutory IDs on this payslip are masked ({Object.values(detail.statutoryIds)[0]}). HR can unmask for official use.
                  </p>
                ) : null}

                {/* v2.161.0: the payslip goes home — the employee can finally
                    take the PDF. Same builders as the HR route, statutory ids
                    masked for self-service (the own-payslip JSON already is). */}
                {detail.issued === true ? (
                  <a
                    href={`/api/self-service/me/payslips/${detail.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="selfservice-payslip-pdf"
                    className="flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  >
                    <FileDown className="h-4 w-4" aria-hidden />
                    Download PDF{detail.payslipNumber ? ` · ${detail.payslipNumber}` : ''}
                  </a>
                ) : detail.issued === false ? (
                  <p data-testid="selfservice-payslip-pdf-pending" className="text-center text-[11px] text-muted-foreground">
                    PDF download unlocks once this payslip is issued (the run posts) — the breakdown above is already live.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
