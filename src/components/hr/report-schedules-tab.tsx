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
import { formatCsvSize } from '@/lib/hr/digest-csv';
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
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  Eye,
  History,
  Loader2,
  Mail,
  Paperclip,
  Pause,
  Play,
  PlusCircle,
  RotateCcw,
  Send,
  Trash2,
  Users,
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
  // v2.27.0: per-recipient chips (parsed server-side from the joined column).
  recipientList: string[];
  // v2.54.0: per-recipient envelope rows stamp the address — when present
  // the row IS that recipient's own delivery record.
  recipientAddress: string | null;
  manual: boolean;
  // v2.46.0: the ready-to-file CSV that travelled with this attempt.
  csvFilename: string | null;
  csvBytes: number | null;
  // v2.55.0: this envelope was the re-send to recipients the previous batch
  // missed — the history renders an amber "re-send" chip so a retry reads as
  // a retry.
  resend: boolean;
}

// v2.55.0: who would a re-send reach right now (GET …/resend, read-only).
interface ScheduleResendInfo {
  available: boolean;
  lastStatus: string | null;
  batchAt: string | null;
  delivered: number;
  total: number;
  failedRecipients: string[];
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
  { value: 'leave-utilisation', label: 'Leave balances (leave-year keyed)' },
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
  // v2.54.0: mixed delivery is its own honest state — amber, like PENDING.
  PARTIAL: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
};

// v2.25.0: delivery-row status chip styles (NotificationLog statuses).
const DELIVERY_STATUS_STYLES: Record<string, string> = {
  SENT: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  FAILED: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900',
  PENDING: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  PARTIAL: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
};

