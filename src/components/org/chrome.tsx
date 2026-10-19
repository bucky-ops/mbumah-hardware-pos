'use client';

// Console chrome (v2.18.3 port) - dark header per BRAND.md (48px white logo
// tile, version badge from the single-source-of-truth src/lib/version.ts,
// Connected pulse, health gauge, store selector, command palette, chat,
// notifications, user chip, date, shortcuts) + footer + modals + login.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { CheckCheck, ChevronDown, ChevronUp, CloudOff, ExternalLink, FileText, History, Home, Keyboard, LogIn, Package, ScrollText, Sparkles, Terminal, Store } from 'lucide-react';
import { goHomeToPos } from '@/components/console/unified-console';
import { APP_BUILD_LABEL, APP_VERSION } from '@/lib/version';
import { WHATS_NEW, whatsNewMarkAllTarget, whatsNewReadState, whatsNewUnreadCount, type WhatsNewEntry } from '@/lib/whats-new';
import { HealthGauge, kes, type KpiSummaryData, type StoreRow } from './primitives';
import { buildStoreWorkspaceUrl } from '@/lib/workspace/links';

export interface SessionUser { name: string; role: string; email: string }

const workspaceHref = (s: StoreRow) =>
  buildStoreWorkspaceUrl({ id: s.id, slug: s.slug, subdomain: s.subdomain }, { page: 'dashboard', forcePath: true });
const storeCode = (s: StoreRow) => s.code ?? s.slug ?? s.id.slice(0, 3);

