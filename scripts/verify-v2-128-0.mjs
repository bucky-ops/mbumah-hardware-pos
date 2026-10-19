#!/usr/bin/env node
// v2.128.0 verification — "the record stands corrected".
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
check('version: package.json leads 2.128.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.128.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.128.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.128.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-128-0'], 'verify script entry missing');
});

check('whats-new: 2.128.0 leads the feed with the correction story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.128.0'");
  assert(head > -1, 'no 2.128.0 entry');
  assert(head < wn.indexOf("version: '2.127.0'"), '2.128.0 does not lead');
  assert(wn.includes('The record stands corrected'), 'title missing');
  assert(wn.includes('re-granted'), 're-grant marker missing from bullets');
  assert(wn.includes('zero gaps'), 'zero-gap claim missing from bullets');
});

check('changelog: [2.128.0] section leads with the correction story', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.128.0]');
  assert(head > -1, 'no [2.128.0] section');
  assert(head < cl.indexOf('## [2.127.0]'), '[2.128.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.127.0]'));
  assert(section.includes('priorGrants'), 'priorGrants undocumented');
  assert(section.includes('5/5'), '5/5 mutator claim missing');
  assert(section.includes('98 `hrAudit` call sites'), '98-site recount missing');
});

// ── the audit-coverage correction (the round's headline) ───────────────────
check('doc: EMS_AUDIT_COVERAGE §4 records a correction with ZERO gaps', () => {
  const doc = read('docs/EMS_AUDIT_COVERAGE.md');
  assert(doc.includes('Known gaps — NONE'), '§4 does not state NONE');
  assert(doc.includes('That finding was false'), 'correction does not name the false finding');
  assert(!doc.includes('fix queued as the next round'), 'stale "fix queued" claim still present');
  assert(doc.includes('portal-link.test.ts'), 'test pin missing from evidence');
  assert(/Portal\s+account\s+linked\./.test(doc), 'live LINK verification missing');
  assert(/Portal\s+account\s+unlinked\./.test(doc), 'live UNLINK verification missing');
  assert(doc.includes('v2.39.0'), 'provenance (since v2.39.0) missing');
  assert(doc.includes('expected to\nSTAY empty') || doc.includes('STAY empty'), 'stay-empty vow missing');
});

check('doc: Employees domain row claims 5/5 incl. the portal-link pair', () => {
  const doc = read('docs/EMS_AUDIT_COVERAGE.md');
  assert(
    doc.includes('linkPortalAccount, unlinkPortalAccount — **5/5**'),
    'Employees row does not claim 5/5 with the pair named',
  );
  assert(!doc.includes('portal-account linking is the gap'), 'stale gap note still in §2');
});

check('doc: raw count is the corrected 98 across 30 files', () => {
  const doc = read('docs/EMS_AUDIT_COVERAGE.md');
  assert(doc.includes('98 `hrAudit` call sites across 30 files'), 'corrected count missing');
  assert(!doc.includes('**96 `hrAudit` call sites'), 'stale 96 count still bolded');
});

check('code: the doc follows the code — both mutators really audit', () => {
  const svc = read('src/lib/hr/employee-service.ts');
  const linkAt = svc.indexOf('export async function linkPortalAccount');
  const unlinkAt = svc.indexOf('export async function unlinkPortalAccount');
  assert(linkAt > -1 && unlinkAt > -1, 'mutators missing');
  const linkBody = svc.slice(linkAt, unlinkAt);
  const unlinkBody = svc.slice(unlinkAt);
  assert(linkBody.includes("action: 'UPDATE'"), 'link does not audit UPDATE');
  assert(linkBody.includes('resourceType: HrEntityType.EMPLOYEE'), 'link is not EMPLOYEE-scoped');
  assert(linkBody.includes("portalLink: 'LINK'"), 'link metadata verb missing');
  assert(linkBody.includes('linkedUserRole: user.role'), 'link role metadata missing');
  assert(unlinkBody.includes("portalLink: 'UNLINK'"), 'unlink metadata verb missing');
  assert(unlinkBody.includes("'Portal account unlinked.'"), 'unlink reason missing');
});

check('test: portal-link.test.ts still pins the LINK audit row with ids-only PII', () => {
  const t = read('src/tests/portal-link.test.ts');
  assert(t.includes("expect(audit.metadata?.portalLink).toBe('LINK')"), 'LINK pin missing');
  assert(t.includes("expect(audit.metadata?.linkedUserId).toBe('user-9')"), 'linkedUserId pin missing');
  assert(t.includes(".not.toContain('candidate@mbumah.co.ke')"), 'PII discipline pin missing');
});

// ── the re-grant trace ─────────────────────────────────────────────────────
check('read-back: ConsentRow carries priorGrants and the fold counts it', () => {
  const s = read('src/lib/hr/data-protection.ts');
  assert(s.includes('priorGrants: number'), 'interface field missing');
  assert(s.includes('priorGrants: Math.max(0, crs.length - 1)'), 'fold missing');
  assert(s.includes('Append-only history depth'), 'honest comment missing');
});

check('privacy tab: the re-grant marker renders only when history exists', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('{r.priorGrants > 0 ? ('), 'marker not gated on priorGrants');
  assert(s.includes('data-testid="hr-privacy-consent-regrant"'), 'testid missing');
  assert(s.includes('re-granted ×{r.priorGrants}'), 'marker label missing');
  assert(s.includes('dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300'), 'dark twin missing');
  assert(s.includes('append-only ledger'), 'tooltip does not name the append-only ledger');
  // status chips keep their own testids — the marker annotates, never replaces
  for (const tid of ['hr-privacy-consent-chip-active', 'hr-privacy-consent-chip-withdrawn', 'hr-privacy-consent-chip-none']) {
    assert(s.includes(`data-testid="${tid}"`), `status chip ${tid} missing`);
  }
});

check('api: the consent ledger route passes records through untouched (priorGrants rides)', () => {
  const s = read('src/app/api/hr/privacy/consent/route.ts');
  assert(s.includes('records: ledger.records'), 'route reshapes records — priorGrants would be dropped');
});

check('tests: the v2128 suite exists and covers fold + marker + doc pins', () => {
  const t = read('src/tests/consent-regrant-v2128.test.ts');
  assert(t.includes('a withdrawn-then-re-granted consent reads priorGrants ≥ 1'), 'fold test missing');
  assert(t.includes('two full cycles read priorGrants 2'), 'depth-2 test missing');
  assert(t.includes('hr-privacy-consent-regrant'), 'marker contract missing');
  assert(t.includes('the false gap claim cannot return'), 'doc pin missing');
  assert(t.includes("svc.indexOf('export async function unlinkPortalAccount')"), 'code-follows check missing');
});

console.log(`\nverify-v2-128-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
