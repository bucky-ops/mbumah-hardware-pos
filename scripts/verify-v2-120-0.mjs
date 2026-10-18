#!/usr/bin/env node
// v2.120.0 verification — "the roster captures its consent".
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
check('version: package.json leads 2.120.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.120.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.120.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.120.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-120-0'], 'verify script entry missing');
});

check('whats-new: 2.120.0 leads the feed with the onboarding story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.120.0'");
  assert(head > -1, 'no 2.120.0 entry');
  assert(head < wn.indexOf("version: '2.119.0'"), '2.120.0 does not lead');
  assert(wn.includes('The roster captures its consent'), 'title missing');
});

check('changelog: [2.120.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.120.0]');
  assert(head > -1, 'no [2.120.0] section');
  assert(head < cl.indexOf('## [2.119.0]'), '[2.120.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.119.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the onboarding route (the round's core) ────────────────────────────────
check('route: the POST files consent through the audited lib path, never re-declared', () => {
  const route = codeOf(read('src/app/api/hr/employees/route.ts'));
  assert(route.includes("grantConsent } from '@/lib/hr/data-protection'"), 'grantConsent import moved');
  assert(route.includes('await grantConsent({ employeeId: result.id }, session)'), 'the grant call moved');
  // one source of truth for the vocabulary — the route must not re-declare it
  assert(!route.includes('PAYROLL_PROCESSING'), 'purpose literal leaked into the route');
  assert(!route.includes('hr-policy-2026-01'), 'policy literal leaked into the route');
  assert(route.includes('PRIVACY_CONSENT_GRANTED') === false, 'audit action must live in the lib, not the route');
});

check('route: withdrawal is never reachable from onboarding', () => {
  const route = codeOf(read('src/app/api/hr/employees/route.ts'));
  assert(!route.includes('withdrawConsent'), 'withdrawConsent must not be imported or called here');
});

check('route: a consent glitch never loses the hire — 201 with an honest outcome', () => {
  const route = codeOf(read('src/app/api/hr/employees/route.ts'));
  assert(route.includes('body.consentPayrollProcessing === true'), 'the strict boolean gate moved');
  assert(route.includes("'CONSENT_GRANT_FAILED'"), 'the fallback reason moved');
  assert(route.includes('error instanceof StageGError ? error.code'), 'the reason passthrough moved');
  assert(
    route.includes('data: result.employee, id: result.id, consent }, { status: 201 }'),
    'the 201 must carry the consent outcome',
  );
});

check('route: the GET answers "may this role onboard?" with the SAME key the POST pins', () => {
  const route = codeOf(read('src/app/api/hr/employees/route.ts'));
  assert(route.includes("canCreate: hasHrPermission(session.role, 'hr.employee.create')"), 'canCreate moved');
  assert(route.includes("hrGuard('hr.employee.create'"), 'the POST guard key moved');
});

// ── the dialog + the pure interpreter ──────────────────────────────────────
check('page: the onboarding dialog exists with honest manners', () => {
  const page = read('src/app/(shell)/hr/employees/page.tsx');
  for (const tid of [
    'hr-employees-onboard-open',
    'hr-employees-onboard-dialog',
    'hr-employees-onboard-first',
    'hr-employees-onboard-last',
    'hr-employees-onboard-type',
    'hr-employees-onboard-consent-checkbox',
    'hr-employees-onboard-consent-outcome',
    'hr-employees-onboard-submit',
  ]) {
    assert(page.includes(`data-testid="${tid}"`), `${tid} missing`);
  }
  assert(page.includes("aria-label=\"File the employee's signed payroll-processing consent\""), 'the checkbox lost its name');
  assert(page.includes('The employee signed the payroll consent form during hiring'), 'the honest sentence moved');
  assert(page.includes('MISSING_CONSENT'), 'the run-truth hint moved');
});

check('page: schema vocabulary + the pure interpreter wiring', () => {
  const page = codeOf(read('src/app/(shell)/hr/employees/page.tsx'));
  assert(page.includes("['PERMANENT', 'CONTRACT', 'CASUAL', 'PROBATION', 'INTERN']"), 'employment types invented');
  assert(page.includes("describeOnboardConsent(obResult.consent)"), 'the outcome interpreter is not wired');
  assert(page.includes('ONBOARD_CONSENT_TONE_CLASSES[outcome.tone]'), 'the tone map is not wired');
  assert(page.includes('{canCreate && ('), 'the door is not gated by the server answer');
  assert(page.includes('setCanCreate(json.canCreate === true)'), 'canCreate must be a strict boolean read');
});

check('lib: the outcome interpreter degrades honestly', () => {
  const lib = read('src/lib/hr/onboard-consent.ts');
  assert(lib.includes('export function describeOnboardConsent'), 'the pure export moved');
  assert(lib.includes("'Consent captured'") && lib.includes("'No consent on file'") && lib.includes("'Consent not captured'"), 'the three sentences moved');
  assert(lib.includes('MISSING_CONSENT'), 'the amber truth moved');
  assert(lib.includes("REASON_UNKNOWN = 'UNKNOWN'"), 'the garbage degradation moved');
  for (const tone of ['emerald', 'amber', 'rose']) {
    assert(lib.includes(`${tone}:`), `the ${tone} tone classes moved`);
  }
});

check('tests: the v2.120 suite pins the onboarding consent end to end', () => {
  const t = read('src/tests/onboarding-consent-v2120.test.ts');
  assert(t.includes('NOT_REQUESTED') && t.includes('CONSENT_GRANT_FAILED'), 'the outcome reasons must be pinned');
  assert(t.includes("routeCode.includes('withdrawConsent')).toBe(false)"), 'the withdrawal-exclusion pin must assert the NEGATIVE');
  assert(t.includes("routeCode.includes('PAYROLL_PROCESSING')).toBe(false)"), 'the vocabulary-exclusion pin must assert the NEGATIVE');
  assert(t.includes('hr.employee.create'), 'the canCreate/guard key pin is missing');
});

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
