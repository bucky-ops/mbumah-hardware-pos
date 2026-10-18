#!/usr/bin/env node
// v2.109.0 verification — "People & payroll joins Finance & Insights".
// Written fresh this round (never patch a prior round's copy): every
// check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json stays at-or-above 2.109.0 (all three slots)', () => {
  // v2.114.0 chore re-anchor (the PR #235/#238 precedent): floor holds (never
  // backward), slots must AGREE with each other (no half-bumped trees).
  const pkg = JSON.parse(read('package.json'));
  const atLeast = (v, floor) => {
    const p = v.split('.').map(Number);
    const f = floor.split('.').map(Number);
    return p[0] > f[0] || (p[0] === f[0] && (p[1] > f[1] || (p[1] === f[1] && p[2] >= f[2])));
  };
  assert(atLeast(pkg.version, '2.109.0'), `version=${pkg.version}`);
  assert(atLeast(pkg.mbumah.releaseVersion, '2.109.0'), `release=${pkg.mbumah.releaseVersion}`);
  assert(atLeast(pkg.mbumah.baseVersion, '2.109.0'), `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.version === pkg.mbumah.releaseVersion && pkg.mbumah.releaseVersion === pkg.mbumah.baseVersion, 'slots disagree');
});

check('whats-new: 2.109.0 leads the feed with the panel story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.109.0'");
  assert(head > -1, 'no 2.109.0 entry');
  assert(head < wn.indexOf("version: '2.108.0'"), '2.109.0 does not lead');
  assert(wn.includes('People & payroll joins Finance'), 'title missing');
});

// ── the shared panel ───────────────────────────────────────────────────────
check('panel: the shared component exists with all five metrics', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes('headcountActive'), 'headcount');
  assert(src.includes('kesMoney(row.monthEmploymentCost)'), 'cost');
  assert(src.includes('monthAbsenceRatePct'), 'absence');
  assert(src.includes('latestPayroll'), 'latest run');
  assert(src.includes('expiryAlerts'), 'expiry alerts');
  assert(src.includes('People &amp; payroll by branch ({rows.length})'), 'dynamic count title');
});

check('panel: KES formatting uses en-KE thousands separators', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes("toLocaleString('en-KE'"), 'en-KE formatting');
  assert(src.includes('minimumFractionDigits: 2'), '2dp money');
});

check('panel: reason codes for every gap (no blank, no fake)', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes('PAYROLL_RUN_NOT_AVAILABLE'), 'run gap');
  const tab = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
  assert(tab.includes('PERMISSION_DENIED'), 'permission gap');
  assert(tab.includes('HR_DATA_SOURCE_UNAVAILABLE'), 'data-source gap');
  assert(tab.includes('API_ERROR_SAFE'), 'api gap');
});

check('panel: mobile cards + desktop table, sticky header, scroll bounded', () => {
  const src = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(src.includes('md:hidden'), 'mobile cards branch');
  assert(src.includes('sticky top-0'), 'sticky header');
  assert(src.includes('max-h-96 overflow-y-auto'), 'bounded height');
});

// ── the Finance & Insights tab ─────────────────────────────────────────────
check('tab: registered in all five registries', () => {
  assert(read('src/lib/stores.ts').includes("'people-payroll'"), 'AppTab union');
  assert(read('src/lib/app-config.ts').includes("id: 'people-payroll'"), 'TAB_CONFIG');
  assert(read('src/lib/app-config.ts').includes("'people-payroll'") && read('src/lib/app-config.ts').includes('people-payroll', ), 'NAV_GROUPS via app-config source');
  assert(read('src/lib/tab-preload.ts').includes("'people-payroll'"), 'TAB_LOADERS');
  assert(read('src/components/app/main-app.tsx').includes("case 'people-payroll':"), 'render switch');
  const tab = read('src/app/(shell)/tabs/people-payroll-tab.tsx');
  assert(tab.includes('export default function PeoplePayrollTab'), 'tab file');
});

check('tab: Finance & Insights carries people-payroll right after payroll', () => {
  const src = read('src/lib/app-config.ts');
  const m = src.match(/Finance & Insights', ids: \[([^\]]+)\]/);
  assert(m, 'group line');
  const ids = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert(ids.includes('people-payroll'), 'member');
  assert(ids.indexOf('people-payroll') === ids.indexOf('payroll') + 1, 'position');
});

check('tab: ORG_SUMMARY_ROLES mirrors the server guard trio', () => {
  const src = read('src/lib/app-config.ts');
  assert(src.includes("ORG_SUMMARY_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT']"), 'trio');
});

// ── the Home action ────────────────────────────────────────────────────────
check('home: ConsoleHeader renders it expert-only with the right marks', () => {
  const chrome = read('src/components/org/chrome.tsx');
  assert(chrome.includes('showHome?: boolean'), 'prop');
  assert(chrome.includes('data-testid="console-home-pos"'), 'testid');
  assert(chrome.includes('aria-label="Back to POS"'), 'aria');
  assert(chrome.includes('<Home className="mr-1.5 h-3.5 w-3.5"'), 'Home icon');
});

check('home: goHomeToPos is one internal helper (POS tab + "/", no open redirect)', () => {
  const u = read('src/components/console/unified-console.tsx');
  assert(u.includes("useAppStore.getState().setActiveTab('pos')"), 'tab set');
  assert(u.includes("window.location.assign('/')"), 'internal path');
  assert(!u.includes('URLSearchParams') && !u.includes('searchParams'), 'no redirect surface');
});

// ── navigation order + icons ───────────────────────────────────────────────
check('nav: workspace links moved below the nav (after Admin)', () => {
  const s = read('src/components/layout/app-sidebar.tsx');
  const navIdx = s.indexOf('<nav className={`flex-1 py-2');
  const linksIdx = s.indexOf('<WorkspaceLinks collapsed={collapsed} />');
  assert(navIdx > -1 && linksIdx > navIdx, `nav=${navIdx} links=${linksIdx}`);
});

