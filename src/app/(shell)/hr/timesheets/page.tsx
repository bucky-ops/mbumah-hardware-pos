'use client';

// MBUMAH HARDWARE POS - /hr/timesheets (v2.136.0)
// The timesheet approval desk: the run gate's second remediation door
// finally has a home. The gate (v2.133.0) says WHO it would block and why;
// the consent block's fix has lived on the Privacy tab's ledger since
// v2.119.0 — but a TIMESHEET_NOT_APPROVED block had no UI desk at all
// (the approve route was API-only). This desk closes that door honestly:
// the pending read mirrors the gate's own where/order (parity-pinned),
// each row approves that employee's pending day range through the ONE
// approveTimesheet service the API always had, and the strip shows the
// exact days — date-only semantics in UTC, never a drifted day.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Briefcase, CalendarCheck, CalendarDays, CheckCircle2, CheckCheck, FileDown, Loader2, RefreshCw, Sun, X } from 'lucide-react';
import { deskRangeLabel, deskDayStrip, deskDayIsWeekend, deskWeekendDays, deskWeekdayDays, buildBulkApproveSummary, readDeskLensPref, writeDeskLensPref, type AttendanceDeskRow, type DeskBulkAttemptResult, type DeskBulkSummary, type DeskLensPref } from '@/lib/hr/attendance-desk';
import { buildTimesheetDeskCsv } from '@/lib/hr/timesheet-desk-csv';
import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';

interface PayrollPeriodLite {
  id: string;
  name: string;
  status: string;
}

interface PendingPayload {
  scope: {
    periodId: string;
    periodName: string;
    startDate: string;
    endDate: string;
    status: string;
  } | null;
  rows: AttendanceDeskRow[];
  totalDays: number;
  checkedAt: string;
}