// v2.25.0: health dot colour per delivery status (mini-bar on each card).
const DOT_STYLES: Record<string, string> = {
  SENT: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  PENDING: 'bg-amber-400',
  PARTIAL: 'bg-amber-400',
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

// v2.26.0: client-side mirror of the service's EMAIL_RE so the recipient
// editor gives instant per-address feedback (the server re-validates anyway).
const RECIPIENT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ParsedRecipientDraft {
  valid: string[];
  invalid: string[];
}

function parseRecipientsDraft(draft: string): ParsedRecipientDraft {
  const tokens = draft
    .split(/[;,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (RECIPIENT_RE.test(lower) && lower.length <= 254) {
      if (!seen.has(lower)) {
        seen.add(lower);
        valid.push(lower);
      }
    } else {
      invalid.push(token);
    }
  }
  return { valid, invalid };
}

function frequencyDetail(s: ScheduleRow): string {
  if (s.frequency === 'WEEKLY') return `Every ${WEEKDAYS[s.weekday ?? 0] ?? '?'}`;
  if (s.frequency === 'MONTHLY') return `Day ${s.dayOfMonth ?? 1} of each month`;
  return 'Every day';
}

function hourLabel(hourUtc: number): string {
  return `${String(hourUtc).padStart(2, '0')}:00 UTC`;
}

export function ReportSchedulesTab({ highlightScheduleId }: { highlightScheduleId?: string | null } = {}) {
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

  // v2.27.0: per-recipient expansion inside the history panel (one row →
  // the individual addresses the attempt was addressed to).
  const [historyExpandedId, setHistoryExpandedId] = useState<string | null>(null);
  // v2.27.0: deep-link target highlight (?schedule=<id> from the
  // notification center's "Manage schedule" affordance).
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // v2.26.0: per-schedule recipient management (PATCH …/schedules/[id]).
  const [recipientsTarget, setRecipientsTarget] = useState<ScheduleRow | null>(null);
  const [recipientsDraft, setRecipientsDraft] = useState('');
  const [recipientsBusy, setRecipientsBusy] = useState(false);
  const [recipientsError, setRecipientsError] = useState('');

  // v2.55.0: re-send affordance — per-schedule info (who missed the latest
  // batch) fetched lazily for PARTIAL/FAILED cards only, plus the in-flight
  // marker for the re-send button.
  const [resendInfo, setResendInfo] = useState<Record<string, ScheduleResendInfo>>({});
  const [resendingId, setResendingId] = useState<string | null>(null);

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

  // v2.27.0: deep-link target (?schedule=<id> from the notification center's
  // "Manage schedule" affordance) — once the rows are loaded, scroll the
  // matching card into view and keep a violet ring on it briefly so the
  // operator lands on the exact schedule, not just the tab.
  useEffect(() => {
    if (!highlightScheduleId || !rows || rows.length === 0) return;
    const target = rows.find((r) => r.id === highlightScheduleId);
    if (!target) return;
    setHighlightId(target.id);
    const el = document.getElementById(`schedule-card-${target.id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = window.setTimeout(() => setHighlightId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [highlightScheduleId, rows]);

  // v2.55.0: lazily ask the server who missed the latest batch — only for
  // cards whose last status says a delivery fell short (PARTIAL / FAILED).
  // Failures here are silent by design: no info → no affordance, the card
  // stays exactly as honest as it was. Re-runs whenever rows refresh (after
  // every action's load()), so a fresh verdict follows a fresh send.
  useEffect(() => {
    if (!rows) return;
    for (const row of rows) {
      if (row.lastStatus !== 'PARTIAL' && row.lastStatus !== 'FAILED') continue;
      apiGet<ScheduleResendInfo>(`/api/hr/reports/schedules/${row.id}/resend`)
        .then((info) => setResendInfo((prev) => ({ ...prev, [row.id]: info })))
        .catch(() => {});
    }
  }, [rows]);

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
        outcome: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
        digestSummary: { reportLabel: string; periodLabel: string; scopeLabel: string; headlines: string[] } | null;
        email: { success: boolean; error?: string };
        notificationId: string | null;
        csv: { filename: string; byteSize: number } | null;
      }>(`/api/hr/reports/schedules/${s.id}/send-now`, 'POST');
      const label = res.digestSummary?.reportLabel ?? s.reportLabel;
      const csvNote = res.csv ? ` The ready-to-file CSV (${formatCsvSize(res.csv.byteSize)}) is attached to the email.` : '';
      if (res.outcome === 'SENT') {
        setSendNote({
          tone: 'ok',
          text: `${label} digest sent to ${s.recipients.length} recipient(s) - email delivered.${csvNote} A copy is in your notification center.`,
        });
      } else if (res.outcome === 'PARTIAL') {
        // v2.54.0: mixed delivery gets its own amber note — per-recipient
        // rows in the delivery history say exactly which address broke.
        setSendNote({
          tone: 'warn',
          text: `${label} digest delivered to some recipients (${res.email.error ?? 'partial delivery'}) - check the delivery history for the per-recipient rows.${csvNote}`,
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

  // v2.55.0: re-send the digest to EXACTLY the recipients the latest batch
  // missed. The server re-derives the target set (the client's list is only
  // ever display copy) and recomputes the digest fresh; everyone who already
  // received it is never emailed twice. The 409 NOTHING_TO_RESEND is treated
  // as an amber note, not an error — "nothing to do" is a good answer.
  const resendNow = async (s: ScheduleRow) => {
    setResendingId(s.id);
    setError('');
    setSendNote(null);
    try {
      const res = await apiSend<{
        outcome: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
        reSentTo: string[];
        digestSummary: { reportLabel: string; periodLabel: string; scopeLabel: string; headlines: string[] } | null;
        email: { success: boolean; error?: string };
        csv: { filename: string; byteSize: number } | null;
      }>(`/api/hr/reports/schedules/${s.id}/resend`, 'POST');
      const label = res.digestSummary?.reportLabel ?? s.reportLabel;
      const n = res.reSentTo.length;
      const csvNote = res.csv ? ` The ready-to-file CSV (${formatCsvSize(res.csv.byteSize)}) rides every envelope.` : '';
      if (res.outcome === 'SENT') {
        setSendNote({
          tone: 'ok',
          text: `${label} digest re-sent to ${n} recipient${n === 1 ? '' : 's'} who missed it — email delivered.${csvNote} A copy is in your notification center.`,
        });
      } else if (res.outcome === 'PARTIAL') {
        setSendNote({
          tone: 'warn',
          text: `${label} re-send delivered to some of the ${n} missed recipient${n === 1 ? '' : 's'} (${res.email.error ?? 'partial delivery'}) — the per-recipient rows are in the delivery history.`,
        });
      } else if (res.outcome === 'SKIPPED') {
        setSendNote({
          tone: 'warn',
          text: `${label} re-send not sent: ${res.email.error ?? 'no data for the period'}. Nothing was emailed.`,
        });
      } else {
        setSendNote({
          tone: 'warn',
          text: `${label} re-send failed (${res.email.error ?? 'delivery error'}) — the per-recipient failure rows are in the delivery history.`,
        });
      }
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not re-send the digest.';
      if (message.toLowerCase().includes('nothing to re-send')) {
        setSendNote({ tone: 'warn', text: `${s.reportLabel}: nothing to re-send — the latest delivery already reached every recipient.` });
      } else {
        setError(message);
      }
    } finally {
      setResendingId(null);
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
      // v2.27.0: collapsing the panel also collapses any expanded row.
      setHistoryExpandedId(null);
      return;
    }
    setHistoryId(s.id);
    setHistoryRows(null);
    setHistoryError('');
    setHistoryLoading(true);
    // v2.27.0: switching schedules collapses the previous row expansion.
    setHistoryExpandedId(null);
    try {
      const res = await apiGet<DeliveryRow[]>(`/api/hr/reports/schedules/${s.id}/deliveries?limit=10`);
      setHistoryRows(res);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Could not load delivery history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  // v2.26.0: open the recipient editor prefilled one address per line.
  const openRecipients = (s: ScheduleRow) => {
    setRecipientsTarget(s);
    setRecipientsDraft(s.recipients.join('\n'));
    setRecipientsError('');
  };

  // v2.26.0: save via PATCH — the server re-validates + enforces the fail-closed
  // schedule scope (a BRANCH manager editing an org-wide schedule gets a 403).
  const saveRecipients = async () => {
    if (!recipientsTarget) return;
    const { valid, invalid } = parseRecipientsDraft(recipientsDraft);
    if (valid.length === 0 || invalid.length > 0) return;
    setRecipientsBusy(true);
    setRecipientsError('');
    try {
      await apiSend(`/api/hr/reports/schedules/${recipientsTarget.id}`, 'PATCH', { recipients: valid });
      setRecipientsTarget(null);
      await load();
    } catch (e) {
      setRecipientsError(e instanceof Error ? e.message : 'Could not update the recipients.');
    } finally {
      setRecipientsBusy(false);
    }
  };

  const summary = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      active: list.filter((r) => r.active).length,
      failing: list.filter((r) => r.lastStatus === 'FAILED').length,
      // v2.55.0: a mixed delivery is its own headline — neither fully green
      // nor fully red, so it earns its own amber chip instead of hiding
      // inside "failing".
      partial: list.filter((r) => r.lastStatus === 'PARTIAL').length,
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
          {summary.partial > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
              title="Deliveries that reached some — but not all — recipients. The re-send affordance on each card targets exactly who missed it."
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {summary.partial} partial
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
              id={`schedule-card-${s.id}`}
              className={`gap-3 overflow-hidden py-0 transition-shadow hover:shadow-md ${s.active ? '' : 'opacity-75'} ${highlightId === s.id ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-2 ring-offset-background' : ''}`}
              aria-label={`${s.reportLabel} schedule${highlightId === s.id ? ' (highlighted from notification)' : ''}`}
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
                      <button
                        type="button"
                        onClick={() => openRecipients(s)}
                        className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        None configured — add recipients
                      </button>
                    ) : (
                      s.recipients.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => openRecipients(s)}
                          className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-sky-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={`${r} — click to manage recipients`}
                        >
                          {r}
                        </button>
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
                      {/* v2.55.0: the re-send affordance — names exactly who
                          missed the latest batch and offers one-tap retry to
                          ONLY those addresses. Rendered straight under the
                          failure it answers, in the amber family the PARTIAL
                          chip established. */}
                      {resendInfo[s.id]?.available ? (
                        <div
                          className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5 dark:border-amber-900 dark:bg-amber-950/30"
                          role="status"
                          aria-label={`Re-send available for ${s.reportLabel}: ${resendInfo[s.id].failedRecipients.length} recipient(s) missed the latest delivery`}
                        >
                          <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            Missed the latest digest
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {resendInfo[s.id].failedRecipients.map((r) => (
                              <span
                                key={r}
                                className="inline-flex max-w-full items-center gap-0.5 rounded-md border border-rose-200 bg-background px-1.5 py-0.5 font-mono text-[10px] text-rose-800 dark:border-rose-900 dark:text-rose-200"
                                title={`${r} — this address did not receive the latest batch`}
                              >
                                <span aria-hidden className="font-sans">×</span>
                                <span className="truncate">{r}</span>
                              </span>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void resendNow(s)}
                            disabled={busy || sendingId !== null || resendingId !== null}
                            className="mt-1.5 h-7 gap-1 border-amber-300 px-2 text-xs text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/60 dark:hover:text-amber-100"
                            aria-label={`Re-send the ${s.reportLabel} digest to ${resendInfo[s.id].failedRecipients.length} failed recipient(s)`}
                          >
                            {resendingId === s.id ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Re-sending…
                              </>
                            ) : (
                              <>
                                <RotateCcw className="h-3 w-3" aria-hidden />
                                Re-send to {resendInfo[s.id].failedRecipients.length} failed
                              </>
                            )}
                          </Button>
                        </div>
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
                        {historyRows.map((d) => {
                          // v2.54.0: a per-recipient envelope row IS one
                          // recipient's own delivery record — the address
                          // renders inline (mono) and the expansion chevron
                          // is pointless. Legacy shared-envelope rows keep
                          // the v2.27.0 per-recipient chip expansion.
                          const perRecipient = typeof d.recipientAddress === 'string' && d.recipientAddress.length > 0;
                          const expanded = historyExpandedId === d.id;
                          return (
                            <li key={d.id} className={`py-1.5 transition-colors hover:bg-muted/40 ${perRecipient ? 'pl-2' : ''}`}>
                              <button
                                type="button"
                                onClick={() => setHistoryExpandedId(expanded ? null : d.id)}
                                aria-expanded={expanded}
                                aria-label={
                                  perRecipient
                                    ? `${d.status} delivery on ${formatDate(d.createdAt)} to ${d.recipientAddress}`
                                    : `${d.status} delivery on ${formatDate(d.createdAt)} to ${d.recipientList.length} recipient(s) — ${expanded ? 'hide' : 'show'} per-recipient details`
                                }
                                className="flex w-full items-start justify-between gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                                    {d.resend ? (
                                      <span
                                        className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                        title="This envelope was the re-send to the recipients the previous delivery missed"
                                      >
                                        <RotateCcw className="h-2.5 w-2.5" aria-hidden />
                                        re-send
                                      </span>
                                    ) : null}
                                    {d.csvFilename ? (
                                      <span
                                        className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1 text-[10px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                                        title={`${d.csvFilename} — the ready-to-file CSV attached to this digest email`}
                                      >
                                        <Paperclip className="h-2.5 w-2.5" aria-hidden />
                                        CSV{d.csvBytes ? ` · ${formatCsvSize(d.csvBytes)}` : ''}
                                      </span>
                                    ) : null}
                                    <span className="text-muted-foreground">· {d.recipientList.length} recipient(s)</span>
                                    {d.recipientAddress ? (
                                      <span
                                        className="max-w-[16rem] truncate rounded bg-muted px-1 font-mono text-[10px] text-foreground/80"
                                        title={`${d.recipientAddress} — this row is ${d.recipientAddress}'s own delivery record`}
                                      >
                                        {d.recipientAddress}
                                      </span>
                                    ) : null}
                                  </p>
                                  {d.error ? (
                                    <p className="mt-0.5 line-clamp-2 text-rose-600 dark:text-rose-400" title={d.error}>
                                      {d.error}
                                    </p>
                                  ) : null}
                                </div>
                                <span
                                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted"
                                  title={expanded ? 'Hide per-recipient details' : 'Show per-recipient details'}
                                >
                                  {expanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                                  )}
                                </span>
                              </button>
                              {expanded && d.recipientList.length > 0 ? (
                                <div className="mt-1.5 rounded-md border bg-muted/30 px-2 py-1.5">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Per-recipient · {d.recipientList.length} address{d.recipientList.length === 1 ? '' : 'es'}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {d.recipientList.map((r) => (
                                      <span
                                        key={r}
                                        className={`inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10px] ${
                                          d.status === 'SENT'
                                            ? 'border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-200'
                                            : d.status === 'FAILED'
                                              ? 'border-rose-200 text-rose-800 dark:border-rose-900 dark:text-rose-200'
                                              : 'border-amber-200 text-amber-800 dark:border-amber-900 dark:text-amber-200'
                                        }`}
                                        title={`${r} — attempt ${d.status}`}
                                      >
                                        <span aria-hidden className="font-sans">
                                          {d.status === 'SENT' ? '✓' : d.status === 'PENDING' ? '…' : '×'}
                                        </span>
                                        <span className="truncate">{r}</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
                <div className="flex items-center justify-end gap-1.5 border-t pt-2">
                  {/* v2.26.0: manage this schedule's recipients (PATCH round-trip). */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openRecipients(s)}
                    disabled={busy || sendingId !== null}
                    className="h-7 gap-1 px-2 text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                    aria-label={`Manage ${s.reportLabel} recipients`}
                  >
                    <Users className="h-3 w-3" aria-hidden />
                    Recipients
                  </Button>
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
              never employee names, national IDs or raw ids. Times are UTC. Leave balances digests
              are keyed to the current calendar leave year instead of the period above.
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

      {/* v2.26.0: recipient management dialog — live per-address validation, */}
      {/* dedupe, and a PATCH round-trip; scope errors surface inline. */}
      <Dialog open={recipientsTarget !== null} onOpenChange={(o) => { if (!o) setRecipientsTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" aria-hidden /> Manage recipients
              {recipientsTarget ? (
                <span className="text-sm font-normal text-muted-foreground">· {recipientsTarget.reportLabel}</span>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              One address per line (or comma-separated). The digest sends aggregates only — never names or raw ids.
              Changes apply to every future send, including the next scheduled fire.
            </DialogDescription>
          </DialogHeader>

          {recipientsError ? <ErrorNote message={recipientsError} /> : null}

          <div className="grid gap-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="recipients-edit">Addresses</Label>
              <Textarea
                id="recipients-edit"
                value={recipientsDraft}
                onChange={(e) => setRecipientsDraft(e.target.value)}
                rows={4}
                aria-required
                placeholder={'owner@mbumahhardware.co.ke\nhr@mbumahhardware.co.ke'}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Duplicates and spacing are handled for you; at most 20 addresses.
              </p>
            </div>

            {/* Live validation preview */}
            {(() => {
              const { valid, invalid } = parseRecipientsDraft(recipientsDraft);
              return (
                <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs" aria-live="polite">
                  <p className="mb-1 font-medium text-muted-foreground">
                    Will send to {valid.length} recipient{valid.length === 1 ? '' : 's'}
                    {valid.length >= 20 ? ' (cap reached — extras will be dropped)' : ''}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {valid.map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <CircleCheck className="h-3 w-3" aria-hidden /> {r}
                      </span>
                    ))}
                    {invalid.map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-mono text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" title="Not a valid email address">
                        <CircleX className="h-3 w-3" aria-hidden /> {r}
                      </span>
                    ))}
                    {valid.length === 0 && invalid.length === 0 ? (
                      <span className="text-muted-foreground">No addresses yet.</span>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRecipientsTarget(null)} disabled={recipientsBusy}>
              Cancel
            </Button>
            {(() => {
              const { valid, invalid } = parseRecipientsDraft(recipientsDraft);
              const changed = recipientsTarget ? valid.join(',') !== recipientsTarget.recipients.join(',') : true;
              return (
                <Button
                  size="sm"
                  onClick={() => void saveRecipients()}
                  disabled={recipientsBusy || valid.length === 0 || invalid.length > 0 || !changed}
                >
                  {recipientsBusy ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…
                    </>
                  ) : (
                    'Save recipients'
                  )}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
