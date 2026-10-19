'use client';

// MBUMAH HARDWARE POS - /hr/payroll (v2.18.9)
// Payroll run lifecycle console: prepare → submit → approve → post → lock,
// with maker-checker aware actions, per-payslip drill-down (trace + PDF),
// and the corrections (reverse & replace) queue.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, ChevronDown, ChevronRight, Clock, FileDown, Landmark, Loader2, Plus, RefreshCw, Search, ShieldCheck, Wallet, X } from 'lucide-react';
import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';
import { PayrollRunDialog } from '@/components/hr/payroll-run-dialog';
import { PayrollCorrectionsPanel } from '@/components/hr/payroll-corrections-panel';
import { downloadRunDigestCsv } from '@/components/hr/run-digest-csv';
import { emptyPeriodRows, groupRunsByPeriod } from '@/lib/hr/payroll/run-groups';
import { yearMonthRollups, movementSideCellCompact, filterAccountSuggestions, rememberAccountCode, parseRecentAccountCodes, groupAccountsByType, ACCOUNT_PICKER_RECENTS_KEY, type AccountPickerEntry } from '@/lib/hr/payroll/period-journal';

export interface PayrollPeriodDto {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  payDate: string | null;
  status: string;
  periodType: string;
}

export interface PayrollRunDto {
  id: string;
  // v2.100.0: rides the list payload (additive) — the period ledger's door
  // needs the period's id to fetch its journals.
  payrollPeriodId: string;
  runType: string;
  status: string;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  employeeCount: number;
  errorMessage: string | null;
  preparedByUserId: string | null;
  approvedByUserId: string | null;
  /** v2.86.0: the handover's stamp — the runs table says how long a run has waited. */
  submittedAt: string | null;
  submittedById: string | null;
  journalEntryId: string | null;
  createdAt: string;
  payrollPeriod: { name: string; payDate: string | null; startDate: string; endDate: string };
}

// v2.100.0: the period ledger's payload — served by GET /api/payroll/period-journal,
// shaped by the pure builder (src/lib/hr/payroll/period-journal.ts).
export interface PeriodLedgerLineDto {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface PeriodLedgerEntryDto {
  runId: string;
  runType: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  /** Recomputed line sums — the drawer never trusts the payload's own totals. */
  debitSum: number;
  creditSum: number;
  /** Proven at 2dp money precision on BOTH the line sums and the header totals. */
  balanced: boolean;
  lines: PeriodLedgerLineDto[];
}

export interface PeriodJournalPayload {
  period: { id: string; name: string; startDate: string; endDate: string; payDate: string | null };
  entries: PeriodLedgerEntryDto[];
  unsettled: Array<{ runId: string; runType: string; status: string }>;
  missingJournal: Array<{ runId: string; runType: string; status: string }>;
  /** v2.110.0: settled runs with nothing payable — no journal is CORRECT by design. */
  zeroRuns: Array<{ runId: string; runType: string; status: string }>;
}

// v2.102.0: the account movement's payload — served by
// GET /api/payroll/period-journal/account, shaped by the pure builder
// (buildAccountMovement in period-journal.ts). The running balance rides
// SIGNED ON THE ACCOUNT'S NORMAL SIDE: positive reads Dr for a debit-normal
// account, Cr for a credit-normal one; a negative value sits on the other
// side — the UI renders the side letter, never a bare negative.
export interface AccountMovementPayload {
  account: { code: string; name: string; type: string; normalBalance: string };
  period: { name: string; windowLabel: string };
  // v2.104.0: the window the payload SERVED — 'month' (the v2.102 drill)
  // or 'year' (the full-year view). The UI reads the window from HERE, not
  // from its own request state, so the screen cannot call a year a month.
  window: 'month' | 'year';
  opening: { debit: number; credit: number; balance: number; priorLines: number };
  movements: Array<{
    entryNumber: string;
    entryDate: string;
    entryDescription: string;
    source: string;
    debit: number;
    credit: number;
    lineDescription: string | null;
    running: number;
  }>;
  totals: { debit: number; credit: number };
  closing: { balance: number };
  normalBalanceAssumed: boolean;
}

export const RUN_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  APPROVED: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900',
  POSTED: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  LOCKED: 'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900',
  REJECTED: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
  VOIDED: 'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-500 dark:border-zinc-800',
  FAILED: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-300 dark:border-red-900',
};

export const CORRECTION_STATUS_STYLES: Record<string, string> = {
  PENDING: RUN_STATUS_STYLES.PENDING_APPROVAL,
  APPROVED: RUN_STATUS_STYLES.APPROVED,
  APPLIED: RUN_STATUS_STYLES.POSTED,
  REJECTED: RUN_STATUS_STYLES.REJECTED,
};

