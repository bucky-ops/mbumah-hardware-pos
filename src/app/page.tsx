"use client";

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE — Organization Console (Expert Information System v3.0)
// v2.18.2 · dark navy chrome + white Inter cards · single shared DB, 5 branch
// workspaces · KPI command row, Branch Intelligence Matrix, 9 Domain Expert
// Modules, Decision Support, Recent Activity Timeline, Global Chat, Live Feed.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { LayoutDashboard, Landmark, Menu, PackageSearch, PieChart, Radio, ScrollText, Users, Wallet } from "lucide-react";
import { ActivityTimeline, ChatDrawer, DecisionSupport, LiveFeed } from "@/components/org/panels";
import { BranchMatrix } from "@/components/org/branch-matrix";
import { ExpertModules } from "@/components/org/experts";
import { KpiRow } from "@/components/org/kpi-row";
import { ChangelogModal, CommandPalette, ConsoleFooter, ConsoleHeader, LoginDialog, ShortcutsModal, type SessionUser } from "@/components/org/chrome";
import { SectionErrorBoundary } from "@/components/org/error-boundary";
import { KenyaMap, kes, timeAgo, type DashboardData } from "@/components/org/primitives";

const SECTIONS = [
  { id: "kpi-row", label: "Overview", icon: LayoutDashboard },
  { id: "branch-matrix", label: "Matrix", icon: PieChart },
  { id: "experts", label: "Experts", icon: PackageSearch },
  { id: "decision", label: "Decision", icon: Wallet },
  { id: "timeline", label: "Activity", icon: ScrollText },
  { id: "live-feed", label: "Live Feed", icon: Radio },
];

