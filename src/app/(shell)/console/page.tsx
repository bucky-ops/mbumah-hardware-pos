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

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, History, Landmark, LayoutDashboard, Menu, PackageSearch, PieChart, Radio, ScrollText, Users, Wallet } from 'lucide-react';
import { ActivityTimeline, ChatDrawer, DecisionSupport, DeskActivity, LiveFeed } from '@/components/org/panels';
import { StoreMatrix } from '@/components/org/store-matrix';
import { ExpertModules } from '@/components/org/experts';
import { KpiRow } from '@/components/org/kpi-row';
import { ChangelogModal, CommandPalette, ConsoleFooter, ConsoleHeader, LoginDialog, ShortcutsModal, type SessionUser } from '@/components/org/chrome';
import { SectionErrorBoundary } from '@/components/error-boundary';
import { KenyaMap, kes, num, timeAgo, type DeskActivityData, type KpiSummaryData, type OrgSummaryData, type StoreRow } from '@/components/org/primitives';
import { authorizedFetchJson } from '@/lib/api';
import { buildStoreWorkspaceUrl } from '@/lib/workspace/links';

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
 * v2.23.0: "People & payroll by branch" drill-down (org console). Reads the
 * additive hrPerStore block of /api/org/summary — the same aggregates as the
 * HR tiles, one row per branch, deep-linked into the per-branch report view.
 * Collapsed by default so the console keeps its expert-system density.
 */
