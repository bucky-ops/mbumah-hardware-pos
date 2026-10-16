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
  Activity,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  CircleAlert,
  Clock3,
  Eye,
  History,
  Loader2,
  Mail,
  Pause,
  Play,
  PlusCircle,
  Send,
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

interface StoreOption {
  id: string;
  name: string;
  code: string | null;
}

// v2.25.0: one recorded email-delivery attempt for a schedule (durable
// NotificationLog row written by the central email service on every send).
interface DeliveryRow {
  id: string;
  status: string; // SENT | FAILED | PENDING
  recipient: string;
  subject: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  recipients: number;
  manual: boolean;
}

// v2.25.0: dry-run digest preview (identical payload to the email, never sent).
interface SchedulePreviewData {
  reportLabel: string;
  periodLabel: string | null;
  scopeLabel: string | null;
  headlines: Array<{ label: string; value: string }>;
  table: { caption: string; columns: string[]; rows: string[][] } | null;
  recipients: string[];
  nextRunAt: string;
  unavailableReason: string | null;
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

// v2.25.0: delivery-row status chip styles (NotificationLog statuses).
const DELIVERY_STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  FAILED: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900',
  PENDING: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
};

// v2.25.0: health dot colour per delivery status (mini-bar on each card).
const DOT_STYLES: Record<string, string> = {
  SENT: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  PENDING: 'bg-amber-400',
};

function deliveryDotClass(status: string): string {
  return DOT_STYLES[status] ?? 'bg-muted-foreground/40';
}

