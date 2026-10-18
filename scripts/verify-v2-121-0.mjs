#!/usr/bin/env node
// v2.121.0 verification — "the roster reads the room".
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
// structural search: the contract's own comment may name the forbidden word
const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.121.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.121.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.121.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.121.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-121-0'], 'verify script entry missing');
});

check('whats-new: 2.121.0 leads the feed with the roster story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.121.0'");
  assert(head > -1, 'no 2.121.0 entry');
  assert(head < wn.indexOf("version: '2.120.0'"), '2.121.0 does not lead');
  assert(wn.includes('The roster reads the room'), 'title missing');
});

check('changelog: [2.121.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.121.0]');
  assert(head > -1, 'no [2.121.0] section');
  assert(head < cl.indexOf('## [2.120.0]'), '[2.121.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.120.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the overlay (the round's core) ─────────────────────────────────────────
check('page: the overlay reads the SAME ledger the Privacy tab reads', () => {
  const page = codeOf(read('src/app/(shell)/hr/employees/page.tsx'));
  assert(page.includes("fetch('/api/hr/privacy/consent', { credentials: 'include' })"), 'the ledger fetch moved');
  assert(
    page.includes('!res.ok || !json.success || !json.data || !Array.isArray(json.data.records)'),
    'the strict success gate moved',
  );
  // strict status mapping — an invented status never renders
  assert(page.includes("r.status === 'ACTIVE' || r.status === 'WITHDRAWN' || r.status === 'NONE'"), 'status whitelist moved');
  assert(page.includes('if (!chip) return null;'), 'the chip look-alike guard moved');
});

check('page: absence of the view is never rendered as absence of consent', () => {
  const page = codeOf(read('src/app/(shell)/hr/employees/page.tsx'));
  assert(page.includes('setConsentLedger(null)'), 'the null degradation moved');
  assert(page.includes("Outside the consent view's first 200 in scope"), 'the dash tooltip moved');
  // the column is conditional on the loaded ledger, not hardcoded
  const th = page.slice(page.indexOf('<TableHead>Status</TableHead>'), page.indexOf('<TableHead>Hired</TableHead>'));
  assert(th.includes('{consentLedger && ('), 'the column must be conditional');
  assert(th.includes('data-testid="hr-employees-consent-col"'), 'the column lost its name');
});

check('page: the chips carry the card vocabulary — tones, labels, MISSING_CONSENT truths', () => {
  const page = read('src/app/(shell)/hr/employees/page.tsx');
  for (const tid of ['hr-employees-consent-chip']) {
    assert(page.includes(`data-testid="${tid}"`), `${tid} missing`);
  }
  for (const tone of ['emerald-200 bg-emerald-50', 'amber-200 bg-amber-50', 'slate-200 bg-slate-100']) {
    assert(page.includes(tone), `tone ${tone} moved`);
  }
  const chipBlock = page.slice(page.indexOf('const CONSENT_CHIP'), page.indexOf('function ConsentChip'));
  assert(chipBlock.includes("label: 'Active'"), 'Active label moved');
  assert(chipBlock.includes("label: 'Withdrawn'"), 'Withdrawn label moved');
  assert(chipBlock.includes("label: 'None on file'"), 'None on file label moved');
  assert((chipBlock.match(/MISSING_CONSENT/g) ?? []).length >= 2, 'the MISSING_CONSENT truths thinned');
  assert(chipBlock.includes('Privacy tab'), 'the pointer to the authoritative surface moved');
});

check('page: the counts strip wears the card sentence with the rose tint', () => {
  const page = codeOf(read('src/app/(shell)/hr/employees/page.tsx'));
  assert(page.includes('data-testid="hr-employees-consent-counts"'), 'the counts strip lost its name');
  assert(page.includes('{consentLedger.summary.active} active'), 'the active count moved');
  assert(page.includes('{consentLedger.summary.none} without consent'), 'the without-consent count moved');
  assert(page.includes("summary.none > 0") || page.includes('summary.none > 0'), 'the rose gate moved');
  assert(page.includes('text-rose-600 dark:text-rose-400'), 'the rose tint moved');
  assert(page.includes('Across the whole consent view — not the filtered list'), 'the honesty tooltip moved');
});

check('page: the fetch rides its own cleaned-up effect keyed to the list refresh', () => {
  const page = codeOf(read('src/app/(shell)/hr/employees/page.tsx'));
  assert(page.includes('let alive = true;'), 'the cleanup guard moved');
  assert(page.includes('alive = false;'), 'the cleanup assignment moved');
  assert(page.includes('}, [reloadKey]);'), 'the effect must refresh with the list');
});

check('guard: the ledger route itself is untouched by this round', () => {
  const route = codeOf(read('src/app/api/hr/privacy/consent/route.ts'));
  assert(route.includes("hrGuard('hr.report.branch'"), 'the read guard moved');
  assert(route.includes("const VIEW_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER']"), 'the view roles moved');
  assert(route.includes('canDecide: canDecideErasure(session.role)'), 'canDecide surfacing moved');
});

check('lib: the payroll gate read stays withdrawnAt: null (untouched)', () => {
  const lib = codeOf(read('src/lib/hr/data-protection.ts'));
  assert(lib.includes("purpose: PAYROLL_CONSENT_PURPOSE = 'PAYROLL_PROCESSING'") || lib.includes("PAYROLL_CONSENT_PURPOSE = 'PAYROLL_PROCESSING'"), 'the purpose constant moved');
  assert(lib.includes("PAYROLL_CONSENT_POLICY_VERSION = 'hr-policy-2026-01'"), 'the policy version moved');
  assert(lib.includes("active ? 'ACTIVE' : crs.length > 0 ? 'WITHDRAWN' : 'NONE'"), 'the honest fold changed');
});

check('tests: the v2.121 suite pins the overlay end to end', () => {
  const t = read('src/tests/employees-consent-chips-v2121.test.ts');
  assert(t.includes('absence of the view is never rendered as absence of consent'), 'the honesty pin is missing');
  assert(t.includes("r.status === 'ACTIVE' || r.status === 'WITHDRAWN' || r.status === 'NONE'"), 'the status whitelist pin is missing');
  assert(t.includes('text-rose-600 dark:text-rose-400'), 'the rose tint pin is missing');
});

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
