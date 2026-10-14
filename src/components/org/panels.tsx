"use client";

// Console panels — Decision Support Action Center, Recent Activity Timeline
// (pop-in + detail modal + filters), Live Feed, Global Chat drawer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Activity, AlertOctagon, BellRing, MessagesSquare, RadioTower, Send, ShieldQuestion } from "lucide-react";
import { timeAgo, type ActivityItem, type DashboardData } from "./primitives";

const SEV: Record<string, string> = {
  critical: "border-red-200 bg-red-50",
  warning: "border-amber-200 bg-amber-50",
  info: "border-blue-200 bg-blue-50",
};
const SEV_TEXT: Record<string, string> = { critical: "text-red-600", warning: "text-amber-600", info: "text-blue-600" };

// ── Decision Support — Action Center + alerts ────────────────────────────────
export function DecisionSupport({ data, onToast }: { data: DashboardData; onToast: (m: string) => void }) {
  const [stepUp, setStepUp] = useState<{ action: string } | null>(null);
  const [email, setEmail] = useState("admin@mbumahhardware.co.ke");
  const [password, setPassword] = useState("");
  const q = data.actionQueue;
  return (
    <section aria-label="Decision Support" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <AlertOctagon className="h-4 w-4 text-red-500" /> Decision Support — Action Center
        </h2>
        <div className="space-y-2">
          {data.alerts.map((a) => (
            <div key={a.type} className={`anim-slide-fade rounded-xl border p-3 ${SEV[a.severity] ?? "border-slate-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={`text-[13px] font-semibold ${SEV_TEXT[a.severity] ?? "text-slate-700"}`}>{a.title}</p>
                  <p className="text-xs text-slate-500">{a.detail}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {a.actions.map((act) => (
                    <Button key={act} size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                      onClick={() => (act.includes("Authorize") || act.includes("Suspend") ? setStepUp({ action: `${act} — ${a.title}` }) : onToast(`${act}: ${a.title}`))}>
                      {act}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {data.alerts.length === 0 && <p className="text-xs text-slate-400">No active alerts — all clear.</p>}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><Activity className="h-4 w-4 text-orange-500" /> Action queue</h2>
        <ul className="space-y-2 text-xs">
          <QueueRow label="Pending expense approvals" value={q.pendingExpenses} action="Authorize" onAuthorize={() => setStepUp({ action: "Expense approval" })} onToast={onToast} />
          <QueueRow label="Purchase orders awaiting release" value={q.pendingPOs} action="Authorize" onAuthorize={() => setStepUp({ action: "PO release" })} onToast={onToast} />
          <QueueRow label="Open shifts" value={q.openShifts} action="View" onToast={onToast} />
          <QueueRow label="Manager step-ups (24h)" value={q.managerAuthorizations} action="View" onToast={onToast} />
        </ul>
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-400">
          <ShieldQuestion className="mr-1 inline h-3 w-3" /> Destructive actions require manager step-up — every authorization is audit-logged.
        </p>
      </div>

      <Dialog open={stepUp !== null} onOpenChange={(o) => !o && setStepUp(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Manager step-up</DialogTitle></DialogHeader>
          {stepUp && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">{stepUp.action} — confirm with manager credentials.</p>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@email" aria-label="Manager email" />
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Manager password" aria-label="Manager password" />
              <Button className="w-full bg-orange-500 hover:bg-orange-600" onClick={() => { setStepUp(null); setPassword(""); onToast("Manager step-up verified (demo) — action authorized + audit-logged"); }}>
                <ShieldQuestion className="mr-1 h-4 w-4" /> Authorize
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function QueueRow({ label, value, action, onAuthorize, onToast }: {
  label: string; value: number; action: string; onAuthorize?: () => void; onToast: (m: string) => void;
}) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2">
        <Badge variant="outline" className={value > 0 ? "border-orange-200 text-orange-600" : "text-slate-400"}>{value}</Badge>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => (onAuthorize ? onAuthorize() : onToast(`${label} — detail view (demo)`))}>{action}</Button>
      </span>
    </li>
  );
}

// ── Recent Activity Timeline (live, filterable, detail modal) ────────────────
export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  const [fAction, setFAction] = useState("all");
  const [fRole, setFRole] = useState("all");
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
  }, [items]);

  const actions = useMemo(() => [...new Set(items.map((i) => i.action))], [items]);
  const roles = useMemo(() => [...new Set(items.map((i) => i.role))], [items]);
  const filtered = items.filter((i) => (fAction === "all" || i.action === fAction) && (fRole === "all" || i.role === fRole));

  return (
    <section aria-label="Recent Activity Timeline" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Activity className="h-4 w-4 text-emerald-500" /> Recent Activity Timeline
          <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 anim-live" /> live</span>
        </h2>
        <div className="flex gap-2">
          <Select value={fAction} onValueChange={setFAction}>
            <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>{["all", ...actions].map((a) => <SelectItem key={a} value={a} className="text-xs">{a === "all" ? "All actions" : a}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={fRole} onValueChange={setFRole}>
            <SelectTrigger className="h-7 w-32 text-[11px]"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>{["all", ...roles].map((r) => <SelectItem key={r} value={r} className="text-xs">{r === "all" ? "All roles" : r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <ol className="relative space-y-2 pl-4 before:absolute before:left-1 before:top-1 before:h-[calc(100%-8px)] before:w-0.5 before:rounded before:bg-slate-100">
        {filtered.slice(0, 8).map((a) => (
          <li key={a.id}>
            <button onClick={() => setDetail(a)} className={`focus-ring w-full rounded-lg border border-slate-100 p-2 text-left transition hover:border-orange-200 hover:bg-orange-50/40 ${flashIds.has(a.id) ? "new-row-flash bg-emerald-50/60" : ""}`}>
              <span className="absolute -left-[3px] mt-1.5 h-2 w-2 rounded-full bg-orange-400 anim-pop-in" style={{ position: "relative", left: -14, top: 12 }} aria-hidden />
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="text-xs font-medium text-slate-700">
                  {a.action === "CREATE" && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle anim-pop-in" />}
                  {a.displayMessage}
                </p>
                <span className="text-[10px] text-slate-400">{timeAgo(a.createdAt)}</span>
              </div>
              <p className="text-[10px] text-slate-400">{a.userName} · {a.role}</p>
            </button>
          </li>
        ))}
      </ol>

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Activity detail</DialogTitle></DialogHeader>
          {detail && (
            <dl className="space-y-1.5 text-xs">
              <Row k="Timestamp" v={new Date(detail.createdAt).toLocaleString("en-KE")} />
              <Row k="User" v={detail.userName} />
              <Row k="Role" v={detail.role} />
              <Row k="Action" v={detail.action} />
              <Row k="Resource" v={detail.entity} />
              <Row k="Result" v="Success" />
              <Row k="Branch" v="org" />
              <Row k="IP" v="10.0.x.x" />
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-b border-slate-50 pb-1"><dt className="text-slate-400">{k}</dt><dd className="font-medium text-slate-700">{v}</dd></div>;
}

// ── Global Chat drawer ───────────────────────────────────────────────────────
interface ChatMsg { id: string; branchId: string | null; userName: string; userRole: string | null; content: string; createdAt: string; }
export function ChatDrawer({ open, onOpenChange, unread }: { open: boolean; onOpenChange: (o: boolean) => void; unread: number }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState("org");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(scope === "org" ? "/api/chat" : `/api/chat?branchId=${scope}`);
      const j = await res.json();
      if (j.ok) setMessages(j.messages);
    } catch { /* offline */ }
  }, [scope]);

  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [open, load]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.trim(), branchId: scope === "org" ? null : scope }),
      });
      setDraft("");
      load();
    } catch { /* offline */ } finally { setSending(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-100 bg-[#0f172a] p-4 text-white">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <MessagesSquare className="h-4 w-4 text-orange-400" /> Global Chat
            {unread > 0 && <Badge className="bg-red-500 text-[10px] hover:bg-red-500 anim-pulse-dot">{unread} unread</Badge>}
          </SheetTitle>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="mt-2 h-7 border-white/20 bg-white/10 text-[11px] text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="org" className="text-xs">Org-wide</SelectItem>
              <SelectItem value="juja-main" className="text-xs">Juja Main</SelectItem>
              <SelectItem value="thika" className="text-xs">Thika</SelectItem>
              <SelectItem value="ruiru" className="text-xs">Ruiru</SelectItem>
              <SelectItem value="nairobi-cbd" className="text-xs">Nairobi CBD</SelectItem>
              <SelectItem value="nakuru" className="text-xs">Nakuru</SelectItem>
            </SelectContent>
          </Select>
        </SheetHeader>
        <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
          {messages.map((m) => (
            <div key={m.id} className="anim-slide-fade max-w-[85%] rounded-xl bg-white p-2 shadow-sm">
              <p className="text-[10px] font-semibold text-slate-600">{m.userName} <span className="font-normal text-slate-400">· {m.userRole} · {timeAgo(m.createdAt)}</span></p>
              <p className="text-xs text-slate-700">{m.content}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 border-t border-slate-100 p-3">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message the team…" aria-label="Chat message" />
          <Button size="icon" className="shrink-0 bg-orange-500 hover:bg-orange-600" onClick={send} disabled={sending} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Live Feed (system log ticker, green highlight 3s fade) ───────────────────
interface SysLog { id: string; level: string; component: string; message: string; createdAt: string; }
export function LiveFeed({ refreshKey }: { refreshKey: number }) {
  const [logs, setLogs] = useState<SysLog[]>([]);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("ALL");
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const apply = (rows: SysLog[]) => {
      setLogs(rows);
      const freshIds = rows.filter((l) => !seen.current.has(l.id)).map((l) => l.id);
      if (freshIds.length) {
        for (const id of freshIds) seen.current.add(id);
        setFlashIds(new Set(freshIds));
        setTimeout(() => setFlashIds(new Set()), 3000);
      }
    };
    fetch("/api/system-logs")
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) apply(j.logs); })
      .catch(() => undefined);
    const t = setInterval(() => {
      fetch("/api/system-logs").then((r) => r.json()).then((j) => { if (alive && j.ok) apply(j.logs); }).catch(() => undefined);
    }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [refreshKey]);

  const filtered = logs.filter((l) => filter === "ALL" || l.level === filter);
  const levelColor: Record<string, string> = { INFO: "text-emerald-600", WARN: "text-amber-600", ERROR: "text-red-500" };

  return (
    <section aria-label="Live Feed" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <RadioTower className="h-4 w-4 text-orange-500" /> Live Feed
          <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 anim-live" /> streaming</span>
        </h2>
        <div className="flex gap-1">
          {["ALL", "INFO", "WARN", "ERROR"].map((l) => (
            <Button key={l} size="sm" variant={filter === l ? "default" : "outline"} className={`h-6 px-2 text-[10px] ${filter === l ? "bg-orange-500 hover:bg-orange-600" : ""}`} onClick={() => setFilter(l)}>{l}</Button>
          ))}
        </div>
      </div>
      <div className="max-h-44 space-y-1 overflow-y-auto font-mono text-[11px]">
        {filtered.map((l) => (
          <p key={l.id} className={`rounded px-2 py-0.5 ${flashIds.has(l.id) ? "bg-emerald-50" : ""}`}>
            <span className={`${levelColor[l.level] ?? ""} font-bold`}>[{l.level}]</span>{" "}
            <span className="text-slate-400">{new Date(l.createdAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>{" "}
            <span className="text-slate-700">{l.message}</span>
            <span className="text-slate-300"> · {l.component}</span>
          </p>
        ))}
        {filtered.length === 0 && <p className="p-2 text-slate-400">No events at this level.</p>}
      </div>
      <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400"><BellRing className="h-3 w-3" /> Notifications mirror critical events — {""}
        <a className="underline" href="/api/notifications" target="_blank" rel="noreferrer">API</a>
      </p>
    </section>
  );
}
