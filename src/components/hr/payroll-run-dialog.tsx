'use client';

// Payroll run detail dialog: lifecycle action bar (maker-checker aware),
// payslip table with per-payslip trace + PDF, validation issue surfacing.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Banknote, Check, CheckCircle2, Clock, FileDown, Loader2, Lock, Play, RefreshCw, Send, ShieldQuestion, Smartphone, Undo2, XCircle } from 'lucide-react';
import { RUN_STATUS_STYLES, StatusBadge, kes, type ApiIssue } from '@/app/(shell)/hr/payroll/page';

/** Colored payment status chips (v2.21.0 styling pass). */
const PAYMENT_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800',
  PAID: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  FAILED: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900',
  HELD: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
};

/** Lifecycle stepper model: which stage is done / current for a run status. */
const LIFECYCLE_STEPS = [
  { key: 'prepare', label: 'Prepare' },
  { key: 'submit', label: 'Submit' },
  { key: 'approve', label: 'Approve' },
  { key: 'post', label: 'Post' },
  { key: 'disburse', label: 'Disburse' },
  { key: 'lock', label: 'Lock' },
] as const;

function lifecycleStage(status: string): number {
  switch (status) {
    case 'DRAFT':
    case 'REJECTED':
      return 0;
    case 'PENDING_APPROVAL':
      return 2;
    case 'APPROVED':
      return 3;
    case 'POSTED':
      return 4;
    case 'LOCKED':
      return 7; // every step complete
    default:
      return -1; // VOIDED / FAILED: stepper hidden
  }
}

function PaymentBadge({ status, reference }: { status: string; reference: string | null }) {
  const mpesa = reference?.startsWith('MPESA-') ? reference : null;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge variant="outline" className={`text-[11px] ${PAYMENT_STATUS_STYLES[status] ?? ''}`}>
        {status === 'PAID' ? <Check className="mr-1 inline h-3 w-3" aria-hidden /> : null}
        {status}
      </Badge>
      {mpesa && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400" title="M-Pesa B2C receipt">
          <Smartphone className="h-3 w-3" aria-hidden /> {mpesa.replace('MPESA-', '')}
        </span>
      )}
    </span>
  );
}

interface RunDetail {
  id: string;
  runType: string;
  status: string;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  employeeCount: number;
  errorMessage: string | null;
  preparedByUserId: string | null;
  rejectionReason: string | null;
  journalEntryId: string | null;
  payslipIssuedCount?: number;
  payrollPeriod: { name: string; payDate: string | null; startDate: string; endDate: string };
}

interface B2CPayslipState {
  payrollDetailId: string;
  attempts: number;
  lastStatus: string | null;
  lastAttemptAt: string | null;
  lastResultDesc: string | null;
  settled: boolean;
  /** v2.33.0 retry discipline (additive, server-supplied). */
  retryBlocked?: boolean;
  nextRetryAt?: string | null;
  maxAttemptsReached?: boolean;
}

interface B2CDisbursementState {
  pendingWithoutAttempt: number;
  processing: number;
  staleProcessing: number;
  failed: number;
  completed: number;
  /** v2.33.0: FAILED payslips the retry gate blocks right now. */
  retryBlocked?: number;
  perPayslip: B2CPayslipState[];
}

interface RunDetailResponse {
  data: RunDetail;
  can: {
    prepare: boolean;
    approve: boolean;
    post: boolean;
    disburse: boolean;
    correct: boolean;
    isPreparer: boolean;
  };
  /** v2.22.0 additive PII-free B2C disbursement state (null-safe for old runs). */
  disbursement?: B2CDisbursementState | null;
}

interface PayslipRow {
  id: string;
  payslipNumber: string | null;
  employee: { employeeCode: string; name: string };
  totals: { gross: number; deductions: number; net: number };
  payment: { status: string; reference: string | null };
  runStatus: string;
}

interface TraceResponse {
  plainLanguage: string[];
  engineSteps: Array<{ step: string; detail: string }>;
  rateTableIds: string[];
}

interface B2CSummary {
  mode: 'daraja' | 'mock';
  eligible?: number;
  initiated?: number;
  alreadyInitiated?: number;
  skipped?: Array<{ employeeCode: string; reason: string }>;
  failed?: Array<{ employeeCode: string; code: string; message: string }>;
  receipts?: Array<{ employeeCode: string; receipt: string }>;
  /** refresh-stuck result (mode: refresh-stuck). */
  queried?: number;
  settled?: number;
  message?: string;
}