/** Newest-last list for the dots bar (API returns newest-first). */
function healthDots(rows: DeliveryRow[]): Array<{ id: string; status: string; title: string }> {
  return [...rows]
    .reverse()
    .slice(-10)
    .map((d) => ({
      id: d.id,
      status: d.status,
      title: `${d.status}${d.manual ? ' (manual)' : ''} · ${formatDate(d.createdAt)}${d.error ? ` · ${d.error}` : ''}`,
    }));
}

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
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // v2.24.0: manual "send now" - per-row busy marker + inline result banner.
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const [form, setForm] = useState({
    reportKey: 'headcount',
    frequency: 'WEEKLY',
    weekday: '1',
    dayOfMonth: '1',
    hourUtc: '2',
    recipients: '',
    storeId: 'all',
  });

  // v2.25.0: dry-run preview (digest-styled dialog, pure read).
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SchedulePreviewData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // v2.25.0: inline delivery-history panel (last NotificationLog rows).
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<DeliveryRow[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  const storeNameFor = useCallback(
    (id: string | null): string | null => (id ? (stores.find((s) => s.id === id)?.name ?? null) : null),
    [stores],
  );

  const load = useCallback(async () => {
    try {
      setError('');
      const [scheduleRows, storeOptions] = await Promise.all([
        apiGet<ScheduleRow[]>('/api/hr/reports/schedules'),
        apiGet<StoreOption[]>('/api/hr/stores').catch(() => [] as StoreOption[]),
      ]);
      setRows(scheduleRows);
      setStores(storeOptions);
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
        storeId: form.storeId === 'all' ? null : form.storeId,
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

  // v2.24.0: send this schedule's digest immediately (cadence untouched -
  // the next scheduled slot stays where it was). The actor always receives
  // a notification-center copy with the digest headline + delivery status.
  const sendNow = async (s: ScheduleRow) => {
    setSendingId(s.id);
    setError('');
    setSendNote(null);
    try {
      const res = await apiSend<{
        outcome: 'SENT' | 'FAILED' | 'SKIPPED';
        digestSummary: { reportLabel: string; periodLabel: string; scopeLabel: string; headlines: string[] } | null;
        email: { success: boolean; error?: string };
        notificationId: string | null;
      }>(`/api/hr/reports/schedules/${s.id}/send-now`, 'POST');
      const label = res.digestSummary?.reportLabel ?? s.reportLabel;
      if (res.outcome === 'SENT') {
        setSendNote({
          tone: 'ok',
          text: `${label} digest sent to ${s.recipients.length} recipient(s) - email delivered. A copy is in your notification center.`,
        });
      } else if (res.outcome === 'SKIPPED') {
        setSendNote({
          tone: 'warn',
          text: `${label} digest not sent: ${res.email.error ?? 'no data for the period'}. A copy is in your notification center.`,
        });
      } else {
        setSendNote({
          tone: 'warn',
          text: `${label} digest email failed (${res.email.error ?? 'delivery error'}) - the aggregate copy is in your notification center.`,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the digest.');
    } finally {
      setSendingId(null);
    }
  };

  // v2.25.0: compute what the next email would contain — no send, no writes,
  // cadence untouched. The dialog mirrors the email template's structure.
  const openPreview = async (s: ScheduleRow) => {
    setPreviewId(s.id);
    setPreviewError('');
    setPreview(null);
    setPreviewOpen(true);
    try {
      const res = await apiGet<SchedulePreviewData>(`/api/hr/reports/schedules/${s.id}/preview`);
      setPreview(res);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Could not compute the preview.');
    } finally {
      setPreviewId(null);
    }
  };

  // v2.25.0: expand/collapse the per-schedule delivery history (NotificationLog).
  const toggleHistory = async (s: ScheduleRow) => {
    if (historyId === s.id) {
      setHistoryId(null);
      setHistoryRows(null);
      return;
    }
    setHistoryId(s.id);
    setHistoryRows(null);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const res = await apiGet<DeliveryRow[]>(`/api/hr/reports/schedules/${s.id}/deliveries?limit=10`);
      setHistoryRows(res);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Could not load delivery history.');
    } finally {
      setHistoryLoading(false);
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

      {sendNote ? (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
            sendNote.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
          }`}
        >
          <span className="flex items-start gap-2">
            <Send className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {sendNote.text}
          </span>
          <button
            type="button"
            onClick={() => setSendNote(null)}
            aria-label="Dismiss send result"
            className="rounded p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            ×
          </button>
        </div>
      ) : null}

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
                  {s.storeId ? (
                    <span className="inline-flex items-center gap-1" title="Digest is scoped to this branch's aggregates">
                      <Building2 className="h-3 w-3" aria-hidden /> {storeNameFor(s.storeId) ?? 'Branch'}
                    </span>
                  ) : null}
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
                        <span
                          className="text-muted-foreground"
                          title="Date of the last scheduled fire. Manual sends update the status but never move the cadence."
                        >
                          {s.lastRunAt ? formatDate(s.lastRunAt) : '—'}
                        </span>
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
                  {/* v2.25.0: last-10 delivery health dots (load history to populate). */}
                  {historyId === s.id && historyRows && historyRows.length > 0 ? (
                    <div
                      className="mt-2 flex items-center gap-1 border-t pt-2"
                      role="img"
                      aria-label={`Last ${historyRows.length} deliveries: ${historyRows.filter((d) => d.status === 'SENT').length} sent, ${historyRows.filter((d) => d.status === 'FAILED').length} failed`}
                    >
                      {healthDots(historyRows).map((dot) => (
                        <span
                          key={dot.id}
                          className={`h-1.5 w-1.5 rounded-full ${deliveryDotClass(dot.status)} transition-transform hover:scale-150`}
                          title={dot.title}
                        />
                      ))}
                      <span className="ml-1 text-[10px] text-muted-foreground">last {historyRows.length} sends</span>
                    </div>
                  ) : null}
                </div>

                {/* v2.25.0: inline delivery-history panel (NotificationLog rows). */}
                {historyId === s.id ? (
                  <div className="rounded-md border bg-background/60 px-2.5 py-2 text-[11px]" aria-live="polite">
                    <p className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground">
                      <History className="h-3 w-3" aria-hidden /> Delivery history
                      {historyLoading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                    </p>
                    {historyError ? (
                      <p className="text-rose-600 dark:text-rose-400">{historyError}</p>
                    ) : historyRows === null ? (
                      <Skeleton className="h-10 w-full" />
                    ) : historyRows.length === 0 ? (
                      <p className="text-muted-foreground">
                        No deliveries recorded yet — every send (scheduled or manual) is logged here from now on.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {historyRows.map((d) => (
                          <li
                            key={d.id}
                            className="flex items-start justify-between gap-2 py-1.5 transition-colors hover:bg-muted/40"
                          >
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5">
                                <Badge variant="outline" className={`px-1 py-0 text-[10px] ${DELIVERY_STATUS_STYLES[d.status] ?? ''}`}>
                                  {d.status}
                                </Badge>
                                <span className="text-muted-foreground">{formatDate(d.createdAt)}</span>
                                {d.manual ? (
                                  <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">manual</span>
                                ) : null}
                                <span className="text-muted-foreground">· {d.recipients} recipient(s)</span>
                              </p>
                              {d.error ? (
                                <p className="mt-0.5 line-clamp-2 text-rose-600 dark:text-rose-400" title={d.error}>
                                  {d.error}
                                </p>
                              ) : null}
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground" title="Outbound email provider result">
                              {d.status === 'SENT' ? '✓' : d.status === 'PENDING' ? '…' : '×'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
                <div className="flex items-center justify-end gap-1.5 border-t pt-2">
                  {/* v2.25.0: dry-run preview — what the next email would contain. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void openPreview(s)}
                    disabled={busy || sendingId !== null || previewId !== null}
                    className="h-7 gap-1 px-2 text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                    aria-label={`Preview ${s.reportLabel} digest`}
                  >
                    {previewId === s.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Eye className="h-3 w-3" aria-hidden />
                    )}
                    Preview
                  </Button>
                  {/* v2.25.0: per-schedule delivery history (NotificationLog). */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void toggleHistory(s)}
                    disabled={busy || sendingId !== null}
                    className="h-7 gap-1 px-2 text-xs"
                    aria-label={historyId === s.id ? `Hide ${s.reportLabel} delivery history` : `Show ${s.reportLabel} delivery history`}
                    aria-expanded={historyId === s.id}
                  >
                    <History className="h-3 w-3" aria-hidden />
                    History
                  </Button>
                  {/* v2.24.0: manual on-demand send (cadence untouched). */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void sendNow(s)}
                    disabled={busy || sendingId !== null}
                    className="h-7 gap-1 px-2 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                    aria-label={`Send ${s.reportLabel} digest now`}
                  >
                    {sendingId === s.id ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Sending…
                      </>
                    ) : (
                      <>
                        <Send className="h-3 w-3" aria-hidden /> Send now
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void toggleActive(s)}
                    disabled={busy || sendingId !== null}
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
                    disabled={busy || sendingId !== null}
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
            {stores.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="sched-store">Branch scope</Label>
                <Select value={form.storeId} onValueChange={(v) => setForm((f) => ({ ...f, storeId: v }))}>
                  <SelectTrigger id="sched-store" aria-label="Branch scope of the digest">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches (organization)</SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Branch-scoped digests contain that branch&apos;s aggregates only.</p>
              </div>
            )}
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

      {/* v2.25.0: dry-run preview dialog — mirrors the email digest's structure */}
      {/* (gradient strip, headline stat grid, aggregate table) without sending. */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-violet-500" aria-hidden /> Digest preview
              {preview ? <span className="font-mono text-xs font-normal text-muted-foreground">· dry run</span> : null}
            </DialogTitle>
            <DialogDescription>
              Exactly what the next email would contain — computed through the same governed scope as a real
              send. Nothing is emailed, logged or marked; the cadence is untouched.
            </DialogDescription>
          </DialogHeader>

          {previewError ? (
            <ErrorNote message={previewError} />
          ) : !preview ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Computing the digest…
            </div>
          ) : preview.unavailableReason ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{preview.unavailableReason}</span>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* Email-style header strip */}
              <div className="overflow-hidden rounded-lg border">
                <div className="h-1 w-full bg-gradient-to-r from-sky-500 via-violet-500 to-amber-400" aria-hidden />
                <div className="space-y-1 px-3.5 py-3">
                  <p className="text-sm font-semibold">{preview.reportLabel} digest</p>
                  <p className="text-xs text-muted-foreground">
                    {preview.periodLabel} · {preview.scopeLabel}
                  </p>
                </div>
              </div>

              {/* Headline stats */}
              <div className="grid grid-cols-2 gap-2">
                {preview.headlines.map((h) => (
                  <div key={h.label} className="rounded-lg border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">{h.label}</p>
                    <p className="text-sm font-semibold tabular-nums">{h.value}</p>
                  </div>
                ))}
              </div>

              {/* Aggregate table (same rows the email renders) */}
              {preview.table ? (
                <div className="overflow-hidden rounded-lg border">
                  <p className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {preview.table.caption}
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-[11px] text-muted-foreground">
                        {preview.table.columns.map((c) => (
                          <th key={c} className="px-3 py-1.5 font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.table.rows.map((row, ri) => (
                        <tr key={ri} className="border-b last:border-b-0 transition-colors hover:bg-muted/30">
                          {row.map((cell, ci) => (
                            <td key={ci} className={`px-3 py-1.5 ${ci === 0 ? 'font-medium' : 'tabular-nums'}`}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {/* Recipients + next run */}
              <div className="space-y-2 text-xs">
                <p className="flex items-start gap-1.5">
                  <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />
                  <span className="text-muted-foreground">Would email</span>
                  <span className="flex flex-wrap gap-1">
                    {preview.recipients.map((r) => (
                      <span key={r} className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]">
                        {r}
                      </span>
                    ))}
                  </span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                  <span className="text-muted-foreground">Next scheduled send</span>
                  <span className="font-medium">{formatDate(preview.nextRunAt)}</span>
                  <span className="text-muted-foreground">(UTC clock; manual sends never move it)</span>
                </p>
                <p className="flex items-start gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  <Activity className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  Aggregates only — the digest never contains employee names, national IDs or raw ids.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