// ── Header ───────────────────────────────────────────────────────────────────
export function ConsoleHeader({ kpi, stores, online, onOpenPalette, onOpenChat, onOpenShortcuts, onOpenLogin, onOpenNotifications, session, signedIn, onToast, showHome = false }: {
  kpi: KpiSummaryData | null; stores: StoreRow[]; online: boolean;
  onOpenPalette: () => void; onOpenChat: () => void; onOpenShortcuts: () => void;
  onOpenLogin: () => void; onOpenNotifications: () => void;
  session: SessionUser | null; signedIn: boolean; onToast: (m: string) => void;
  /** v2.109.0: the Expert Console's Home action — back to the POS workspace. */
  showHome?: boolean;
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
          {/* v2.109.0: the Home action — the unified console's way back to the
              POS workspace. First in the actions row so it can never overlap
              the health gauge, store selector, chat, notifications or user
              chip; keyboard-reachable with a visible focus ring; navigates
              through the ONE internal helper (goHomeToPos), never a URL from
              outside, so it cannot become an open redirect. */}
          {showHome && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="console-home-pos"
              aria-label="Back to POS"
              title="Back to POS"
              className="h-8 border border-white/15 text-[11px] text-slate-200 hover:bg-white/10"
              onClick={goHomeToPos}
            >
              <Home className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Home
            </Button>
          )}
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
// v2.66.0: the footer is a client island with an SSR-safe mount gate (the
// useSyncExternalStore pattern) so the release-waiting pill can read the
// SHARED mbt_seen_version flag (written by the tabs shell's auto-dialog and
// by this console's changelog modal) without touching localStorage on the
// server — one flag, no double-nag across surfaces.
const SEEN_VERSION_KEY = 'mbt_seen_version';
const mountedProbe = () => true;
const serverProbe = () => false;
const subscribeNoop = () => () => {};

export function ConsoleFooter({ kpi, stores, online, onOpenShortcuts, onOpenChangelog, lastSync }: {
  kpi: KpiSummaryData | null; stores: StoreRow[]; online: boolean;
  onOpenShortcuts: () => void; onOpenChangelog: () => void; lastSync: string;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, mountedProbe, serverProbe);
  const [releaseWaiting, setReleaseWaiting] = useState(false);
  useEffect(() => {
    if (!mounted) return;
    // Deferred so no setState runs synchronously inside the effect (the
    // react-hooks/set-state-in-effect rule — same pattern the console page
    // uses for its initial load).
    const id = window.setTimeout(() => {
      try {
        setReleaseWaiting(localStorage.getItem(SEEN_VERSION_KEY) !== APP_VERSION);
      } catch {
        // Storage unavailable — stay quiet, the pill is a nicety not a need.
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [mounted]);
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-[11px] text-slate-500 lg:px-5 dark:text-slate-400" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-slate-700 dark:text-slate-200">{APP_BUILD_LABEL}</span>
          <span className="flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500 anim-live' : 'bg-amber-500'}`} />
            {online ? 'Connected' : 'Offline'}
          </span>
          <button onClick={onOpenShortcuts} className="hover:text-orange-500 dark:hover:text-orange-400">Shortcuts</button>
          <button onClick={onOpenChangelog} className="relative hover:text-orange-500 dark:hover:text-orange-400" data-testid="footer-changelog-button">
            Changelog
            {releaseWaiting && (
              <span data-testid="footer-changelog-pill" title={`Release notes for v${APP_VERSION} are waiting`} className="absolute -right-2.5 -top-1.5 inline-flex items-center gap-0.5 rounded-full border border-emerald-300 bg-emerald-50 px-1 py-px text-[9px] font-semibold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300">
                new
              </span>
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span>Health <strong className={kpi && kpi.health.score >= 80 ? 'text-emerald-400 dark:text-emerald-400' : 'text-amber-400 dark:text-amber-400'}>{kpi ? `${kpi.health.score}/100` : '-'}</strong></span>
          <span>Stores <strong className="text-slate-700 dark:text-slate-200">{stores.length}</strong></span>
          <span>Debt <strong className="text-slate-700 dark:text-slate-200">{kpi ? kes(kpi.kpis.debt.total) : '-'}</strong></span>
          <span>Last sync <strong className="text-slate-700 dark:text-slate-200">{lastSync}</strong></span>
        </div>
      </div>
    </footer>
  );
}

// ── Command palette (cmd+K) ──────────────────────────────────────────────────
export function CommandPalette({ open, onOpenChange, stores, actions, onJumpToRelease }: {
  open: boolean; onOpenChange: (o: boolean) => void; stores: StoreRow[];
  actions: { id: string; label: string; hint?: string; run: () => void }[];
  onJumpToRelease: (version: string) => void;
}) {
  const storeActions = useMemo(
    () => stores.map((s) => ({ id: `ws-${s.id}`, label: `Open ${s.name} workspace`, hint: storeCode(s), run: () => { window.open(workspaceHref(s), '_blank', 'noopener'); } })),
    [stores],
  );
  // v2.75.0: the release group knows what you've READ. The SHARED
  // mbt_seen_version flag (the footer pill reads it, the changelog modal
  // writes it on "Got it") is read when the palette OPENS — deferred like
  // every other storage read on this page and re-read on every open, so a
  // "Got it" in the modal is reflected the very next cmd+K. read=false
  // until then: items render in their quiet 'seen' dress for that first
  // paint, and no state is claimed before the flag has actually been read.
  const [seenState, setSeenState] = useState<{ read: boolean; value: string | null }>({ read: false, value: null });
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      try {
        setSeenState({ read: true, value: localStorage.getItem(SEEN_VERSION_KEY) });
      } catch {
        // Storage unavailable — stay quiet, the markers are a nicety.
        setSeenState({ read: true, value: null });
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);
  // v2.73.0: one palette item per release, newest first — the same WHATS_NEW
  // source the changelog modal renders, so the palette and the archive can
  // never disagree. Search ranks across all groups, so a title keyword
  // ("CSV", "payslip") finds the release that shipped it. v2.75.0: each
  // item carries its reading state (latest / new / seen) derived from the
  // same flag — the palette is a release inbox, not just a jump list.
  const releaseActions = useMemo(
    () => WHATS_NEW.map((e) => ({
      version: e.version,
      label: `v${e.version} — ${e.title}`,
      state: seenState.read ? whatsNewReadState(e.version, seenState.value) : ('seen' as const),
    })),
    [seenState],
  );
  const unreadCount = useMemo(
    () => (seenState.read ? whatsNewUnreadCount(seenState.value) : 0),
    [seenState],
  );
  // v2.76.0: the inbox clears in place. With unread releases on the board,
  // the action stamps the SAME shared flag the changelog's "Got it" writes
  // — the feed's head, via whatsNewMarkAllTarget — and updates the local
  // read state immediately, so the counter and the NEW chips clear while
  // you watch. The palette STAYS OPEN: the effect of the write is the
  // feedback. If storage is unavailable nothing was written, so nothing is
  // claimed; and with nothing unread the action simply never renders.
  const markAllRead = () => {
    const target = whatsNewMarkAllTarget();
    if (!target) return;
    try {
      localStorage.setItem(SEEN_VERSION_KEY, target);
    } catch {
      return; // storage unavailable — nothing was written, claim nothing
    }
    setSeenState({ read: true, value: target });
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search actions, stores, releases..." />
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
        {releaseActions.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup
              heading={
                <>
                  Jump to release
                  {unreadCount > 0 ? (
                    <span
                      data-testid="palette-release-unread"
                      title={`${unreadCount} release${unreadCount === 1 ? '' : 's'} arrived after you last read the notes`}
                      className="ml-2 inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
                    >
                      {unreadCount} unread
                    </span>
                  ) : null}
                </>
              }
            >
              {seenState.read && unreadCount > 0 && whatsNewMarkAllTarget() ? (
                <CommandItem
                  data-testid="palette-mark-all-read"
                  value="mark all releases read inbox got it catch up"
                  onSelect={markAllRead}
                  title="Writes the same seen flag the changelog’s “Got it” writes — the palette stays open"
                  className="aria-selected:bg-emerald-50 aria-selected:text-emerald-900 dark:aria-selected:bg-emerald-500/10 dark:aria-selected:text-emerald-100"
                >
                  <CheckCheck className="mr-2 h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                  <span className="min-w-0 flex-1 truncate">Mark all releases read</span>
                  <span className="ml-auto shrink-0 text-[10px] text-slate-400">stays open</span>
                </CommandItem>
              ) : null}
              {releaseActions.map((r) => (
                <CommandItem
                  key={r.version}
                  data-testid={`palette-release-${r.version}`}
                  value={`${r.label} release notes`}
                  onSelect={() => { onOpenChange(false); onJumpToRelease(r.version); }}
                >
                  <ScrollText className={`mr-2 h-3.5 w-3.5 shrink-0 ${r.state === 'latest' ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400'}`} />
                  <span className={`min-w-0 flex-1 truncate ${r.state === 'latest' ? 'font-semibold text-slate-800 dark:text-slate-100' : ''}`}>{r.label}</span>
                  {r.state === 'latest' ? (
                    <span
                      data-testid={`palette-release-state-${r.version}`}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-white px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-emerald-300"
                    >
                      <Sparkles className="h-2.5 w-2.5" aria-hidden /> latest
                    </span>
                  ) : r.state === 'new' ? (
                    <span
                      data-testid={`palette-release-state-${r.version}`}
                      title={`v${r.version} arrived after you last read the notes`}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-400 dark:border-emerald-500/30 dark:text-emerald-400"
                    >
                      new
                    </span>
                  ) : (
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">notes</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
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
  // v2.77.0: the sheet tells the whole story — the desk report has its own
  // keys (j/k walk its doors, esc closes a drawer), and the console's
  // shortcut sheet is where they are discoverable. A labeled section keeps
  // the sheet honest about WHERE each key works.
  const deskRows: Array<[string, string]> = [
    ['j', 'Desk report: walk to the next door'],
    ['k', 'Desk report: walk to the previous door'],
    ['esc', 'Desk report: close the open drawer'],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Keyboard className="h-4 w-4 text-orange-500" /> Keyboard shortcuts</DialogTitle></DialogHeader>
        <ul className="space-y-1.5 text-xs">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between border-b border-slate-50 pb-1">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{k}</kbd>
              <span className="text-slate-600">{v}</span>
            </li>
          ))}
        </ul>
        <div data-testid="shortcuts-desk-section" className="border-t border-slate-100 pt-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <FileText className="h-3 w-3" aria-hidden /> On the desk report
            <span className="font-normal normal-case tracking-normal text-slate-400/80">/org/desk-report</span>
          </p>
          <ul className="space-y-1.5 text-xs">
            {deskRows.map(([k, v]) => (
              <li key={k} className="flex items-center justify-between border-b border-slate-50 pb-1">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{k}</kbd>
                <span className="text-slate-600">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Changelog modal ──────────────────────────────────────────────────────────
// v2.66.0: the console stops telling a v2.18.3-era story. The modal now
// renders the SAME WHATS_NEW source the tabs shell's auto-dialog uses —
// newest first, the latest release highlighted emerald, older releases
// muted — with a collapse for the backlog (66 entries and counting), the
// shared mbt_seen_version flag on "Got it" (one flag across surfaces, no
// double-nag), the GitHub changelog link, and the business contacts kept.
const CHANGELOG_URL = 'https://github.com/bucky-ops/mbumah-hardware-pos/blob/main/CHANGELOG.md';
// The modal reads top-down and never drowns: the latest release + this many
// older ones render open; the rest wait behind one expand button.
const INITIAL_VISIBLE = 5;

function ChangelogEntry({ entry, latest, focused }: { entry: WhatsNewEntry; latest: boolean; focused?: boolean }) {
  return (
    <div
      data-testid={`changelog-entry-${entry.version}`}
      className={`${
        latest
          ? 'rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10'
          : 'rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30'
      }${focused ? ' ring-2 ring-orange-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={latest ? 'default' : 'secondary'} className="font-mono text-[11px]">
          v{entry.version}
        </Badge>
        <span className={`text-sm font-semibold leading-tight ${latest ? 'text-emerald-900 dark:text-emerald-200' : 'text-slate-800 dark:text-slate-200'}`}>{entry.title}</span>
        {latest && (
          <span data-testid="changelog-latest-pill" className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-emerald-300">
            <Sparkles className="h-2.5 w-2.5" aria-hidden /> latest
          </span>
        )}
        {focused && (
          <span data-testid="changelog-jump-pill" className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300">
            <Terminal className="h-2.5 w-2.5" aria-hidden /> via cmd+K
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {entry.bullets.map((bullet) => (
          <li key={bullet} className={`flex items-start gap-2 text-xs leading-relaxed ${latest ? 'text-emerald-900/80 dark:text-emerald-200/80' : 'text-slate-600 dark:text-slate-400'}`}>
            <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${latest ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChangelogModal({ open, onOpenChange, jumpTo }: { open: boolean; onOpenChange: (o: boolean) => void; jumpTo?: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const [latest, ...older] = WHATS_NEW;
  // v2.73.0: the palette's jump — a deep target (older than the five the
  // modal opens by default) forces the backlog open so the entry is actually
  // on the page, then a scroll effect brings it into view and the orange
  // "via cmd+K" pill + ring mark it. A plain open keeps the collapse.
  const jumpIndex = jumpTo ? WHATS_NEW.findIndex((e) => e.version === jumpTo) : -1;
  const needsExpand = jumpIndex > INITIAL_VISIBLE;
  const effectiveShowAll = showAll || needsExpand;
  const visibleOlder = effectiveShowAll ? older : older.slice(0, INITIAL_VISIBLE);
  const hiddenCount = older.length - visibleOlder.length;

  // Scroll the jumped entry into view once the dialog has painted. No
  // setState — a pure DOM nudge, cleaned up like any other effect.
  useEffect(() => {
    if (!open || !jumpTo || jumpIndex < 0) return;
    const id = window.setTimeout(() => {
      document.querySelector(`[data-testid="changelog-entry-${jumpTo}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(id);
  }, [open, jumpTo, jumpIndex]);

  // "Got it" marks the CURRENT release seen on the SHARED flag — the same
  // key the tabs shell's auto-dialog writes — so a release read on the
  // console stays read on the POS and vice versa (the pill in the footer
  // listens to the same key).
  const markSeen = () => {
    try {
      localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    } catch {
      // Nothing to do — the pill just comes back on the next visit.
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="changelog-modal" className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400">
              <ScrollText className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            Release changelog
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-left text-sm text-muted-foreground">
              You&apos;re on version {APP_VERSION} — every release since the console joined the lineage, newest first.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3" data-testid="changelog-entries">
          {latest ? <ChangelogEntry entry={latest} latest focused={jumpTo === latest.version} /> : null}
          {visibleOlder.map((entry) => (
            <ChangelogEntry key={entry.version} entry={entry} latest={false} focused={jumpTo === entry.version} />
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              data-testid="changelog-show-older"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              Show {hiddenCount} older release{hiddenCount === 1 ? '' : 's'}
            </button>
          ) : null}
          {showAll && older.length > INITIAL_VISIBLE ? (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              data-testid="changelog-show-fewer"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              Show fewer
            </button>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" asChild>
            <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer" data-testid="changelog-github-link">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              View changelog on GitHub
            </a>
          </Button>
          <Button size="sm" onClick={markSeen} data-testid="changelog-got-it">
            Got it
          </Button>
        </DialogFooter>

        <p className="rounded-lg bg-slate-50 p-2 text-center text-[10px] text-slate-400 dark:bg-slate-800/50 dark:text-slate-500">
          Contacts: 0795 191 909 · 0759 963 601 · mbumahhardware@gmail.com - Juja Town
        </p>
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