export function PayrollRunDialog({
  runId,
  onClose,
  onChanged,
}: {
  runId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [payslips, setPayslips] = useState<PayslipRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ApiIssue[] | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [trace, setTrace] = useState<{ id: string; data: TraceResponse } | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [b2cOpen, setB2cOpen] = useState(false);
  const [b2cSummary, setB2cSummary] = useState<B2CSummary | null>(null);
  const [b2cMode, setB2cMode] = useState<'all' | 'retry-failed'>('all');

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      const [dRes, pRes] = await Promise.all([
        fetch(`/api/payroll/runs/${id}`, { credentials: 'include' }),
        fetch(`/api/payroll/runs/${id}/payslips`, { credentials: 'include' }),
      ]);
      if (!dRes.ok) {
        const body = (await dRes.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Could not load the run (${dRes.status}).`);
        setPayslips([]);
        return;
      }
      const d = (await dRes.json()) as RunDetailResponse;
      const p = pRes.ok ? ((await pRes.json()) as { data: PayslipRow[] }) : { data: [] };
      setDetail(d);
      setPayslips(p.data ?? []);
    } catch {
      setError('Network error while loading the run.');
    }
  }, []);

  useEffect(() => {
    if (runId) {
      setDetail(null);
      setPayslips(null);
      setIssues(null);
      setTrace(null);
      void load(runId);
    }
  }, [runId, load]);

  // Hooks must run before the early return below (rules-of-hooks).
  const pendingPayslips = useMemo(
    () => (payslips ?? []).filter((p) => p.payment.status === 'PENDING' && p.totals.net > 0),
    [payslips],
  );
  const pendingTotal = useMemo(() => pendingPayslips.reduce((s, p) => s + p.totals.net, 0), [pendingPayslips]);

  // v2.22.0 B2C recovery affordances, derived from the run's disbursement block.
  const disbursement = detail?.disbursement ?? null;
  const b2cStateByPayslip = useMemo(() => {
    const map = new Map<string, B2CPayslipState>();
    for (const s of disbursement?.perPayslip ?? []) map.set(s.payrollDetailId, s);
    return map;
  }, [disbursement]);
  // v2.33.0: "Retry failed (N)" counts only payslips the retry gate allows
  // right now - backoff-blocked and ceiling-blocked ones are excluded so the
  // button never promises a re-send the service would just skip.
  const failedRetryable = useMemo(
    () =>
      (payslips ?? []).filter((p) => {
        if (p.payment.status !== 'PENDING' || p.totals.net <= 0) return false;
        const st = b2cStateByPayslip.get(p.id);
        return st?.lastStatus === 'FAILED' && !st.retryBlocked;
      }),
    [payslips, b2cStateByPayslip],
  );
  const failedBlockedCount = (disbursement?.retryBlocked ?? 0) || 0;
  const stuckProcessing = disbursement?.staleProcessing ?? 0;

  if (!runId) return null;

  const act = async (action: string, body?: Record<string, unknown>): Promise<{ ok: boolean; body: Record<string, unknown> } | null> => {
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const respBody = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        issues?: ApiIssue[];
        data?: { replay?: boolean } & Record<string, unknown>;
      };
      if (!res.ok) {
        if (respBody.issues) setIssues(respBody.issues);
        setError(
          respBody.error ||
            `${action} failed (${res.status}).${respBody.code ? ` [${respBody.code}]` : ''}`,
        );
        return { ok: false, body: respBody as Record<string, unknown> };
      }
      if (action === 'validate') {
        setIssues(null);
      }
      await load(runId);
      onChanged();
      return { ok: true, body: respBody as Record<string, unknown> };
    } catch {
      setError('Network error during the action.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const showTrace = async (payslipId: string) => {
    if (trace?.id === payslipId) {
      setTrace(null);
      return;
    }
    setTraceLoading(true);
    try {
      const res = await fetch(`/api/payroll/payslips/${payslipId}/trace`, { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as { data?: TraceResponse; error?: string };
      if (res.ok && body.data) setTrace({ id: payslipId, data: body.data });
      else setError(body.error || 'Could not load the computation trace.');
    } finally {
      setTraceLoading(false);
    }
  };

  const run = detail?.data;
  const can = detail?.can;
  const status = run?.status ?? '';
  const parsedIssues: ApiIssue[] | null = issues ?? (run?.errorMessage ? tryParseIssues(run.errorMessage) : null);

  const stage = lifecycleStage(status);

  const runB2C = async (mode: 'all' | 'retry-failed' | 'refresh-stuck') => {
    const result = await act('disburse-mpesa', { mode });
    if (result?.ok) {
      const data = (result.body as { data?: B2CSummary }).data;
      if (data) setB2cSummary(data);
      setB2cOpen(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {run ? run.payrollPeriod.name : 'Payroll run'}
            {run && <StatusBadge status={run.status} styles={RUN_STATUS_STYLES} />}
            {run && <Badge variant="secondary" className="text-[11px]">{run.runType}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {run
              ? `${run.payrollPeriod.startDate.slice(0, 10)} → ${run.payrollPeriod.endDate.slice(0, 10)}${run.payrollPeriod.payDate ? ` · pay date ${run.payrollPeriod.payDate.slice(0, 10)}` : ''}`
              : 'Loading run…'}
          </DialogDescription>
        </DialogHeader>

        {!run ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Totals strip */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-4">
              {[
                { label: 'Gross', value: kes(run.totalGross), tone: '' },
                { label: 'Deductions', value: kes(run.totalDeductions), tone: 'text-rose-600 dark:text-rose-400' },
                { label: 'Net', value: kes(run.totalNet), tone: 'font-semibold' },
                { label: 'Payslips', value: String(run.employeeCount), tone: '' },
              ].map((t) => (
                <div key={t.label}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
                  <p className={`mt-0.5 text-sm tabular-nums ${t.tone}`}>{t.value}</p>
                </div>
              ))}
            </div>

            {/* Lifecycle stepper (v2.21.0 styling pass) */}
            {stage >= 0 && (
              <div className="rounded-lg border bg-muted/30 px-4 py-3" aria-label="Run lifecycle progress">
                <ol className="flex flex-wrap items-center gap-y-2 text-[11px]">
                  {LIFECYCLE_STEPS.map((step, i) => {
                    const done = stage > i + (i >= 4 ? 1 : 0);
                    const current = !done && (
                      (i === 0 && (status === 'DRAFT' || status === 'REJECTED')) ||
                      (i === 1 && status === 'DRAFT') ||
                      (i === 2 && status === 'PENDING_APPROVAL') ||
                      (i === 3 && status === 'APPROVED') ||
                      (i === 4 && status === 'POSTED' && pendingPayslips.length > 0) ||
                      (i === 5 && status === 'POSTED' && pendingPayslips.length === 0)
                    );
                    // POSTED: disburse is current until all pending payslips are settled; lock comes after
                    const state = done ? 'done' : current ? 'current' : 'todo';
                    return (
                      <li key={step.key} className="flex items-center">
                        {i > 0 && <span aria-hidden className={`mx-1.5 h-px w-5 sm:w-8 ${done ? 'bg-emerald-400' : 'bg-border'}`} />}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors ${
                            state === 'done'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : state === 'current'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {state === 'done' ? (
                            <Check className="h-3 w-3" aria-hidden />
                          ) : state === 'current' ? (
                            <span className="relative flex h-2 w-2" aria-hidden>
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground opacity-60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
                            </span>
                          ) : null}
                          {step.label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {/* Lifecycle action bar */}
            <div className="rounded-lg border p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ShieldQuestion className="h-3.5 w-3.5" /> Lifecycle actions
              </p>
              <div className="flex flex-wrap gap-2">
                {(status === 'DRAFT' || status === 'REJECTED') && can?.prepare && (
                  <Button size="sm" onClick={() => void act('validate')} disabled={busy} className="gap-1.5">
                    <Play className="h-3.5 w-3.5" /> {status === 'REJECTED' ? 'Re-prepare' : 'Prepare payslips'}
                  </Button>
                )}
                {(status === 'DRAFT' || status === 'REJECTED') && can?.prepare && (
                  <SubmitButton busy={busy} onSubmit={() => void act('submit')} />
                )}
                {status === 'PENDING_APPROVAL' && can?.approve && (
                  <Button
                    size="sm"
                    onClick={() => void act('approve')}
                    disabled={busy || can.isPreparer}
                    className="gap-1.5"
                    title={can.isPreparer ? 'Maker-checker: the preparer cannot approve this run' : 'Approve this run'}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                  </Button>
                )}
                {status === 'PENDING_APPROVAL' && can?.approve && (
                  <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)} disabled={busy} className="gap-1.5">
                    <XCircle className="h-3.5 w-3.5" /> Reject…
                  </Button>
                )}
                {status === 'APPROVED' && can?.post && (
                  <Button size="sm" onClick={() => void act('post')} disabled={busy} className="gap-1.5">
                    <Banknote className="h-3.5 w-3.5" /> Post journal
                  </Button>
                )}
                {status === 'POSTED' && can?.post && (
                  <Button size="sm" variant="outline" onClick={() => void act('lock')} disabled={busy} className="gap-1.5">
                    <Lock className="h-3.5 w-3.5" /> Lock run
                  </Button>
                )}
                {(status === 'POSTED' || status === 'LOCKED') && can?.disburse && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void act('disburse', { paymentRef: `MANUAL-${Date.now()}` })}
                    disabled={busy}
                    className="gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" /> Mark disbursed
                  </Button>
                )}
                {(status === 'POSTED' || status === 'LOCKED') && can?.disburse && pendingPayslips.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setB2cSummary(null);
                      setB2cMode('all');
                      setB2cOpen(true);
                    }}
                    disabled={busy}
                    className="gap-1.5 border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                  >
                    <Smartphone className="h-3.5 w-3.5" /> Disburse via M-Pesa
                  </Button>
                )}
                {(status === 'POSTED' || status === 'LOCKED') && can?.disburse && (failedRetryable.length > 0 || failedBlockedCount > 0) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runB2C('retry-failed')}
                    disabled={busy || failedRetryable.length === 0}
                    title={
                      failedRetryable.length > 0
                        ? `Re-send the ${failedRetryable.length} payslip(s) whose backoff has elapsed. Never touches payslips that are paid, being processed, or still within their retry backoff.`
                        : `All ${failedBlockedCount} failed payslip(s) are inside their retry backoff or at the attempt ceiling - chips on each row show when retries reopen.`
                    }
                    className="gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retry failed ({failedRetryable.length})
                    {failedBlockedCount > 0 ? (
                      <span className="text-[10px] font-normal opacity-75">· {failedBlockedCount} waiting</span>
                    ) : null}
                  </Button>
                )}
                {(status === 'POSTED' || status === 'LOCKED') && can?.disburse && stuckProcessing > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runB2C('refresh-stuck')}
                    disabled={busy}
                    title="Re-query Safaricom for disbursements that never reported a result. Payslips settle automatically when the result re-arrives."
                    className="gap-1.5"
                  >
                    <Loader2 className="h-3.5 w-3.5" /> Check status ({stuckProcessing})
                  </Button>
                )}
                {['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED'].includes(status) && can?.approve && (
                  <Button size="sm" variant="ghost" onClick={() => void act('void')} disabled={busy} className="gap-1.5 text-rose-600 hover:text-rose-700 dark:text-rose-400">
                    <Undo2 className="h-3.5 w-3.5" /> Void
                  </Button>
                )}
              </div>
              {status === 'PENDING_APPROVAL' && can?.approve && can.isPreparer && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Maker-checker: you prepared this run, so approval must come from a different user
                  (e.g. the store owner or a super admin).
                </p>
              )}
              {run.journalEntryId && (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                  Posted journal entry <span className="font-mono">{run.journalEntryId}</span> — posting is
                  idempotent; re-posting returns the same entry.
                </p>
              )}
              {run.rejectionReason && (
                <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">
                  Rejection reason: {run.rejectionReason}
                </p>
              )}
              {error && (
                <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </p>
              )}
            </div>

            {/* Gate issues */}
            {parsedIssues && parsedIssues.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-300">Blocked employees</p>
                {parsedIssues.map((issue, i) => (
                  <div key={`${issue.code}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline" className="font-mono text-[11px]">{issue.code}</Badge>
                    <span className="font-medium">{issue.employeeName || 'Employee'}</span>
                    <span className="text-muted-foreground">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            <Separator />

            {/* Payslip table */}
            <div>
              <p className="mb-2 text-sm font-medium">Payslips</p>
              {!payslips ? (
                <Skeleton className="h-32 w-full" />
              ) : payslips.length === 0 ? (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  Not prepared yet. Use “Prepare payslips” to compute and validate every active employee.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Payslip no.</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="text-right">Slip</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payslips.map((p) => (
                        <Fragment key={p.id}>
                          <TableRow className="transition-colors hover:bg-muted/40">
                            <TableCell className="font-mono text-xs">{p.payslipNumber ?? '—'}</TableCell>
                            <TableCell>
                              <span className="font-medium">{p.employee.name}</span>
                              {p.employee.employeeCode ? (
                                <span className="text-xs text-muted-foreground"> ({p.employee.employeeCode})</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{kes(p.totals.gross)}</TableCell>
                            <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                              {kes(p.totals.deductions)}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{kes(p.totals.net)}</TableCell>
                            <TableCell>
                              <PaymentBadge status={p.payment.status} reference={p.payment.reference} />
                              {(() => {
                                const st = b2cStateByPayslip.get(p.id);
                                if (!st || st.settled || !st.lastStatus) return null;
                                if (st.lastStatus === 'FAILED') {
                                  // v2.33.0 three-state retry chip: ready
                                  // (emerald) / backoff countdown (amber) /
                                  // ceiling reached (rose). Attempts badge
                                  // rides along once more than one try.
                                  const attemptsLabel =
                                    st.attempts > 1 ? ` · ${st.attempts} attempts` : '';
                                  if (st.maxAttemptsReached) {
                                    return (
                                      <span
                                        className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-rose-700 dark:text-rose-400"
                                        title={st.lastResultDesc || `B2C failed ${st.attempts} time(s) - the retry ceiling is reached, so this needs manual investigation in the Daraja portal before any further re-send.`}
                                      >
                                        <AlertTriangle className="h-3 w-3" aria-hidden /> B2C failed{attemptsLabel} · manual review
                                      </span>
                                    );
                                  }
                                  if (st.retryBlocked && st.nextRetryAt) {
                                    const waitMs = new Date(st.nextRetryAt).getTime() - Date.now();
                                    const wait =
                                      waitMs > 0
                                        ? `${Math.floor(waitMs / 60000)}m ${Math.round((waitMs % 60000) / 1000)}s`
                                        : 'moments';
                                    return (
                                      <span
                                        className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                                        title={st.lastResultDesc || `Last M-Pesa B2C attempt failed - retry reopens in ${wait}.`}
                                      >
                                        <Clock className="h-3 w-3" aria-hidden /> B2C failed{attemptsLabel} · retry in {wait}
                                      </span>
                                    );
                                  }
                                  return (
                                    <span
                                      className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                                      title={st.lastResultDesc || 'Last M-Pesa B2C attempt failed - use Retry failed to re-send.'}
                                    >
                                      <AlertTriangle className="h-3 w-3" aria-hidden /> B2C failed{attemptsLabel} · retry ready
                                    </span>
                                  );
                                }
                                if (st.lastStatus === 'PROCESSING') {
                                  return (
                                    <span
                                      className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-400"
                                      title={`M-Pesa B2C attempt ${st.attempts} in progress${st.lastAttemptAt ? ` since ${new Date(st.lastAttemptAt).toLocaleTimeString()}` : ''}.`}
                                    >
                                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> B2C processing{st.attempts > 1 ? ` · ${st.attempts} attempts` : ''}
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </TableCell>
                            <TableCell className="space-x-1 text-right whitespace-nowrap">
                              <Button variant="ghost" size="sm" onClick={() => void showTrace(p.id)}>
                                {traceLoading && trace?.id !== p.id ? 'Trace…' : trace?.id === p.id ? 'Hide trace' : 'Trace'}
                              </Button>
                              <a
                                href={`/api/payroll/payslips/${p.id}/pdf`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                title="Download PDF (PII masked for your role)"
                              >
                                <FileDown className="h-3.5 w-3.5" /> PDF
                              </a>
                            </TableCell>
                          </TableRow>
                          {trace?.id === p.id && (
                            <TableRow>
                              <TableCell colSpan={7} className="bg-muted/30">
                                <div className="space-y-1.5 py-1 text-sm">
                                  {trace.data.plainLanguage.map((s, i) => (
                                    <p key={i} className="leading-relaxed">{s}</p>
                                  ))}
                                  <p className="pt-1 text-xs text-muted-foreground">
                                    Rate tables referenced: {trace.data.rateTableIds.length} · engine steps:{' '}
                                    {trace.data.engineSteps.map((s) => s.step).join(' → ')}
                                  </p>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* M-Pesa B2C disbursement confirm (v2.21.0, retry-aware v2.22.0) */}
        <Dialog open={b2cOpen} onOpenChange={setB2cOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Disburse via M-Pesa B2C
              </DialogTitle>
              <DialogDescription>
                Sends each pending payslip to the employee&apos;s registered M-Pesa number as a SalaryPayment.
                Employees without a phone number are skipped and listed in the result. This action is
                audit-logged and can never double-pay a payslip.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {b2cMode === 'all' && failedRetryable.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setB2cOpen(false);
                    void runB2C('retry-failed');
                  }}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                >
                  <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    <span className="font-semibold">{failedRetryable.length} payslip(s)</span> already have a failed B2C
                    attempt — you can re-send just those instead.
                  </span>
                </button>
              )}
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p>
                  <span className="font-semibold tabular-nums">{pendingPayslips.length}</span> payslip(s) ·
                  total <span className="font-semibold tabular-nums">{kes(pendingTotal)}</span> net pay
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Real mode requires Daraja B2C credentials; the payslips stay PENDING until Safaricom
                  reports the result. Without credentials (development) the run completes in mock mode.
                </p>
              </div>
              {error && (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setB2cOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy || pendingPayslips.length === 0}
                  onClick={() => void runB2C('all')}
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Smartphone className="h-3.5 w-3.5" aria-hidden />}
                  {busy ? 'Sending…' : `Send ${pendingPayslips.length} payment(s)`}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* M-Pesa B2C result summary (v2.22.0: disburse / retry / refresh) */}
        {b2cSummary && (
          <Dialog open onOpenChange={(v) => !v && setB2cSummary(null)}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(b2cSummary.failed?.length ?? 0) === 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  )}
                  M-Pesa disbursement {b2cSummary.mode === 'mock' ? '(mock mode)' : 'sent'}
                </DialogTitle>
                <DialogDescription>
                  {b2cSummary.queried !== undefined ? (
                    <>
                      {b2cSummary.queried} re-queried · {b2cSummary.settled ?? 0} settled ·{' '}
                      {b2cSummary.message}
                    </>
                  ) : (
                    <>
                      {b2cSummary.initiated ?? 0} initiated · {b2cSummary.alreadyInitiated ?? 0} already active ·{' '}
                      {b2cSummary.skipped?.length ?? 0} skipped · {b2cSummary.failed?.length ?? 0} failed
                      {b2cSummary.mode === 'daraja' && ' · payslips settle when Safaricom reports the result'}
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-72 space-y-3 overflow-y-auto text-sm">
                {(b2cSummary.receipts?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Completed (mock receipts)</p>
                    <ul className="space-y-1">
                      {b2cSummary.receipts?.map((r) => (
                        <li key={r.employeeCode} className="flex items-center justify-between gap-2 rounded-md border bg-emerald-50/60 px-2.5 py-1.5 dark:border-emerald-900 dark:bg-emerald-950/30">
                          <span className="font-medium">{r.employeeCode}</span>
                          <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">{r.receipt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(b2cSummary.skipped?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Skipped</p>
                    <ul className="space-y-1">
                      {b2cSummary.skipped?.map((s) => (
                        <li key={s.employeeCode} className="rounded-md border px-2.5 py-1.5">
                          <span className="font-medium">{s.employeeCode}</span>
                          <span className="text-muted-foreground"> — {s.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(b2cSummary.failed?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Failed</p>
                    <ul className="space-y-1">
                      {b2cSummary.failed?.map((f) => (
                        <li key={f.employeeCode} className="rounded-md border border-rose-200 bg-rose-50/60 px-2.5 py-1.5 dark:border-rose-900 dark:bg-rose-950/30">
                          <span className="font-medium">{f.employeeCode}</span>
                          <span className="text-rose-700 dark:text-rose-300"> — {f.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setB2cSummary(null)}>Done</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Reject with reason */}
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reject this run</DialogTitle>
              <DialogDescription>
                It returns to the preparer as REJECTED. A reason of at least 10 characters is required.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Casual day rates for J. Wanjiku are missing; correct and re-prepare."
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || rejectReason.trim().length < 10}
                onClick={async () => {
                  await act('reject', { reason: rejectReason });
                  setRejectOpen(false);
                  setRejectReason('');
                }}
              >
                Reject run
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/** Submit-for-approval button (kept separate to stay honest about the action name). */
function SubmitButton({ busy, onSubmit }: { busy: boolean; onSubmit: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onSubmit} disabled={busy} className="gap-1.5">
      <Send className="h-3.5 w-3.5" /> Submit for approval
    </Button>
  );
}

function tryParseIssues(raw: string): ApiIssue[] | null {
  try {
    const parsed = JSON.parse(raw) as ApiIssue[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
