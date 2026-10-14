"use client";

// Console chrome — dark header (logo 48px white tile, version + Connected
// pulse, health gauge, branch selector, command palette, notifications, chat,
// cart, user chip, date, shortcuts, online/offline/queue) + footer + modals.

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CloudOff, History, Keyboard, LogIn, Package, RefreshCcw, ScrollText, ShoppingCart, Terminal } from "lucide-react";
import { HealthGauge, kes, type BranchRow, type DashboardData } from "./primitives";

export interface SessionUser { name: string; role: string; email: string }

// ── Header ───────────────────────────────────────────────────────────────────
export function ConsoleHeader({ data, online, onOpenPalette, onOpenChat, onOpenShortcuts, onOpenLogin, session, onToast }: {
  data: DashboardData; online: boolean; onOpenPalette: () => void; onOpenChat: () => void;
  onOpenShortcuts: () => void; onOpenLogin: () => void; session: SessionUser | null; onToast: (m: string) => void;
}) {
  const [date, setDate] = useState<string>("");
  const [cart, setCart] = useState(7);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setDate(new Date().toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
      const stored = Number(localStorage.getItem("mbt_cart_count"));
      setCart(Number.isFinite(stored) && stored > 0 ? stored : 7);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0f172a]/95 text-white backdrop-blur-xl" style={{ paddingTop: "var(--safe-area-inset-top)" }}>
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 lg:px-5">
        <img src="/logo.webp" alt="Mbumah Hardware logo" width={48} height={48} className="h-12 w-12 rounded-xl bg-white p-1 shadow" />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold tracking-wide">MBUMAH HARDWARE</p>
          <p className="truncate text-[9px] font-medium uppercase tracking-[0.14em] text-orange-400">{data.org.tagline}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="border-white/20 text-[10px] text-slate-200">{data.release.label}</Badge>
          <span className="hidden items-center gap-1 text-[10px] text-emerald-400 sm:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400 anim-live" : "bg-slate-500"}`} />
            {online ? "Connected" : "Offline"}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-2 rounded-xl bg-white/5 px-2 py-1 md:flex" title={`Health ${data.health.score}/100 — ${data.health.label}`}>
            <HealthGauge score={data.health.score} size={44} />
            <div className="leading-tight">
              <p className="text-[10px] text-slate-400">Health</p>
              <p className="text-xs font-bold text-emerald-400">{data.health.score}/100 {data.health.label}</p>
            </div>
          </div>

          {/* Branch selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 border border-white/15 text-[11px] text-slate-200 hover:bg-white/10">
                Branches · {data.branches.length} <span className="ml-1 text-orange-400">▾</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Switch branch workspace</DropdownMenuLabel>
              {data.branches.map((b) => (
                <DropdownMenuItem key={b.id} onClick={() => { window.location.href = `/stores/${b.code}/dashboard`; }}>
                  <span className="mr-2 h-2 w-2 rounded-full" style={{ background: b.brandColor ?? "#12243D" }} />
                  <span className="flex-1">{b.name}</span>
                  <span className="text-[10px] text-slate-400">{b.code}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { window.location.href = "/"; }}><span className="text-orange-500">★</span> Organization console (all branches)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button onClick={onOpenPalette} className="focus-ring hidden items-center gap-1.5 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10 md:flex" aria-label="Open command palette">
            <Terminal className="h-3 w-3" /> cmd+K
          </button>

          <IconPulse label={`${data.notifications} notifications`} onClick={() => onToast("Notifications panel — 4 unread (demo)")} count={data.notifications} dot="bg-red-500">
            <History className="h-4 w-4" />
          </IconPulse>

          <IconPulse label={`${data.chatUnread} unread messages`} onClick={onOpenChat} count={data.chatUnread} dot="bg-red-500">
            <ChatIcon />
          </IconPulse>

          <IconPulse label={`Cart · ${cart} items`} onClick={() => onToast(`Cart — ${cart} items ready for checkout`)} count={cart} dot="bg-orange-500">
            <ShoppingCart className="h-4 w-4" />
          </IconPulse>

          {/* User chip */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="focus-ring flex items-center gap-2 rounded-full border border-white/15 py-1 pl-1 pr-2 hover:bg-white/10" aria-label="User menu">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold">
                  {session ? session.name.slice(0, 1).toUpperCase() : "S"}
                </span>
                <span className="hidden text-[11px] font-semibold sm:block">{session ? session.role : "SUPER_ADMIN"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{session ? session.name : "Demo view (not signed in)"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {session ? (
                <DropdownMenuItem className="text-xs">{session.email}</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onOpenLogin} className="text-xs"><LogIn className="mr-2 h-3 w-3" /> Sign in as admin…</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="hidden text-[10px] text-slate-400 lg:block">{date}</span>
          <Button size="sm" variant="ghost" className="h-7 border border-white/15 text-[10px] text-slate-300 hover:bg-white/10" onClick={onOpenShortcuts}>
            <Keyboard className="mr-1 h-3 w-3" /> Shortcuts
          </Button>
          {!online ? (
            <Badge className="bg-amber-500/90 text-[10px] text-white hover:bg-amber-500/90"><CloudOff className="mr-1 h-3 w-3" /> Offline · Queue</Badge>
          ) : (
            <button onClick={() => onToast("Queue empty — everything synced")} className="hidden items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 xl:flex" aria-label="Sync queue">
              <RefreshCcw className="h-3 w-3" /> Queue 0
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function IconPulse({ children, label, count, dot, onClick }: { children: React.ReactNode; label: string; count: number; dot: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="focus-ring relative rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white">
      {children}
      {count > 0 && (
        <>
          <span className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full ${dot} anim-pulse-dot`} />
          <span className={`absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full ${dot} px-0.5 text-[8px] font-bold text-white`}>{count}</span>
        </>
      )}
    </button>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────