function HrPerStorePanel({ rows }: { rows: NonNullable<OrgSummaryData['hrPerStore']> }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Users className="h-4 w-4 text-orange-500" aria-hidden="true" />
          People &amp; payroll by branch ({rows.length})
          <span className="hidden text-xs font-normal text-slate-400 sm:inline">
            — headcount, cost, absence, latest run, expiry alerts per branch
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="max-h-96 overflow-y-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 text-right font-medium">Headcount</th>
                <th className="px-3 py-2 text-right font-medium">Cost (month)</th>
                <th className="px-3 py-2 text-right font-medium">Absence</th>
                <th className="px-3 py-2 font-medium">Latest payroll</th>
                <th className="px-4 py-2 text-right font-medium">Expiry alerts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const alerts = row.expiryAlerts.documentsExpiring90Days + row.expiryAlerts.assetsOverdue;
                return (
                  <tr key={row.storeId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-orange-50/40">
                    <td className="px-4 py-2">
                      <a
                        href={`/hr/reports?tab=headcount&storeId=${row.storeId}`}
                        title={`Open the headcount report narrowed to ${row.storeName}`}
                        className="font-medium text-slate-700 underline-offset-2 hover:text-orange-600 hover:underline"
                      >
                        {row.storeName}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.headcountActive}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{kes(row.monthEmploymentCost)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.monthAbsenceRatePct >= 10 ? 'font-semibold text-amber-600' : 'text-slate-700'}`}>
                      {row.monthAbsenceRatePct}%
                    </td>
                    <td className="px-3 py-2">
                      {row.latestPayroll ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">{row.latestPayroll.periodName}</span>
                          <span
                            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                              row.latestPayroll.status === 'LOCKED' || row.latestPayroll.status === 'POSTED'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : row.latestPayroll.status === 'VOIDED'
                                  ? 'border-slate-200 bg-slate-50 text-slate-500'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}
                          >
                            {row.latestPayroll.status.toLowerCase()}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">no runs yet</span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums ${alerts > 0 ? 'font-semibold text-amber-600' : 'text-slate-700'}`}>
                      {alerts}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default function OrgConsolePage() {
  const [summary, setSummary] = useState<OrgSummaryData | null>(null);
  const [kpi, setKpi] = useState<KpiSummaryData | null>(null);
  // v2.64.0: the desk-activity audit panel (GET /api/org/review-activity).
  const [deskActivity, setDeskActivity] = useState<DeskActivityData | null>(null);
  const [deskActivityError, setDeskActivityError] = useState<string | null>(null);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState('-');
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

  const onToast = useCallback((msg: string) => toast(msg), []);

  // ── Data fetch + 30s poll ────────────────────────────────────────────────
  const load = useCallback(async () => {
    const [summaryRes, kpiRes, deskRes] = await Promise.all([
      authorizedFetchJson('/api/org/summary'),
      authorizedFetchJson('/api/org/kpi-summary'),
      authorizedFetchJson('/api/org/review-activity'),
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
  }, []);

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
    <div className="mbumah-console flex min-h-screen flex-col bg-slate-100">
      <ConsoleHeader
        kpi={kpi} stores={stores} online={online} session={session} signedIn={signedIn} onToast={onToast}
        onOpenPalette={() => setPaletteOpen(true)} onOpenChat={() => setChatOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)} onOpenLogin={() => setLoginOpen(true)}
        onOpenNotifications={() => onToast(`${kpi?.system.notificationsUnread ?? 0} unread notifications - read them in the workspace notification center`)}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 py-4 lg:px-5">
        {/* Autohide nav rail */}
        <nav
          aria-label="Console sections"
          className={`no-print sticky top-20 hidden h-fit flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-all duration-300 md:flex ${railExpanded ? 'w-[210px]' : 'w-16 items-center'}`}
        >
          <button onClick={() => setRailPinned((p) => !p)} className="focus-ring mb-1 flex h-8 w-full items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50" aria-label={railPinned ? 'Unpin navigation' : 'Pin navigation'}>
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
              <p className="text-[10px] leading-snug text-slate-400">Org roles only · every endpoint re-verifies the session server-side</p>
            </div>
          )}
        </nav>

        {/* Main column */}
        <main className="flex min-w-0 flex-1 flex-col gap-4">
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
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${s.status === 'ACTIVE' ? 'border-emerald-200 text-emerald-600' : 'border-slate-200 text-slate-400'}`}>{s.status}</span>
                </div>
                <p className="mt-1.5 truncate text-[12px] font-semibold text-slate-800">{s.name}</p>
                <p className="text-[10px] text-slate-400">{kes(s.todayRevenue)} · {s.todayTransactions} txns</p>
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
              {kpi ? <KpiRow data={kpi} /> : <UnavailableCard message={kpiError ?? 'Loading organization KPIs...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />}
            </SectionErrorBoundary>
          </div>

          <SectionErrorBoundary sectionName="Overview">
            <section aria-label="Overview" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-1 text-sm font-semibold text-slate-800">Health - {kpi?.health.label ?? 'unknown'}</h2>
                <p className="mb-2 text-[11px] text-slate-400">Composite: revenue attainment, stock, debt and engagement</p>
                {stores.length > 0 ? <KenyaMap stores={stores} /> : <p className="p-6 text-center text-xs text-slate-400">Store map needs /api/org/summary access.</p>}
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
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                        <p className="text-sm font-bold text-slate-800">{value}</p>
                        <p className="text-[10px] text-slate-400">{sub}</p>
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
              {deskActivity ? <DeskActivity data={deskActivity} /> : <UnavailableCard message={deskActivityError ?? 'Loading desk activity...'} onSignIn={() => setLoginOpen(true)} showSignIn={needsAuth && !signedIn} />}
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
        </main>
      </div>

      <ConsoleFooter kpi={kpi} stores={stores} online={online} lastSync={lastSync} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenChangelog={() => setChangelogOpen(true)} />

      {/* Overlays */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} stores={stores}
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
      <ChangelogModal open={changelogOpen} onOpenChange={setChangelogOpen} />
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onToast={onToast} onSignedIn={handleSignedIn} />

      {/* Screen-reader summary */}
      <span className="sr-only" aria-live="polite">
        {loading
          ? 'Mbumah Organization Console is loading.'
          : `Mbumah Organization Console. Health ${kpi?.health.score ?? 'unknown'} of 100. Revenue today ${kes(kpi?.kpis.revenue.today ?? 0)}. Debt ${kes(kpi?.kpis.debt.total ?? 0)}. Last sync ${lastSync === '-' ? 'pending' : timeAgo(new Date().toISOString())}.`}
      </span>
    </div>
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
