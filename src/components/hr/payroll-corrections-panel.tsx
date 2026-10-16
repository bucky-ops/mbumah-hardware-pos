'use client';

// Corrections queue: reverse-and-replace requests against immutable posted
// payslips. Request (hr.payroll.correct) → approve/reject (hr.payroll.approve,
// maker-checked). Approval posts a balanced adjusting entry and, for
// amount-affecting types, opens a replacement supplementary run.

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Plus } from 'lucide-react';
import { CORRECTION_STATUS_STYLES, StatusBadge, kes } from '@/app/(shell)/hr/payroll/page';

interface CorrectionRow {
  id: string;
  correctionType: string;
  amountCents: number;
  reason: string;
  status: string;
  createdAt: string;
  rejectionReason: string | null;
  employee: { employeeCode: string; firstName: string; lastName: string };
  run: { status: string; runType: string; payrollPeriod: { name: string } };
  originalDetail: { payslipNumber: string | null; netPay: string };
  replacementRun: { id: string; status: string } | null;
}

interface PostedRunOption {
  id: string;
  label: string;
  periodName: string;
}

interface PayslipOption {
  id: string;
  payslipNumber: string | null;
  employeeName: string;
  net: number;
}

export function PayrollCorrectionsPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<CorrectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/payroll/corrections', { credentials: 'include' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Corrections API unreachable (${res.status}).`);
        setRows([]);
        return;
      }
      const body = (await res.json()) as { data: CorrectionRow[] };
      setRows(body.data ?? []);
    } catch {
      setError('Network error while loading corrections.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED', reason?: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/payroll/corrections/${id}/${decision === 'APPROVED' ? 'approve' : 'reject'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'REJECTED' ? { reason } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error || `Could not ${decision.toLowerCase()} the correction (${res.status}).`);
      else {
        setRejectId(null);
        setRejectReason('');
        await load();
        onChanged();
      }
    } catch {
      setError('Network error during the action.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Corrections (reverse &amp; replace)</CardTitle>
          <CardDescription>
            Issued payslips are immutable. A correction posts a balanced adjusting entry and, for
            under/overpayments, opens a replacement supplementary run that goes through the normal
            maker-checked lifecycle.
          </CardDescription>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setRequestOpen(true)}>
          <Plus className="h-4 w-4" /> New correction
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {error && (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}
        {!rows ? (
          <div className="space-y-2 p-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <AlertTriangle className="h-7 w-7 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">No corrections requested</p>
            <p className="max-w-md text-xs text-muted-foreground">
              When a posted payslip is wrong (missed overtime, wrong allowance), request a correction here
              instead of editing anything. The original stays untouched for audit.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card/95 backdrop-blur">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Payslip</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount (cents)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-56">Reason</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} className="transition-colors hover:bg-muted/40">
                    <TableCell className="font-mono text-xs">
                      {c.originalDetail.payslipNumber ?? '—'}
                      <div className="text-[11px] text-muted-foreground">{c.run.payrollPeriod.name}</div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {c.employee.firstName} {c.employee.lastName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[11px]">{c.correctionType}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.correctionType === 'REVERSAL' ? '—' : c.amountCents}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} styles={CORRECTION_STATUS_STYLES} />
                      {c.replacementRun && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          replacement run: {c.replacementRun.status}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.reason}
                      {c.rejectionReason && (
                        <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">Rejected: {c.rejectionReason}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === 'PENDING' ? (
                        <div className="space-x-1 whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === c.id}
                            onClick={() => void decide(c.id, 'APPROVED')}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                            disabled={busyId === c.id}
                            onClick={() => setRejectId(c.id)}
                          >
                            Reject…
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <RequestCorrectionDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        onCreated={() => {
          void load();
          onChanged();
        }}
      />

      <Dialog open={rejectId !== null} onOpenChange={(v) => !v && setRejectId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject correction</DialogTitle>
            <DialogDescription>A reason of at least 10 characters is required.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busyId !== null || rejectReason.trim().length < 10}
              onClick={() => rejectId && void decide(rejectId, 'REJECTED', rejectReason)}
            >
              Reject correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Request correction ───────────────────────────────────────────────────────

function RequestCorrectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [runs, setRuns] = useState<PostedRunOption[] | null>(null);
  const [runId, setRunId] = useState('');
  const [payslips, setPayslips] = useState<PayslipOption[] | null>(null);
  const [detailId, setDetailId] = useState('');
  const [type, setType] = useState('UNDERPAYMENT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRunId('');
    setDetailId('');
    setType('UNDERPAYMENT');
    setAmount('');
    setReason('');
    setPayslips(null);
    (async () => {
      try {
        const res = await fetch('/api/payroll/runs', { credentials: 'include' });
        if (!res.ok) {
          setRuns([]);
          return;
        }
        const body = (await res.json()) as {
          data: Array<{ id: string; status: string; runType: string; payrollPeriod: { name: string } }>;
        };
        const posted = (body.data ?? [])
          .filter((r) => r.status === 'POSTED' || r.status === 'LOCKED')
          .map((r) => ({ id: r.id, label: r.runType, periodName: r.payrollPeriod.name }));
        setRuns(posted);
      } catch {
        setRuns([]);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!runId) {
      setPayslips(null);
      return;
    }
    setDetailId('');
    (async () => {
      try {
        const res = await fetch(`/api/payroll/runs/${runId}/payslips`, { credentials: 'include' });
        const body = res.ok
          ? ((await res.json()) as {
              data: Array<{ id: string; payslipNumber: string | null; employee: { name: string }; totals: { net: number } }>;
            })
          : { data: [] };
        setPayslips(
          (body.data ?? []).map((p) => ({
            id: p.id,
            payslipNumber: p.payslipNumber,
            employeeName: p.employee.name,
            net: p.totals.net,
          })),
        );
      } catch {
        setPayslips([]);
      }
    })();
  }, [runId]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const amountCents = type === 'REVERSAL' ? 0 : Math.round(Number(amount) * 100);
      const res = await fetch('/api/payroll/corrections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalDetailId: detailId, correctionType: type, amountCents, reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || `Could not request the correction (${res.status}).`);
        return;
      }
      onCreated();
      onOpenChange(false);
    } catch {
      setError('Network error while requesting the correction.');
    } finally {
      setBusy(false);
    }
  };

  const selected = payslips?.find((p) => p.id === detailId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a correction</DialogTitle>
          <DialogDescription>
            Pick a payslip from a posted or locked run. Approval posts a balanced adjusting entry; the
            requester cannot approve their own request.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>Posted run</Label>
            <Select value={runId} onValueChange={setRunId}>
              <SelectTrigger><SelectValue placeholder={runs?.length ? 'Choose a posted run' : 'No posted runs yet'} /></SelectTrigger>
              <SelectContent>
                {(runs ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.periodName} ({r.label})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {runId && (
            <div className="space-y-1.5">
              <Label>Payslip</Label>
              <Select value={detailId} onValueChange={setDetailId}>
                <SelectTrigger><SelectValue placeholder={payslips === null ? 'Loading…' : 'Choose a payslip'} /></SelectTrigger>
                <SelectContent>
                  {(payslips ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.payslipNumber ?? '(unnumbered)'} — {p.employeeName} — net {kes(p.net)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Correction type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNDERPAYMENT">Underpayment (company owes)</SelectItem>
                  <SelectItem value="OVERPAYMENT">Overpayment (employee owes)</SelectItem>
                  <SelectItem value="REVERSAL">Full reversal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type !== 'REVERSAL' && (
              <div className="space-y-1.5">
                <Label htmlFor="corr-amount">Amount (KES, signed)</Label>
                <Input
                  id="corr-amount"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 1250.00 or -300.00"
                />
                {selected && amount && Number(amount) !== 0 && (
                  <p className="text-xs text-muted-foreground">
                    Payslip net {kes(selected.net)} → adjusted net ≈ {kes(selected.net + Number(amount))}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="corr-reason">Reason</Label>
            <Textarea
              id="corr-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Missed 6 weekend overtime hours on the 14th; verified against attendance."
            />
          </div>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !detailId || reason.trim().length < 10 || (type !== 'REVERSAL' && !amount)}>
            {busy ? 'Submitting…' : 'Submit request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