export function ConsoleFooter({ data, online, onOpenShortcuts, onOpenChangelog, lastSync }: {
  data: DashboardData; online: boolean; onOpenShortcuts: () => void; onOpenChangelog: () => void; lastSync: string;
}) {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-[11px] text-slate-500 lg:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-slate-700">{data.release.label}</span>
          <span className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500 anim-live" : "bg-amber-500"}`} />
            {online ? "Connected" : "Offline"}
          </span>
          <button onClick={onOpenShortcuts} className="hover:text-orange-500">Shortcuts</button>
          <button onClick={onOpenChangelog} className="hover:text-orange-500">Changelog</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span>Health <strong className={data.health.score >= 80 ? "text-emerald-600" : "text-amber-600"}>{data.health.score}/100</strong></span>
          <span>Branches <strong className="text-slate-700">{data.branches.length}</strong></span>
          <span>Last sync <strong className="text-slate-700">{lastSync}</strong></span>
          <span>Env <strong className="text-slate-700">{data.release.env}</strong></span>
          <span className="hidden text-slate-300 md:inline">{data.release.commits} commits · {data.release.releases} releases · {data.release.tags} tags · {data.release.commitShort}</span>
        </div>
      </div>
    </footer>
  );
}

// ── Command palette (cmd+K) ──────────────────────────────────────────────────
export function CommandPalette({ open, onOpenChange, data, actions }: {
  open: boolean; onOpenChange: (o: boolean) => void; data: DashboardData;
  actions: { id: string; label: string; hint?: string; run: () => void }[];
}) {
  const branchActions = useMemo(
    () => data.branches.map((b) => ({ id: `ws-${b.code}`, label: `Open ${b.name} workspace`, hint: b.code, run: () => { window.location.href = `/stores/${b.code}/dashboard`; } })),
    [data.branches]
  );
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search actions, branches, exports…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          {actions.map((a) => (
            <CommandItem key={a.id} onSelect={() => { onOpenChange(false); a.run(); }}>
              <Terminal className="mr-2 h-3.5 w-3.5 text-orange-500" /> {a.label} {a.hint && <span className="ml-auto text-[10px] text-slate-400">{a.hint}</span>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Branch workspaces">
          {branchActions.map((a) => (
            <CommandItem key={a.id} onSelect={() => { onOpenChange(false); a.run(); }}>
              <Package className="mr-2 h-3.5 w-3.5 text-slate-400" /> {a.label} <span className="ml-auto text-[10px] text-slate-400">{a.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Exports">
          <CommandItem onSelect={() => { onOpenChange(false); window.location.href = "/api/reports/export?kind=branch_intelligence"; }}>
            <ScrollText className="mr-2 h-3.5 w-3.5 text-slate-400" /> Export branch_intelligence.csv
          </CommandItem>
          <CommandItem onSelect={() => { onOpenChange(false); window.location.href = "/api/reports/export?kind=sales"; }}>
            <ScrollText className="mr-2 h-3.5 w-3.5 text-slate-400" /> Export sales CSV
          </CommandItem>
          <CommandItem onSelect={() => { onOpenChange(false); window.location.href = "/api/reports/export?kind=debt"; }}>
            <ScrollText className="mr-2 h-3.5 w-3.5 text-slate-400" /> Export debt CSV
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// ── Shortcuts modal ──────────────────────────────────────────────────────────
export function ShortcutsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const rows: Array<[string, string]> = [
    ["cmd + K", "Command palette"],
    ["F2", "POS · point of sale"],
    ["F3", "Inventory expert"],
    ["F4", "Reports & exports"],
    ["F5", "Force live feed refresh"],
    ["F11", "Fullscreen (autohide rail)"],
    ["Esc", "Close dialogs"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Keyboard className="h-4 w-4 text-orange-500" /> Keyboard shortcuts</DialogTitle></DialogHeader>
        <ul className="space-y-1.5 text-xs">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between border-b border-slate-50 pb-1">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">{k}</kbd>
              <span className="text-slate-600">{v}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// ── Changelog modal ──────────────────────────────────────────────────────────
export function ChangelogModal({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: DashboardData }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ScrollText className="h-4 w-4 text-orange-500" /> Changelog</DialogTitle></DialogHeader>
        <div className="space-y-3 text-xs leading-relaxed text-slate-600">
          <div>
            <p className="font-bold text-slate-800">{data.release.label} — Organization Console Expert Information System v3.0</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Expert redesigned formal console: official logo (navy gear + orange house), Inter grid, glassmorphism header</li>
              <li>KPI command row: revenue 48,270 count-up + sparkline + variance drill-down (7d/30d/90d)</li>
              <li>Branch Intelligence Matrix: sticky header, resizable columns, visibility toggles, CSV/PDF export, Kenya heatmap</li>
              <li>9 Domain Expert Modules: Inventory, Debt (mkopo), Rentals, Financials, Suppliers, M-Pesa, eTIMS, Audit, System</li>
              <li>Decision Support Action Center with manager step-up (audit-logged) + action queue</li>
              <li>Recent Activity Timeline (live pop-in, detail modal, filters) + Global Chat drawer + Live Feed</li>
              <li>Branch workspaces: juja-main / thika / ruiru / nairobi-cbd / nakuru with subdomain SSO allowlisting</li>
            </ul>
          </div>
          <div>
            <p className="font-bold text-slate-800">v2.18.1 — Branch manager user-store binding</p>
            <p>Every branch bound to exactly one manager; managers land in their own workspace; cross-branch blocked server-side.</p>
          </div>
          <div>
            <p className="font-bold text-slate-800">v2.18.0 — Branch workspaces</p>
            <p>Subdomain workspaces ({data.org.rootDomain}) + path mode, shared DB, host-header allowlisting, audit-logged authorization.</p>
          </div>
          <p className="rounded-lg bg-slate-50 p-2 text-[10px] text-slate-400">
            Contacts: {data.org.phone1} · {data.org.phone2} · {data.org.email} — Juja Town
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Login dialog ─────────────────────────────────────────────────────────────
export function LoginDialog({ open, onOpenChange, onToast, onSignedIn }: {
  open: boolean; onOpenChange: (o: boolean) => void; onToast: (m: string) => void; onSignedIn: (u: SessionUser) => void;
}) {
  const [email, setEmail] = useState("admin@mbumahhardware.co.ke");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await res.json();
      if (res.ok && j.user) {
        onSignedIn(j.user);
        onOpenChange(false);
        onToast(`Karibu, ${j.user.name} — signed in as ${j.user.role}`);
      } else {
        setErr(j.error ?? "Invalid email or password");
      }
    } catch {
      setErr("Network error — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><img src="/logo.webp" alt="" className="h-7 w-7 rounded-md" /> Sign in — Mbumah Hardware</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" placeholder="you@mbumahhardware.co.ke" />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="Password" placeholder="Password" />
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
          <Button className="w-full bg-orange-500 hover:bg-orange-600" onClick={submit} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          <p className="text-center text-[10px] text-slate-400">Demo seeded accounts use password123 — login is rate-limited (5 / 15 min).</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
