#!/usr/bin/env node
// v2.122.0 verification — "the hold takes the desk".
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
check('version: package.json leads 2.122.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.122.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.122.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.122.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-122-0'], 'verify script entry missing');
});

check('whats-new: 2.122.0 leads the feed with the hold story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.122.0'");
  assert(head > -1, 'no 2.122.0 entry');
  assert(head < wn.indexOf("version: '2.121.0'"), '2.122.0 does not lead');
  assert(wn.includes('The hold takes the desk'), 'title missing');
  assert(wn.includes('Sweeping nightly'), 'chip vocabulary missing from bullets');
});

check('changelog: [2.122.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.122.0]');
  assert(head > -1, 'no [2.122.0] section');
  assert(head < cl.indexOf('## [2.121.0]'), '[2.122.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.121.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the service (the fold + the decisions) ─────────────────────────────────
check('lib: the fold rides the SAME reader the sweep obeys', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes("startsWith: 'legalHold:'"), 'the hold prefix moved');
  assert(lib.includes(".filter((s) => s.value === 'true')"), "getLegalHolds no longer reads value === 'true'");
  assert(lib.includes('export async function listRetentionPolicies'), 'the desk read missing');
  assert(lib.includes('windowLabel: describeRetentionWindow(p)'), 'windowLabel not carried on the view');
  assert(lib.includes('canDecide: canDecideErasure(session.role)'), 'canDecide does not mirror the erasure gate');
});

check('lib: hold writes value true; release DELETES (only true rows)', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes("value: 'true'"), 'the hold row is not value true');
  assert(lib.includes('updatedByUserId: session.userId'), 'the hold row is not attributed');
  const rel = lib.slice(lib.indexOf('export async function setLegalHold'));
  assert(rel.includes('deleteMany'), 'release does not delete');
  assert(rel.includes("value: 'true'"), 'release does not filter to true rows');
  assert(lib.includes("action: 'LEGAL_HOLD_SET'"), 'LEGAL_HOLD_SET audit missing');
  assert(lib.includes("action: 'LEGAL_HOLD_RELEASED'"), 'LEGAL_HOLD_RELEASED audit missing');
  assert(lib.includes('HrEntityType.HR_SETTING'), 'audit resource is not HrSetting');
});

check('lib: the refusals stay honest (409 pair + 400 pair)', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  for (const code of ['HOLD_ACTIVE', 'NO_ACTIVE_HOLD', 'UNKNOWN_SCOPE', 'INVALID_HELD']) {
    assert(lib.includes(`'${code}'`), `${code} missing`);
  }
  assert(lib.includes('Valid scopes: ${knownScopes.join'), 'UNKNOWN_SCOPE does not name the valid scopes');
});

check('lib: the three reviewable scopes stand with their windows', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  for (const scope of ['hr_applicant_rejection_data', 'hr_disciplinary_closed', 'hr_attendance_daily']) {
    assert(lib.includes(`scope: '${scope}'`), `${scope} missing`);
  }
  assert(lib.includes('export function describeRetentionWindow'), 'the pure humaniser missing');
});

// ── the routes ──────────────────────────────────────────────────────────────
check('route: the desk read is guarded like the consent ledger', () => {
  const route = codeOf(read('src/app/api/hr/privacy/retention/route.ts'));
  assert(route.includes("hrGuard('hr.report.branch', VIEW_ROLES)"), 'guard moved');
  assert(route.includes("['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER']"), 'VIEW_ROLES moved');
  assert(route.includes('canDecideErasure(session.role)'), 'canDecide not surfaced');
  assert(route.includes('listRetentionPolicies(session)'), 'service not called');
});

check('route: the hold decision fails closed for non-deciders', () => {
  const route = codeOf(read('src/app/api/hr/privacy/legal-hold/route.ts'));
  assert(route.includes("hrGuard('hr.report.branch')"), 'guard moved');
  assert(route.includes("code: 'DECISION_FORBIDDEN'"), '403 code missing');
  assert(route.includes('Only settings managers can set or release legal holds.'), 'honest copy missing');
  assert(route.includes('setLegalHold(body, session)'), 'service not called');
});

