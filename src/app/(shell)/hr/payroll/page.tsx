'use client';

// MBUMAH HARDWARE POS - /hr/payroll (v2.18.9)
// Payroll run lifecycle console: prepare → submit → approve → post → lock,
// with maker-checker aware actions, per-payslip drill-down (trace + PDF),
// and the corrections (reverse & replace) queue.

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { AlertTriangle, Banknote, CheckCircle2, Clock, FileDown, Landmark, Loader2, Plus, RefreshCw, Wallet } from 'lucide-react';
import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';
import { PayrollRunDialog } from '@/components/hr/payroll-run-dialog';
import { PayrollCorrectionsPanel } from '@/components/hr/payroll-corrections-panel';
import { downloadRunDigestCsv } from '@/components/hr/run-digest-csv';

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
              <CardTitle className="text-base">All runs</CardTitle>
              <CardDescription>Newest first. Open a run to work its lifecycle.</CardDescription>
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
                        <TableHead>Period</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="text-right">Payslips</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => (
                        <TableRow key={run.id} className="group transition-colors hover:bg-muted/40">
                          <TableCell className="font-medium">{run.payrollPeriod.name}</TableCell>
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
