'use client';

// Payroll run detail dialog: lifecycle action bar (maker-checker aware),
// payslip table with per-payslip trace + PDF, validation issue surfacing.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Banknote, CheckCircle2, FileDown, Lock, Play, Send, ShieldQuestion, Undo2, XCircle } from 'lucide-react';
import { RUN_STATUS_STYLES, StatusBadge, kes, type ApiIssue } from '@/app/hr/payroll/page';

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

  if (!runId) return null;

  const act = async (action: string, body?: Record<string, unknown>) => {
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
        data?: { replay?: boolean };
      };
      if (!res.ok) {
        if (respBody.issues) setIssues(respBody.issues);
        setError(
          respBody.error ||
            `${action} failed (${res.status}).${respBody.code ? ` [${respBody.code}]` : ''}`,
        );
        return;
      }
      if (action === 'validate') {
        setIssues(null);
      }
      await load(runId);
      onChanged();
    } catch {
      setError('Network error during the action.');
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
                              <Badge variant="outline" className="text-[11px]">{p.payment.status}</Badge>
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
