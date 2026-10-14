'use client';

// Console chrome (v2.18.3 port) - dark header per BRAND.md (48px white logo
// tile, version badge from the single-source-of-truth src/lib/version.ts,
// Connected pulse, health gauge, store selector, command palette, chat,
// notifications, user chip, date, shortcuts) + footer + modals + login.

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { CloudOff, History, Keyboard, LogIn, Package, ScrollText, Terminal, Store } from 'lucide-react';
import { APP_BUILD_LABEL } from '@/lib/version';
import { HealthGauge, kes, type KpiSummaryData, type StoreRow } from './primitives';
import { buildStoreWorkspaceUrl } from '@/lib/workspace/links';

export interface SessionUser { name: string; role: string; email: string }

const workspaceHref = (s: StoreRow) =>
  buildStoreWorkspaceUrl({ id: s.id, slug: s.slug, subdomain: s.subdomain }, { page: 'dashboard', forcePath: true });
const storeCode = (s: StoreRow) => s.code ?? s.slug ?? s.id.slice(0, 3);

// ── Header ───────────────────────────────────────────────────────────────────
export function ConsoleHeader({ kpi, stores, online, onOpenPalette, onOpenChat, onOpenShortcuts, onOpenLogin, onOpenNotifications, session, signedIn, onToast }: {
  kpi: KpiSummaryData | null; stores: StoreRow[]; online: boolean;
  onOpenPalette: () => void; onOpenChat: () => void; onOpenShortcuts: () => void;
  onOpenLogin: () => void; onOpenNotifications: () => void;
  session: SessionUser | null; signedIn: boolean; onToast: (m: string) => void;
}) {
  const [date, setDate] = useState('');
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setDate(new Date().toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const notifications = kpi?.system.notificationsUnread ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0f172a]/95 text-white backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 lg:px-5">
        <img src="/logo.webp" alt="Mbumah Hardware logo" width={48} height={48} className="h-12 w-12 rounded-xl bg-white p-1 shadow" />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold tracking-wide">MBUMAH HARDWARE</p>
          <p className="truncate text-[9px] font-medium uppercase tracking-[0.14em] text-orange-400">YOUR BUILDING PARTNER IN JUJA</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="border-white/20 text-[10px] text-slate-200">{APP_BUILD_LABEL}</Badge>
          <span className="hidden items-center gap-1 text-[10px] text-emerald-400 sm:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400 anim-live' : 'bg-slate-500'}`} />
            {online ? 'Connected' : 'Offline'}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {kpi && (
            <div className="hidden items-center gap-2 rounded-xl bg-white/5 px-2 py-1 md:flex" title={`Health ${kpi.health.score}/100 - ${kpi.health.label}`}>
              <HealthGauge score={kpi.health.score} size={44} />
              <div className="leading-tight">
                <p className="text-[10px] text-slate-400">Health</p>
                <p className="text-xs font-bold text-emerald-400">{kpi.health.score}/100 {kpi.health.label}</p>
              </div>
            </div>
          )}

          {/* Store selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 border border-white/15 text-[11px] text-slate-200 hover:bg-white/10">
                Stores · {stores.length} <span className="ml-1 text-orange-400">▾</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Open store workspace</DropdownMenuLabel>
              {stores.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => { window.open(workspaceHref(s), '_blank', 'noopener'); }}>
                  <span className="mr-2 h-2 w-2 rounded-full" style={{ background: s.brandingColor ?? '#12243D' }} />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-[10px] text-slate-400">{storeCode(s)}</span>
                </DropdownMenuItem>
              ))}
              {stores.length === 0 && <DropdownMenuItem className="text-xs text-slate-400">Sign in as an org role to list stores.</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>

          <button onClick={onOpenPalette} className="focus-ring hidden items-center gap-1.5 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10 md:flex" aria-label="Open command palette">
            <Terminal className="h-3 w-3" /> cmd+K
          </button>

          <IconPulse label={`${notifications} unread notifications`} onClick={onOpenNotifications} count={notifications} dot="bg-red-500">
            <History className="h-4 w-4" />
          </IconPulse>

          <IconPulse label="Open global chat" onClick={onOpenChat} count={0} dot="bg-red-500">
            <ChatIcon />
          </IconPulse>

          {/* User chip */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="focus-ring flex items-center gap-2 rounded-full border border-white/15 py-1 pl-1 pr-2 hover:bg-white/10" aria-label="User menu">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold">
                  {session ? session.name.slice(0, 1).toUpperCase() : '?'}
                </span>
                <span className="hidden text-[11px] font-semibold sm:block">{session ? session.role : 'Guest'}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{session ? session.name : 'Browsing as guest'}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {signedIn && session ? (
                <DropdownMenuItem className="text-xs">{session.email}</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onOpenLogin} className="text-xs"><LogIn className="mr-2 h-3 w-3" /> Sign in...</DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-xs" onClick={() => onToast('The tabs POS app stays at / - this console is a read-only org surface.')}>
                <Store className="mr-2 h-3 w-3" /> Where is the POS?
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="hidden text-[10px] text-slate-400 lg:block">{date}</span>
          <Button size="sm" variant="ghost" className="h-7 border border-white/15 text-[10px] text-slate-300 hover:bg-white/10" onClick={onOpenShortcuts}>
            <Keyboard className="mr-1 h-3 w-3" /> Shortcuts
          </Button>
          {!online && (
            <Badge className="bg-amber-500/90 text-[10px] text-white hover:bg-amber-500/90"><CloudOff className="mr-1 h-3 w-3" /> Offline</Badge>
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
          <span className={`absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full ${dot} px-0.5 text-[8px] font-bold text-white`}>{count > 99 ? '99+' : count}</span>
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
export function ConsoleFooter({ kpi, stores, online, onOpenShortcuts, onOpenChangelog, lastSync }: {
  kpi: KpiSummaryData | null; stores: StoreRow[]; online: boolean;
  onOpenShortcuts: () => void; onOpenChangelog: () => void; lastSync: string;
}) {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-[11px] text-slate-500 lg:px-5" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-slate-700">{APP_BUILD_LABEL}</span>
          <span className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500 anim-live' : 'bg-amber-500'}`} />
            {online ? 'Connected' : 'Offline'}
          </span>
          <button onClick={onOpenShortcuts} className="hover:text-orange-500">Shortcuts</button>
          <button onClick={onOpenChangelog} className="hover:text-orange-500">Changelog</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span>Health <strong className={kpi && kpi.health.score >= 80 ? 'text-emerald-600' : 'text-amber-600'}>{kpi ? `${kpi.health.score}/100` : '-'}</strong></span>
          <span>Stores <strong className="text-slate-700">{stores.length}</strong></span>
          <span>Debt <strong className="text-slate-700">{kpi ? kes(kpi.kpis.debt.total) : '-'}</strong></span>
          <span>Last sync <strong className="text-slate-700">{lastSync}</strong></span>
        </div>
      </div>
    </footer>
  );
}

// ── Command palette (cmd+K) ──────────────────────────────────────────────────
export function CommandPalette({ open, onOpenChange, stores, actions }: {
  open: boolean; onOpenChange: (o: boolean) => void; stores: StoreRow[];
  actions: { id: string; label: string; hint?: string; run: () => void }[];
}) {
  const storeActions = useMemo(
    () => stores.map((s) => ({ id: `ws-${s.id}`, label: `Open ${s.name} workspace`, hint: storeCode(s), run: () => { window.open(workspaceHref(s), '_blank', 'noopener'); } })),
    [stores],
  );
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search actions, stores..." />
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
        <CommandGroup heading="Store workspaces">
          {storeActions.map((a) => (
            <CommandItem key={a.id} onSelect={() => { onOpenChange(false); a.run(); }}>
              <Package className="mr-2 h-3.5 w-3.5 text-slate-400" /> {a.label} <span className="ml-auto text-[10px] text-slate-400">{a.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// ── Shortcuts modal ──────────────────────────────────────────────────────────
export function ShortcutsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const rows: Array<[string, string]> = [
    ['cmd + K', 'Command palette'],
    ['F2', 'Focus expert modules'],
    ['F3', 'Focus inventory expert'],
    ['F5', 'Force live feed refresh'],
    ['Esc', 'Close dialogs'],
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
export function ChangelogModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ScrollText className="h-4 w-4 text-orange-500" /> Changelog</DialogTitle></DialogHeader>
        <div className="space-y-3 text-xs leading-relaxed text-slate-600">
          <div>
            <p className="font-bold text-slate-800">v2.18.3 - Organization Console joins the unified lineage</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>The expert console ships at /console on the main (PostgreSQL, multi-tenant) lineage - the tabs POS app stays at /</li>
              <li>KPI command row, Store Intelligence Matrix, 9 expert modules, Decision Support, Activity Timeline, Global Chat, Live Feed</li>
              <li>Every figure is computed from the database via /api/org/summary and the new /api/org/kpi-summary (org roles only)</li>
              <li>Official brand assets restored per docs/BRAND.md (navy gear + orange house)</li>
            </ul>
          </div>
          <div>
            <p className="font-bold text-slate-800">v2.18.1 - Branch manager user-store binding</p>
            <p>Every branch bound to exactly one manager; managers land in their own workspace; cross-branch blocked server-side.</p>
          </div>
          <div>
            <p className="font-bold text-slate-800">v2.16.0 - Subdomain workspaces</p>
            <p>{'{store}.{root-domain}'} rewrites plus path-mode /stores/{'{slug}'}/... workspaces with host-header allowlisting and audit-logged authorization.</p>
          </div>
          <p className="rounded-lg bg-slate-50 p-2 text-[10px] text-slate-400">
            Contacts: 0795 191 909 · 0759 963 601 · mbumahhardware@gmail.com - Juja Town
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Login dialog (main-lineage /api/auth/login contract) ─────────────────────
export function LoginDialog({ open, onOpenChange, onToast, onSignedIn }: {
  open: boolean; onOpenChange: (o: boolean) => void; onToast: (m: string) => void; onSignedIn: (u: SessionUser, token: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const j = await res.json();
      if (res.ok && j?.success && j.data?.user && j.data?.token) {
        // Same token convention as the tabs SPA (localStorage mbt_token).
        onSignedIn(
          { name: j.data.user.name ?? j.data.user.email, role: j.data.user.role, email: j.data.user.email },
          j.data.token,
        );
        onOpenChange(false);
        setPassword('');
        onToast(`Karibu, ${j.data.user.name} - signed in as ${j.data.user.role}`);
      } else {
        setErr(j?.error ?? 'Invalid email or password');
      }
    } catch {
      setErr('Network error - try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><img src="/logo.webp" alt="" className="h-7 w-7 rounded-md" /> Sign in - Mbumah Hardware</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" placeholder="you@mbumahhardware.co.ke" autoComplete="username" />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="Password" placeholder="Password" autoComplete="current-password" />
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
          <Button className="w-full bg-orange-500 hover:bg-orange-600" onClick={submit} disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
          <p className="text-center text-[10px] text-slate-400">Login is rate-limited (5 attempts / 15 minutes). Seeded demo accounts use password123 on local databases only.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
