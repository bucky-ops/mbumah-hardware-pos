'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE - Organization Console (Expert Information System)
// v2.18.3 port of the sandbox-lineage console onto the main lineage.
//
// Route: /console (the tabs POS app remains at /). Every data surface is
// rewired to MAIN-lineage APIs and re-verified server-side:
//   /api/org/summary        per-store matrix rows   (SUPER_ADMIN, STORE_OWNER, ACCOUNTANT)
//   /api/org/kpi-summary    org KPIs + experts      (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER)
//   /api/chat/*             global chat             (any authenticated user)
//   /api/system-logs        live feed               (admin roles)
//   /api/financial/*, /api/audit-logs, /api/health (per-tab, lazy)
// Sections the caller's role cannot read degrade to an explicit
// "unavailable" state. Guests see the shell + a sign-in prompt.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { History, Landmark, LayoutDashboard, Menu, PackageSearch, PieChart, Radio, ScrollText, Users, Wallet } from 'lucide-react';
import { ActivityTimeline, ChatDrawer, DecisionSupport, DeskActivity, LiveFeed } from '@/components/org/panels';
import { StoreMatrix } from '@/components/org/store-matrix';
import { ExpertModules } from '@/components/org/experts';
import { KpiRow } from '@/components/org/kpi-row';
import { ChangelogModal, CommandPalette, ConsoleFooter, ConsoleHeader, LoginDialog, ShortcutsModal, type SessionUser } from '@/components/org/chrome';
import { SectionErrorBoundary } from '@/components/error-boundary';
import { KenyaMap, Sparkline, WeekDeltaChip, weekDeltaWords, kes, num, timeAgo, type DeskActivityData, type DeskActivityFilter, type KpiSummaryData, type OrgSummaryData, type StoreRow } from '@/components/org/primitives';
import { authorizedFetchJson } from '@/lib/api';
import { buildStoreWorkspaceUrl } from '@/lib/workspace/links';
import { PeoplePayrollByBranch, PeoplePayrollUnavailable } from '@/components/finance/people-payroll-by-branch';
import { UnifiedConsoleShell } from '@/components/console/unified-console';

const SECTIONS = [
  { id: 'kpi-row', label: 'Overview', icon: LayoutDashboard },
  { id: 'store-matrix', label: 'Matrix', icon: PieChart },
  { id: 'experts', label: 'Experts', icon: PackageSearch },
  { id: 'decision', label: 'Decision', icon: Wallet },
  { id: 'desk-activity', label: 'Desk activity', icon: History },
  { id: 'timeline', label: 'Activity', icon: ScrollText },
  { id: 'live-feed', label: 'Live Feed', icon: Radio },
];

const storeCodeOf = (s: StoreRow) => s.code ?? s.slug ?? s.id.slice(0, 3);
const storeHref = (s: StoreRow) =>
  buildStoreWorkspaceUrl({ id: s.id, slug: s.slug, subdomain: s.subdomain }, { page: 'dashboard', forcePath: true });

/**
 * v2.23.0: "People & payroll by branch" drill-down. v2.109.0: the panel is
 * now the SHARED component (src/components/finance/people-payroll-by-branch.tsx)
 * also served inside the Finance & Insights tab of the main SPA — one
 * implementation, one /api/org/summary truth, zero duplicated table logic.
 * Collapsed by default so the console keeps its expert-system density.
 */
const HrPerStorePanel = PeoplePayrollByBranch;
const HrPerStoreUnavailable = PeoplePayrollUnavailable;

