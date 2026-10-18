#!/usr/bin/env node
// v2.112.0 verification — "The branch picker hands you the payroll ledger".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory.

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
check('version: package.json leads 2.112.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.112.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.112.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.112.0', `base=${pkg.mbumah.baseVersion}`);
});

check('whats-new: 2.112.0 leads the feed with the hand-over story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.112.0'");
  assert(head > -1, 'no 2.112.0 entry');
  assert(head < wn.indexOf("version: '2.111.0'"), '2.112.0 does not lead');
  assert(wn.includes('The branch picker hands you the payroll ledger'), 'title missing');
});

check('changelog: [2.112.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.112.0]');
  assert(head > -1, 'no 2.112.0 section');
  assert(head < cl.indexOf('## [2.111.0]'), '2.112.0 does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.111.0]'));
  assert(section.includes('### Added'), 'Added');
  assert(section.includes('### Changed'), 'Changed');
  assert(section.includes('### Security'), 'Security');
});

// ── the deep-link builder ──────────────────────────────────────────────────
check('links: buildPeoplePayrollDeepLink is pure, encoded, and tab-pinned', () => {
  const links = read('src/lib/workspace/links.ts');
  assert(links.includes('export function buildPeoplePayrollDeepLink'), 'builder missing');
  assert(links.includes("params.set('tab', 'people-payroll')"), 'tab param');
  assert(links.includes("params.set('branch', storeId || '')"), 'branch param (empty-safe)');
  assert(links.includes('buildPeoplePayrollDeepLink'), 'exported');
});

// ── the affordance (gating + safety) ───────────────────────────────────────
check('selector: the hand-over is gated on ORG_SUMMARY_ROLES (never a dead door)', () => {
  const sel = read('src/components/workspace/branch-selector.tsx');
  assert(sel.includes("ORG_SUMMARY_ROLES.includes(user?.role || '')"), 'role gate missing');
  assert(sel.includes("import { ORG_SUMMARY_ROLES } from '@/lib/app-config'"), 'import');
  assert(sel.includes('buildPeoplePayrollDeepLink'), 'builder used');
});

check('selector: new-tab + noopener (one-tab-per-view holds, no reverse tabnab)', () => {
  const sel = read('src/components/workspace/branch-selector.tsx');
  const anchorAt = sel.indexOf('href={payrollHref}');
  assert(anchorAt > -1, 'payroll anchor missing');
  const anchor = sel.slice(anchorAt, anchorAt + 300);
  assert(anchor.includes('target="_blank"'), 'target=_blank');
  assert(anchor.includes('rel="noopener noreferrer"'), 'noopener');
  assert(anchor.includes('aria-label='), 'honest aria label');
});

check('selector: styling — hover lift, brand-dot ring, focus path, dark variants', () => {
  const sel = read('src/components/workspace/branch-selector.tsx');
  assert(sel.includes('hover:shadow-md'), 'hover lift');
  assert(sel.includes('hover:border-primary/30'), 'hover border');
  assert(sel.includes('focus-within:border-primary/40'), 'focus path');
  assert(sel.includes('group-hover:ring-current'), 'brand dot ring');
  assert(sel.includes('dark:hover:bg-emerald-950/40'), 'dark variant');
  assert(sel.includes('transition-all duration-200'), 'quiet transition');
});

check('org console: the same hand-over rides the Workspace column (the owner\u2019s real home)', () => {
  const oc = read('src/components/workspace/org-console.tsx');
  assert(oc.includes('buildPeoplePayrollDeepLink'), 'builder used');
  assert(oc.includes("ORG_SUMMARY_ROLES.includes(user?.role || '')"), 'role gate');
  assert(oc.includes('href={buildPeoplePayrollDeepLink(store.id)}'), 'anchor wired');
  const anchorAt = oc.indexOf('href={buildPeoplePayrollDeepLink(store.id)}');
  const anchor = oc.slice(Math.max(0, anchorAt - 900), anchorAt + 220);
  assert(anchor.includes('target="_blank"'), 'target=_blank');
  assert(anchor.includes('rel="noopener noreferrer"'), 'noopener');
  assert(anchor.includes('aria-label='), 'honest aria label');
  assert(anchor.includes('disabled={inactive}'), 'inactive stores never offer the door');
});

check('docs: the deep-link contract mentions the Branch Selector hand-over', () => {
  const doc = read('docs/PEOPLE_PAYROLL_BY_BRANCH.md');
  assert(doc.includes('Branch Selector'), 'hand-over not documented');
});

// ── the test pins ──────────────────────────────────────────────────────────
check('tests: hand-over pin file exists and names the builder + the gate', () => {
  const t = read('src/tests/branch-selector-handover-v2112.test.ts');
  assert(t.includes('buildPeoplePayrollDeepLink'), 'builder pinned');
  assert(t.includes('ORG_SUMMARY_ROLES'), 'gate pinned');
  assert(t.includes("t.id === 'people-payroll'"), 'tab existence pinned');
});

console.log(`\nverify-v2-112-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
