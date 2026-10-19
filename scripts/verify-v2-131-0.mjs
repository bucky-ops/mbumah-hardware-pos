#!/usr/bin/env node
// v2.131.0 verification — "the reports speak their failures".
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
check('version: package.json leads 2.131.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.131.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.131.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.131.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-131-0'], 'verify script entry missing');
});

check('whats-new: 2.131.0 leads the feed with the failure-speech story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.131.0'");
  assert(head > -1, 'no 2.131.0 entry');
  assert(head < wn.indexOf("version: '2.130.0'"), '2.131.0 does not lead');
  assert(wn.includes('The reports speak their failures'), 'title missing');
  assert(wn.includes('rose error strip'), 'the strip missing from bullets');
  assert(wn.includes('Updated HH:MM'), 'the honesty stamp missing from bullets');
});

check('changelog: [2.131.0] section leads with both beats', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.131.0]');
  assert(head > -1, 'no [2.131.0] section');
  assert(head < cl.indexOf('## [2.130.0]'), '[2.131.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.130.0]'));
  assert(section.includes('Failure strips on all eight report tabs'), 'strips missing');
  assert(section.includes('honesty stamp'), 'the stamp missing');
  assert(section.includes('### Changed'), 'Changed section missing');
});

// ── the strips: every desk speaks on its own tab ────────────────────────────
const STRIP_IDS = [
  'hr-reports-headcount-error',
  'hr-reports-cost-error',
  'hr-reports-absence-error',
  'hr-reports-leave-error',
  'hr-reports-turnover-error',
  'hr-reports-tth-error',
  'hr-reports-statutory-error',
  'hr-reports-p10-error',
];
const PRIVACY_IDS = ['hr-privacy-consent-error', 'hr-privacy-erasure-error', 'hr-privacy-retention-error'];

check('strips: all eight report tabs + three privacy desks carry their own door', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  for (const id of [...STRIP_IDS, ...PRIVACY_IDS]) {
    assert(page.includes(`testId="${id}"`), `missing strip door ${id}`);
  }
  const copies = page.match(/copy="([^"]+)"/g) ?? [];
  assert(copies.length === 11, `expected 11 strip copies, found ${copies.length}`);
  for (const c of copies) assert(c.includes('dark rather than guess'), `copy off-voice: ${c}`);
});

check('strips: ONE family component — rose frame once, status role, warning glyph, spinner', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  const at = page.indexOf('const ReportFailureStrip');
  assert(at > -1, 'ReportFailureStrip component missing');
  const def = page.slice(at, at + 1200);
  assert(def.includes('role="status"'), 'no status role');
  assert(def.includes('border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40'), 'rose frame missing');
  assert(def.includes('AlertTriangle'), 'warning glyph missing');
  assert(def.includes('animate-spin'), 'in-flight spinner missing');
  assert(def.includes('disabled={busy}'), 'retry does not disable while busy');
  const frames = page.match(/border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950\/40/g) ?? [];
  assert(frames.length === 1, `rose frame must live once, found ${frames.length}`);
});

check('loaders: failure nulls data then speaks; success clears the flag', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  const loadBody = page.slice(page.indexOf('const load = useCallback'), page.indexOf('const loadP10 = useCallback'));
  for (const nuller of ['setHeadcount(null)', 'setCost(null)', 'setAbsence(null)', 'setTurnover(null)', 'setTth(null)', 'setStatutory(null)']) {
    assert(loadBody.includes(nuller), `aggregate catch does not null ${nuller}`);
  }
  assert(loadBody.includes('setAggregateFailed(true)'), 'aggregate flag not set on catch');
  assert(loadBody.includes('setAggregateFailed(false)'), 'aggregate flag not cleared on success');
  for (const [flag, data] of [['setP10Failed(true)', 'setP10(null)'], ['setLeaveFailed(true)', 'setLeaveUtil(null)']]) {
    assert(page.includes(flag), `missing ${flag}`);
    assert(page.includes(data), `missing ${data}`);
  }
});

check('loaders: no longer borrow the shared error — setError stays with actions', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  const loadBody = page.slice(page.indexOf('const load = useCallback'), page.indexOf('const loadP10 = useCallback'));
  assert(!loadBody.includes('setError('), 'load() still writes the shared error');
  const p10Body = page.slice(page.indexOf('const loadP10 = useCallback'), page.indexOf('const loadErasure = useCallback'));
  assert(!p10Body.includes('setError('), 'loadP10 still writes the shared error');
  const leaveBody = page.slice(page.indexOf('const loadLeaveUtil = useCallback'), page.indexOf('}, [leaveYear, storeId]);'));
  assert(!leaveBody.includes('setError('), 'loadLeaveUtil still writes the shared error');
  const runBody = page.slice(page.indexOf('const run = async'), page.indexOf('const runHold'));
  assert(runBody.includes('setError('), 'actions lost the shared error');
});

check('refresh path: privacy loaders spin their buttons while fetching', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes('disabled={consentBusy}'), 'refresh button does not disable');
  for (const busy of ['busy={consentBusy}', 'busy={erasureBusy}', 'busy={retentionBusy}', 'busy={p10Busy}', 'busy={leaveBusy}']) {
    assert(page.includes(busy), `missing ${busy}`);
  }
  const btn = page.slice(page.indexOf('Refresh consent records') - 400, page.indexOf('Refresh consent records') + 200);
  assert(btn.includes('consentBusy ? <Loader2'), 'refresh icon does not spin while busy');
});

check('honesty stamp: every loaded report says WHEN its numbers were fetched', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  for (const id of ['headcount', 'cost', 'absence', 'leave', 'turnover', 'tth', 'statutory', 'p10']) {
    assert(page.includes(`hr-reports-updated-${id}`), `no stamp on ${id}`);
  }
  assert(page.includes('formatStamp(consentLoadedAt)'), 'consent counts carry no stamp');
  assert(page.includes('hr-privacy-updated-erasure'), 'erasure carries no stamp');
  assert(page.includes('hr-privacy-updated-retention'), 'retention carries no stamp');
  assert(page.includes("d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })"), 'stamp clock off-spec');
});

// ── tests + guards ─────────────────────────────────────────────────────────
check('tests: the v2.131 contract file exists and pins the family', () => {
  const t = read('src/tests/reports-speak-failures-v2131.test.ts');
  assert(t.includes('reports speak their failures'), 'contract title missing');
  assert(t.includes('retryLabel="'), 'retry-label pin missing');
  assert(t.includes('hr-reports-updated-${id}'), 'stamp pin missing');
});

check('tests: the v2.130 contract re-anchored to the family props', () => {
  const t = read('src/tests/consent-timeline-csv-v2130.test.ts');
  assert(t.includes("testId=\"hr-privacy-consent-error\""), 'v2.130 test still pins inline data-testid');
  assert(!t.includes('data-testid="hr-privacy-consent-error"'), 'v2.130 test not re-anchored');
  assert(t.includes("?.length).toBe(1)"), 'rose-frame count not re-anchored');
});

check('guard: the sanity contract — strips ride tabs, not the page header', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  // the page-level ErrorNote (actions) stays where it always was
  assert(page.includes('{error ? <ErrorNote message={error} /> : null}'), 'shared action ErrorNote vanished');
  // every strip usage sits inside a TabsContent block (tabs start after the Tabs element)
  const tabsAt = page.indexOf('<Tabs value={tab}');
  for (const id of STRIP_IDS) {
    const at = page.indexOf(`testId="${id}"`);
    assert(at > tabsAt, `${id} renders outside the tab body`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
