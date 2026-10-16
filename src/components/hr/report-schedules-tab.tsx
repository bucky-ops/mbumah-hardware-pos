'use client';

// MBUMAH HARDWARE POS - /hr/reports → Schedules tab (v2.22.0)
//
// Create and manage scheduled email digests of the aggregate HR reports.
// Every send goes through the governed report service on the server; this UI
// only manages the schedule rows. Status chips surface the last sweep result
// (SENT / FAILED / SKIPPED + error) so delivery problems are visible without
// leaving the page. Styling follows the HR workspace dense-table contract:
// no horizontal scroll, dark-mode variants, aria labels, focus rings.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  Mail,
  Pause,
  Play,
  PlusCircle,
  Trash2,
} from 'lucide-react';
import { apiGet, apiSend, ErrorNote, formatDate } from '@/components/hr/self-service-ui';

interface ScheduleRow {
  id: string;
  reportKey: string;
  reportLabel: string;
  frequency: string;
  recipients: string[];
  weekday: number | null;
  dayOfMonth: number | null;
  hourUtc: number;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  storeId: string | null;
}

const REPORT_OPTIONS = [
  { value: 'headcount', label: 'Headcount' },
  { value: 'employment-cost', label: 'Employment cost' },
  { value: 'absence', label: 'Absence' },
  { value: 'turnover', label: 'Turnover' },
  { value: 'time-to-hire', label: 'Time to hire' },
  { value: 'statutory-liability', label: 'Statutory liability' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FREQUENCY_STYLES: Record<string, string> = {
  DAILY: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900',
  WEEKLY: 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900',
  MONTHLY: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
};

const LAST_STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  FAILED: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900',
  SKIPPED: 'bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800',
};

function frequencyDetail(s: ScheduleRow): string {
  if (s.frequency === 'WEEKLY') return `Every ${WEEKDAYS[s.weekday ?? 0] ?? '?'}`;
  if (s.frequency === 'MONTHLY') return `Day ${s.dayOfMonth ?? 1} of each month`;
  return 'Every day';
}

function hourLabel(hourUtc: number): string {
  return `${String(hourUtc).padStart(2, '0')}:00 UTC`;
}

export function ReportSchedulesTab() {
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    reportKey: 'headcount',
    frequency: 'WEEKLY',
    weekday: '1',
    dayOfMonth: '1',
    hourUtc: '2',
    recipients: '',
  });

  const load = useCallback(async () => {
    try {
      setError('');
      setRows(await apiGet<ScheduleRow[]>('/api/hr/reports/schedules'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedules.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await apiSend('/api/hr/reports/schedules', 'POST', {
        reportKey: form.reportKey,
        frequency: form.frequency,
        weekday: form.frequency === 'WEEKLY' ? Number(form.weekday) : null,
        dayOfMonth: form.frequency === 'MONTHLY' ? Number(form.dayOfMonth) : null,
        hourUtc: Number(form.hourUtc),
        recipients: form.recipients
          .split(/[,;\n]/)
          .map((r) => r.trim())
          .filter(Boolean),
      });
      setOpen(false);
      setForm((f) => ({ ...f, recipients: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the schedule.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (s: ScheduleRow) => {
    setBusy(true);
    setError('');
    try {
      await apiSend(`/api/hr/reports/schedules/${s.id}`, 'PATCH', { active: !s.active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the schedule.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: ScheduleRow) => {
    setBusy(true);
    setError('');
    try {
      await apiSend(`/api/hr/reports/schedules/${s.id}`, 'DELETE');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the schedule.');
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      active: list.filter((r) => r.active).length,
      failing: list.filter((r) => r.lastStatus === 'FAILED').length,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      {error ? <ErrorNote message={error} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1">
            <CalendarClock className="h-3.5 w-3.5 text-sky-500" aria-hidden />
            {summary.total} schedule(s)
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1">
            <Play className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
            {summary.active} active
          </span>
          {summary.failing > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <CalendarSync className="h-3.5 w-3.5" aria-hidden />
              {summary.failing} failing delivery
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => setOpen(true)} disabled={busy} className="gap-1.5">
          <PlusCircle className="h-4 w-4" aria-hidden /> New schedule
        </Button>
      </div>

      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="mt-2 text-sm font-medium">No schedules yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Schedule an email digest of any aggregate report — headcount, cost, absence, turnover,
            time to hire or statutory liability. The digest never contains names or raw ids.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Card
              key={s.id}
              className={`gap-3 overflow-hidden py-0 transition-shadow hover:shadow-md ${s.active ? '' : 'opacity-75'}`}
              aria-label={`${s.reportLabel} schedule`}
            >
              <div className={`h-1 w-full ${s.active ? 'bg-gradient-to-r from-sky-500 via-violet-500 to-amber-400' : 'bg-muted'}`} />
              <CardHeader className="px-4 pt-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Mail className="h-4 w-4 shrink-0 text-sky-500" aria-hidden />
                    {s.reportLabel}
                  </CardTitle>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className={`text-[10px] ${FREQUENCY_STYLES[s.frequency] ?? ''}`}>
                      {s.frequency}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${s.active ? LAST_STATUS_STYLES.SENT : LAST_STATUS_STYLES.SKIPPED}`}>
                      {s.active ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                </div>
                <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" aria-hidden /> {frequencyDetail(s)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarRange className="h-3 w-3" aria-hidden /> {hourLabel(s.hourUtc)}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 px-4 pb-4">
                <div className="text-xs">
                  <p className="mb-1 font-medium text-muted-foreground">Recipients</p>
                  <div className="flex flex-wrap gap-1">
                    {s.recipients.length === 0 ? (
                      <span className="text-muted-foreground">None configured</span>
                    ) : (
                      s.recipients.map((r) => (
                        <span
                          key={r}
                          className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                          title={r}
                        >
                          {r}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-[11px]">
                  {s.lastStatus ? (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant="outline" className={`px-1 py-0 text-[10px] ${LAST_STATUS_STYLES[s.lastStatus] ?? ''}`}>
                          {s.lastStatus}
                        </Badge>
                        <span className="text-muted-foreground">{s.lastRunAt ? formatDate(s.lastRunAt) : '—'}</span>
                      </span>
                      {s.lastError ? (
                        <p className="mt-1 line-clamp-2 text-rose-600 dark:text-rose-400" title={s.lastError}>
                          {s.lastError}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not sent yet — first digest when due.</span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1.5 border-t pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void toggleActive(s)}
                    disabled={busy}
                    className="h-7 gap-1 px-2 text-xs"
                    aria-label={s.active ? `Pause ${s.reportLabel} schedule` : `Resume ${s.reportLabel} schedule`}
                  >
                    {s.active ? (
                      <>
                        <Pause className="h-3 w-3" aria-hidden /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3" aria-hidden /> Resume
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void remove(s)}
                    disabled={busy}
                    className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                    aria-label={`Delete ${s.reportLabel} schedule`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-sky-500" aria-hidden /> Schedule a report digest
            </DialogTitle>
            <DialogDescription>
              Emails the aggregate report on a repeating schedule. Digests contain aggregates only —
              never employee names, national IDs or raw ids. Times are UTC.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="sched-report">Report</Label>
              <Select value={form.reportKey} onValueChange={(v) => setForm((f) => ({ ...f, reportKey: v }))}>
                <SelectTrigger id="sched-report" aria-label="Report to schedule">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sched-freq">Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v }))}>
                  <SelectTrigger id="sched-freq" aria-label="Frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">Daily</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sched-hour">Send hour (UTC)</Label>
                <Select value={form.hourUtc} onValueChange={(v) => setForm((f) => ({ ...f, hourUtc: v }))}>
                  <SelectTrigger id="sched-hour" aria-label="Send hour in UTC">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>
                        {String(h).padStart(2, '0')}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.frequency === 'WEEKLY' && (
              <div className="space-y-1.5">
                <Label htmlFor="sched-weekday">Day of week</Label>
                <Select value={form.weekday} onValueChange={(v) => setForm((f) => ({ ...f, weekday: v }))}>
                  <SelectTrigger id="sched-weekday" aria-label="Day of week">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d, i) => (
                      <SelectItem key={d} value={String(i)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.frequency === 'MONTHLY' && (
              <div className="space-y-1.5">
                <Label htmlFor="sched-dom">Day of month (1–28)</Label>
                <Input
                  id="sched-dom"
                  type="number"
                  min={1}
                  max={28}
                  value={form.dayOfMonth}
                  onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="sched-recipients">Recipients</Label>
              <Textarea
                id="sched-recipients"
                placeholder="owner@mbumahhardware.co.ke, hr@mbumahhardware.co.ke"
                value={form.recipients}
                onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))}
                rows={2}
                aria-required
              />
              <p className="text-[11px] text-muted-foreground">Separate multiple addresses with commas or new lines.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void create()} disabled={busy || form.recipients.trim().length === 0}>
              {busy ? 'Creating…' : 'Create schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