export default function OrgConsolePage() {
  const { toast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState("—");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // UI state
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [railPinned, setRailPinned] = useState(false);
  const [railPeek, setRailPeek] = useState(false);

  const onToast = useCallback((msg: string) => toast({ description: msg }), [toast]);

  // ── Data fetch + 30s poll ────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) {
        setData(j);
        setError(null);
        setLastSync(new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      } else {
        setError(j.error ?? "Failed to load");
      }
      setOnline(true);
    } catch {
      setOnline(false);
      setError("Console offline — showing last known data");
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [load]);

  // ── Session probe (anonymous OK) ─────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.user) setSession({ name: j.user.name, role: j.user.role, email: j.user.email }); })
      .catch(() => undefined);
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      const map: Record<string, () => void> = {
        F2: () => document.getElementById("experts")?.scrollIntoView({ behavior: "smooth" }),
        F3: () => { document.getElementById("experts")?.scrollIntoView({ behavior: "smooth" }); onToast("Inventory expert focused"); },
        F4: () => { window.location.href = "/api/reports/export?kind=branch_intelligence"; },
        F5: () => { setRefreshKey((k) => k + 1); onToast("Live feed refreshed"); },
      };
      if (map[e.key]) { e.preventDefault(); map[e.key](); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToast]);

  // ── Autohide rail: collapse after 2s idle, peek on left-edge hover ───────
  useEffect(() => {
    if (railPinned) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { setRailPeek(false); t = setTimeout(() => setRailPeek(false), 2000); };
    const reset = () => { clearTimeout(t); };
    const onMove = (e: MouseEvent) => {
      if (e.clientX <= 20) setRailPeek(true);
      else if (e.clientX > 280) { reset(); arm(); }
    };
    arm();
    window.addEventListener("mousemove", onMove);
    return () => { window.removeEventListener("mousemove", onMove); clearTimeout(t); };
  }, [railPinned]);
  const railExpanded = railPinned || railPeek;

  if (error && !data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
        <img src="/logo.svg" alt="Mbumah Hardware" className="h-24 w-24 rounded-2xl shadow" />
        <h1 className="text-lg font-bold text-slate-800">Mbumah Hardware — Organization Console</h1>
        <p className="text-sm text-red-500">{error}</p>
        <Button onClick={load} className="bg-orange-500 hover:bg-orange-600">Retry</Button>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.svg" alt="Mbumah Hardware" className="h-16 w-16 rounded-xl shadow anim-pulse-dot" />
          <p className="text-sm text-slate-500">Loading Organization Console…</p>
        </div>
      </main>
    );
  }

  const k = data.kpis;

  return (
    <div className="mbumah-console flex min-h-screen flex-col bg-slate-100">
      <ConsoleHeader
        data={data} online={online} session={session} onToast={onToast}
        onOpenPalette={() => setPaletteOpen(true)} onOpenChat={() => setChatOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)} onOpenLogin={() => setLoginOpen(true)}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 py-4 lg:px-5">
        {/* Autohide nav rail */}
        <nav
          aria-label="Console sections"
          className={`no-print sticky top-20 hidden h-fit flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-all duration-300 md:flex ${railExpanded ? "w-[210px]" : "w-16 items-center"}`}
        >
          <button onClick={() => setRailPinned((p) => !p)} className="focus-ring mb-1 flex h-8 w-full items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50" aria-label={railPinned ? "Unpin navigation" : "Pin navigation"}>
            <Menu className="h-4 w-4" />
          </button>
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" })}
              className="focus-ring flex items-center gap-2 rounded-lg px-2 py-2 text-[12px] font-medium text-slate-600 hover:bg-orange-50 hover:text-orange-600" title={s.label}>
              <s.icon className="h-4 w-4 shrink-0" />
              {railExpanded && <span>{s.label}</span>}
            </button>
          ))}
          {railExpanded && (
            <div className="mt-2 border-t border-slate-100 px-2 pt-2">
              <Users className="mb-1 h-3 w-3 text-slate-300" />
              <p className="text-[10px] leading-snug text-slate-400">SUPER_ADMIN view · shared DB · branch isolation via storeId</p>
            </div>
          )}
        </nav>

        {/* Main column */}
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Branch strip */}
          <section aria-label="Branches" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {data.branches.map((b, i) => (
              <button key={b.id} onClick={() => window.open(`/stores/${b.code}/dashboard`, "_blank")}
                className="focus-ring anim-slide-fade rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                style={{ animationDelay: `${i * 100}ms` }}>
                <div className="flex items-center justify-between">
                  <span className="flex h-7 w-11 items-center justify-center rounded-md text-[10px] font-bold text-white transition-transform hover:scale-105" style={{ background: b.brandColor ?? "#12243D" }}>
                    {b.code.slice(0, 3).toUpperCase()}
                  </span>
                  <Badge variant="outline" className={`text-[9px] ${b.health >= 90 ? "border-emerald-200 text-emerald-600" : "border-amber-200 text-amber-600"}`}>{b.health}</Badge>
                </div>
                <p className="mt-1.5 truncate text-[12px] font-semibold text-slate-800">{b.name}</p>
                <p className="text-[10px] text-slate-400">{kes(b.revenue)} · {b.shiftStatus}</p>
              </button>
            ))}
          </section>

          <div id="kpi-row"><SectionErrorBoundary section="KPI Command Row"><KpiRow data={data} /></SectionErrorBoundary></div>

          <SectionErrorBoundary section="Overview">
          <section aria-label="Overview" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">Health — {data.health.label}</h2>
              <p className="mb-2 text-[11px] text-slate-400">Composite: revenue attainment − debt/engagement penalties</p>
              <KenyaMap branches={data.branches} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">Today at a glance</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  ["Revenue", kes(k.revenue.value), `variance ${k.revenue.variancePct >= 0 ? "+" : ""}${k.revenue.variancePct}% · 7d ${kes(k.revenue.weekTotal)}`],
                  ["Debt exposure", kes(k.debt.total), `90+ bucket ${kes(k.debt.aging.d90plus)}`],
                  ["eTIMS pending", String(data.experts.etims.pending), `${data.experts.etims.compliant} compliant`],
                  ["M-Pesa", `${data.experts.mpesa.today.matched} matched`, `${data.experts.mpesa.today.mismatch} mismatch · ${data.experts.mpesa.today.pending} pending`],
                  ["Rentals", `${data.experts.rentals.active} active`, `${data.experts.rentals.overdue} overdue · util ${data.experts.rentals.utilizationPct}%`],
                  ["Release", data.release.label, `${data.release.commits} commits · ${data.release.commitShort}`],
                ].map(([label, value, sub]) => (
                  <div key={label} className="rounded-xl border border-slate-100 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="text-sm font-bold text-slate-800">{value}</p>
                    <p className="text-[10px] text-slate-400">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
          </SectionErrorBoundary>

          <div id="branch-matrix"><SectionErrorBoundary section="Branch Intelligence Matrix"><BranchMatrix data={data} onToast={onToast} /></SectionErrorBoundary></div>
          <div id="experts"><SectionErrorBoundary section="Domain Expert Modules"><ExpertModules data={data} onToast={onToast} /></SectionErrorBoundary></div>
          <div id="decision"><SectionErrorBoundary section="Decision Support"><DecisionSupport data={data} onToast={onToast} /></SectionErrorBoundary></div>
          <div id="timeline"><SectionErrorBoundary section="Recent Activity Timeline"><ActivityTimeline items={data.activity} /></SectionErrorBoundary></div>
          <div id="live-feed"><SectionErrorBoundary section="Live Feed"><LiveFeed refreshKey={refreshKey} /></SectionErrorBoundary></div>
        </main>
      </div>

      <ConsoleFooter data={data} online={online} lastSync={lastSync} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenChangelog={() => setChangelogOpen(true)} />

      {/* Overlays */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} data={data}
        actions={[
          { id: "overview", label: "Go to overview", run: () => document.getElementById("kpi-row")?.scrollIntoView({ behavior: "smooth" }) },
          { id: "experts", label: "Go to expert modules", run: () => document.getElementById("experts")?.scrollIntoView({ behavior: "smooth" }) },
          { id: "chat", label: "Open global chat", hint: "3 unread", run: () => setChatOpen(true) },
          { id: "shortcuts", label: "Show keyboard shortcuts", run: () => setShortcutsOpen(true) },
          { id: "changelog", label: "Show changelog", run: () => setChangelogOpen(true) },
          { id: "login", label: "Sign in as administrator", run: () => setLoginOpen(true) },
          { id: "refresh", label: "Refresh console data", run: () => { load(); setRefreshKey((k) => k + 1); onToast("Console data refreshed"); } },
        ]} />
      <ChatDrawer open={chatOpen} onOpenChange={setChatOpen} unread={data.chatUnread} />
      <ShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ChangelogModal open={changelogOpen} onOpenChange={setChangelogOpen} data={data} />
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onToast={onToast}
        onSignedIn={(u) => { setSession(u); load(); }} />

      {/* Screen-reader summary */}
      <span className="sr-only" aria-live="polite">
        Mbumah Organization Console loaded. Health {data.health.score} of 100. Revenue today {kes(k.revenue.value)}. Debt {kes(k.debt.total)}. Last sync {lastSync === "—" ? "pending" : timeAgo(new Date(Date.now()).toISOString())}.
      </span>
    </div>
  );
}