// ── the page (the desk on the Privacy tab) ──────────────────────────────────
check('page: the third posture card stands with its testids and counts strip', () => {
  const page = codeOf(read('src/app/(shell)/hr/reports/page.tsx'));
  assert(page.includes('data-testid="hr-privacy-retention"'), 'card testid missing');
  assert(page.includes('data-testid="hr-privacy-retention-hold-count"'), 'counts strip missing');
  assert(page.includes('scopes on hold'), 'hold counts sentence missing');
  assert(page.includes('the sweep skips them until release'), 'amber honesty missing');
  assert(page.includes('the sweep runs nightly'), 'zero-state honesty missing');
  assert(page.includes('hr-retention-row-${p.scope}'), 'row testid missing');
  assert(page.includes('hr-retention-hold-${p.scope}'), 'chip testid missing');
});

check('page: the chip pair speaks in amber/slate with the sweep truth in tooltips', () => {
  const page = codeOf(read('src/app/(shell)/hr/reports/page.tsx'));
  assert(page.includes('On hold'), 'amber chip missing');
  assert(page.includes('Sweeping nightly'), 'slate chip missing');
  assert(page.includes('border-amber-200 bg-amber-50'), 'amber tone missing');
  assert(page.includes('border-slate-200 bg-slate-50'), 'slate tone missing');
  assert(page.includes('the nightly sweep skips this scope'), 'held tooltip missing');
  assert(page.includes("anonymises this scope's expired records"), 'idle tooltip missing');
});

check('page: release asks twice; the outcome reports in the card', () => {
  const page = codeOf(read('src/app/(shell)/hr/reports/page.tsx'));
  assert(page.includes('Release…'), 'arm button missing');
  assert(page.includes('Confirm release'), 'confirm missing');
  assert(page.includes('Release? The sweep resumes on its next run.'), 'rose copy missing');
  assert(page.includes('hr-retention-arm-${p.scope}'), 'arm testid missing');
  assert(page.includes('data-testid="hr-retention-note"'), 'local note missing');
  assert(page.includes('role="status"'), 'note not a status region');
  assert(page.includes("apiSend('/api/hr/privacy/legal-hold', 'POST', { scope, held })"), 'the call moved');
  assert(page.includes('await loadRetention()'), 'the desk does not refetch');
});

check('page: non-deciders read the muted truth; the client stays pure', () => {
  const page = codeOf(read('src/app/(shell)/hr/reports/page.tsx'));
  assert(page.includes('settings managers decide'), 'muted truth missing');
  assert(!page.includes("from '@/lib/hr/data-protection'"), 'the page imports the db-backed module');
  assert(page.includes('p.windowLabel'), 'window label not rendered from the DTO');
});

check('prior anchors: the sibling posture cards stand untouched', () => {
  const page = codeOf(read('src/app/(shell)/hr/reports/page.tsx'));
  assert(page.includes('Consent records (Data Protection Act posture)'), 'consent card moved');
  assert(page.includes('Erasure requests (Data Protection Act posture)'), 'erasure card moved');
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes('PAYROLL_CONSENT_POLICY_VERSION'), 'the consent vocabulary moved');
  assert(lib.includes('STATUTORY_RETENTION_NOTE'), 'the erasure basis moved');
});

check('tests: the v2.122 suite pins the desk end to end', () => {
  const t = read('src/tests/retention-legal-hold-v2122.test.ts');
  for (const pin of ['listRetentionPolicies', 'setLegalHold', 'describeRetentionWindow', 'HOLD_ACTIVE', 'NO_ACTIVE_HOLD', 'LEGAL_HOLD_SET', 'LEGAL_HOLD_RELEASED', 'Sweeping nightly', 'Confirm release']) {
    assert(t.includes(pin), `pin missing: ${pin}`);
  }
});

const total = pass + fail;
console.log(`\nverify-v2-122-0: ${pass}/${total} checks pass`);
if (fail > 0) process.exit(1);