check('nav: link order Branch Selector, Organization Console, Expert Console, Global Chat', () => {
  const s = read('src/components/layout/app-sidebar.tsx');
  const order = [
    s.indexOf('>Branch Selector</span>'),
    s.indexOf('>Organization Console</span>'),
    s.indexOf('>Expert Console</span>'),
    s.indexOf('>Global Chat</span>'),
  ];
  order.forEach((v, i) => assert(v > -1, `index ${i} missing`));
  assert(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'order broken');
});

check('icons: Building2/Network on the links, ShieldCheck on Admin, Gauge/MessagesSquare kept', () => {
  const s = read('src/components/layout/app-sidebar.tsx');
  assert(s.includes('<Building2 className="h-3.5 w-3.5 shrink-0" />'), 'Building2 expanded');
  assert(s.includes('<Network className="h-3.5 w-3.5 shrink-0" />'), 'Network expanded');
  assert(s.includes('<Building2 className="h-3.5 w-3.5" />'), 'Building2 collapsed');
  assert(s.includes('<Network className="h-3.5 w-3.5" />'), 'Network collapsed');
  assert(!s.includes('<ShieldCheck className="h-3.5'), 'ShieldCheck gone from links');
  assert(s.includes('<Gauge'), 'Gauge kept');
  assert(s.includes('<MessagesSquare'), 'MessagesSquare kept');
  const cfg = read('src/lib/app-config.ts');
  assert(/id: 'admin', label: 'Admin', icon: ShieldCheck/.test(cfg), 'Admin ShieldCheck');
});

check('icons: Global Chat keeps a chat icon; labels carry no "Chatal" typo', () => {
  const s = read('src/components/layout/app-sidebar.tsx');
  const gc = s.indexOf('>Global Chat</span>');
  assert(gc > -1, 'label');
  const icon = s.lastIndexOf('<MessagesSquare', gc);
  assert(icon > -1 && gc - icon < 400, 'chat icon near label');
});

// ── unified console ────────────────────────────────────────────────────────
check('unified: both consoles render through the shared shell', () => {
  assert(read('src/app/(shell)/console/page.tsx').includes('mode="expert"'), 'expert mode');
  assert(read('src/components/workspace/org-console.tsx').includes('mode="organization"'), 'org mode');
  const u = read('src/components/console/unified-console.tsx');
  assert(u.includes('data-console-mode'), 'mode attribute');
  assert(u.includes('Skip to console content'), 'skip link');
});

check('unified: the parity matrix documents every disposition', () => {
  const doc = read('docs/CONSOLE_MERGE_PARITY_MATRIX.md');
  for (const anchor of ['Store Intelligence Matrix', 'Expert diagnostics dialog', 'Home button', 'People & payroll by branch', 'ACCOUNTANT financial read-only']) {
    assert(doc.includes(anchor), `missing: ${anchor}`);
  }
});

// ── docs ───────────────────────────────────────────────────────────────────
check('docs: navigation IA + icon system exist and name the order', () => {
  const nav = read('docs/NAVIGATION_INFORMATION_ARCHITECTURE.md');
  assert(nav.includes('Branch Selector'), 'IA doc');
  assert(nav.includes('Finance & Insights'), 'IA doc group');
  const icons = read('docs/ICON_SYSTEM.md');
  assert(icons.includes('UserCog'), 'icon doc');
  assert(icons.includes('MessagesSquare'), 'chat icon doc');
});

check('tests: the nav test file pins the round', () => {
  const t = read('src/tests/nav-console-v2109.test.ts');
  assert(t.includes('people-payroll'), 'tab pins');
  assert(t.includes('goHomeToPos'), 'home pins');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
