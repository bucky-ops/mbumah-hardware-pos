// v2.109.0: the navigation/console round —
//   - the People & payroll by branch panel is the SHARED component and lives
//     under Finance & Insights (a real tab, typed end to end),
//   - the Expert Console carries the Home action back to POS,
//   - Branch Selector / Organization Console / Expert Console / Global Chat
//     follow the Admin module in that exact order with their own icons,
//   - both console routes render through the unified shell,
//   - every navigation item has an icon (the type already demands it; these
//     tests pin the mapping the docs promise).
// Every pin reads the SOURCE OF RECORD (source bytes, not memory) — the
// house rule since the verify scripts were born.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { TAB_CONFIG, NAV_GROUPS, ORG_SUMMARY_ROLES } from '@/lib/app-config';
import { TAB_LOADERS } from '@/lib/tab-preload';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('v2.109.0 — the People & Payroll tab registers everywhere', () => {
  it('AppTab gains people-payroll: TAB_CONFIG, TAB_LOADERS and the union all agree', () => {
    const cfg = TAB_CONFIG.find((t) => t.id === 'people-payroll');
    expect(cfg).toBeDefined();
    expect(cfg?.label).toBe('People & Payroll');
    expect(cfg?.icon).toBeDefined(); // the icon is REQUIRED, never undefined
    expect(TAB_LOADERS['people-payroll']).toBeDefined();
    // The loader points at the real tab file.
    const loaderSrc = read('src/lib/tab-preload.ts');
    expect(loaderSrc.includes("'people-payroll': () => import('../app/(shell)/tabs/people-payroll-tab')")).toBe(true);
    // The tab file exists and default-exports the component.
    const tabSrc = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
    expect(tabSrc.includes('export default function PeoplePayrollTab')).toBe(true);
  });

  it('the tab sits in the Finance & Insights group, right after payroll', () => {
    const fin = NAV_GROUPS.find((g) => g.label === 'Finance & Insights');
    expect(fin).toBeDefined();
    const ids = fin?.ids ?? [];
    expect(ids).toContain('people-payroll');
    expect(ids.indexOf('people-payroll')).toBe(ids.indexOf('payroll') + 1);
  });

  it('the tab is offered to exactly the roles the org-summary guard serves', () => {
    expect(ORG_SUMMARY_ROLES).toEqual(['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT']);
    expect(TAB_CONFIG.find((t) => t.id === 'people-payroll')?.roles).toEqual(ORG_SUMMARY_ROLES);
  });

  it('the main-app switch renders the tab behind an error boundary', () => {
    const app = read('src/components/app/main-app.tsx');
    expect(app.includes(`case 'people-payroll':`)).toBe(true);
    expect(app.includes('LazyPeoplePayrollTab')).toBe(true);
    expect(app.includes('sectionName="People & Payroll"')).toBe(true);
  });

  it('the tab renders the SHARED panel with real-data guards, never fake numbers', () => {
    const tabSrc = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
    expect(tabSrc.includes('PeoplePayrollByBranch')).toBe(true);
    expect(tabSrc.includes('PERMISSION_DENIED')).toBe(true);
    expect(tabSrc.includes('HR_DATA_SOURCE_UNAVAILABLE')).toBe(true);
    expect(tabSrc.includes('API_ERROR_SAFE')).toBe(true);
    // It reads the org summary endpoint (the console's own truth).
    expect(tabSrc.includes("authorizedFetchJson('/api/org/summary')")).toBe(true);
  });
});

