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
import { AlertTriangle, Banknote, CheckCircle2, ChevronDown, ChevronRight, Clock, FileDown, Landmark, Loader2, Plus, RefreshCw, Wallet } from 'lucide-react';
import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';
import { PayrollRunDialog } from '@/components/hr/payroll-run-dialog';
import { PayrollCorrectionsPanel } from '@/components/hr/payroll-corrections-panel';
import { downloadRunDigestCsv } from '@/components/hr/run-digest-csv';
import { groupRunsByPeriod } from '@/lib/hr/payroll/run-groups';

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

export interface ApiIssue {
  employeeName?: string;
  code: string;
  message: string;
}

export default function HrPayrollPage() {
  const [periods, setPeriods] = useState<PayrollPeriodDto[] | null>(null);
  const [runs, setRuns] = useState<PayrollRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [createRunOpen, setCreateRunOpen] = useState(false);
  const [createPeriodOpen, setCreatePeriodOpen] = useState(false);
  const [gateIssues, setGateIssues] = useState<ApiIssue[] | null>(null);
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
}: {
  periodName: string | null;
  payload: PeriodJournalPayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const p = payload?.period;
  // v2.101.0: the ledger files itself — the governed CSV exit rides the
  // drawer footer. State lives here: the drawer is the file's source, and
  // a stale note from a previous period must never greet the next open.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvNote, setCsvNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    setCsvNote(null);
    setCsvBusy(false);
  }, [periodName]);

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

  return (
    <Dialog open={periodName !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="print:hidden max-h-[85vh] overflow-y-auto sm:max-w-2xl">
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
            {payload.entries.length === 0 && payload.unsettled.length === 0 && payload.missingJournal.length === 0 && (
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
                      <TableRow key={`${entry.runId}-${i}`} className="odd:bg-muted/40" data-testid="payroll-ledger-line">
                        <TableCell className="py-1.5">
                          <span className="font-mono text-[11px] text-muted-foreground">{line.accountCode}</span>{' '}
                          <span className="text-xs">{line.accountName}</span>
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