export default function OrgConsolePage() {
  const [summary, setSummary] = useState<OrgSummaryData | null>(null);
  const [kpi, setKpi] = useState<KpiSummaryData | null>(null);
  // v2.64.0: the desk-activity audit panel (GET /api/org/review-activity).
  // v2.65.0: the panel drills down — the filter state lives here so the
  // 30s poll fetches the SAME narrowed view the reviewer chose, and a
  // filter change re-keys `load` for an immediate refetch (no waiting for
  // the next tick).
  const [deskActivity, setDeskActivity] = useState<DeskActivityData | null>(null);
  const [deskActivityError, setDeskActivityError] = useState<string | null>(null);
  const [deskFilter, setDeskFilter] = useState<DeskActivityFilter>({ reviewer: null, branch: null });
  const deskQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (deskFilter.reviewer) params.set('reviewer', deskFilter.reviewer);
    if (deskFilter.branch) params.set('branch', deskFilter.branch);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [deskFilter]);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState('-');
  const [session, setSession] = useState<SessionUser | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // UI state
  const [paletteOpen, setPaletteOpen] = useState(false);
  // v2.73.0: the palette's jump-to-release target — the version the changelog
  // modal should open scrolled to (null = a plain open). Cleared on close so
  // the next plain open doesn't re-scroll or re-ring.
  const [releaseJump, setReleaseJump] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [railPinned, setRailPinned] = useState(false);
  const [railPeek, setRailPeek] = useState(false);

  const onToast = useCallback((msg: string) => toast(msg), []);

  // ── Data fetch + 30s poll ────────────────────────────────────────────────
  const load = useCallback(async () => {
    const [summaryRes, kpiRes, deskRes] = await Promise.all([
      authorizedFetchJson('/api/org/summary'),
      authorizedFetchJson('/api/org/kpi-summary'),
      authorizedFetchJson(`/api/org/review-activity${deskQuery}`),
    ]);

    if (summaryRes.ok && summaryRes.json?.success) {
      setSummary(summaryRes.json.data as OrgSummaryData);
      setSummaryError(null);
    } else {
      setSummaryError(
        summaryRes.status === 401
          ? 'Sign in to load the store matrix.'
          : summaryRes.status === 403
            ? 'The store matrix is limited to org roles (SUPER_ADMIN, STORE_OWNER, ACCOUNTANT).'
            : summaryRes.json?.error ?? 'Store matrix unavailable.',
      );
      if (summaryRes.status === 401) setNeedsAuth(true);
    }

    if (kpiRes.ok && kpiRes.json?.success) {
      setKpi(kpiRes.json.data as KpiSummaryData);
      setKpiError(null);
    } else {
      setKpiError(
        kpiRes.status === 401
          ? 'Sign in to load organization KPIs.'
          : kpiRes.status === 403
            ? 'Organization KPIs are limited to org roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER).'
            : kpiRes.json?.error ?? 'KPI summary unavailable.',
      );
      if (kpiRes.status === 401) setNeedsAuth(true);
    }

    if (deskRes.ok && deskRes.json?.success) {
      setDeskActivity(deskRes.json.data as DeskActivityData);
      setDeskActivityError(null);
    } else {
      setDeskActivityError(
        deskRes.status === 401
          ? 'Sign in to load desk activity.'
          : deskRes.status === 403
            ? 'Desk activity is limited to org roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER).'
            : deskRes.json?.error ?? 'Desk activity unavailable.',
      );
      if (deskRes.status === 401) setNeedsAuth(true);
    }

    setOnline(true);
    setLastSync(new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }, [deskQuery]);

  useEffect(() => {
    // Deferred initial load keeps the effect body free of synchronous
    // setState (react-hooks/set-state-in-effect) while polling continues.
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 30_000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [load, refreshKey]);

  // ── Session probe (guests stay guests) ───────────────────────────────────
  useEffect(() => {
    authorizedFetchJson('/api/auth/me')
      .then((res) => {
        if (res.ok && res.json?.success && res.json.data) {
          const u = res.json.data as { name?: string; role?: string; email?: string };
          setSession({ name: u.name ?? u.email ?? 'User', role: u.role ?? 'USER', email: u.email ?? '' });
          setNeedsAuth(false);
        }
      })
      .catch(() => undefined);
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const map: Record<string, () => void> = {
        F2: () => document.getElementById('experts')?.scrollIntoView({ behavior: 'smooth' }),
        F3: () => { document.getElementById('experts')?.scrollIntoView({ behavior: 'smooth' }); onToast('Inventory expert focused'); },
        F5: () => { setRefreshKey((k) => k + 1); onToast('Live feed refreshed'); },
      };
      if (map[e.key]) { e.preventDefault(); map[e.key](); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToast]);

  // ── Autohide rail: collapse after 2s idle, peek on left-edge hover ───────
  useEffect(() => {
    if (railPinned) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { setRailPeek(false); t = setTimeout(() => setRailPeek(false), 2000); };
    const reset = () => clearTimeout(t);
    const onMove = (e: MouseEvent) => {
      if (e.clientX <= 20) setRailPeek(true);
      else if (e.clientX > 280) { reset(); arm(); }
    };
    arm();
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); clearTimeout(t); };
  }, [railPinned]);
  const railExpanded = railPinned || railPeek;

  const signedIn = Boolean(session);
  const stores = summary?.stores ?? [];
  const loading = !summary && !summaryError && !kpi && !kpiError;

  const handleSignedIn = (u: SessionUser, token: string) => {
    try {
      // Same token convention as the tabs SPA.
      localStorage.setItem('mbt_token', token);
      localStorage.setItem('mbt_user', JSON.stringify(u));
    } catch {
      /* private mode - session still works for this page load */
    }
    setSession(u);
    setNeedsAuth(false);
    setRefreshKey((k) => k + 1);
    void load();
  };

  return (
    <UnifiedConsoleShell
      mode="expert"
      bodyClassName="mbumah-console bg-slate-100"
      header={
        <ConsoleHeader
          kpi={kpi} stores={stores} online={online} session={session} signedIn={signedIn} onToast={onToast}
          onOpenPalette={() => setPaletteOpen(true)} onOpenChat={() => setChatOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)} onOpenLogin={() => setLoginOpen(true)}
          onOpenNotifications={() => onToast(`${kpi?.system.notificationsUnread ?? 0} unread notifications - read them in the workspace notification center`)}
          showHome
        />
      }
    >

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 py-4 lg:px-5">
        {/* Autohide nav rail */}
        <nav
          aria-label="Console sections"
          className={`no-print sticky top-20 hidden h-fit flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-all duration-300 md:flex ${railExpanded ? 'w-[210px]' : 'w-16 items-center'}`}
        >
          <button onClick={() => setRailPinned((p) => !p)} className="focus-ring mb-1 flex h-8 w-full items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50" aria-label={railPinned ? 'Unpin navigation' : 'Pin navigation'}>
            <Menu className="h-4 w-4" />
          </button>
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })}
              className="focus-ring flex items-center gap-2 rounded-lg px-2 py-2 text-[12px] font-medium text-slate-600 hover:bg-orange-50 hover:text-orange-600" title={s.label}>
              <s.icon className="h-4 w-4 shrink-0" />
              {railExpanded && <span>{s.label}</span>}
            </button>
          ))}
          {railExpanded && (
            <div className="mt-2 border-t border-slate-100 px-2 pt-2">
              <Landmark className="mb-1 h-3 w-3 text-slate-300" />
              <p className="text-[10px] leading-snug text-slate-500">Org roles only · every endpoint re-verifies the session server-side</p>
            </div>
          )}
        </nav>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Sign-in banner for guests */}
          {needsAuth && !signedIn && (
            <section aria-label="Sign in prompt" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-orange-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Browsing the console as a guest</p>
                  <p className="text-xs text-slate-500">Sign in with an organization account to load live KPIs, the store matrix, chat and the live feed.</p>
                </div>
              </div>
              <button onClick={() => setLoginOpen(true)} className="focus-ring inline-flex min-h-[44px] items-center rounded-lg bg-[#12243D] px-4 text-sm font-medium text-white hover:bg-[#0F1E33]">
                Sign in
              </button>
            </section>
          )}

          {/* Store strip */}
          <section aria-label="Stores" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {stores.map((s, i) => (
              <button key={s.id} onClick={() => window.open(storeHref(s), '_blank', 'noopener')}
                className="focus-ring anim-slide-fade rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                style={{ animationDelay: `${i * 100}ms` }}>
                <div className="flex items-center justify-between">
                  <span className="flex h-7 w-11 items-center justify-center rounded-md text-[10px] font-bold text-white transition-transform hover:scale-105" style={{ background: s.brandingColor ?? '#12243D' }}>
                    {storeCodeOf(s).slice(0, 3).toUpperCase()}
                  </span>
                  {/* v2.149.0: emerald-700/slate-500 — the 9px chip at emerald-600
                      measured 3.65:1 on white (fails 4.5:1 for normal text);
                      slate-400 meta on white was 2.9:1. Both clear now. */}
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${s.status === 'ACTIVE' ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>{s.status}</span>
                </div>
                <p className="mt-1.5 truncate text-[12px] font-semibold text-slate-800">{s.name}</p>
                <p className="text-[10px] text-slate-500">{kes(s.todayRevenue)} · {s.todayTransactions} txns</p>
                {/* v2.176.0: this branch's 7-day spark — the SAME muted slate
                    vocabulary the org dashboard's branches table speaks
                    (72×20, #64748b), joined by storeId (never row order).
                    The week total rides the title tooltip + an sr-only clause
                    (the svg is aria-hidden decoration); an older cached
                    summary without perStoreTrend — or a missing entry —
                    keeps a calm dash row at the same height, never a
                    fabricated shape. v2.177.0: the week learns its own
                    variance — the WeekDeltaChip stacks under the spark (the
                    lib's weekDelta math, one vocabulary across all three
                    trend surfaces), the tooltip gains the prior week, and a
                    second sr-only sentence speaks the verdict. No prior week
                    → no chip, no words, nothing fabricated. */}
                {(() => {
                  const storeTrend = summary?.perStoreTrend?.find((t) => t.storeId === s.id) ?? null;
                  const deltaWords = storeTrend ? weekDeltaWords(storeTrend.weekTotal, storeTrend.priorWeekTotal ?? 0) : null;
                  return storeTrend ? (
                    <div
                      className="mt-1.5 flex w-[76px] flex-col gap-0.5"
                      title={`7-day revenue ${kes(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${kes(storeTrend.priorWeekTotal)}` : ''}`}
                    >
                      <Sparkline data={storeTrend.spark} stroke="#64748b" width={72} height={20} />
                      <WeekDeltaChip current={storeTrend.weekTotal} prior={storeTrend.priorWeekTotal ?? 0} />
                      <span className="sr-only">7-day revenue {kes(storeTrend.weekTotal)}</span>
                      {deltaWords ? <span className="sr-only">{deltaWords}</span> : null}
                    </div>
                  ) : (
                    <div className="mt-1.5 flex min-h-[20px] items-center" aria-hidden="true">
                      <span className="text-[10px] text-muted-foreground">—</span>
                    </div>
                  );
                })()}
              </button>
            ))}
            {summaryError && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                {summaryError}
              </div>
            )}
          </section>

          <div id="kpi-row">
            <SectionErrorBoundary sectionName="KPI Command Row">
              {kpi ? (
                <KpiRow
                  data={kpi}
                  /* v2.176.0: the per-branch week rides in from the SAME
                     /api/org/summary response the strip already reads —
                     no second fetch; null (branch manager without matrix
                     access, or an older cached answer) keeps the modal's
                     org-wide story only. */
                  perStoreTrend={summary?.perStoreTrend ?? null}
                  stores={stores}
                />
              ) : <UnavailableCard message={kpiError ?? 'Loading organization KPIs...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />}
            </SectionErrorBoundary>
          </div>

          <SectionErrorBoundary sectionName="Overview">
            <section aria-label="Overview" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-1 text-sm font-semibold text-slate-800">Health - {kpi?.health.label ?? 'unknown'}</h2>
                <p className="mb-2 text-[11px] text-slate-500">Composite: revenue attainment, stock, debt and engagement</p>
                {stores.length > 0 ? <KenyaMap stores={stores} /> : <p className="p-6 text-center text-xs text-slate-500">Store map needs /api/org/summary access.</p>}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
                <h2 className="mb-2 text-sm font-semibold text-slate-800">Today at a glance</h2>
                {kpi ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[
                      ['Revenue', kes(kpi.kpis.revenue.today), `7d ${kes(kpi.kpis.revenue.weekTotal)} · ${kpi.kpis.revenue.variancePct >= 0 ? '+' : ''}${kpi.kpis.revenue.variancePct}% vs prior`],
                      ['Transactions', num(kpi.kpis.transactions.today), `7d ${num(kpi.kpis.transactions.weekTotal)} vs prior ${num(kpi.kpis.transactions.priorWeekTotal)}`],
                      ['Debt exposure', kes(kpi.kpis.debt.total), `90+ bucket ${kes(kpi.kpis.debt.aging.d90plus)}`],
                      ['eTIMS pending', String(kpi.etims.pending), `${kpi.etims.issued} issued`],
                      ['M-Pesa', `${kpi.mpesa.today.completed} completed`, `${kpi.mpesa.today.stale} stale · ${kpi.mpesa.today.pending} pending`],
                      ['Rentals', `${kpi.rentals.active} active`, `${kpi.rentals.overdue} overdue`],
                    ].map(([label, value, sub]) => (
                      <div key={label} className="rounded-xl border border-slate-100 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="text-sm font-bold text-slate-800">{value}</p>
                        <p className="text-[10px] text-slate-500">{sub}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <UnavailableCard message={kpiError ?? 'Loading...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />
                )}
              </div>
            </section>
          </SectionErrorBoundary>

          <div id="store-matrix">
            <SectionErrorBoundary sectionName="Store Intelligence Matrix">
              {summary ? <StoreMatrix stores={summary.stores} onToast={onToast} /> : <UnavailableCard message={summaryError ?? 'Loading store matrix...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />}
            </SectionErrorBoundary>
          </div>
          <div id="hr-people">
            <SectionErrorBoundary sectionName="People & payroll by branch">
              {summary?.hrPerStore && summary.hrPerStore.length > 0 ? (
                <HrPerStorePanel rows={summary.hrPerStore} />
              ) : summary && !summaryError ? (
                /* v2.109.0: the summary answered WITHOUT the per-branch block —
                    a precise reason, never a silent hole. The server omits
                    hrPerStore when the HR module is off or the caller lacks
                    the report permission (it fail-closes; the panel never
                    widens it). */
                <HrPerStoreUnavailable
                  code="HR_DATA_SOURCE_UNAVAILABLE"
                  detail="The summary answered without the per-branch HR block — the HR module is off for this organization or this role lacks the HR report permission."
                />
              ) : null}
            </SectionErrorBoundary>
          </div>
          <div id="experts">
            <SectionErrorBoundary sectionName="Domain Expert Modules">
              {kpi ? <ExpertModules data={kpi} /> : <UnavailableCard message={kpiError ?? 'Loading expert modules...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />}
            </SectionErrorBoundary>
          </div>
          <div id="decision">
            <SectionErrorBoundary sectionName="Decision Support">
              {kpi ? <DecisionSupport data={kpi} onToast={onToast} /> : <UnavailableCard message={kpiError ?? 'Loading decision support...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />}
            </SectionErrorBoundary>
          </div>
          <div id="desk-activity">
            <SectionErrorBoundary sectionName="Desk activity">
              {deskActivity ? <DeskActivity data={deskActivity} filter={deskFilter} onFilterChange={setDeskFilter} /> : <UnavailableCard message={deskActivityError ?? 'Loading desk activity...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />}
            </SectionErrorBoundary>
          </div>
          <div id="timeline">
            <SectionErrorBoundary sectionName="Recent Activity Timeline">
              <ActivityTimeline items={kpi?.activity ?? []} />
            </SectionErrorBoundary>
          </div>
          <div id="live-feed">
            <SectionErrorBoundary sectionName="Live Feed">
              <LiveFeed refreshKey={refreshKey} signedIn={signedIn} onRequireSignIn={() => setLoginOpen(true)} />
            </SectionErrorBoundary>
          </div>
        </div>
      </div>

      <ConsoleFooter kpi={kpi} stores={stores} online={online} lastSync={lastSync} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenChangelog={() => setChangelogOpen(true)} />

      {/* Overlays */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} stores={stores}
        onJumpToRelease={(v) => { setReleaseJump(v); setChangelogOpen(true); }}
        actions={[
          { id: 'overview', label: 'Go to overview', run: () => document.getElementById('kpi-row')?.scrollIntoView({ behavior: 'smooth' }) },
          { id: 'experts', label: 'Go to expert modules', run: () => document.getElementById('experts')?.scrollIntoView({ behavior: 'smooth' }) },
          { id: 'chat', label: 'Open global chat', run: () => setChatOpen(true) },
          { id: 'shortcuts', label: 'Show keyboard shortcuts', run: () => setShortcutsOpen(true) },
          { id: 'changelog', label: 'Show changelog', run: () => setChangelogOpen(true) },
          { id: 'login', label: signedIn ? 'Account is signed in' : 'Sign in as administrator', run: () => setLoginOpen(true) },
          { id: 'refresh', label: 'Refresh console data', run: () => { void load(); setRefreshKey((k) => k + 1); onToast('Console data refreshed'); } },
          { id: 'pos', label: 'Open the tabs POS app', hint: '/', run: () => { window.location.href = '/'; } },
        ]} />
      <ChatDrawer open={chatOpen} onOpenChange={setChatOpen} unread={kpi?.system.notificationsUnread ?? 0} signedIn={signedIn} onRequireSignIn={() => setLoginOpen(true)} />
      <ShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ChangelogModal open={changelogOpen} onOpenChange={(o) => { setChangelogOpen(o); if (!o) setReleaseJump(null); }} jumpTo={releaseJump} />
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onToast={onToast} onSignedIn={handleSignedIn} />

      {/* Screen-reader summary */}
      <span className="sr-only" aria-live="polite">
        {loading
          ? 'Mbumah Organization Console is loading.'
          : `Mbumah Organization Console. Health ${kpi?.health.score ?? 'unknown'} of 100. Revenue today ${kes(kpi?.kpis.revenue.today ?? 0)}. Debt ${kes(kpi?.kpis.debt.total ?? 0)}. Last sync ${lastSync === '-' ? 'pending' : timeAgo(new Date().toISOString())}.`}
      </span>
    </UnifiedConsoleShell>
  );
}

function UnavailableCard({ message, onSignIn, showSignIn }: { message: string; onSignIn: () => void; showSignIn: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
      <p className="text-xs font-semibold text-slate-600">{message}</p>
      {showSignIn && (
        <button onClick={onSignIn} className="focus-ring mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-[#12243D] px-4 text-sm font-medium text-white hover:bg-[#0F1E33]">
          Sign in
        </button>
      )}
    </div>
  );
}