describe('v2.109.0 — the shared panel (people-payroll-by-branch.tsx)', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');

  it('titles the panel exactly and counts branches dynamically', () => {
    expect(src.includes('People &amp; payroll by branch ({rows.length})')).toBe(true);
    expect(src.includes('headcount, cost, absence, latest run, expiry alerts per branch')).toBe(true);
  });

  it('serves every required metric per branch', () => {
    expect(src.includes('row.headcountActive')).toBe(true);
    expect(src.includes('kesMoney(row.monthEmploymentCost)')).toBe(true);
    expect(src.includes('{row.monthAbsenceRatePct}%')).toBe(true);
    // v2.113.0 re-anchor: the cells gained the storeName prop (the doors'
    // aria labels name the branch) — table AND mobile card both pass it.
    expect(src.includes('<LatestRunCell run={row.latestPayroll} storeName={row.storeName} />')).toBe(true);
    expect(src.includes('<ExpiryCell row={row} />')).toBe(true);
  });

  it('never renders a blank or fake gap: reasons ride titles, money is KES with separators', () => {
    expect(src.includes('title="PAYROLL_RUN_NOT_AVAILABLE"')).toBe(true);
    expect(src.includes("toLocaleString('en-KE'")).toBe(true);
    expect(src.includes('no runs yet')).toBe(true);
  });

  it('renders both layouts: dense table (desktop) and cards (mobile), no horizontal scroll', () => {
    expect(src.includes('people-payroll-table-wrap') || src.includes('{testIdPrefix}-table-wrap')).toBe(true);
    expect(src.includes('md:hidden')).toBe(true);
    expect(src.includes('overflow-y-auto')).toBe(true);
  });

  it('the console page consumes the shared component (no duplicated table)', () => {
    const page = read('src/app/(shell)/console/page.tsx');
    expect(page.includes("from '@/components/finance/people-payroll-by-branch'")).toBe(true);
    expect(page.includes('const HrPerStorePanel = PeoplePayrollByBranch')).toBe(true);
    // The old inline table is gone (its unique header cell no longer exists
    // in the page source).
    expect(page.includes('<th className="px-4 py-2 font-medium">Branch</th>')).toBe(false);
    // A summary without the HR block explains itself instead of vanishing.
    expect(page.includes('HR_DATA_SOURCE_UNAVAILABLE')).toBe(true);
  });
});

describe('v2.109.0 — the Expert Console Home action', () => {
  it('ConsoleHeader renders the Home button only when asked, with the accessible name', () => {
    const chrome = read('src/components/org/chrome.tsx');
    expect(chrome.includes('showHome?: boolean')).toBe(true);
    expect(chrome.includes('data-testid="console-home-pos"')).toBe(true);
    expect(chrome.includes('aria-label="Back to POS"')).toBe(true);
    expect(chrome.includes('<Home className="mr-1.5 h-3.5 w-3.5"')).toBe(true);
    expect(chrome.includes('onClick={goHomeToPos}')).toBe(true);
  });

  it('goHomeToPos is ONE internal helper: sets the POS tab, assigns "/" — never a URL from outside', () => {
    const unified = read('src/components/console/unified-console.tsx');
    expect(unified.includes("useAppStore.getState().setActiveTab('pos')")).toBe(true);
    expect(unified.includes("window.location.assign('/')")).toBe(true);
    // No query-param redirect surface exists in the helper.
    expect(unified.includes('searchParams')).toBe(false);
    expect(unified.includes('URLSearchParams')).toBe(false);
  });

  it('the expert console passes showHome; the org console keeps its own header', () => {
    const page = read('src/app/(shell)/console/page.tsx');
    expect(page.includes('showHome')).toBe(true);
    expect(page.includes('mode="expert"')).toBe(true);
    const org = read('src/components/workspace/org-console.tsx');
    expect(org.includes('mode="organization"')).toBe(true);
  });
});

