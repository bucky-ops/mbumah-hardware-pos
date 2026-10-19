'use client';

// Console panels (v2.18.3 port) - Decision Support Action Center, Recent
// Activity Timeline (pop-in + detail modal + filters), Global Chat drawer
// (rewired to main's channel-based /api/chat/* routes) and Live Feed
// (/api/system-logs with graceful unavailable state).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Activity, AlertOctagon, BadgeCheck, BellRing, Coffee, FileText, History, LogIn, MessagesSquare, RadioTower, Send, Sunrise, X } from 'lucide-react';
import { authorizedFetchJson } from '@/lib/api';
import { deskReportDrawerHref } from '@/lib/hr/desk-report';
import { num, timeAgo, type ActivityItem, type ConsoleAlert, type DeskActivityData, type DeskActivityFilter, type KpiSummaryData } from './primitives';

const SEV: Record<string, string> = {
  critical: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  info: 'border-blue-200 bg-blue-50',
};
const SEV_TEXT: Record<string, string> = { critical: 'text-red-600', warning: 'text-amber-700', info: 'text-blue-600' };

// ── Decision Support - Action Center + alerts ────────────────────────────────
export function DecisionSupport({ data, onToast }: {
  data: KpiSummaryData; onToast: (m: string) => void;
}) {
  const q = data.actionQueue;
  return (
    <section aria-label="Decision Support" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <AlertOctagon className="h-4 w-4 text-red-500" /> Decision Support - Action Center
        </h2>
        <div className="space-y-2">
          {data.alerts.map((a: ConsoleAlert) => (
            <div key={a.type} className={`anim-slide-fade rounded-xl border p-3 ${SEV[a.severity] ?? 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={`text-[13px] font-semibold ${SEV_TEXT[a.severity] ?? 'text-slate-700'}`}>{a.title}</p>
                  <p className="text-xs text-slate-500">{a.detail}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {a.actions.map((act) => (
                    <Button key={act} size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                      onClick={() => onToast(`${act}: ${a.title}`)}>
                      {act}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {data.alerts.length === 0 && <p className="text-xs text-slate-500">No active alerts - all clear.</p>}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><Activity className="h-4 w-4 text-orange-500" /> Action queue</h2>
        <ul className="space-y-2 text-xs">
          <QueueRow label="Pending expense approvals" value={q.pendingExpenses} onToast={onToast} />
          <QueueRow label="Purchase orders awaiting release" value={q.pendingPOs} onToast={onToast} />
          <QueueRow label="Open shifts" value={q.openShifts} onToast={onToast} />
        </ul>
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-500">
          Follow-up actions run in the branch workspace that owns the record; every authorization there is audit-logged.
        </p>
      </div>
    </section>
  );
}

function QueueRow({ label, value, onToast }: {
  label: string; value: number; onToast: (m: string) => void;
}) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2">
        <Badge variant="outline" className={value > 0 ? 'border-orange-300 text-orange-800 dark:border-orange-500/40 dark:text-orange-300' : 'text-slate-500'}>{value}</Badge>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToast(`${label}: ${value} - drill down from the branch workspace`)}>View</Button>
      </span>
    </li>
  );
}

// ── Recent Activity Timeline (live, filterable, detail modal) ────────────────
export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  const [fAction, setFAction] = useState('all');
  const [fRole, setFRole] = useState('all');
  const [detail, setDetail] = useState<ActivityItem | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set(items.map((i) => i.id)));

  useEffect(() => {
    const fresh = items.filter((i) => !seen.current.has(i.id));
    if (fresh.length) {
      setFlashIds(new Set(fresh.map((f) => f.id)));
      for (const f of fresh) seen.current.add(f.id);
      const t = setTimeout(() => setFlashIds(new Set()), 3200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [items]);

  const actions = useMemo(() => [...new Set(items.map((i) => i.action))], [items]);
  const roles = useMemo(() => [...new Set(items.map((i) => i.role))], [items]);
  const filtered = items.filter((i) => (fAction === 'all' || i.action === fAction) && (fRole === 'all' || i.role === fRole));

  return (
    <section aria-label="Recent Activity Timeline" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Activity className="h-4 w-4 text-emerald-500" /> Recent Activity Timeline
          <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 anim-live" /> live</span>
        </h2>
        <div className="flex gap-2">
          <Select value={fAction} onValueChange={setFAction}>
            {/* v2.149.0: label the TRIGGER, never the root (v2.147.0's Radix
                Select lesson — the root never forwards a name to the button). */}
            <SelectTrigger aria-label="Filter timeline by action" className="h-7 w-28 text-[11px]"><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>{['all', ...actions].map((a) => <SelectItem key={a} value={a} className="text-xs">{a === 'all' ? 'All actions' : a}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={fRole} onValueChange={setFRole}>
            <SelectTrigger aria-label="Filter timeline by role" className="h-7 w-32 text-[11px]"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>{['all', ...roles].map((r) => <SelectItem key={r} value={r} className="text-xs">{r === 'all' ? 'All roles' : r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <ol className="relative space-y-2 pl-4 before:absolute before:left-1 before:top-1 before:h-[calc(100%-8px)] before:w-0.5 before:rounded before:bg-slate-100">
        {filtered.slice(0, 8).map((a) => (
          <li key={a.id}>
            <button onClick={() => setDetail(a)} className={`focus-ring w-full rounded-lg border border-slate-100 p-2 text-left transition hover:border-orange-200 hover:bg-orange-50/40 ${flashIds.has(a.id) ? 'new-row-flash bg-emerald-50/60' : ''}`}>
              <span aria-hidden className="relative -left-3 top-[11px] mr-1 inline-block h-2 w-2 rounded-full bg-orange-400 anim-pop-in" />
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="text-xs font-medium text-slate-700">{a.displayMessage}</p>
                <span className="text-[10px] text-slate-500">{timeAgo(a.createdAt)}</span>
              </div>
              <p className="text-[10px] text-slate-500">{a.userName} · {a.role}</p>
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="p-2 text-xs text-slate-500">No activity yet in this window.</li>}
      </ol>

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Activity detail</DialogTitle></DialogHeader>
          {detail && (
            <dl className="space-y-1.5 text-xs">
              <Row k="Timestamp" v={new Date(detail.createdAt).toLocaleString('en-KE')} />
              <Row k="User" v={detail.userName} />
              <Row k="Role" v={detail.role} />
              <Row k="Action" v={detail.action} />
              <Row k="Resource" v={detail.entity} />
              <Row k="Summary" v={detail.displayMessage} />
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-b border-slate-50 pb-1"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-700">{v}</dd></div>;
}

// ── Global Chat drawer (main-lineage channel API) ────────────────────────────
interface ChatChannel { id: string; type: string; title: string; storeName: string | null; storeCode: string | null; isGlobal: boolean; messageCount: number; lastMessagePreview: string | null; lastMessageAt: string | null }
interface ChatMsg { id: string; content: string; sentAt: string; isOwn: boolean; sender: { name: string; role: string }; originStoreName: string | null }

export function ChatDrawer({ open, onOpenChange, unread, signedIn, onRequireSignIn }: {
  open: boolean; onOpenChange: (o: boolean) => void; unread: number; signedIn: boolean; onRequireSignIn: () => void;
}) {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadChannels = useCallback(async () => {
    const res = await authorizedFetchJson('/api/chat/channels');
    if (res.ok && res.json?.success) {
      const list = (res.json.data as ChatChannel[]) ?? [];
      setChannels(list);
      setActiveChannel((cur) => cur ?? list.find((c) => c.isGlobal)?.id ?? list[0]?.id ?? null);
      setLoadError(null);
    } else {
      setLoadError(res.status === 401 ? 'Sign in to use global chat.' : 'Chat is unavailable right now.');
    }
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    const res = await authorizedFetchJson(`/api/chat/channels/${channelId}/messages?limit=50`);
    if (res.ok && res.json?.success) setMessages((res.json.data as ChatMsg[]) ?? []);
  }, []);

  useEffect(() => {
    if (!open || !signedIn) return;
    void loadChannels();
    const t = setInterval(() => {
      void loadChannels();
      if (activeChannel) void loadMessages(activeChannel);
    }, 10_000);
    return () => clearInterval(t);
  }, [open, signedIn, loadChannels, loadMessages, activeChannel]);

  useEffect(() => {
    if (open && activeChannel) void loadMessages(activeChannel);
  }, [open, activeChannel, loadMessages]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async () => {
    if (!draft.trim() || !activeChannel) return;
    setSending(true);
    try {
      const res = await authorizedFetchJson(`/api/chat/channels/${activeChannel}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: draft.trim() }),
      });
      if (res.ok) {
        setDraft('');
        await loadMessages(activeChannel);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-100 bg-[#0f172a] p-4 text-white">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <MessagesSquare className="h-4 w-4 text-orange-400" /> Global Chat
            {unread > 0 && <Badge className="bg-red-500 text-[10px] hover:bg-red-500 anim-pulse-dot">{unread} unread</Badge>}
          </SheetTitle>
          {signedIn && channels.length > 0 && (
            <Select value={activeChannel ?? undefined} onValueChange={setActiveChannel}>
              <SelectTrigger className="mt-2 h-7 border-white/20 bg-white/10 text-[11px] text-white"><SelectValue placeholder="Channel" /></SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.isGlobal ? 'Org-wide' : c.storeName ?? c.title} ({c.messageCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SheetHeader>
        {!signedIn ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
            <MessagesSquare className="h-8 w-8 text-slate-300" />
            <p className="text-xs text-slate-500">Sign in to read and send organization chat.</p>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={onRequireSignIn}><LogIn className="mr-1 h-3 w-3" /> Sign in</Button>
          </div>
        ) : loadError ? (
          <div className="flex flex-1 items-center justify-center bg-slate-50 p-6 text-center text-xs text-slate-500">{loadError}</div>
        ) : (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
              {messages.map((m) => (
                <div key={m.id} className={`anim-slide-fade max-w-[85%] rounded-xl p-2 shadow-sm ${m.isOwn ? 'ml-auto bg-orange-50' : 'bg-white'}`}>
                  <p className="text-[10px] font-semibold text-slate-600">
                    {m.isOwn ? 'You' : m.sender.name}
                    <span className="font-normal text-slate-500"> · {m.sender.role}{m.originStoreName ? ` · ${m.originStoreName}` : ''} · {timeAgo(m.sentAt)}</span>
                  </p>
                  <p className="text-xs text-slate-700">{m.content}</p>
                </div>
              ))}
              {messages.length === 0 && <p className="p-2 text-center text-xs text-slate-500">No messages yet - say hello to the org.</p>}
              <div ref={endRef} />
            </div>
            <div className="flex gap-2 border-t border-slate-100 p-3">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Message the team..." aria-label="Chat message" />
              <Button size="icon" className="shrink-0 bg-orange-500 hover:bg-orange-600" onClick={send} disabled={sending} aria-label="Send"><Send className="h-4 w-4" /></Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Live Feed (system log ticker, green highlight 3s fade) ───────────────────
interface SysLog { id: string; severity: string; component: string; message: string; createdAt: string }

export function LiveFeed({ refreshKey, signedIn, onRequireSignIn }: {
  refreshKey: number; signedIn: boolean; onRequireSignIn: () => void;
}) {
  const [logs, setLogs] = useState<SysLog[]>([]);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const apply = (rows: SysLog[]) => {
      if (!alive) return;
      setLogs(rows);
      setError(null);
      const freshIds = rows.filter((l) => !seen.current.has(l.id)).map((l) => l.id);
      if (freshIds.length) {
        for (const id of freshIds) seen.current.add(id);
        setFlashIds(new Set(freshIds));
        setTimeout(() => setFlashIds(new Set()), 3000);
      }
    };
    const load = () => {
      authorizedFetchJson('/api/system-logs?limit=30')
        .then((res) => {
          if (res.ok && res.json?.success) {
            apply(((res.json.data as SysLog[]) ?? []).map((l) => ({
              id: l.id, severity: l.severity, component: l.component, message: l.message, createdAt: l.createdAt,
            })));
          } else if (alive) {
            setError(res.status === 401 ? 'Sign in to stream the live feed.' : res.status === 403 ? 'System logs are restricted to admin roles.' : 'System log feed unavailable.');
          }
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [refreshKey, signedIn]);

  const filtered = logs.filter((l) => filter === 'ALL' || l.severity === filter);
  const levelColor: Record<string, string> = { INFO: 'text-emerald-700', WARN: 'text-amber-700', ERROR: 'text-red-500', CRITICAL: 'text-red-500' };

  return (
    <section aria-label="Live Feed" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <RadioTower className="h-4 w-4 text-orange-500" /> Live Feed
          {signedIn && !error && <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 anim-live" /> streaming</span>}
        </h2>
        <div className="flex gap-1">
          {['ALL', 'INFO', 'WARN', 'ERROR'].map((l) => (
            <Button key={l} size="sm" variant={filter === l ? 'default' : 'outline'} className={`h-6 px-2 text-[10px] ${filter === l ? 'bg-orange-500 hover:bg-orange-600' : ''}`} onClick={() => setFilter(l)}>{l}</Button>
          ))}
        </div>
      </div>
      {!signedIn ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5">
          <p className="text-xs text-slate-500">Sign in to stream system events.</p>
          <Button size="sm" variant="outline" onClick={onRequireSignIn}><LogIn className="mr-1 h-3 w-3" /> Sign in</Button>
        </div>
      ) : error ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs text-slate-500">{error}</p>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto font-mono text-[11px]">
          {filtered.map((l) => (
            <p key={l.id} className={`rounded px-2 py-0.5 ${flashIds.has(l.id) ? 'bg-emerald-50' : ''}`}>
              <span className={`${levelColor[l.severity] ?? ''} font-bold`}>[{l.severity}]</span>{' '}
              <span className="text-slate-500">{new Date(l.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
              <span className="text-slate-700">{l.message}</span>
              <span className="text-slate-300"> · {l.component}</span>
            </p>
          ))}
          {filtered.length === 0 && <p className="p-2 text-slate-500">No events at this level.</p>}
        </div>
      )}
      <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500"><BellRing className="h-3 w-3" /> Notifications mirror critical events in each workspace.</p>
    </section>
  );
}

// ── Desk activity - the leave review ledger, org-wide (v2.64.0) ──────────────
// The v2.63.0 ledger recorded every desk visit per request; this panel turns
// it into the organization's audit view: WHO looked at WHOSE request, on
// WHICH branch, WHEN, and whether THAT visit cleared a re-check marker. The
// stat tiles answer the management questions at a glance: how much desk
// attention leave is getting this week, how many corrections were answered,
// and how many distinct reviewers are actually reading.
const DESK_STATUS_CHIP: Record<string, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400',
};

// v2.65.0: per-reviewer avatar hue — a deterministic hash of the name picks
// one of six soft duotones so two reviewers never wear the same colour and
// the same reviewer reads as the same person across visits. Light + dark.
const AVATAR_HUES = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
];
const avatarHue = (name: string): string =>
  AVATAR_HUES[[...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % AVATAR_HUES.length];

// v2.65.0: store names share the "MBUMAH HARDWARE - X" prefix — the chips
// wear the branch part only; the full name stays on the tooltip.
const shortStoreName = (name: string): string =>
  name.replace(/^MBUMAH HARDWARE\s*-\s*/i, '') || name;

export function DeskActivity({ data, filter, onFilterChange }: {
  data: DeskActivityData;
  filter: DeskActivityFilter;
  onFilterChange: (f: DeskActivityFilter) => void;
}) {
  const { stats, recent, yesterday } = data;
  const { reviewer, branch } = filter;
  const setBranch = (id: string | null) => onFilterChange({ ...filter, branch: id });
  const clearReviewer = () => onFilterChange({ ...filter, reviewer: null });
  return (
    <section aria-label="Desk activity" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <History className="h-4 w-4 text-emerald-500" /> Desk activity — leave review ledger
          <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-700 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 anim-live" /> live</span>
        </h2>
        {/* v2.69.0 — the desk files its report: the printable per-branch
            roll-up lives at /org/desk-report; this door opens it. */}
        <Link
          href="/org/desk-report"
          data-testid="desk-report-link"
          title="Open the printable desk report"
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:border-emerald-300 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-emerald-500/40 dark:hover:text-emerald-300"
        >
          <FileText className="h-3 w-3" aria-hidden /> Report
        </Link>
        <p className="text-[10px] text-slate-500 dark:text-slate-500">Every desk visit on record, newest first · syncs every 30s</p>
      </div>

      {/* v2.67.0 — the desk's morning note. Yesterday's ledger summarized in
          one strip: visits taken, corrections answered, reviewers who showed
          up, requests touched, the busiest branch and the most active
          reviewer. The note is org-wide by contract — the drill-down and
          branch chips narrow the timeline below it, never this strip — and
          the dawn gradient (amber morning → emerald answered) carries the
          metaphor in both colour modes. A quiet day says so honestly. */}
      <div
        data-testid="desk-digest"
        role="status"
        aria-label="Yesterday at the desk"
        className="mb-3 rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50/90 via-white to-emerald-50/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:border-amber-500/20 dark:from-amber-500/10 dark:via-slate-900 dark:to-emerald-500/10 dark:shadow-none"
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
          <p data-testid="desk-digest-heading" className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
            <Sunrise className="h-3.5 w-3.5 text-amber-500" /> Yesterday at the desk
            <span data-testid="desk-digest-label" className="text-[10px] font-normal tabular-nums text-slate-500 dark:text-slate-500">· {yesterday.label}</span>
          </p>
          {yesterday.visits > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {yesterday.busiestBranch && (
                <span
                  data-testid="desk-digest-busiest"
                  title={`Busiest branch yesterday: ${yesterday.busiestBranch.storeName} (${yesterday.busiestBranch.visits} visit${yesterday.busiestBranch.visits === 1 ? '' : 's'})`}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                >
                  busiest · {shortStoreName(yesterday.busiestBranch.storeName)} {yesterday.busiestBranch.visits}
                </span>
              )}
              {yesterday.topReviewer && (
                <span
                  data-testid="desk-digest-top-reviewer"
                  title={`Most active reviewer yesterday: ${yesterday.topReviewer.name} (${yesterday.topReviewer.visits} visit${yesterday.topReviewer.visits === 1 ? '' : 's'})`}
                  className={`inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-[10px] font-medium ${avatarHue(yesterday.topReviewer.name)}`}
                >
                  top reviewer · {yesterday.topReviewer.name} {yesterday.topReviewer.visits}
                </span>
              )}
            </div>
          ) : null}
        </div>
        {yesterday.visits > 0 ? (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            <div data-testid="desk-digest-visits">
              <p className="text-lg font-bold leading-none tabular-nums text-slate-800 dark:text-slate-100">{num(yesterday.visits)}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">visit{yesterday.visits === 1 ? '' : 's'}</p>
            </div>
            <div data-testid="desk-digest-clears">
              <p className="text-lg font-bold leading-none tabular-nums text-emerald-700 dark:text-emerald-400">{num(yesterday.clears)}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">correction{yesterday.clears === 1 ? '' : 's'} answered</p>
            </div>
            <div data-testid="desk-digest-reviewers">
              <p className="text-lg font-bold leading-none tabular-nums text-slate-800 dark:text-slate-100">{num(yesterday.reviewers)}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">reviewer{yesterday.reviewers === 1 ? '' : 's'} on the desk</p>
            </div>
            <div data-testid="desk-digest-requests">
              <p className="text-lg font-bold leading-none tabular-nums text-slate-800 dark:text-slate-100">{num(yesterday.requests)}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">request{yesterday.requests === 1 ? '' : 's'} touched</p>
            </div>
            {yesterday.branches.length > 1 ? (
              <div data-testid="desk-digest-branches" className="ml-auto flex flex-wrap items-center gap-1">
                {yesterday.branches.slice(0, 3).map((b) => (
                  <span key={b.storeId} className="rounded-full border border-slate-200 bg-white/70 px-2 py-0.5 text-[10px] tabular-nums text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    {shortStoreName(b.storeName)} {b.visits}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p data-testid="desk-digest-empty" className="flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300/60 bg-amber-50/40 px-3 py-2 text-[11px] text-slate-500 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-slate-400">
            <Coffee className="h-3.5 w-3.5 text-amber-500" /> The desk was quiet yesterday — no visits on record. The note fills as reviewers open leave requests.
          </p>
        )}
      </div>

      {/* Stat tiles — org-wide figures, never re-keyed by the filters */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ['Visits · 7 days', stats.weekVisits],
          ['Cleared re-checks', stats.weekClears],
          ['Reviewers active', stats.weekReviewers],
          ['On record', stats.total],
        ] as Array<[string, number]>).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">{label}</p>
            <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{num(value)}</p>
          </div>
        ))}
      </div>

      {/* v2.65.0 drill-down bar — who the desk is looking at right now */}
      {reviewer ? (
        <div data-testid="desk-drilldown-bar" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white dark:bg-emerald-500" aria-hidden="true">
            {reviewer.trim().charAt(0).toUpperCase()}
          </span>
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
            Reviewing {reviewer}&apos;s desk visits
          </p>
          {data.reviewerStats ? (
            <span data-testid="desk-drilldown-stats" className="text-[10px] tabular-nums text-emerald-700/80 dark:text-emerald-300/80">
              {num(data.reviewerStats.visits)} on record · {num(data.reviewerStats.clears)} cleared a re-check{data.reviewerStats.lastVisitAt ? ` · last ${timeAgo(data.reviewerStats.lastVisitAt)}` : ''}
            </span>
          ) : null}
          {/* v2.80.0 — the desk flows into the report: the narrowed reviewer
              rides the link as a deep link (?reviewer=…), and the report
              opens that reviewer's drawer on arrival. v2.81.0 — the door
              hands its BRANCH FILTER over too (?branch=… rides behind the
              name), so the report arrives in the scope the desk narrowed
              to. The chip wears the panel's emerald family — a door,
              dressed like one. */}
          <Link
            href={deskReportDrawerHref('reviewer', reviewer, { branch: branch ?? null })}
            data-testid="desk-drilldown-report-link"
            title={`Open ${reviewer}'s file in the desk report`}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-emerald-500/30 dark:bg-slate-900/60 dark:text-emerald-300 dark:hover:border-emerald-400 dark:hover:bg-emerald-500/15"
          >
            <FileText className="h-3 w-3" aria-hidden /> Their file in the report
          </Link>
          <button
            type="button"
            onClick={clearReviewer}
            aria-label="Back to all reviewers"
            data-testid="desk-drilldown-clear"
            className="rounded-full p-1 text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* v2.65.0 branch chips — org-wide counts, stable while the timeline narrows */}
      {data.branches.length > 0 ? (
        <div role="group" aria-label="Filter desk activity by branch" className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="desk-branch-chips">
          <button
            type="button"
            aria-pressed={!branch}
            onClick={() => setBranch(null)}
            data-testid="desk-branch-chip-all"
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${!branch
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >
            All branches
          </button>
          {data.branches.map((b) => {
            const active = branch === b.storeId;
            return (
              <button
                key={b.storeId}
                type="button"
                aria-pressed={active}
                title={b.storeName}
                onClick={() => setBranch(active ? null : b.storeId)}
                data-testid={`desk-branch-chip-${b.storeId}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${active
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                {shortStoreName(b.storeName)}
                <span className="tabular-nums opacity-70">{num(b.visits)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {recent.length === 0 ? (
        <p data-testid="desk-empty-state" className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          {reviewer
            ? `No desk visits recorded for ${reviewer}${branch ? ' on this branch' : ''} yet.`
            : branch
              ? 'No desk visits recorded for this branch yet — the ledger fills as approvers open leave requests.'
              : 'No desk visits recorded yet — the ledger fills as approvers open leave requests.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {recent.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onFilterChange({ ...filter, reviewer: v.visitedByName })}
                aria-label={`Review ${v.visitedByName}'s desk visits`}
                data-testid="desk-visit-row"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:hover:bg-slate-800/40"
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarHue(v.visitedByName)}`} aria-hidden="true">
                  {v.visitedByName.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-slate-700 dark:text-slate-200">
                    <span className="font-semibold">{v.visitedByName}</span>
                    {' '}opened {v.employeeName}&apos;s {v.leaveTypeName} request
                  </span>
                  <span className="block text-[10px] text-slate-500 dark:text-slate-500">
                    {v.storeName ? `${v.storeName} · ` : ''}{timeAgo(v.visitedAt)} ago
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {v.clearedRecheck && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <BadgeCheck className="h-2.5 w-2.5" aria-hidden /> cleared a re-check
                    </span>
                  )}
                  <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${DESK_STATUS_CHIP[v.requestStatus] ?? 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400'}`}>
                    {v.requestStatus.toLowerCase()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-500">
        Ledger keeps every visit since v2.63.0 — {num(stats.total)} on record. Click a row to review that person&apos;s desk visits; click a branch to narrow the trail.
      </p>
    </section>
  );
}
