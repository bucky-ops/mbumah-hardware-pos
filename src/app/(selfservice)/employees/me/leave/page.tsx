'use client';

// MBUMAH HARDWARE POS - /employees/me/leave (v2.19.0)
// Leave balances, my requests, and the self-service request form. The leave
// request POST goes through /api/self-service/me/leave where the employeeId
// is forced to the session-linked employee (no cross-employee requests).

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { CalendarPlus, Palmtree } from 'lucide-react';
import { apiGet, apiSend, EmptyState, ErrorNote, ProgressMeter, StatusBadge, formatDate } from '@/components/hr/self-service-ui';

interface BalanceDto {
  leaveTypeId: string;
  name: string;
  code: string;
  allocatedDays: string;
  usedDays: string;
  pendingDays: string;
  carryForwardDays: string;
  availableDays: string;
}
interface RequestDto {
  id: string;
  type: string;
  code: string;
  startDate: string;
  endDate: string;
  workingDays: string;
  halfDay: boolean;
  status: string;
  reason: string | null;
  rejectionReason: string | null;
}
interface LeaveDto {
  balances: BalanceDto[];
  requests: RequestDto[];
}

export default function MyLeave() {
  const [data, setData] = useState<LeaveDto | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [halfDay, setHalfDay] = useState('false');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiGet<LeaveDto>('/api/self-service/me/leave'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load leave.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await apiSend('/api/self-service/me/leave', 'POST', {
        leaveTypeId,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        halfDay: halfDay === 'true',
        ...(reason.trim() ? { reason } : {}),
      });
      setOpen(false);
      setStartDate('');
      setEndDate('');
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Palmtree className="h-5 w-5 text-sky-500" aria-hidden /> My leave
          </h1>
          <p className="text-sm text-muted-foreground">Balances and requests. Your manager approves before days are used.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} disabled={(data?.balances.length ?? 0) === 0}>
          <CalendarPlus className="h-4 w-4" aria-hidden /> Request
        </Button>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {/* Balances */}
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : data.balances.length === 0 ? (
        <EmptyState icon={<Palmtree className="h-8 w-8" aria-hidden />} title="No leave balances yet" hint="HR sets up your entitlements — they will appear here." />
      ) : (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Leave balances">
          {data.balances.map((b) => {
            const allocated = Number(b.allocatedDays) + Number(b.carryForwardDays);
            const pct = allocated > 0 ? (Number(b.availableDays) / allocated) * 100 : 0;
            return (
              <div key={b.leaveTypeId} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">{b.name}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{b.code}</span>
                </div>
                <ProgressMeter pct={pct} label="Leave balance used" tone={pct <= 15 ? 'bad' : pct <= 40 ? 'warn' : 'good'} />
                <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground">{Number(b.availableDays).toLocaleString()}</strong> of {allocated.toLocaleString()} days available
                  </span>
                  {Number(b.pendingDays) > 0 ? <span className="text-amber-600 dark:text-amber-400">{Number(b.pendingDays)} pending</span> : null}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Requests */}
      {!data ? null : data.requests.length === 0 ? (
        <EmptyState icon={<CalendarPlus className="h-8 w-8" aria-hidden />} title="No requests yet" hint="Request leave with the button above." />
      ) : (
        <section aria-label="My leave requests" className="space-y-2">
          <h2 className="px-1 text-sm font-semibold">My requests</h2>
          <ul className="space-y-2">
            {data.requests.map((r) => (
              <li key={r.id} className="rounded-xl border bg-card px-3.5 py-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {r.type}
                    {r.halfDay ? ' (half day)' : ''} · {Number(r.workingDays)} day{Number(r.workingDays) === 1 ? '' : 's'}
                  </p>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDate(r.startDate)} → {formatDate(r.endDate)}
                </p>
                {r.reason ? <p className="mt-1 text-xs text-muted-foreground">“{r.reason}”</p> : null}
                {r.rejectionReason ? (
                  <p className="mt-1 rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                    Declined: {r.rejectionReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Request dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request leave</DialogTitle>
            <DialogDescription>The request goes to your branch approver. Balance checks run immediately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Leave type</Label>
              <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                <SelectTrigger aria-label="Leave type"><SelectValue placeholder="Choose type" /></SelectTrigger>
                <SelectContent>
                  {(data?.balances ?? []).map((b) => (
                    <SelectItem key={b.leaveTypeId} value={b.leaveTypeId}>
                      {b.name} — {Number(b.availableDays)}d available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="leave-start">Start</Label>
                <Input id="leave-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-end">End</Label>
                <Input id="leave-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={halfDay} onValueChange={setHalfDay}>
                <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Full days</SelectItem>
                  <SelectItem value="true">Half day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-reason">Reason (optional)</Label>
              <Textarea id="leave-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !leaveTypeId || !startDate || !endDate} onClick={() => void submit()}>
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