describe('v2.109.0 — navigation order and icons', () => {
  it('Admin wears ShieldCheck (the icon system\u2019s admin mark)', () => {
    const admin = TAB_CONFIG.find((t) => t.id === 'admin');
    expect(admin?.label).toBe('Admin');
    // Lucide icons are ForwardRef components: the name rides displayName /
    // render.name, not Function.name.
    const icon = admin?.icon as { displayName?: string; render?: { name?: string } } | undefined;
    expect(icon?.displayName ?? icon?.render?.name).toBe('ShieldCheck');
  });

  it('the workspace links follow Admin, in the exact requested order, with their icons', () => {
    // Compliance & System is the LAST group. v2.208.0 routed the Phase-8
    // System Health desk as the group's final item (ADMIN_ROLES cluster:
    // security, admin, then the admin ops desk that watches them).
    const last = NAV_GROUPS[NAV_GROUPS.length - 1];
    expect(last.label).toBe('Compliance & System');
    expect(last.ids.slice(-2)).toEqual(['admin', 'system-health']);
    // The sidebar renders WorkspaceLinks AFTER the nav (the only
    // WorkspaceLinks render site in the sidebar source).
    const sidebar = read('src/components/layout/app-sidebar.tsx');
    const navIdx = sidebar.indexOf('<nav className={`flex-1 py-2');
    const linksIdx = sidebar.indexOf('<WorkspaceLinks collapsed={collapsed} />');
    expect(navIdx).toBeGreaterThan(-1);
    expect(linksIdx).toBeGreaterThan(navIdx);
    // In-order labels inside WorkspaceLinks: Branch Selector, Organization
    // Console, Expert Console, Global Chat.
    const bs = sidebar.indexOf('>Branch Selector</span>');
    const oc = sidebar.indexOf('>Organization Console</span>');
    const ec = sidebar.indexOf('>Expert Console</span>');
    const gc = sidebar.indexOf('>Global Chat</span>');
    expect(bs).toBeGreaterThan(-1);
    expect(oc).toBeGreaterThan(bs);
    expect(ec).toBeGreaterThan(oc);
    expect(gc).toBeGreaterThan(ec);
  });

  it('the workspace links wear the documented icons in BOTH modes', () => {
    const sidebar = read('src/components/layout/app-sidebar.tsx');
    // Building2 for Branch Selector (collapsed + expanded), Network for
    // Organization Console, Gauge for Expert Console, MessagesSquare for
    // Global Chat.
    expect(sidebar.includes('<Building2 className="h-3.5 w-3.5" />')).toBe(true);
    expect(sidebar.includes('<Network className="h-3.5 w-3.5" />')).toBe(true);
    expect(sidebar.includes('<Building2 className="h-3.5 w-3.5 shrink-0" />')).toBe(true);
    expect(sidebar.includes('<Network className="h-3.5 w-3.5 shrink-0" />')).toBe(true);
    expect(sidebar.includes('<Gauge className="h-3.5 w-3.5 shrink-0" />')).toBe(true);
    expect(sidebar.includes('<MessagesSquare className="h-3.5 w-3.5 shrink-0" />')).toBe(true);
    // The old marks are gone from the links (ChevronsRight survives only in
    // the unrelated peek handle; ShieldCheck survives only in TAB_CONFIG).
    expect(sidebar.includes('<ChevronsRight className="h-3.5 w-3.5')).toBe(false);
    expect(sidebar.includes('<ShieldCheck className="h-3.5')).toBe(false);
  });

  it('every TAB_CONFIG entry carries a real icon component (type-enforced, pinned here)', () => {
    for (const tab of TAB_CONFIG) {
      const icon = tab.icon as { displayName?: string; render?: { name?: string } } | undefined;
      expect(icon, `tab ${tab.id} has no icon`).toBeDefined();
      const name = icon?.displayName ?? icon?.render?.name;
      expect(typeof name).toBe('string');
      expect((name ?? '').length).toBeGreaterThan(0);
    }
    // No duplicate ids, no duplicate labels (aliases would be documented).
    const ids = TAB_CONFIG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = TAB_CONFIG.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('both console routes render the shared shell with their mode', () => {
    const page = read('src/app/(shell)/console/page.tsx');
    const org = read('src/components/workspace/org-console.tsx');
    expect(page.includes('<UnifiedConsoleShell')).toBe(true);
    expect(org.includes('<UnifiedConsoleShell')).toBe(true);
  });

  it('the parity matrix and navigation/icon docs exist', () => {
    expect(read('docs/CONSOLE_MERGE_PARITY_MATRIX.md').length).toBeGreaterThan(200);
    expect(read('docs/NAVIGATION_INFORMATION_ARCHITECTURE.md').length).toBeGreaterThan(200);
    expect(read('docs/ICON_SYSTEM.md').length).toBeGreaterThan(200);
  });
});
