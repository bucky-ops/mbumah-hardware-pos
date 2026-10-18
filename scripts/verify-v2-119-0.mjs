#!/usr/bin/env node
// v2.119.0 verification — "Consent works".
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
check('version: package.json leads 2.119.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.119.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.119.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.119.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-119-0'], 'verify script entry missing');
});

check('whats-new: 2.119.0 leads the feed with the consent story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.119.0'");
  assert(head > -1, 'no 2.119.0 entry');
  assert(head < wn.indexOf("version: '2.118.0'"), '2.119.0 does not lead');
  assert(wn.includes('Consent works'), 'title missing');
});

check('changelog: [2.119.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.119.0]');
  assert(head > -1, 'no [2.119.0] section');
  assert(head < cl.indexOf('## [2.118.0]'), '[2.119.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.118.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the consent ledger (the round's core) ──────────────────────────────────
check('service: the read-back folds ALL records and rides the scope', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  const fn = lib.slice(lib.indexOf('export async function listConsentRecords'), lib.indexOf('async function consentTargetEmployee'));
  assert(fn.includes('employeeScopeWhere(session)'), 'the ledger must ride the employee scope');
  assert(fn.includes('take: 200'), 'the employee cap is missing');
  assert(fn.includes("orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]"), 'stable ordering missing');
  // status folds ALL records (the gate does not filter by purpose)
  assert(fn.includes("active ? 'ACTIVE' : crs.length > 0 ? 'WITHDRAWN' : 'NONE'"), 'the honest fold changed');
  assert(fn.includes('consentRecords:'), 'the batched include is missing');
  const summary = fn.slice(fn.indexOf('summary:'), fn.indexOf(';\n}', fn.indexOf('summary:')));
  for (const k of ['active:', 'withdrawn:', 'none:']) assert(summary.includes(k), `summary missing ${k}`);
});

check('service: grant is append-only and pinned to the payroll vocabulary', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes("PAYROLL_CONSENT_PURPOSE = 'PAYROLL_PROCESSING'"), 'the purpose constant moved');
  assert(lib.includes("PAYROLL_CONSENT_POLICY_VERSION = 'hr-policy-2026-01'"), 'the policy version moved');
  const grant = lib.slice(lib.indexOf('export async function grantConsent'), lib.indexOf('export async function withdrawConsent'));
  assert(grant.includes('consentRecord.create'), 'grant must CREATE a new record');
  assert(!grant.includes('consentRecord.update'), 'grant must never UPDATE (append-only)');
  assert(grant.includes("throw new StageGError('CONSENT_ACTIVE'"), 'the active-consent refusal moved');
  assert(grant.includes("action: 'PRIVACY_CONSENT_GRANTED'"), 'the grant audit moved');
  const withdraw = lib.slice(lib.indexOf('export async function withdrawConsent'));
  assert(withdraw.includes('where: { employeeId: employee.id, withdrawnAt: null }'), 'withdraw must target the ACTIVE records');
  assert(withdraw.includes("throw new StageGError('NO_ACTIVE_CONSENT'"), 'the nothing-active refusal moved');
  assert(withdraw.includes("action: 'PRIVACY_CONSENT_WITHDRAWN'"), 'the withdraw audit moved');
});

check('routes: ledger reads on hr.report.branch; decisions re-check settings.manage', () => {
  const get = read('src/app/api/hr/privacy/consent/route.ts');
  assert(get.includes("hrGuard('hr.report.branch'"), 'the read guard moved');
  assert(get.includes('VIEW_ROLES'), 'the view-role list moved');
  assert(get.includes('canDecideErasure(session.role)'), 'canDecide is not surfaced');
  for (const verb of ['grant', 'withdraw']) {
    const route = read(`src/app/api/hr/privacy/consent/${verb}/route.ts`);
    assert(route.includes("hrGuard('hr.report.branch')"), `${verb}: the base guard moved`);
    assert(route.includes('if (!canDecideErasure(session.role))'), `${verb}: the in-handler decision check moved`);
    assert(route.includes("'DECISION_FORBIDDEN'"), `${verb}: the 403 code moved`);
  }
});

check('page: the Privacy tab wears the consent card with honest manners', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  for (const tid of [
    'hr-privacy-consent',
    'hr-privacy-consent-counts',
    'hr-privacy-consent-none-count',
    'hr-privacy-consent-chip-active',
    'hr-privacy-consent-chip-withdrawn',
    'hr-privacy-consent-chip-none',
    'hr-privacy-consent-withdraw',
    'hr-privacy-consent-grant',
  ]) {
    assert(page.includes(`data-testid="${tid}"`), `${tid} missing`);
  }
  assert(page.includes('MISSING_CONSENT'), 'the payroll-gate hint is missing');
  assert(page.includes('No employees in scope.'), 'the true-empty state is missing');
  assert(page.includes('aria-label="Refresh consent records"'), 'the refresh door is missing');
  // the erasure card coexists beneath
  assert(page.includes('Erasure requests (Data Protection Act posture)'), 'the erasure card disappeared');
  // grant/withdraw ride the decision buttons, scoped per row
  assert(page.includes("aria-label={`Withdraw data-processing consent — ${r.employeeName}`}"), 'the withdraw button lost its name');
  assert(page.includes("aria-label={`Grant data-processing consent — ${r.employeeName}`}"), 'the grant button lost its name');
});

check('page: the counts line tints the blockers honestly', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  const counts = page.slice(page.indexOf('hr-privacy-consent-counts'), page.indexOf('</CardHeader>', page.indexOf('hr-privacy-consent-counts')));
  assert(counts.includes('text-rose-600 dark:text-rose-400'), 'the rose tint is missing');
  assert(counts.includes('0 without consent'), 'zero must stay honest and quiet');
  assert(counts.includes('MISSING_CONSENT'), 'the blocker tooltip is missing');
});

check('gate: the payroll consent read is untouched by this round', () => {
  const svc = codeOf(read('src/lib/hr/payroll/run-service.ts'));
  const gate = svc.slice(svc.indexOf('const consent = await db.consentRecord.findFirst'), svc.indexOf('if (!consent)'));
  assert(gate.includes('withdrawnAt: null'), 'the gate read changed');
  assert(svc.includes("code: 'MISSING_CONSENT'"), 'the MISSING_CONSENT issue moved');
});

check('tests: the v2.119 suite pins the consent loop end to end', () => {
  const t = read('src/tests/data-protection-consent-v2119.test.ts');
  assert(t.includes('EMP-001:ACTIVE') && t.includes('EMP-003:NONE'), 'the fold pins are missing');
  assert(t.includes('CONSENT_ACTIVE') && t.includes('NO_ACTIVE_CONSENT'), 'the 409 refusals must be pinned');
  assert(t.includes('PRIVACY_CONSENT_GRANTED') && t.includes('PRIVACY_CONSENT_WITHDRAWN'), 'the audit actions must be pinned');
  assert(t.includes('consentRecord.update'), 'the withdraw updateMany pin is missing');
  assert(!/grantFn\).toContain\('consentRecord.update'\)/.test(t), 'the append-only pin must assert the NEGATIVE');
});

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