export default function HrTimesheetsPage() {
  // The door param: the gate's TIMESHEET row deep-links ?employee=<id> —
  // the desk answers by highlighting that row (lazy initializer, param
  // stripped once on mount — the payroll run= param's own pattern).
  const [focusId, setFocusId] = useState<string | null>(() => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = new URLSearchParams(window.location.search).get('employee');
      return raw && raw.trim() ? raw.trim() : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!focusId) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('employee');
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Strip is cosmetic — a blocked replaceState costs nothing honest.
    }
  }, [focusId]);

  const [periods, setPeriods] = useState<PayrollPeriodLite[] | null>(null);
  // scopeId === '__all__' means every pending day, unscoped. Default: the
  // newest non-voided period (the gate's natural habitat), else all.
  const [scopeId, setScopeId] = useState<string>('__all__');

  const [payload, setPayload] = useState<PendingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<{ employeeId: string; tone: 'ok' | 'err'; text: string } | null>(null);
  // v2.139.0: the batch — "Approve all" walks the SAME per-employee service
  // one row at a time (never a new bulk write path), reporting honest
  // progress and an end-of-batch receipt that names every failure.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkNote, setBulkNote] = useState<DeskBulkSummary | null>(null);
  // v2.140.0: the weekends-only lens — the strip's second reading. The tint
  // (v2.138) made a Saturday punch stand out; a long strip still buries it.
  // A view preference, not a data change: the count chip keeps speaking the
  // row's total, and flipping the lens never touches notes or scope.
  // v2.141.0: the lens keeps its preference — but the persisted read happens
  // AFTER hydration (microtask-deferred, the page load()'s own pattern). A
  // lazy initializer would render true on the client while the server
  // rendered false, and React never patches stale hydration ATTRIBUTES:
  // the strip's children got fixed while the toggle's aria-pressed stayed
  // stale — a franken-state caught live in E2E and not allowed to ship.
  // v2.145.0: the lens learns weekdays — the boolean grows into the
  // three-way day-kind lens (the gate card's outcome trio's own shape), and
  // the persisted read maps the legacy '1' to 'weekends' so an old browser's
  // choice survives the upgrade (readDeskLensPref's own rule).
  const [lens, setLens] = useState<DeskLensPref>('all');
  useEffect(() => {
    void Promise.resolve().then(() => setLens(readDeskLensPref(window.localStorage)));
  }, []);
  const setLensPref = useCallback((next: DeskLensPref) => {
    setLens(next);
    writeDeskLensPref(window.localStorage, next);
  }, []);

  const loadPeriods = useCallback(async () => {
    try {
      const res = await fetch('/api/payroll/periods', { credentials: 'include' });
      const body = (await res.json().catch(() => ({ data: [] }))) as { data?: PayrollPeriodLite[] };
      if (!res.ok) {
        setPeriods([]);
        return;
      }
      const list = body.data ?? [];
      setPeriods(list);
      setScopeId((current) => {
        if (current !== '__all__') return current;
        const open = list.find((p) => p.status === 'OPEN') ?? list[0];
        return open ? open.id : '__all__';
      });
    } catch {
      setPeriods([]);
    }
  }, []);

  const loadPending = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = id === '__all__' ? '' : `?periodId=${encodeURIComponent(id)}`;
      const res = await fetch(`/api/attendance/timesheets/pending${qs}`, { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as { data?: PendingPayload; error?: string };
      if (!res.ok) {
        setPayload(null);
        setError(body.error || `The pending read failed (${res.status}).`);
        return;
      }
      setPayload(body.data ?? null);
    } catch {
      setPayload(null);
      setError('The timesheet desk is unreachable. Check your connection and sign in again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    // Microtask-deferred: no setState synchronously inside the effect body.
    void Promise.resolve().then(() => loadPending(scopeId));
  }, [scopeId, loadPending]);

  const approve = useCallback(
    async (row: AttendanceDeskRow) => {
      if (!row.firstDay || !row.lastDay) return;
      setApprovingId(row.employeeId);
      setRowNote(null);
      try {
        const res = await fetch('/api/attendance/timesheets/approve', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: row.employeeId, from: row.firstDay, to: row.lastDay }),
        });
        const body = (await res.json().catch(() => ({}))) as { data?: { approved: number }; error?: string };
        if (!res.ok) {
          setRowNote({ employeeId: row.employeeId, tone: 'err', text: body.error || `Approval failed (${res.status}).` });
          return;
        }
        const count = body.data?.approved ?? 0;
        setRowNote({
          employeeId: row.employeeId,
          tone: 'ok',
          text: count > 0 ? `Approved ${count} ${count === 1 ? 'day' : 'days'} for ${row.employeeName || row.employeeCode}.` : 'Nothing to approve — the days were already approved.',
        });
        await loadPending(scopeId);
      } catch {
        setRowNote({ employeeId: row.employeeId, tone: 'err', text: 'Approval request failed — the desk stays honest rather than guess.' });
      } finally {
        setApprovingId(null);
      }
    },
    [scopeId, loadPending],
  );

  // v2.139.0: the batch loop — one POST per employee, in the desk's own
  // order, failures never aborting the walk (the receipt names them). The
  // per-row spinner rides approvingId so every other button (single AND the
  // batch itself) stays disabled — single-flight both directions.
  const approveAll = useCallback(async () => {
    if (!payload || payload.rows.length === 0) return;
    const rows = payload.rows;
    setBulkNote(null);
    setRowNote(null);
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: rows.length });
    const results: DeskBulkAttemptResult[] = [];
    try {
      for (const row of rows) {
        if (!row.firstDay || !row.lastDay) {
          results.push({
            employeeId: row.employeeId,
            employeeCode: row.employeeCode,
            employeeName: row.employeeName,
            ok: false,
            approved: 0,
            error: 'The pending row has no day range on file.',
          });
          setBulkProgress({ done: results.length, total: rows.length });
          continue;
        }
        setApprovingId(row.employeeId);
        try {
          const res = await fetch('/api/attendance/timesheets/approve', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employeeId: row.employeeId, from: row.firstDay, to: row.lastDay }),
          });
          const body = (await res.json().catch(() => ({}))) as { data?: { approved: number }; error?: string };
          if (!res.ok) {
            results.push({
              employeeId: row.employeeId,
              employeeCode: row.employeeCode,
              employeeName: row.employeeName,
              ok: false,
              approved: 0,
              error: body.error || `Approval failed (${res.status}).`,
            });
          } else {
            results.push({
              employeeId: row.employeeId,
              employeeCode: row.employeeCode,
              employeeName: row.employeeName,
              ok: true,
              approved: body.data?.approved ?? 0,
            });
          }
        } catch {
          results.push({
            employeeId: row.employeeId,
            employeeCode: row.employeeCode,
            employeeName: row.employeeName,
            ok: false,
            approved: 0,
            error: 'Approval request failed — the desk stays honest rather than guess.',
          });
        }
        setBulkProgress({ done: results.length, total: rows.length });
      }
    } finally {
      setApprovingId(null);
      setBulkRunning(false);
      setBulkProgress(null);
      setBulkNote(buildBulkApproveSummary(results));
      await loadPending(scopeId);
    }
  }, [payload, scopeId, loadPending]);

  const scopeLine = useMemo(() => {
    if (!payload?.scope) return 'All pending days, every period — unscoped by choice.';
    const range = deskRangeLabel(payload.scope.startDate.slice(0, 10), payload.scope.endDate.slice(0, 10));
    return `${payload.scope.periodName} (${range})`;
  }, [payload]);

  const focusedRow = useMemo(
    () => (focusId && payload ? payload.rows.find((r) => r.employeeId === focusId) ?? null : null),
    [focusId, payload],
  );

  // v2.137.0: the pending list prints itself — the desk's rows as shown
  // (scope, order, counts), never more. The row type has no field for pay
  // data, so an export can never become a payslip preview.
  const exportCsv = useCallback(() => {
    if (!payload || payload.rows.length === 0) return;
    const csv = buildTimesheetDeskCsv(
      payload.rows.map((row) => ({
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        pendingDays: row.days.length,
        firstDay: row.firstDay,
        lastDay: row.lastDay,
        pendingDates: row.days,
      })),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-pending-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [payload]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timesheets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approve the days the run gate calls unapproved. Approval stamps a day range —
            the Shift system stays the source of truth, and payroll re-checks the gate on prepare.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={scopeId}
            onValueChange={(value) => {
              // Fresh scope, fresh notes — the old receipts described the
              // old scope, and carrying them over would only confuse.
              setRowNote(null);
              setBulkNote(null);
              setScopeId(value || '__all__');
            }}
            aria-label="Scope the timesheet desk to a payroll period"
          >
            <SelectTrigger className="w-56" data-testid="hr-timesheet-scope-picker">
              <SelectValue placeholder="Pick a period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All pending days</SelectItem>
              {(periods ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.status === 'VOIDED' ? ' · voided' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* v2.139.0: the batch door — every pending row cleared through the
              ONE audited per-employee service, walked one at a time. Disabled
              while anything (single or batch) is in flight; the label keeps
              an honest count of the walk. */}
          <Button
            size="sm"
            onClick={() => void approveAll()}
            disabled={!payload || loading || payload.rows.length === 0 || approvingId !== null || bulkRunning}
            aria-label="Approve every pending day listed, one employee at a time, through the same audited approval service"
            title="Walks every pending row through the same approval service the single button uses — one employee at a time, failures named, never a bulk write"
            data-testid="hr-timesheet-approve-all"
          >
            {bulkRunning ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                Approving {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : '…'}
              </>
            ) : (
              <>
                <CheckCheck className="mr-1 h-3.5 w-3.5" aria-hidden />
                Approve all
              </>
            )}
          </Button>
          {/* v2.145.0: the day-kind lens trio — the weekends-only toggle
              (v2.140.0) completes the pair as a joined segmented control
              (the gate card's outcome trio's own shape, v2.144.0). Each
              member dresses as the chips it keeps: ALL neutral, WEEKENDS
              sky (the weekend chips' own tint), WEEKDAYS amber (the weekday
              chips' own tint). aria-pressed speaks every state; the count
              chip keeps speaking every pending day; the persisted read maps
              the legacy '1' to 'weekends' so no old choice resets. */}
          <div
            className="inline-flex h-8 items-center gap-0.5 rounded-full border border-input bg-background p-0.5"
            role="group"
            aria-label="Day-kind lens for the pending strips"
            data-testid="hr-timesheet-lens"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLensPref('all')}
              disabled={loading}
              aria-pressed={lens === 'all'}
              aria-label="Show every pending day on the strips"
              title="The unfiltered view — every pending day, weekends and weekdays. The count chip always speaks this total."
              data-testid="hr-timesheet-lens-all"
              className={`h-7 gap-1 rounded-full px-2.5 text-xs font-medium ${
                lens === 'all'
                  ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-border'
              } focus-visible:ring-1 focus-visible:ring-ring`}
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">All days</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLensPref('weekends')}
              disabled={loading}
              aria-pressed={lens === 'weekends'}
              aria-label="Show only weekend days on the pending strips"
              title="Filters the strips to Saturdays and Sundays — the count chip still speaks every pending day, and the lens keeps its setting in this browser"
              data-testid="hr-timesheet-lens-weekends"
              className={`h-7 gap-1 rounded-full px-2.5 text-xs font-medium ${
                lens === 'weekends'
                  ? 'border border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-950 dark:hover:text-sky-200'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-border'
              } focus-visible:ring-1 focus-visible:ring-ring`}
            >
              <Sun className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Weekends only</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLensPref('weekdays')}
              disabled={loading}
              aria-pressed={lens === 'weekdays'}
              aria-label="Show only weekday days on the pending strips"
              title="Filters the strips to Mondays through Fridays — the count chip still speaks every pending day, and the lens keeps its setting in this browser"
              data-testid="hr-timesheet-lens-weekdays"
              className={`h-7 gap-1 rounded-full px-2.5 text-xs font-medium ${
                lens === 'weekdays'
                  ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-950 dark:hover:text-amber-200'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground hover:ring-1 hover:ring-border'
              } focus-visible:ring-1 focus-visible:ring-ring`}
            >
              <Briefcase className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Weekdays only</span>
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!payload || loading || payload.rows.length === 0}
            aria-label="Export the pending timesheet list as CSV — codes, names, and days only, never pay data"
            title="Exports the pending list as shown — codes, names, and days; no pay data"
            data-testid="hr-timesheet-csv"
          >
            <FileDown className="mr-1 h-3.5 w-3.5" aria-hidden />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadPending(scopeId)}
            disabled={loading}
            aria-label="Refresh the pending timesheet read"
            data-testid="hr-timesheet-refresh"
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      <p className="text-xs font-medium text-muted-foreground" data-testid="hr-timesheet-scope-line">
        <CalendarCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        {scopeLine}
        {payload ? ` · ${payload.totalDays} pending ${payload.totalDays === 1 ? 'day' : 'days'} · checked ${formatEatStamp(new Date(payload.checkedAt))}` : ''}
      </p>

      {focusedRow ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          data-testid="hr-timesheet-focus-chip"
        >
          Showing the row the gate sent you for: {focusedRow.employeeCode} {focusedRow.employeeName}.
          <button
            type="button"
            onClick={() => setFocusId(null)}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:hover:bg-amber-900/40 dark:hover:text-amber-200"
            aria-label="Clear the focused employee and show every row"
            data-testid="hr-timesheet-focus-clear"
          >
            <X className="h-3 w-3" aria-hidden />
            Show every row
          </button>
        </div>
      ) : null}

      {rowNote ? (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-xs ${
            rowNote.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
          data-testid="hr-timesheet-note"
        >
          {rowNote.text}
        </div>
      ) : null}

      {bulkNote ? (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-xs ${
            bulkNote.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : bulkNote.tone === 'partial'
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
          data-testid="hr-timesheet-bulk-note"
        >
          <p className="font-medium">{bulkNote.text}</p>
          {bulkNote.failures.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {bulkNote.failures.map((f, i) => (
                <li key={i} className="font-medium" data-testid="hr-timesheet-bulk-failure">
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2" data-testid="hr-timesheet-desk" aria-busy>
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <div className="space-y-2" data-testid="hr-timesheet-desk">
          <div
            role="status"
            data-testid="hr-timesheet-error"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40"
          >
            <p className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> The pending read failed — the desk stays dark rather than guess. {error}
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadPending(scopeId)} aria-label="Retry the pending timesheet read">
              Retry
            </Button>
          </div>
        </div>
      ) : !payload || payload.rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" aria-hidden />
            <p className="mt-2 text-sm font-medium" data-testid="hr-timesheet-clear">
              No unapproved timesheet days{payload?.scope ? ' for this period' : ' anywhere on file'} — the gate&apos;s timesheet lane is quiet.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The run gate checks every active employee&apos;s attendance on prepare; nothing here means nothing for it to block on.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pending approval</CardTitle>
            <CardDescription>
              One row per employee. Approving stamps the employee&apos;s whole pending range — the same service the gate re-checks on prepare.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table data-testid="hr-timesheet-desk">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead>Pending days</TableHead>
                  <TableHead className="hidden md:table-cell">Days</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payload.rows.map((row) => {
                  // v2.140.0: the lens composes BEFORE the strip builder, so
                  // the +N overflow stays honest about exactly what the lens
                  // is showing. v2.145.0: three ways — weekends keep real
                  // Sat/Sun, weekdays keep valid non-weekend days, garbage
                  // survives only under All (an unreadable day is honestly
                  // neither) — the hidden count stays honest on every path.
                  const strip = deskDayStrip(
                    lens === 'weekends'
                      ? deskWeekendDays(row.days)
                      : lens === 'weekdays'
                        ? deskWeekdayDays(row.days)
                        : row.days,
                  );
                  const focused = row.employeeId === focusId;
                  return (
                    <TableRow
                      key={row.employeeId}
                      data-testid="hr-timesheet-row"
                      data-employee-id={row.employeeId}
                      aria-current={focused ? 'true' : undefined}
                      className={focused ? 'bg-amber-50/60 ring-1 ring-inset ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-700' : ''}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {row.employeeCode}
                          </Badge>
                          <span className="font-medium">{row.employeeName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
                          data-testid="hr-timesheet-count-chip"
                        >
                          {row.days.length} {row.days.length === 1 ? 'day' : 'days'}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {/* v2.138.0: weekend chips wear the sky tint — a
                            Saturday punch stands out from the working week
                            (an anomaly spotlight, not a judgement). */}
                        <span
                          className="flex flex-wrap items-center gap-1"
                          data-testid="hr-timesheet-day-strip"
                          data-lens={lens !== 'all' ? lens : undefined}
                        >
                          {strip.shown.length === 0 && lens !== 'all' && row.days.length > 0 ? (
                            <span
                              className="rounded px-1 py-0.5 text-[10px] italic text-muted-foreground"
                              data-testid="hr-timesheet-strip-empty"
                            >
                              {lens === 'weekends' ? 'no weekend days' : 'no weekday days'}
                            </span>
                          ) : null}
                          {strip.shownDays.map((day, idx) => {
                            const weekend = deskDayIsWeekend(day);
                            return (
                              <span
                                key={`${day}-${idx}`}
                                className={`rounded border px-1 py-0.5 font-mono text-[10px] tabular-nums ${
                                  weekend
                                    ? 'border-sky-200 bg-sky-50/80 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300'
                                    : 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                                }`}
                                title={weekend ? `${strip.shown[idx]} — weekend day` : undefined}
                                data-weekend={weekend ? 'true' : undefined}
                              >
                                {strip.shown[idx]}
                              </span>
                            );
                          })}
                          {strip.hidden > 0 ? (
                            <span
                              className="rounded px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
                              data-testid="hr-timesheet-strip-overflow"
                            >
                              +{strip.hidden} more
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => void approve(row)}
                          disabled={approvingId !== null}
                          aria-label={`Approve ${row.days.length} pending ${row.days.length === 1 ? 'day' : 'days'} for ${row.employeeName || row.employeeCode}`}
                          data-testid="hr-timesheet-approve"
                        >
                          {approvingId === row.employeeId ? (
                            <>
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                              Approving…
                            </>
                          ) : (
                            'Approve'
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