export function StatusBadge({ status, styles }: { status: string; styles: Record<string, string> }) {
  return (
    <Badge variant="outline" className={`font-medium ${styles[status] ?? ''}`} data-testid={`status-${status}`}>
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}

export const kes = (value: string | number): string =>
  `KES ${Number(value).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// v2.102.0: a normal-side balance reads the way an accountant reads a
// T-account — positive on the account's own side (Dr/Cr per normalBalance),
// negative on the other, zero as an em-dash. Never a bare negative.
export const sideLabel = (balance: number, normalBalance: string): string => {
  if (Math.round(Math.abs(balance) * 100) === 0) return '—';
  const normal = normalBalance === 'CREDIT' ? 'Cr' : 'Dr';
  const opposite = normal === 'Dr' ? 'Cr' : 'Dr';
  return `${kes(Math.abs(balance))} ${balance >= 0 ? normal : opposite}`;
};

export interface ApiIssue {
  employeeName?: string;
  code: string;
  message: string;
}

// v2.133.0: the pre-flight run gate's payload — the service's own shape.
export interface RunGateRowDto {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  consentOk: boolean;
  timesheetOk: boolean;
  blocks: string[];
  gateState: string;
}
export interface RunGateReportDto {
  period: { id: string; name: string; startDate: string; endDate: string; status: string };
  rows: RunGateRowDto[];
  summary: { clear: number; missingConsent: number; timesheetNotApproved: number };
  checkedAt: string;
}

// v2.133.0: the gate panel — the pre-flight verdict read off the run's own
// guardrails. Counts speak first; blocked employees speak per-person in
// prepare's own words; the clear strip says what the desk may now do; a
// voided period says the runs are closed. Failure speaks (rose strip +
// Retry), loading spins a skeleton — never a silent spinner.
function GatePanel({
  periodName,
  report,
  loading,
  error,
  onRetry,
}: {
  periodName: string;
  report: RunGateReportDto | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2" data-testid="payroll-gate-panel" aria-busy>
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-2" data-testid="payroll-gate-panel">
        <div
          role="status"
          data-testid="payroll-gate-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40"
        >
          <p className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> The gate read for {periodName} failed — the desk stays dark rather than guess. {error}
          </p>
          <Button variant="outline" size="sm" onClick={onRetry} aria-label={`Retry the ${periodName} gate read`}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (!report) return null;
  const blocked = report.rows.filter((r) => r.gateState !== 'CLEAR');
  return (
    <div className="space-y-2" data-testid="payroll-gate-panel">
      <p className="text-xs font-medium text-muted-foreground" data-testid="payroll-gate-counts">
        <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        {`${report.summary.clear} clear`}
        {report.summary.missingConsent > 0 ? ` · ${report.summary.missingConsent} missing consent` : ''}
        {report.summary.timesheetNotApproved > 0 ? ` · ${report.summary.timesheetNotApproved} timesheet pending` : ''}
        {` · checked ${formatEatStamp(new Date(report.checkedAt))}`}
      </p>
      {report.period.status === 'VOIDED' ? (
        <p
          role="status"
          data-testid="payroll-gate-voided"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          This period is voided — runs are closed; the gate has nothing to gate.
        </p>
      ) : blocked.length === 0 ? (
        <p
          role="status"
          data-testid="payroll-gate-clear"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          The gate is clear — prepare would proceed for all {report.summary.clear} active employees.
        </p>
      ) : (
        <div className="space-y-1.5">
          {blocked.map((r) => (
            <div
              key={r.employeeId}
              data-testid="payroll-gate-blocked-row"
              className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <Badge
                variant="outline"
                className={`font-mono text-[11px] ${
                  r.gateState === 'MISSING_CONSENT'
                    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                }`}
              >
                {r.gateState}
              </Badge>
              <span className="font-medium">{r.employeeCode}</span>
              <span>{r.employeeName}</span>
              <span className="text-muted-foreground">
                {r.gateState === 'MISSING_CONSENT'
                  ? 'No active data-processing consent on file; payroll blocked.'
                  : 'Attendance for this period has unapproved timesheet days.'}
              </span>
              {r.blocks.length > 1 ? (
                <span className="text-[11px] text-muted-foreground" data-testid="payroll-gate-both-blocks">
                  (prepare would report {r.blocks[0]} first)
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HrPayrollPage() {
  const [periods, setPeriods] = useState<PayrollPeriodDto[] | null>(null);
  const [runs, setRuns] = useState<PayrollRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // v2.113.0: the page speaks deep links. /hr/payroll?run=<id> — the People &
  // Payroll panel's latest-run door — opens straight onto that run's detail
  // dialog (the dialog fetches by id and fail-closes on its own). The seed is
  // a LAZY initializer (no setState-in-effect); the param is stripped once on
  // mount so a refresh or a re-mount never re-opens a stale dialog.
  const [openRunId, setOpenRunId] = useState<string | null>(() => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = new URLSearchParams(window.location.search).get('run');
      return raw && raw.trim() ? raw.trim() : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('run')) {
        sp.delete('run');
        const qs = sp.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    } catch {
      // no URL surface — the dialog still opens, it just cannot be shared
    }
  }, []);
  const [createRunOpen, setCreateRunOpen] = useState(false);
  const [createPeriodOpen, setCreatePeriodOpen] = useState(false);
  const [gateIssues, setGateIssues] = useState<ApiIssue[] | null>(null);
  // v2.133.0: the gate speaks FIRST — one pre-flight panel per period, opened
  // from the period header's rail (beside the Ledger door), fetched fresh on
  // every open (openGate is the single loader, like the consent drawer).
  const [gatePanel, setGatePanel] = useState<{ periodId: string; periodName: string } | null>(null);
  const [gateReport, setGateReport] = useState<RunGateReportDto | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  // v2.53.0: per-row digest CSV export — the filing file for one run, without
  // opening the dialog. Tracks which row's download is in flight.
  const [digestRowId, setDigestRowId] = useState<string | null>(null);
  // Toast-free page: notes render inline next to the table (honest, printable).
  const [digestNote, setDigestNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // v2.98.0: periods fold — a collapsed period keeps its header story
  // (counts, settled net) while its run rows stand down.
  const [collapsedPeriods, setCollapsedPeriods] = useState<ReadonlySet<string>>(new Set());

  const togglePeriod = useCallback((name: string) => {
    setCollapsedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // v2.133.0: the gate speaks FIRST — one loader, a fresh fetch per open
  // (the consent drawer's openHistory pattern), Retry reuses the door's
  // period. The verdict rides the run's OWN guardrails read read-only: the
  // same gates prepare enforces, asked before anyone tries.
  const loadGate = useCallback(async (periodId: string, periodName: string) => {
    setGatePanel({ periodId, periodName });
    setGateReport(null);
    setGateError(null);
    setGateLoading(true);
    try {
      const res = await fetch(`/api/payroll/runs/gate?periodId=${encodeURIComponent(periodId)}`, {
        credentials: 'include',
      });
      const j = (await res.json().catch(() => ({}))) as { success?: boolean; data?: RunGateReportDto; error?: string };
      if (!res.ok || !j.success || !j.data) throw new Error(j.error || `The gate read failed (${res.status}).`);
      setGateReport(j.data);
    } catch (e: unknown) {
      setGateError(e instanceof Error ? e.message : 'The gate read failed.');
    } finally {
      setGateLoading(false);
    }
  }, []);

  const toggleGate = useCallback(
    (periodId: string, periodName: string) => {
      if (gatePanel?.periodId === periodId) {
        setGatePanel(null);
        setGateReport(null);
        setGateError(null);
        return;
      }
      void loadGate(periodId, periodName);
    },
    [gatePanel?.periodId, loadGate],
  );

  // v2.100.0: the period opens its ledger — one fetch per open (money must
  // be current), dialog-scoped state, no global churn.
  const [ledgerPeriodId, setLedgerPeriodId] = useState<string | null>(null);
  const [ledgerPeriodName, setLedgerPeriodName] = useState<string | null>(null);
  const [ledger, setLedger] = useState<PeriodJournalPayload | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const openPeriodJournal = useCallback(
    async (periodId: string, periodName?: string) => {
      if (!periodId || ledgerLoading) return;
      if (periodName) setLedgerPeriodName(periodName);
      setLedgerPeriodId(periodId);
      setLedgerLoading(true);
      setLedgerError(null);
      setLedger(null);
      try {
        const res = await fetch(`/api/payroll/period-journal?periodId=${encodeURIComponent(periodId)}`, {
          credentials: 'include',
        });
        // House envelope: { success, data } — the ledger lives in .data.
        const body = (await res.json().catch(() => null)) as
          | { success?: boolean; error?: string; data?: Partial<PeriodJournalPayload> }
          | null;
        if (!res.ok || !body?.success || !body.data?.period || !body.data.entries) {
          setLedgerError(body?.error || `Ledger API unreachable (${res.status}).`);
        } else {
          setLedger(body.data as PeriodJournalPayload);
        }
      } catch {
        setLedgerError('Ledger is unreachable. Check your connection and try again.');
      } finally {
        setLedgerLoading(false);
      }
    },
    [ledgerLoading],
  );

  const exportRunDigest = useCallback(
    async (runId: string) => {
      if (digestRowId) return;
      setDigestRowId(runId);
      setDigestNote(null);
      try {
        const dl = await downloadRunDigestCsv(runId);
        setDigestNote({
          tone: 'ok',
          text: `Digest CSV downloaded — ${dl.filename} (${dl.sizeLabel}). Same per-employee summary the approval and posting emails carry.`,
        });
      } catch (e) {
        setDigestNote({ tone: 'err', text: e instanceof Error ? e.message : 'Export failed.' });
      } finally {
        setDigestRowId(null);
      }
    },
    [digestRowId],
  );

  // All state updates happen after awaits, never synchronously in the effect.
  const load = useCallback(async () => {
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/payroll/periods', { credentials: 'include' }),
        fetch('/api/payroll/runs', { credentials: 'include' }),
      ]);
      const p = (await pRes.json().catch(() => ({ data: [] }))) as { data: PayrollPeriodDto[] };
      const r = (await rRes.json().catch(() => ({ data: [] }))) as { data: PayrollRunDto[] };
      if (!pRes.ok || !rRes.ok) {
        const body = (await rRes.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Payroll API unreachable (${rRes.status}).`);
        setPeriods([]);
        setRuns([]);
        return;
      }
      setPeriods(p.data ?? []);
      setRuns(r.data ?? []);
      setError(null);
    } catch {
      setError('Payroll workspace is unreachable. Check your connection and sign in again.');
      setPeriods([]);
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    // Microtask-deferred: the initial fetch must not setState synchronously
    // inside the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [load]);

  const stats = useMemo(() => {
    const list = runs ?? [];
    return [
      {
        label: 'Awaiting approval',
        value: list.filter((r) => r.status === 'PENDING_APPROVAL').length,
        money: false,
        icon: Clock,
        hint: 'Submitted runs waiting for a maker-checked approval',
        tone: 'text-amber-600 dark:text-amber-400',
      },
      {
        label: 'Posted runs',
        value: list.filter((r) => r.status === 'POSTED' || r.status === 'LOCKED').length,
        money: false,
        icon: CheckCircle2,
        hint: 'Journals posted; payslips issued and append-only',
        tone: 'text-emerald-600 dark:text-emerald-400',
      },
      {
        label: 'Net posted (all runs)',
        value: list
          .filter((r) => r.status === 'POSTED' || r.status === 'LOCKED')
          .reduce((s, r) => s + Number(r.totalNet), 0),
        money: true,
        icon: Banknote,
        hint: 'Sum of net pay across posted runs',
        tone: 'text-sky-600 dark:text-sky-400',
      },
      {
        label: 'Payroll periods',
        value: (periods ?? []).length,
        money: false,
        icon: Landmark,
        hint: 'Periods available for runs',
        tone: 'text-violet-600 dark:text-violet-400',
      },
    ];
  }, [runs, periods]);

  // v2.98.0: runs read as periods — the pure builder folds the flat list
  // and does the honest settled-money arithmetic (posted/locked only).
  const periodGroups = useMemo(() => groupRunsByPeriod(runs ?? []), [runs]);
  // v2.134.0: the gate opens onto empty months — the periods the runs table
  // will never render (zero runs) become pre-flight rows, each with the
  // same Gate door the header rail carries, so the front door is reachable
  // BEFORE the first run of the month is prepared.
  const emptyPeriods = useMemo(() => emptyPeriodRows(periods ?? [], periodGroups), [periods, periodGroups]);
  // The row status chip's tone: OPEN months are alive (emerald), everything
  // else speaks its own word in muted ink — a voided month is a closed door,
  // not an error.
  const preflightChipTone = useCallback((status: string) => {
    switch (status) {
      case 'OPEN':
        return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
      case 'VOIDED':
        return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
      default:
        return 'border-border bg-muted text-muted-foreground';
    }
  }, []);
  const allPeriodsOpen =
    periodGroups.length > 1 && periodGroups.every((g) => !collapsedPeriods.has(g.periodName));
  const toggleAllPeriods = useCallback(() => {
    setCollapsedPeriods(allPeriodsOpen ? new Set(periodGroups.map((g) => g.periodName)) : new Set());
  }, [allPeriodsOpen, periodGroups]);

  return (
    <div className="space-y-6" data-testid="payroll-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payroll runs</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Prepare, approve, post, and lock payroll. The preparer can never approve — every posting is a
            balanced, idempotent journal entry, and issued payslips are append-only.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={runs === null} className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreatePeriodOpen(true)} className="gap-1.5">
            <Landmark className="h-4 w-4" /> New period
          </Button>
          <Button size="sm" onClick={() => setCreateRunOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New run
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="overflow-hidden transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.tone}`} aria-hidden />
            </CardHeader>
            <CardContent className="pb-4">
              <div className="text-xl font-semibold tabular-nums">
                {runs === null ? (
                  <Skeleton className="h-6 w-14" />
                ) : s.money ? (
                  kes(s.value as number)
                ) : (
                  (s.value as number)
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="runs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="corrections">Corrections</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-4">
          {gateIssues && (
            <Card className="border-amber-300 dark:border-amber-900">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" /> Payroll gates blocked preparation
                </CardTitle>
                <CardDescription>
                  Resolve these issues, then re-prepare. Nothing was posted; the run stays in draft.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {gateIssues.map((issue, i) => (
                  <div
                    key={`${issue.code}-${i}`}
                    className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <Badge variant="outline" className="font-mono text-[11px]">{issue.code}</Badge>
                    <span className="font-medium">{issue.employeeName || 'Employee'}</span>
                    <span className="text-muted-foreground">{issue.message}</span>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setGateIssues(null)}>Dismiss</Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Runs by period</CardTitle>
                  <CardDescription>
                    Runs read as periods, newest first — settled net counts posted and locked runs
                    only; waiting runs are estimates until they post.
                  </CardDescription>
                </div>
                {periodGroups.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={toggleAllPeriods}
                    data-testid="payroll-periods-toggle-all"
                  >
                    {allPeriodsOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {allPeriodsOpen ? 'Collapse all' : 'Expand all'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!runs ? (
                <div className="space-y-2 p-4">
                  {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : runs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <Wallet className="h-8 w-8 text-muted-foreground/40" aria-hidden />
                  <p className="text-sm font-medium">No payroll runs yet</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Create a period (e.g. “January 2026”), then start a run. You will prepare payslips,
                    submit for approval, and post a balanced journal.
                  </p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setCreateRunOpen(true)}>
                    Start your first run
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Run</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="text-right">Payslips</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {periodGroups.map((group) => {
                        const open = !collapsedPeriods.has(group.periodName);
                        const chips: Array<{ key: string; label: string; cls: string; dot: string }> = [];
                        if (group.settledCount > 0)
                          chips.push({
                            key: 'settled',
                            label: `${group.settledCount} settled`,
                            cls: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
                            dot: 'bg-emerald-500',
                          });
                        if (group.inMotionCount > 0)
                          chips.push({
                            key: 'waiting',
                            label: `${group.inMotionCount} waiting`,
                            cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
                            dot: 'bg-amber-500',
                          });
                        if (group.attentionCount > 0)
                          chips.push({
                            key: 'attention',
                            label: `${group.attentionCount} need attention`,
                            cls: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300',
                            dot: 'bg-rose-500',
                          });
                        if (group.voidedCount > 0)
                          chips.push({
                            key: 'voided',
                            label: `${group.voidedCount} voided`,
                            cls: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400',
                            dot: 'bg-zinc-400',
                          });
                        return (
                          <Fragment key={group.periodName}>
                            {/* v2.98.0: the period IS the row — one header per month,
                                runs folded beneath, settled money (posted + locked
                                only) summed where the eye lands first. The header is
                                the story even collapsed: counts never stand down. */}
                            <TableRow
                              data-testid="payroll-period-group"
                              className="border-y bg-muted/50 transition-colors hover:bg-muted/70"
                            >
                              <TableCell colSpan={7} className="p-0">
                                {/* v2.100.0: the header splits — the fold stays the
                                    fold, and the ledger gets its own door on the right
                                    rail (a real button BESIDE the toggle, never nested
                                    inside it). */}
                                <div className="flex w-full items-stretch">
                                  <button
                                    type="button"
                                    onClick={() => togglePeriod(group.periodName)}
                                    aria-expanded={open}
                                    aria-label={`${open ? 'Collapse' : 'Expand'} the ${group.periodName} payroll period`}
                                    data-testid="payroll-period-toggle"
                                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left"
                                  >
                                  {open ? (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                  )}
                                  <span className="text-sm font-semibold tracking-tight">{group.periodName}</span>
                                  {group.payDate && (
                                    <span className="text-[11px] text-muted-foreground">
                                      pays {formatEatStamp(new Date(group.payDate))}
                                    </span>
                                  )}
                                  <span className="flex flex-wrap items-center gap-1.5" data-testid="payroll-period-rollup">
                                    {chips.map((c) => (
                                      <span
                                        key={c.key}
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${c.cls}`}
                                      >
                                        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden />
                                        {c.label}
                                      </span>
                                    ))}
                                  </span>
                                  <span className="ml-auto flex items-center gap-3 pl-2">
                                    <span className="hidden text-right text-[11px] leading-tight text-muted-foreground sm:block">
                                      {group.runCount} {group.runCount === 1 ? 'run' : 'runs'}
                                      {' · '}
                                      {group.settledPayslips} {group.settledPayslips === 1 ? 'payslip' : 'payslips'} issued
                                    </span>
                                    <span className="text-right">
                                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Settled net</span>
                                      <span className="block text-sm font-semibold tabular-nums" data-testid="payroll-period-net">
                                        {kes(group.settledNet)}
                                      </span>
                                    </span>
                                  </span>
                                  </button>
                                  <div className="flex items-center border-l border-border/70 pr-2">
                                    {/* v2.133.0: the gate speaks FIRST — a pre-flight
                                        read of the run's own guardrails, before anyone
                                        tries. Beside the Ledger door, never inside the
                                        fold (the v2.100.0 rail rule). */}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-border"
                                      aria-label={`Check the ${group.periodName} run gate`}
                                      title="Who the run gate would block, before anyone tries — the same gates prepare enforces, read-only"
                                      data-testid="payroll-period-gate"
                                      onClick={() => toggleGate(group.runs[0]?.payrollPeriodId ?? '', group.periodName)}
                                    >
                                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                                      <span className="hidden sm:inline">Gate</span>
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-border"
                                      aria-label={`Open the ${group.periodName} journal ledger`}
                                      title="The month's posted journals — every entry, every line, balance proven"
                                      data-testid="payroll-period-journal"
                                      onClick={() => void openPeriodJournal(group.runs[0]?.payrollPeriodId ?? '', group.periodName)}
                                    >
                                      <Landmark className="h-3.5 w-3.5" aria-hidden />
                                      <span className="hidden sm:inline">Ledger</span>
                                    </Button>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                            {open && gatePanel && gatePanel.periodId === (group.runs[0]?.payrollPeriodId ?? '') && (
                              <TableRow className="hover:bg-transparent" data-testid="payroll-gate-panel-row">
                                <TableCell colSpan={7} className="border-b bg-muted/30 px-4 py-3">
                                  <GatePanel
                                    periodName={gatePanel.periodName}
                                    report={gateReport}
                                    loading={gateLoading}
                                    error={gateError}
                                    onRetry={() => gatePanel && void loadGate(gatePanel.periodId, gatePanel.periodName)}
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                            {open &&
                              group.runs.map((run) => (
                                <TableRow key={run.id} className="group transition-colors hover:bg-muted/40">
                                  <TableCell>
                                    <Badge variant="secondary" className="text-[11px]">{run.runType}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <StatusBadge status={run.status} styles={RUN_STATUS_STYLES} />
                                    {/* v2.86.0: the waiting run wears its handover's age —
                                        the same EAT clock every filing surface uses. */}
                                    {run.status === 'PENDING_APPROVAL' && run.submittedAt && (
                                      <p
                                        className="mt-0.5 text-[10px] tabular-nums text-muted-foreground"
                                        data-testid="payroll-run-waiting-since"
                                      >
                                        waiting since {formatEatStamp(new Date(run.submittedAt))}
                                      </p>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{kes(run.totalGross)}</TableCell>
                                  <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                                    {kes(run.totalDeductions)}
                                  </TableCell>
                                  <TableCell className="text-right font-semibold tabular-nums">{kes(run.totalNet)}</TableCell>
                                  <TableCell className="text-right tabular-nums">{run.employeeCount}</TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {['APPROVED', 'POSTED', 'LOCKED'].includes(run.status) && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 gap-1 px-2 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40 dark:hover:text-violet-200"
                                          disabled={digestRowId !== null}
                                          aria-label={`Download the digest CSV for the ${run.payrollPeriod.name} ${run.runType} run`}
                                          title="The run's filing file — same per-employee summary the digest emails carry"
                                          onClick={() => void exportRunDigest(run.id)}
                                        >
                                          {digestRowId === run.id ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          ) : (
                                            <FileDown className="h-3.5 w-3.5" />
                                          )}
                                          <span className="hidden text-xs lg:inline">{digestRowId === run.id ? 'Exporting…' : 'Digest CSV'}</span>
                                        </Button>
                                      )}
                                      <Button variant="outline" size="sm" onClick={() => setOpenRunId(run.id)}>
                                        Open
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* v2.134.0: the gate opens onto empty months — a run-less period
              renders here, not nowhere. Each row carries the SAME gate door
              the header rail carries (same loader, same panel, same aria
              family), so the pre-flight read is reachable before the first
              run of the month is prepared — the front door unlocks from
              the outside. */}
          {emptyPeriods.length > 0 && (
            <Card data-testid="payroll-preflight-section">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
                  Pre-flight months
                </CardTitle>
                <CardDescription>
                  Periods with no runs yet — check the run gate before preparing the first run. The
                  door reads the same guardrails prepare enforces, read-only; no run is created.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="overflow-hidden rounded-md border" data-testid="payroll-preflight-list">
                  {emptyPeriods.map((row) => (
                    <li
                      key={row.periodId}
                      data-testid={`payroll-preflight-row-${row.periodId}`}
                      className="px-3 py-2.5 transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <span className="truncate">{row.periodName}</span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${preflightChipTone(row.status)}`}
                              data-testid={`payroll-preflight-status-${row.periodId}`}
                            >
                              {row.status ? row.status.toUpperCase() : 'UNKNOWN'}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            {formatEatStamp(new Date(row.startDate))} → {formatEatStamp(new Date(row.endDate))}
                            {row.payDate ? ` · pays ${formatEatStamp(new Date(row.payDate))}` : ' · pay date not set'}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-border focus-visible:ring-1 focus-visible:ring-ring"
                          aria-label={`Check the ${row.periodName} run gate`}
                          title="Who the run gate would block, before anyone tries — the same gates prepare enforces, read-only"
                          data-testid="payroll-preflight-gate"
                          onClick={() => toggleGate(row.periodId, row.periodName)}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                          <span className="hidden sm:inline">Gate</span>
                        </Button>
                      </div>
                      {gatePanel?.periodId === row.periodId && (
                        <div className="mt-2 rounded-md bg-muted/30 px-3 py-2" data-testid="payroll-preflight-gate-panel">
                          <GatePanel
                            periodName={gatePanel.periodName}
                            report={gateReport}
                            loading={gateLoading}
                            error={gateError}
                            onRetry={() => gatePanel && void loadGate(gatePanel.periodId, gatePanel.periodName)}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* v2.53.0: inline note for the row-level digest CSV download. */}
          {digestNote && (
            <div
              role="status"
              className={`rounded-md border px-3 py-2 text-xs ${
                digestNote.tone === 'ok'
                  ? 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {digestNote.text}
            </div>
          )}
        </TabsContent>

        <TabsContent value="corrections">
          <PayrollCorrectionsPanel onChanged={() => void load()} />
        </TabsContent>
      </Tabs>

      <PayrollRunDialog
        runId={openRunId}
        onClose={() => {
          setOpenRunId(null);
          setGateIssues(null);
        }}
        onChanged={() => void load()}
      />

      <PeriodJournalDrawer
        periodName={ledgerPeriodName}
        payload={ledger}
        loading={ledgerLoading}
        error={ledgerError}
        onClose={() => {
          setLedgerPeriodId(null);
          setLedgerPeriodName(null);
        }}
        onRetry={() => {
          if (ledgerPeriodId) void openPeriodJournal(ledgerPeriodId);
        }}
        onOpenRun={(runId) => {
          // v2.111.0: the drawer's settled-run chips are DOORS — clicking one
          // hands the run to the run-detail dialog (one drawer closes, one
          // opens; never two dialogs stacked).
          setLedgerPeriodId(null);
          setLedgerPeriodName(null);
          setOpenRunId(runId);
        }}
      />

      <CreateRunDialog
        open={createRunOpen}
        periods={periods ?? []}
        onOpenChange={setCreateRunOpen}
        onCreated={(id) => {
          setCreateRunOpen(false);
          void load();
          setOpenRunId(id);
        }}
        onOpenPeriods={() => setCreatePeriodOpen(true)}
      />

      <CreatePeriodDialog
        open={createPeriodOpen}
        onOpenChange={setCreatePeriodOpen}
        onCreated={() => {
          setCreatePeriodOpen(false);
          void load();
        }}
      />
    </div>
  );
}

// ── Period ledger drawer (v2.100.0) ──────────────────────────────────────────

function PeriodJournalDrawer({
  periodName,
  payload,
  loading,
  error,
  onClose,
  onRetry,
  onOpenRun,
}: {
  periodName: string | null;
  payload: PeriodJournalPayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  /** v2.111.0: settled-run chips are doors — hand the run to the run dialog. */
  onOpenRun?: (runId: string) => void;
}) {
  const p = payload?.period;
  // v2.101.0: the ledger files itself — the governed CSV exit rides the
  // drawer footer. State lives here: the drawer is the file's source, and
  // a stale note from a previous period must never greet the next open.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvNote, setCsvNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // v2.102.0: the account opens its month — the per-line drill state.
  // drillCode (which account's door is open) + the movement payload/error.
  const [drillCode, setDrillCode] = useState<string | null>(null);
  const [drill, setDrill] = useState<AccountMovementPayload | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  // v2.104.0: the window the drill ASKED for — 'month' on every fresh open
  // (a door opens on the month it was clicked in), switched by the toggle,
  // reset per close and per period. The SERVED window rides drill.window;
  // after a load the two always agree.
  const [drillWindow, setDrillWindow] = useState<'month' | 'year'>('month');
  // v2.103.0: the drill's own filing door — busy flag + note, reset per open
  // and per period (the same stale-state hygiene the ledger CSV note taught).
  const [movementCsvBusy, setMovementCsvBusy] = useState(false);
  const [movementCsvNote, setMovementCsvNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // v2.105.0: the picker — the ledger answers for any account. The index
  // (the org's chart, lite, with in-period activity counts) fetches once per
  // period; the query/highlight/open state resets with it, so one month's
  // typing never greets the next. A failed index stays honest by absence:
  // no suggestions render, typing a code still asks the ledger, and the
  // drill's own 404 answers an unknown code plainly.
  const [pickerAccounts, setPickerAccounts] = useState<AccountPickerEntry[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerHighlight, setPickerHighlight] = useState(0);
  // v2.106.0: the picker remembers and browses. The browse door shows the
  // whole chart grouped by type (focus + empty query, then the door); the
  // recents are the doors THIS browser opened, re-validated against the
  // fetched chart on every read — a stale or foreign code never renders.
  // Both reset with the picker's per-period hygiene; the memory itself
  // persists (it is a memory, not a period state) but re-answers to the
  // chart each time the index lands.
  const [pickerBrowseOpen, setPickerBrowseOpen] = useState(false);
  const [pickerRecents, setPickerRecents] = useState<string[]>([]);
  // v2.107.0: the chart files its month — the browse box's governed exit.
  // v2.108.0: …and its year. TWO doors, one truth: the month door shows the
  // count the index's own badges know (the same window the route
  // re-derives); the year door shows NO count, because the client only
  // knows the month's badges and a guessed number could disagree with the
  // archive — the manifest inside says exactly how many were filed and how
  // many were quiet. No count beats a wrong count. The zip is built
  // SERVER-side through the same builders the single export serves; this
  // side only asks, downloads and reports. Busy + note ride the drawer's
  // stale-state hygiene (reset per period), like every filing door before
  // them.
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleNote, setBundleNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    setCsvNote(null);
    setCsvBusy(false);
    // v2.102.0: a drill opened on one period must never greet the next —
    // same stale-state hygiene the CSV note taught.
    setDrillCode(null);
    setDrill(null);
    setDrillError(null);
    setDrillLoading(false);
    // v2.104.0: a new period opens on the month — the year is a choice,
    // never a leftover.
    setDrillWindow('month');
    // v2.103.0: the movement CSV's note rides the same hygiene.
    setMovementCsvBusy(false);
    setMovementCsvNote(null);
    // v2.105.0: the picker's query and highlight belong to THIS open — the
    // next period starts with an empty box, like every other state here.
    setPickerQuery('');
    setPickerOpen(false);
    setPickerHighlight(0);
    // v2.106.0: the browse door belongs to THIS open too — the next period
    // greets with the idle panel, never an unfolded chart.
    setPickerBrowseOpen(false);
    // v2.107.0: the bundle's note rides the same hygiene.
    setBundleBusy(false);
    setBundleNote(null);
  }, [periodName]);

  // v2.105.0: the picker's index — the org's chart of accounts, lite, with
  // in-period activity counts. One fetch per period (keyed on the period
  // id, the same anchor the drill rides), envelope-narrowed BEFORE any
  // cast (the house discipline): a wrapped, foreign or failed response
  // leaves the index empty, and an empty index is honest — the suggestions
  // simply never render, while typing a code still asks the ledger and the
  // drill's own 404 answers an unknown code plainly. A cancelled fetch
  // (the drawer moved to another period mid-flight) never writes state.
  const pickerPeriodId = payload?.period?.id ?? null;
  useEffect(() => {
    if (!pickerPeriodId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/payroll/period-journal/accounts?periodId=${encodeURIComponent(pickerPeriodId)}`,
          { credentials: 'include' },
        );
        const body = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          data?: { accounts?: unknown };
          error?: string;
        };
        if (
          !res.ok ||
          !body.success ||
          !body.data ||
          !Array.isArray(body.data.accounts)
        ) {
          throw new Error(body.error || `Account index failed (${res.status}).`);
        }
        if (!cancelled) setPickerAccounts(body.data.accounts as AccountPickerEntry[]);
      } catch {
        if (!cancelled) setPickerAccounts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerPeriodId]);

  // v2.106.0: the memory read — the stored recents answer to THIS chart.
  // One re-validation per index landing: only codes the fetched index knows
  // survive (canonicalized to the chart's own spelling), so a stale,
  // foreign or corrupted memory degrades to fewer chips or none, never to
  // a door that 404s. The read is client-local (window.localStorage) and
  // wrapped — a privacy-mode denial is an empty memory, not a crash.
  useEffect(() => {
    if (!pickerAccounts.length) {
      setPickerRecents([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(ACCOUNT_PICKER_RECENTS_KEY);
      setPickerRecents(parseRecentAccountCodes(raw, pickerAccounts.map((a) => a.code)));
    } catch {
      setPickerRecents([]);
    }
  }, [pickerAccounts]);

  // The suggestions are PURE — the same rank every test pins: exact code
  // hit, then code prefix, then name substring; a fresh query starts the
  // highlight at the top match.
  const pickerSuggestions = filterAccountSuggestions(pickerAccounts, pickerQuery);

  // v2.106.0: the browse door's shape — the SAME pure builder every test
  // pins; the flattened row order is what the keyboard walks.
  const pickerGroups = useMemo(
    () => groupAccountsByType(pickerAccounts),
    [pickerAccounts],
  );
  const pickerBrowseRows = useMemo(
    () => pickerGroups.flatMap((g) => g.accounts),
    [pickerGroups],
  );

  // v2.107.0: the bundle files the accounts that POSTED — the index's own
  // badges are the truth (the same window the route re-derives), so the
  // month door's number can never disagree with the archive it fetches.
  // v2.108.0: the YEAR door's calendar year — the period's own first day
  // names it (the SAME definition the route and the account drill serve:
  // the year the period's startDate lives in).
  const bundleActiveCount = useMemo(
    () => pickerAccounts.filter((a) => a.periodLines > 0).length,
    [pickerAccounts],
  );
  const bundleYear = payload?.period?.startDate ? payload.period.startDate.slice(0, 4) : null;

  // v2.107.0: the bundle exit — same download discipline as the ledger CSV
  // and the movement CSV (blob → object URL → anchor click → revoke), the
  // envelope's error narrowed before any use, the note honest either way.
  // v2.108.0: the exit grew a window — the SAME governed route, one
  // querystring word apart, and the note says which word was served.
  const exportAccountBundle = async (bundleWindow: 'month' | 'year') => {
    if (bundleBusy || !payload?.period?.id) return;
    setBundleBusy(true);
    setBundleNote(null);
    try {
      const res = await fetch(
        `/api/payroll/period-journal/accounts/export-bundle?periodId=${encodeURIComponent(payload.period.id)}&window=${bundleWindow}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Bundle export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? 'mbumah-account-movements.zip';
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      setBundleNote({
        tone: 'ok',
        text:
          bundleWindow === 'year'
            ? `Bundle downloaded — ${filename}. One governed zip for the year: a MANIFEST that says what was filed and what was not, then one CSV per account that posted — each file closing its own loop.`
            : `Bundle downloaded — ${filename}. One governed zip: a MANIFEST that says what was filed and what was not, then one CSV per account that posted this month — each file closing its own loop.`,
      });
    } catch (e) {
      setBundleNote({ tone: 'err', text: e instanceof Error ? e.message : 'Bundle export failed.' });
    } finally {
      setBundleBusy(false);
    }
  };

  const pickAccount = (code: string) => {
    setPickerQuery('');
    setPickerOpen(false);
    setPickerHighlight(0);
    setPickerBrowseOpen(false);
    // v2.106.0: the door remembers — but only what the chart knows. An
    // unknown code (the honest-no path) is a question, not a door, and a
    // question is not remembered; a known one is canonicalized to the
    // chart's own spelling before it lands in the memory.
    const known = pickerAccounts.find(
      (a) => String(a.code).toLowerCase() === code.trim().toLowerCase(),
    );
    if (known) {
      setPickerRecents((prev) => {
        const next = rememberAccountCode(prev, known.code);
        try {
          window.localStorage.setItem(ACCOUNT_PICKER_RECENTS_KEY, JSON.stringify(next));
        } catch {
          // private-mode denial: the memory lives in state for this visit
        }
        return next;
      });
    }
    // A picker door opens on the month — the same doctrine every line door
    // follows; the year is one click away on the dialog's window switch.
    void openAccountMovement(code, 'month');
  };

  // v2.106.0: one row renderer for BOTH voices of the picker — suggestions
  // (ranked matches) and browse (the grouped chart). Same badges, same
  // violet highlight family, same month-door doctrine; only the testid/id
  // namespace differs so tests and assistive tech can tell them apart.
  const renderPickerRow = (a: AccountPickerEntry, i: number, variant: 'suggestion' | 'browse') => (
    <button
      type="button"
      key={a.code}
      role="option"
      id={variant === 'suggestion' ? `payroll-account-picker-opt-${i}` : `payroll-account-picker-browse-opt-${i}`}
      aria-selected={i === pickerHighlight}
      data-testid={variant === 'suggestion' ? 'payroll-account-picker-option' : 'payroll-account-picker-browse-option'}
      data-code={a.code}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pickAccount(a.code)}
      onMouseEnter={() => setPickerHighlight(i)}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left outline-none transition-colors ${
        i === pickerHighlight
          ? 'bg-violet-50 dark:bg-violet-950/40'
          : 'bg-transparent'
      }`}
    >
      <span className="font-mono text-[11px] text-muted-foreground">{a.code}</span>
      <span className="min-w-0 truncate text-xs">{a.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {String(a.type ?? '').replaceAll('_', ' ')}
        </span>
        {a.periodLines > 0 ? (
          <span
            data-testid="payroll-account-picker-activity"
            title={`${a.periodLines} posted ${a.periodLines === 1 ? 'line' : 'lines'} in this period — the drill opens on the month`}
            className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-800 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300"
          >
            in this month · {a.periodLines}
          </span>
        ) : (
          <span
            data-testid="payroll-account-picker-quiet"
            title="No posted lines in this period — the account is still askable, the drill will say what it finds"
            className="rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[9px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
          >
            quiet
          </span>
        )}
      </span>
    </button>
  );

  const exportLedgerCsv = async () => {
    if (csvBusy || !payload?.period?.id) return;
    setCsvBusy(true);
    setCsvNote(null);
    try {
      const res = await fetch(`/api/payroll/period-journal/export?periodId=${encodeURIComponent(payload.period.id)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? 'mbumah-period-ledger.csv';
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      setCsvNote({
        tone: 'ok',
        text: `Ledger CSV downloaded — ${filename}. The governed filing format (header block, injection guard, self-balancing Totals line), exactly the entries on this drawer.`,
      });
    } catch (e) {
      setCsvNote({ tone: 'err', text: e instanceof Error ? e.message : 'Export failed.' });
    } finally {
      setCsvBusy(false);
    }
  };

  // v2.102.0: the account opens its month — the per-line drill fetch.
  // Same envelope-narrowing discipline the ledger drawer taught (v2.100):
  // unwrap body.data with honest guards BEFORE any cast, so a wrapped or
  // failed response can never masquerade as a movement.
  // v2.104.0: the window rides the fetch — the payload's echoed window is
  // narrowed too, so a response that cannot say which window it served is
  // refused, never guessed.
  const openAccountMovement = async (code: string, window: 'month' | 'year' = 'month') => {
    if (!payload?.period?.id) return;
    setDrillCode(code);
    setDrillWindow(window);
    setDrillLoading(true);
    setDrillError(null);
    setDrill(null);
    try {
      const res = await fetch(
        `/api/payroll/period-journal/account?periodId=${encodeURIComponent(payload.period.id)}&accountCode=${encodeURIComponent(code)}&window=${window}`,
        { credentials: 'include' },
      );
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: Partial<AccountMovementPayload>;
        error?: string;
      };
      const servedWindow = body.data?.window;
      if (
        !res.ok ||
        !body.success ||
        !body.data ||
        typeof body.data.account?.code !== 'string' ||
        !Array.isArray(body.data.movements) ||
        !body.data.opening ||
        !body.data.closing ||
        (servedWindow !== 'month' && servedWindow !== 'year')
      ) {
        throw new Error(body.error || `Movement API unreachable (${res.status}).`);
      }
      setDrill(body.data as AccountMovementPayload);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Movement failed.');
    } finally {
      setDrillLoading(false);
    }
  };

  // v2.103.0: the account files its month — the drill's governed CSV exit,
  // the ledger CSV's download pattern (blob → anchor → revoke) pointed at
  // the account route's export sibling. Same envelope honesty: a failed
  // response names its reason, never a silent nothing.
  // v2.104.0: the window RIDES THE EXPORT — filing the year fetches
  // window=year, because the file cannot disagree with the screen (found
  // live in E2E: the dialog said year and the file said month).
  const exportMovementCsv = async () => {
    if (movementCsvBusy || !payload?.period?.id || !drillCode) return;
    setMovementCsvBusy(true);
    setMovementCsvNote(null);
    try {
      const res = await fetch(
        `/api/payroll/period-journal/account/export?periodId=${encodeURIComponent(payload.period.id)}&accountCode=${encodeURIComponent(drillCode)}&window=${drillWindow}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? 'mbumah-account-movement.csv';
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      setMovementCsvNote({
        tone: 'ok',
        text: `Movement CSV downloaded — ${filename}. The governed filing format (header block, injection guard), and the Closing line that equals the last replay row — the file closes its own loop, exactly the ${drillWindow === 'year' ? 'year' : 'month'} on this dialog.`,
      });
    } catch (e) {
      setMovementCsvNote({ tone: 'err', text: e instanceof Error ? e.message : 'Export failed.' });
    } finally {
      setMovementCsvBusy(false);
    }
  };

  // Back to the ledger: the drill closes, the drawer stays put.
  const closeDrill = () => {
    setDrillCode(null);
    setDrill(null);
    setDrillError(null);
    setDrillLoading(false);
    // v2.104.0: the window resets too — the next door opens on its month.
    setDrillWindow('month');
    // v2.103.0: the note belongs to THIS drill — the next account opens clean.
    setMovementCsvBusy(false);
    setMovementCsvNote(null);
  };

  // v2.104.0: the year at a glance — the strip's twelve cells, computed from
  // THE SAME replay the dialog shows (the pure builder; no second truth).
  // Only the year view carries a strip; a year the window label refuses to
  // name, or a replay the builder refuses to roll up (impossible by
  // construction — the route guarantees the window and the order), renders
  // no strip rather than a wrong one.
  let drillYearStrip: { year: number; months: ReturnType<typeof yearMonthRollups> } | null = null;
  if (drill && drill.window === 'year') {
    const y = Number(drill.period.windowLabel.slice(0, 4));
    if (Number.isInteger(y)) {
      try {
        drillYearStrip = {
          year: y,
          months: yearMonthRollups(drill.opening.balance, drill.movements, drill.account.normalBalance, y),
        };
      } catch {
        drillYearStrip = null;
      }
    }
  }

  return (
    <>
    <Dialog open={periodName !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="print:hidden max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(e) => {
          // v2.105.0, E2E-caught: while the picker's suggestions speak, the
          // first Esc must dismiss THEM, not the drawer. preventDefault on
          // Radix's own escape event vetoes the dismiss; the picker's input
          // handler has already closed the box. The next Esc (box closed)
          // passes through and the drawer closes the normal way.
          // v2.106.0: the box now opens on focus (idle panel, browse door,
          // recents) — so the veto is the box itself, not the query: ANY
          // open box keeps the drawer shut for one Esc, and the input's
          // handler steps the layers back (browse → box → drawer).
          if (pickerOpen) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
            Period ledger — {p?.name ?? periodName}
          </DialogTitle>
          <DialogDescription>
            {p
              ? `${formatEatStamp(new Date(p.startDate))} → ${formatEatStamp(new Date(p.endDate))}${p.payDate ? ` · pays ${formatEatStamp(new Date(p.payDate))}` : ''} — `
              : ''}
            the month&apos;s posted journals, lines and all. The header&apos;s settled net, checkable to the account.
          </DialogDescription>
        </DialogHeader>

        {/* v2.105.0: the picker — the ledger answers for any account, not
            just the lines this period happened to post. Same read contract
            as the drill it opens; a fresh door opens on the month. */}
        {p && (
          <div className="relative" data-testid="payroll-account-picker">
            <label
              htmlFor="payroll-account-picker-input"
              className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              Find any account
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
                aria-hidden
              />
              <input
                id="payroll-account-picker-input"
                data-testid="payroll-account-picker-input"
                value={pickerQuery}
                onChange={(e) => {
                  setPickerQuery(e.target.value);
                  setPickerOpen(true);
                  setPickerHighlight(0);
                  // v2.106.0: typing leaves the browse chart — the query
                  // speaks for itself, and the two never mix.
                  if (e.target.value.trim()) setPickerBrowseOpen(false);
                }}
                onFocus={() => {
                  // v2.106.0: focus opens the box even with an empty query —
                  // the idle panel greets with the remembered doors and the
                  // browse chart, so an account needs no spelling at all.
                  setPickerOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    // v2.106.0: in browse mode the keyboard walks the chart.
                    if (pickerBrowseOpen && !pickerQuery.trim()) {
                      if (!pickerBrowseRows.length) return;
                      setPickerHighlight((h) => Math.min(h + 1, pickerBrowseRows.length - 1));
                      return;
                    }
                    if (!pickerSuggestions.length) return;
                    setPickerOpen(true);
                    setPickerHighlight((h) => Math.min(h + 1, pickerSuggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (pickerBrowseOpen && !pickerQuery.trim()) {
                      if (!pickerBrowseRows.length) return;
                      setPickerHighlight((h) => Math.max(h - 1, 0));
                      return;
                    }
                    if (!pickerSuggestions.length) return;
                    setPickerHighlight((h) => Math.max(h - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (pickerBrowseOpen && !pickerQuery.trim()) {
                      const row = pickerBrowseRows[pickerHighlight];
                      if (row) pickAccount(row.code);
                      return;
                    }
                    const pick = pickerSuggestions[pickerHighlight] ?? pickerSuggestions[0];
                    if (pick) {
                      pickAccount(pick.code);
                    } else if (pickerQuery.trim()) {
                      // No index match is not a refusal: the query goes to
                      // the ledger as a code, and an unknown one gets the
                      // drill's honest 404 — the answer, not a guess.
                      pickAccount(pickerQuery.trim());
                    }
                  } else if (e.key === 'Escape') {
                    // E2E-caught (v2.105.0): a bare Esc here dismissed the
                    // suggestions AND closed the whole ledger drawer —
                    // Radix's dismissable layer hears the key above React's
                    // synthetic reach (a stopPropagation here was proven
                    // NOT to stop it live). So the local handler only
                    // steps the layers back; the drawer's own
                    // onEscapeKeyDown guard below decides whether the
                    // drawer may close: the FIRST Esc belongs to the box
                    // (browse, then box), the NEXT closes the drawer the
                    // Radix way.
                    if (pickerBrowseOpen) setPickerBrowseOpen(false);
                    else if (pickerOpen) setPickerOpen(false);
                  }
                }}
                placeholder="Type a code or name — e.g. 5200 or Salaries"
                autoComplete="off"
                role="combobox"
                aria-controls="payroll-account-picker-suggestions payroll-account-picker-browse"
                aria-expanded={pickerOpen && (pickerQuery.trim().length > 0 || pickerBrowseOpen)}
                aria-autocomplete="list"
                aria-activedescendant={
                  pickerOpen && pickerBrowseOpen && !pickerQuery.trim() && pickerBrowseRows[pickerHighlight]
                    ? `payroll-account-picker-browse-opt-${pickerHighlight}`
                    : pickerOpen && pickerSuggestions[pickerHighlight]
                      ? `payroll-account-picker-opt-${pickerHighlight}`
                      : undefined
                }
                className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:focus-visible:border-violet-600"
              />
            </div>
            {pickerOpen && pickerQuery.trim().length > 0 && (
              <div
                role="listbox"
                id="payroll-account-picker-suggestions"
                aria-label="Account suggestions"
                data-testid="payroll-account-picker-suggestions"
                className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg"
              >
                {pickerSuggestions.length === 0 ? (
                  <p
                    className="px-3 py-2.5 text-xs text-muted-foreground"
                    data-testid="payroll-account-picker-empty"
                  >
                    Nothing in the chart matches &ldquo;{pickerQuery.trim()}&rdquo; — pressing Enter still asks the ledger, and an unknown code gets an honest no.
                  </p>
                ) : (
                  pickerSuggestions.map((a, i) => renderPickerRow(a, i, 'suggestion'))
                )}
                <div
                  className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground"
                  data-testid="payroll-account-picker-hint"
                >
                  <span><kbd className="rounded border bg-muted px-1 font-mono text-[9px]">↑↓</kbd> move</span>
                  <span><kbd className="rounded border bg-muted px-1 font-mono text-[9px]">Enter</kbd> open</span>
                  <span><kbd className="rounded border bg-muted px-1 font-mono text-[9px]">Esc</kbd> dismiss</span>
                  <span className="ml-auto">{pickerAccounts.length} accounts in the chart</span>
                </div>
              </div>
            )}
            {/* v2.106.0: the idle panel — the box speaks on focus, even with
                an empty query. The remembered doors come back as chips
                (validated against THIS chart), and the browse door lists
                the whole chart so an account needs no spelling at all. A
                failed index stays honest by absence: no chips, no door,
                and typing still asks the ledger. */}
            {pickerOpen && pickerQuery.trim().length === 0 && !pickerBrowseOpen && (
              <div
                data-testid="payroll-account-picker-idle"
                className="absolute left-0 right-0 z-20 mt-1 rounded-md border bg-popover shadow-lg"
              >
                {pickerRecents.length > 0 ? (
                  <div className="border-b px-3 py-2" data-testid="payroll-account-picker-recent">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <Clock className="h-3 w-3 text-violet-500 dark:text-violet-400" aria-hidden />
                      Recent
                      {/* v2.108.0: the memory can be let go — one quiet affordance
                          that forgets THIS browser's remembered doors. The chart
                          itself is never touched; the empty note returns, and the
                          next pick starts the memory again. A private-mode denial
                          still leaves the memory alive in state for the visit. */}
                      <button
                        type="button"
                        data-testid="payroll-account-picker-recent-clear"
                        aria-label="Clear recent accounts"
                        title="Forget the remembered accounts in this browser — the chart itself is never touched"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setPickerRecents([]);
                          try {
                            window.localStorage.removeItem(ACCOUNT_PICKER_RECENTS_KEY);
                          } catch {
                            // private-mode denial: the memory still leaves state
                          }
                        }}
                        className="ml-auto inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-muted-foreground outline-none transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:border-red-300 focus-visible:ring-2 focus-visible:ring-red-500/30 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                      >
                        <X className="h-2.5 w-2.5" aria-hidden />
                        Clear
                      </button>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {pickerRecents.map((code) => {
                        const known = pickerAccounts.find((a) => a.code === code);
                        return (
                          <button
                            type="button"
                            key={code}
                            data-testid="payroll-account-picker-recent-chip"
                            data-code={code}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickAccount(code)}
                            title="Recent — a door you opened, remembered in this browser only"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-900 transition-colors hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-900/60"
                          >
                            <Clock className="h-3 w-3 shrink-0 text-violet-500 dark:text-violet-400" aria-hidden />
                            <span className="font-mono text-[10px] text-violet-700 dark:text-violet-300">{code}</span>
                            <span className="min-w-0 truncate">{known?.name ?? code}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  pickerAccounts.length > 0 && (
                    <p className="border-b px-3 py-2 text-[11px] text-muted-foreground" data-testid="payroll-account-picker-recent-empty">
                      Pick an account and it will be remembered here — in this browser only.
                    </p>
                  )
                )}
                {pickerAccounts.length > 0 ? (
                  <button
                    type="button"
                    data-testid="payroll-account-picker-browse-door"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPickerBrowseOpen(true);
                      setPickerHighlight(0);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-violet-700 outline-none transition-colors hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
                  >
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Browse all {pickerAccounts.length} accounts
                    <span className="ml-auto text-[10px] text-muted-foreground">grouped by type</span>
                  </button>
                ) : (
                  <p className="px-3 py-2.5 text-xs text-muted-foreground" data-testid="payroll-account-picker-idle-absent">
                    The chart index did not load — typing a code still asks the ledger, and an unknown code gets an honest no.
                  </p>
                )}
              </div>
            )}
            {/* v2.106.0: the browse door, open — the whole chart, grouped by
                type through the SAME pure builder the tests pin, walked by
                the SAME keyboard contract, wearing the SAME truth badges. */}
            {pickerOpen && pickerQuery.trim().length === 0 && pickerBrowseOpen && (
              <div
                role="listbox"
                id="payroll-account-picker-browse"
                aria-label="The chart of accounts, grouped by type"
                data-testid="payroll-account-picker-browse"
                className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg"
              >
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-violet-50/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-violet-800 backdrop-blur dark:bg-violet-950/85 dark:text-violet-300" data-testid="payroll-account-picker-browse-head">
                  <span>The chart — {pickerAccounts.length} accounts</span>
                  <button
                    type="button"
                    data-testid="payroll-account-picker-browse-close"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setPickerBrowseOpen(false)}
                    className="ml-auto rounded border border-violet-200 bg-white/70 px-1.5 py-0.5 text-[9px] normal-case text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300 dark:hover:bg-violet-900/60"
                  >
                    collapse
                  </button>
                </div>
                {pickerGroups.map((g) => (
                  <Fragment key={g.type}>
                    <div
                      className="sticky top-[30px] z-[5] flex items-center gap-2 border-b bg-zinc-50/95 px-3 py-1 text-[9px] font-medium uppercase tracking-wider text-zinc-500 backdrop-blur dark:bg-zinc-900/90 dark:text-zinc-400"
                      data-testid="payroll-account-picker-group"
                      data-type={g.type}
                    >
                      <span>{String(g.type).replaceAll('_', ' ')}</span>
                      <span className="ml-auto rounded-full border border-zinc-200 bg-white/70 px-1.5 text-[9px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-400">{g.accounts.length}</span>
                    </div>
                    {g.accounts.map((a) => renderPickerRow(a, pickerBrowseRows.indexOf(a), 'browse'))}
                  </Fragment>
                ))}
                {/* v2.107.0: the chart files its month — the browse box's
                    governed exit. Only when the chart has something to say
                    (at least one account posted); the note rides the same
                    stale hygiene as every filing door before it. */}
                {bundleActiveCount > 0 && (
                  <div className="border-t px-3 py-2" data-testid="payroll-account-bundle-row">
                    {/* v2.108.0: the pair gets its own micro-heading — the exit
                        is a place now, not a stray button. */}
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <FileDown className="h-3 w-3 text-violet-500 dark:text-violet-400" aria-hidden />
                      File the chart
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        data-testid="payroll-account-bundle-door"
                        disabled={bundleBusy}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void exportAccountBundle('month')}
                        title={bundleBusy ? 'Building the bundle…' : `One zip: a MANIFEST plus one CSV per account that posted this month (${bundleActiveCount} files)`}
                        className="flex w-full flex-col items-start gap-0.5 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-left text-xs font-medium text-violet-800 outline-none transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-900/60"
                      >
                        <span className="flex w-full items-center gap-2">
                          {bundleBusy ? 'Building…' : `File all ${bundleActiveCount} accounts`}
                        </span>
                        <span className="text-[10px] font-normal text-muted-foreground">one zip · month window</span>
                      </button>
                      {/* v2.108.0: the year door — no count on purpose (the client
                          only knows the month's badges; no count beats a wrong
                          count), the manifest inside says the real numbers. */}
                      <button
                        type="button"
                        data-testid="payroll-account-bundle-year-door"
                        disabled={bundleBusy}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void exportAccountBundle('year')}
                        title={bundleBusy ? 'Building the bundle…' : `One zip: a MANIFEST plus one CSV per account that posted in ${bundleYear ?? 'the year'} — the manifest says how many`}
                        className="flex w-full flex-col items-start gap-0.5 rounded-md border border-violet-200 bg-white/60 px-3 py-2 text-left text-xs font-medium text-violet-800 outline-none transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-900 dark:bg-violet-950/25 dark:text-violet-200 dark:hover:bg-violet-950/50"
                      >
                        <span className="flex w-full items-center gap-2">
                          {bundleBusy ? 'Building…' : 'File the year'}
                        </span>
                        <span className="text-[10px] font-normal text-muted-foreground">
                          one zip · {bundleYear ? `${bundleYear} window` : 'year window'}
                        </span>
                      </button>
                    </div>
                    {bundleNote && (
                      <p
                        className={`mt-1.5 text-[11px] ${
                          bundleNote.tone === 'ok'
                            ? 'text-violet-700 dark:text-violet-300'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                        data-testid="payroll-account-bundle-note"
                        role="status"
                      >
                        {bundleNote.text}
                      </p>
                    )}
                  </div>
                )}
                <div
                  className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground"
                  data-testid="payroll-account-picker-browse-hint"
                >
                  <span><kbd className="rounded border bg-muted px-1 font-mono text-[9px]">↑↓</kbd> move</span>
                  <span><kbd className="rounded border bg-muted px-1 font-mono text-[9px]">Enter</kbd> open</span>
                  <span><kbd className="rounded border bg-muted px-1 font-mono text-[9px]">Esc</kbd> collapse</span>
                  <span className="ml-auto">{pickerGroups.length} types</span>
                </div>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="space-y-2" data-testid="payroll-ledger-loading">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        )}

        {!loading && error && (
          <div className="space-y-2">
            <div
              role="alert"
              data-testid="payroll-ledger-error"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {error}
            </div>
            <Button variant="outline" size="sm" onClick={onRetry} data-testid="payroll-ledger-retry">
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && payload && (
          <div className="space-y-4">
            {payload.entries.length === 0 && payload.unsettled.length === 0 && payload.missingJournal.length === 0 && payload.zeroRuns.length === 0 && (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground" data-testid="payroll-ledger-empty">
                Nothing posted in this period yet.
              </p>
            )}

            {payload.entries.map((entry) => (
              <div key={entry.runId} className="rounded-lg border bg-muted/30 p-3" data-testid="payroll-ledger-entry">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">{entry.runType}</Badge>
                  <span className="font-mono text-[11px] text-muted-foreground">{entry.entryNumber}</span>
                  <span className="text-[11px] text-muted-foreground">· {formatEatStamp(new Date(entry.entryDate))}</span>
                  <span className="ml-auto" data-testid="payroll-ledger-balanced">
                    {entry.balanced ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                        Balanced · {kes(entry.debitSum)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Unbalanced · off by {kes(Math.abs(entry.debitSum - entry.creditSum))}
                      </span>
                    )}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{entry.description}</p>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 text-[11px]">Account</TableHead>
                      <TableHead className="h-8 text-right text-[11px]">Debit</TableHead>
                      <TableHead className="h-8 text-right text-[11px]">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.lines.map((line, i) => (
                      <TableRow
                        key={`${entry.runId}-${i}`}
                        className="cursor-pointer odd:bg-muted/40 hover:bg-violet-50/60 dark:hover:bg-violet-950/20"
                        data-testid="payroll-ledger-line"
                        onClick={(e) => {
                          // The button is THE door (keyboard + aria); row
                          // clicks open too, but never double-fire when the
                          // door itself was the target.
                          if ((e.target as HTMLElement).closest('[data-testid=payroll-ledger-line-door]')) return;
                          void openAccountMovement(line.accountCode);
                        }}
                      >
                        <TableCell className="py-1.5">
                          <button
                            type="button"
                            className="group/line flex items-center gap-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                            onClick={() => void openAccountMovement(line.accountCode)}
                            aria-label={`Open ${line.accountCode} ${line.accountName} — the account's month movement across this period's ledger`}
                            data-testid="payroll-ledger-line-door"
                          >
                            <span className="font-mono text-[11px] text-muted-foreground">{line.accountCode}</span>{' '}
                            <span className="text-xs underline-offset-2 group-hover/line:underline group-hover/line:decoration-violet-400 dark:group-hover/line:decoration-violet-500">{line.accountName}</span>
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover/line:text-violet-500" aria-hidden />
                          </button>
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                            {line.accountType.replaceAll('_', ' ')}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums">{line.debit ? kes(line.debit) : '—'}</TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums">{line.credit ? kes(line.credit) : '—'}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell className="py-1.5 text-xs font-semibold">Totals</TableCell>
                      <TableCell className="py-1.5 text-right text-xs font-semibold tabular-nums">{kes(entry.debitSum)}</TableCell>
                      <TableCell className="py-1.5 text-right text-xs font-semibold tabular-nums">{kes(entry.creditSum)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ))}

            {payload.unsettled.length > 0 && (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                data-testid="payroll-ledger-unsettled"
              >
                <p className="font-medium">
                  {payload.unsettled.length} {payload.unsettled.length === 1 ? 'run' : 'runs'} in motion — no journal yet.
                </p>
                <p className="mt-0.5 text-[11px]">The entry posts when the run posts; until then it stays a count, never money.</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {payload.unsettled.map((r) => (
                    <span
                      key={r.runId}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100/70 px-2 py-0.5 text-[10px] dark:border-amber-800 dark:bg-amber-900/40"
                    >
                      {r.runType} · {r.status.replaceAll('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* v2.110.0: zero runs ride their OWN quiet block — a run with nothing
                payable posts no journal by design. Surfaced, never alarming: the
                red alarm keeps its teeth for money that truly went missing. */}
            {payload.zeroRuns.length > 0 && (
              <div
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
                data-testid="payroll-ledger-zero-runs"
              >
                <p className="font-medium">
                  {payload.zeroRuns.length} zero-value {payload.zeroRuns.length === 1 ? 'run' : 'runs'} settled — nothing was payable, so no journal posts.
                </p>
                <p className="mt-0.5 text-[11px]">Correct by design: a run owing KES 0.00 has no entry to carry. This is not the missing-journal alarm.</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {payload.zeroRuns.map((r) => (
                    <button
                      key={r.runId}
                      type="button"
                      onClick={() => onOpenRun?.(r.runId)}
                      aria-label={`Open the ${r.runType} run's detail — a zero-value settled run`}
                      title="A zero run has no journal — open its run detail"
                      data-testid="payroll-ledger-zero-run-door"
                      className="group/door inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] transition-colors hover:border-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                    >
                      {r.runType} · {r.status.replaceAll('_', ' ')} · KES 0.00
                      <ChevronRight className="h-3 w-3 text-slate-400 transition-colors group-hover/door:text-violet-500" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {payload.missingJournal.length > 0 && (
              <div
                role="alert"
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                data-testid="payroll-ledger-missing"
              >
                <p className="font-medium">
                  {payload.missingJournal.length} settled {payload.missingJournal.length === 1 ? 'run has' : 'runs have'} no journal — this must never happen.
                </p>
                <p className="mt-0.5 text-[11px]">The header counts their money, but no entry carries it. Re-post or investigate before trusting this period.</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {payload.missingJournal.map((r) => (
                    <button
                      key={r.runId}
                      type="button"
                      onClick={() => onOpenRun?.(r.runId)}
                      aria-label={`Open the ${r.runType} run's detail — a settled run missing its journal`}
                      title="Open the run's detail to investigate the missing journal"
                      data-testid="payroll-ledger-missing-run-door"
                      className="group/door inline-flex items-center gap-1 rounded-full border border-rose-300 bg-white px-2 py-0.5 text-[10px] transition-colors hover:border-rose-400 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-rose-800 dark:bg-rose-950/40 dark:hover:border-rose-600"
                    >
                      {r.runType} · {r.status.replaceAll('_', ' ')}
                      <ChevronRight className="h-3 w-3 text-rose-400 transition-colors group-hover/door:text-rose-600" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-2 flex-col gap-2 sm:flex-col">
          {csvNote && (
            <div
              role="status"
              data-testid="payroll-ledger-csv-note"
              className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                csvNote.tone === 'ok'
                  ? 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {csvNote.text}
            </div>
          )}
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40 dark:hover:text-violet-200"
              disabled={csvBusy || !payload || payload.entries.length === 0}
              aria-label="Download the period ledger CSV — the governed filing file of this period's journal entries"
              title={payload && payload.entries.length === 0 ? 'Nothing to file — nothing has posted in this period.' : 'The governed filing file: one row per journal line, a Totals line that balances by itself'}
              data-testid="payroll-ledger-csv"
              onClick={() => void exportLedgerCsv()}
            >
              {csvBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              {csvBusy ? 'Building…' : 'Ledger CSV'}
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* v2.102.0: the account opens its month — the per-line drill dialog,
        layered above the ledger drawer. Back returns to the ledger, never
        closes the drawer; a drill opened on one account never greets the
        next (state resets per open and per period). */}
    <Dialog open={drillCode !== null} onOpenChange={(o) => { if (!o) closeDrill(); }}>
      <DialogContent className="print:hidden max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-testid="payroll-account-movement">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
            Account movement — {drill ? `${drill.account.code} ${drill.account.name}` : drillCode}
          </DialogTitle>
          <DialogDescription>
            {drill
              ? `${drill.period.name} · ${drill.period.windowLabel} — the account's ${drill.window === 'year' ? 'year' : 'month'}, replayed line by line.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {/* v2.104.0: the window switch — the month the door was clicked in,
            or the account's full year. The active side rides the SERVED
            payload's window (via drillWindow, which the fetch set and the
            payload echoed), so the screen cannot call a year a month. */}
        <div className="flex flex-wrap items-center gap-1.5" data-testid="payroll-account-window">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Window</span>
          <button
            type="button"
            onClick={() => { if (drillCode && drillWindow !== 'month') void openAccountMovement(drillCode, 'month'); }}
            disabled={drillLoading || drillWindow === 'month'}
            aria-pressed={drillWindow === 'month'}
            aria-label="Show the period's own month — the drill you opened"
            title="Back to the period's own month"
            data-testid="payroll-account-window-month"
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-default ${
              drillWindow === 'month'
                ? 'border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-700 dark:bg-violet-900/60 dark:text-violet-200'
                : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-violet-700 dark:hover:text-violet-300'
            }`}
          >
            This month
          </button>
          <button
            type="button"
            onClick={() => { if (drillCode && drillWindow !== 'year') void openAccountMovement(drillCode, 'year'); }}
            disabled={drillLoading || drillWindow === 'year'}
            aria-pressed={drillWindow === 'year'}
            aria-label="Show the account's full year — every posted line from January to December, any source, with the year at a glance"
            title="The account's full year — every posted line from January to December, any source, with the year at a glance"
            data-testid="payroll-account-window-year"
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-default ${
              drillWindow === 'year'
                ? 'border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-700 dark:bg-violet-900/60 dark:text-violet-200'
                : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-violet-700 dark:hover:text-violet-300'
            }`}
          >
            Full year
          </button>
        </div>

        {drillLoading && (
          <div className="space-y-2" data-testid="payroll-account-loading">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}

        {!drillLoading && drillError && (
          <div className="space-y-2">
            <div
              role="alert"
              data-testid="payroll-account-error"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {drillError}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => drillCode && void openAccountMovement(drillCode, drillWindow)}
              data-testid="payroll-account-retry"
            >
              Retry
            </Button>
          </div>
        )}

        {!drillLoading && !drillError && drill && (
          <div className="min-w-0 space-y-4">
            {/* The honest opening: what the ledger posted before this window,
                aggregated over every source — zero prior lines says so. */}
            <div
              className="rounded-md border bg-muted/30 px-3 py-2 text-xs"
              data-testid="payroll-account-opening"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">
                  Opening — before {drill.period.name}:
                </span>
                <span className="font-semibold tabular-nums">
                  {sideLabel(drill.opening.balance, drill.account.normalBalance)}
                </span>
                <span className="ml-auto rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  {drill.account.normalBalance === 'CREDIT' ? 'Credit-normal' : 'Debit-normal'}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {drill.opening.priorLines === 0
                  ? `No posted lines before this window — the account starts the ${drill.window === 'year' ? 'year' : 'month'} at zero.`
                  : `Summed from ${drill.opening.priorLines} posted ${drill.opening.priorLines === 1 ? 'line' : 'lines'} before this window — every source, not just payroll.`}
              </p>
            </div>

            {/* v2.104.0: the year at a glance — twelve calendar cells computed
                from THE SAME replay the table below shows (no second truth).
                Activity months wear the violet ring; quiet months carry the
                balance forward and say so; a closing on the other side keeps
                the amber eyebrow. A glance is not a filing: the compact cell
                reads '516.0K Dr', the exact value rides the title. */}
            {drillYearStrip && (
              <div className="space-y-1" data-testid="payroll-account-year">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {drillYearStrip.year} at a glance — the running balance at each month&apos;s end:
                </p>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-12" data-testid="payroll-account-year-strip">
                  {drillYearStrip.months.map((mo) => {
                    const otherSide = mo.closing < 0 && Math.round(Math.abs(mo.closing) * 100) !== 0;
                    return (
                      <div
                        key={mo.label}
                        data-testid="payroll-account-year-cell"
                        data-month={mo.label}
                        title={mo.activity
                          ? `${mo.label} ${drillYearStrip?.year} — ${mo.lines} ${mo.lines === 1 ? 'line' : 'lines'} posted · debits ${kes(mo.debit)} · credits ${kes(mo.credit)} · closing ${sideLabel(mo.closing, drill.account.normalBalance)}`
                          : `${mo.label} ${drillYearStrip?.year} — no activity, balance carried forward · closing ${sideLabel(mo.closing, drill.account.normalBalance)}`}
                        className={`rounded-md border px-1 py-1.5 text-center ${
                          mo.activity
                            ? 'border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/30'
                            : 'border-zinc-200/70 dark:border-zinc-800/70'
                        }`}
                      >
                        <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{mo.label}</div>
                        <div
                          className={`text-[10px] font-semibold tabular-nums ${
                            otherSide ? 'text-amber-700 dark:text-amber-400' : ''
                          }`}
                        >
                          {movementSideCellCompact(mo.closing, drill.account.normalBalance)}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {mo.activity ? `${mo.lines} ${mo.lines === 1 ? 'line' : 'lines'}` : 'quiet'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* table-fixed keeps the 5-column replay INSIDE the dialog:
                a plain auto table's max-content blows the grid track past
                the dialog box and clips the footer (found live in E2E). */}
            {drill.movements.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground" data-testid="payroll-account-empty">
                Nothing posted on this account inside the window.
              </p>
            ) : (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 w-[150px] text-[11px]">Day</TableHead>
                    <TableHead className="h-8 text-[11px]">Entry</TableHead>
                    <TableHead className="h-8 w-[110px] text-right text-[11px]">Debit</TableHead>
                    <TableHead className="h-8 w-[110px] text-right text-[11px]">Credit</TableHead>
                    <TableHead className="h-8 w-[140px] text-right text-[11px]">Running</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drill.movements.map((m, i) => (
                    <TableRow key={`${m.entryNumber}-${i}`} className="odd:bg-muted/40" data-testid="payroll-account-row">
                      <TableCell className="whitespace-nowrap py-1.5 text-[11px] text-muted-foreground">
                        {formatEatStamp(new Date(m.entryDate))}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px]">{m.entryNumber}</span>
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">
                            {m.source.replaceAll('_', ' ')}
                          </span>
                        </span>
                        <span className="mt-0.5 block max-w-full truncate text-[10px] text-muted-foreground" title={m.entryDescription}>
                          {m.entryDescription}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-xs tabular-nums">{m.debit ? kes(m.debit) : '—'}</TableCell>
                      <TableCell className="py-1.5 text-right text-xs tabular-nums">{m.credit ? kes(m.credit) : '—'}</TableCell>
                      <TableCell
                        className={`py-1.5 text-right text-xs font-medium tabular-nums ${
                          // v2.103.0 styling detail: a balance that sits on the
                          // OTHER side of the T-account wears the amber eyebrow —
                          // the one state a teller should never scroll past.
                          m.running < 0 && Math.round(Math.abs(m.running) * 100) !== 0
                            ? 'text-amber-700 dark:text-amber-400'
                            : ''
                        }`}
                        data-testid="payroll-account-running"
                      >
                        {sideLabel(m.running, drill.account.normalBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell className="py-1.5 text-xs font-semibold" colSpan={2}>
                      {drill.window === 'year' ? 'Year totals' : 'Month totals'}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-xs font-semibold tabular-nums">{kes(drill.totals.debit)}</TableCell>
                    <TableCell className="py-1.5 text-right text-xs font-semibold tabular-nums">{kes(drill.totals.credit)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-violet-50/50 dark:bg-violet-950/20">
                    <TableCell className="py-1.5 text-xs font-semibold" colSpan={4}>
                      Closing — {drill.period.name}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-xs font-semibold tabular-nums" data-testid="payroll-account-closing">
                      {sideLabel(drill.closing.balance, drill.account.normalBalance)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}

            {/* The honesty floor: what this replay counts, and the one flag
                that must never pass silently (an assumed normal side). */}
            <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
              The replay counts only POSTED, never-voided entries — a voided entry is a closed door, an in-motion entry does not exist yet.
              {drill.normalBalanceAssumed && ' Note: this account carries no known normal side; DEBIT was assumed.'}
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 flex-col gap-2 sm:flex-col">
          {movementCsvNote && (
            <div
              role="status"
              data-testid="payroll-account-csv-note"
              className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                movementCsvNote.tone === 'ok'
                  ? 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {movementCsvNote.text}
            </div>
          )}
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40 dark:hover:text-violet-200"
              disabled={movementCsvBusy || !drill || drill.movements.length === 0}
              aria-label={`Download the account movement CSV — the governed filing file of this account's ${drillWindow === 'year' ? 'year' : 'month'} replay`}
              title={drill && drill.movements.length === 0 ? 'Nothing to file — nothing posted on this account inside the window.' : `The governed filing file: one row per replay line, and a Closing line that equals the last one — exactly the ${drillWindow === 'year' ? 'year' : 'month'} on this dialog`}
              data-testid="payroll-account-csv"
              onClick={() => void exportMovementCsv()}
            >
              {movementCsvBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              {movementCsvBusy ? 'Building…' : 'Movement CSV'}
            </Button>
            <Button variant="outline" size="sm" onClick={closeDrill} data-testid="payroll-account-back">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to ledger
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ── Create run ───────────────────────────────────────────────────────────────

function CreateRunDialog({
  open,
  periods,
  onOpenChange,
  onCreated,
  onOpenPeriods,
}: {
  open: boolean;
  periods: PayrollPeriodDto[];
  onOpenChange: (v: boolean) => void;
  onCreated: (runId: string) => void;
  onOpenPeriods: () => void;
}) {
  const [periodId, setPeriodId] = useState<string>('');
  const [runType, setRunType] = useState('REGULAR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPeriodId(periods[0]?.id ?? '');
      setRunType('REGULAR');
      setError(null);
    }
  }, [open, periods]);

  const submit = async () => {
    if (!periodId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/payroll/runs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payrollPeriodId: periodId, runType }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: PayrollRunDto; error?: string };
      if (!res.ok || !body.data) {
        setError(body.error || `Could not create the run (${res.status}).`);
        return;
      }
      onCreated(body.data.id);
    } catch {
      setError('Network error while creating the run.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a payroll run</DialogTitle>
          <DialogDescription>
            The run starts in draft. You will prepare payslips, submit for approval, then post.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="run-period">Payroll period</Label>
            {periods.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No periods yet.
                <Button variant="link" size="sm" className="ml-1 px-1" onClick={onOpenPeriods}>
                  Create one first
                </Button>
              </div>
            ) : (
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger id="run-period"><SelectValue placeholder="Choose a period" /></SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.startDate.slice(0, 10)} → {p.endDate.slice(0, 10)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-type">Run type</Label>
            <Select value={runType} onValueChange={setRunType}>
              <SelectTrigger id="run-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="REGULAR">Regular</SelectItem>
                <SelectItem value="SUPPLEMENTARY">Supplementary</SelectItem>
                <SelectItem value="OFF_CYCLE">Off-cycle</SelectItem>
                <SelectItem value="BONUS">Bonus</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !periodId}>
            {busy ? 'Creating…' : 'Create draft run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create period ────────────────────────────────────────────────────────────

function CreatePeriodDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [payDate, setPayDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setStartDate('');
      setEndDate('');
      setPayDate('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/payroll/periods', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          startDate: startDate ? new Date(`${startDate}T00:00:00Z`).toISOString() : undefined,
          endDate: endDate ? new Date(`${endDate}T23:59:59Z`).toISOString() : undefined,
          payDate: payDate ? new Date(`${payDate}T00:00:00Z`).toISOString() : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || `Could not create the period (${res.status}).`);
        return;
      }
      onCreated();
    } catch {
      setError('Network error while creating the period.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New payroll period</DialogTitle>
          <DialogDescription>Name it like “January 2026” or “2026-W05”. One active run per period and type.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="period-name">Name</Label>
            <Input id="period-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="January 2026" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="period-start">Start date</Label>
              <Input id="period-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-end">End date</Label>
              <Input id="period-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="period-pay">Pay date <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="period-pay" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !name || !startDate || !endDate}>
            {busy ? 'Creating…' : 'Create period'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
