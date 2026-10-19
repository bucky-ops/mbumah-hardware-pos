#!/usr/bin/env node
// v2.134.0 verification — "the gate opens onto empty months".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the two-doors-one-gate contract: the pre-flight rows must ride the SAME
// loader and panel as the header door, keyed by the period's REAL id —
// never the runs[0] borrow trick, which has nothing to borrow from on a
// run-less period. Comment-stripping before code searches (house lesson 49):
// a comment that QUOTES a string is not the string living in code.

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
/** Strip line comments so a quoted example in prose never satisfies a code pin. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');

const RUN_GROUPS = 'src/lib/hr/payroll/run-groups.ts';
const PAGE = 'src/app/(shell)/hr/payroll/page.tsx';
const TEST = 'src/tests/payroll-preflight-empty-v2134.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.134.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.134.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.134.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.134.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-134-0'], 'verify script entry missing');
});

check('whats-new: 2.134.0 leads the feed with the empty-months story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.134.0'");
  assert(head > -1, 'no 2.134.0 entry');
  assert(head < wn.indexOf("version: '2.133.0'"), '2.134.0 does not lead');
  assert(wn.includes('The gate opens onto empty months'), 'title missing');
  const entry = wn.slice(head, wn.indexOf("version: '2.133.0'"));
  const bullets = entry.match(/^ {6}'.*',$/gm) || [];
  assert(bullets.length >= 3 && bullets.length <= 6, `bullet count ${bullets.length}`);
});

check('changelog: [2.134.0] carries Added + Changed with both beats', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.134.0]');
  assert(head > -1, 'no [2.134.0] section');
  assert(head < cl.indexOf('## [2.133.0]'), '[2.134.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.133.0]'));
  assert(section.includes('### Added'), 'no Added');
  assert(section.includes('### Changed'), 'no Changed');
  assert(section.includes('emptyPeriodRows'), 'pure builder missing');
  assert(section.includes('pre-flight months'), 'section missing');
});

// ── the pure builder ───────────────────────────────────────────────────────
check('pure: emptyPeriodRows exported from run-groups (pure module, no env/db)', () => {
  const code = stripComments(read(RUN_GROUPS));
  assert(code.includes('export function emptyPeriodRows('), 'fn missing');
  assert(code.includes('export interface EmptyPeriodRow'), 'row type missing');
  assert(code.includes('export interface EmptyPeriodSource'), 'source type missing');
  const fnStart = code.indexOf('export function emptyPeriodRows(');
  const fnBody = code.slice(fnStart, code.indexOf('}', code.indexOf('.sort(', fnStart)));
  assert(!fnBody.includes('await '), 'builder must be synchronous');
  assert(fnBody.includes('new Set(groups.map'), 'name-keyed filter missing');
});

check('pure: rows carry the real period id and verbatim status', () => {
  const code = stripComments(read(RUN_GROUPS));
  const mapStart = code.indexOf('.map((p) => ({');
  const mapBody = code.slice(mapStart, code.indexOf('}))', mapStart));
  assert(mapBody.includes('periodId: p.id'), 'real id missing');
  assert(mapBody.includes("status: p.status ?? ''"), 'status passthrough missing');
});

check('pure: deterministic order — startDate desc with a name-ascending tie-break', () => {
  const code = stripComments(read(RUN_GROUPS));
  const sortStart = code.indexOf('.sort((a, b) => {', code.indexOf('export function emptyPeriodRows('));
  const sortBody = code.slice(sortStart, code.indexOf('});', sortStart));
  assert(sortBody.includes("localeCompare(String(a.startDate"), 'startDate desc missing');
  assert(sortBody.includes("localeCompare(String(b.periodName"), 'name tie-break missing');
});

// ── the page contract: one gate, two doors ─────────────────────────────────
check('page: pre-flight section renders ONLY when a run-less period exists', () => {
  const code = stripComments(read(PAGE));
  assert(code.includes('{emptyPeriods.length > 0 && ('), 'render guard missing');
  assert(code.includes('emptyPeriodRows(periods ?? [], periodGroups)'), 'memo wiring missing');
});

check('page: the row door rides the REAL period id — never the runs[0] borrow trick', () => {
  const code = stripComments(read(PAGE));
  const sectionStart = code.indexOf('data-testid="payroll-preflight-section"');
  const section = code.slice(sectionStart, code.indexOf('payroll-preflight-gate-panel', sectionStart));
  assert(section.includes('onClick={() => toggleGate(row.periodId, row.periodName)}'), 'row click missing the real id');
  assert(section.includes('aria-label={`Check the ${row.periodName} run gate`}'), 'aria family missing');
  assert(!section.includes('runs[0]'), 'borrow trick leaked into the pre-flight section');
});

check('page: same GatePanel verdict — the shared loader, one gate, two doors', () => {
  const code = stripComments(read(PAGE));
  const panelStart = code.indexOf('data-testid="payroll-preflight-gate-panel"');
  assert(panelStart > -1, 'inset wrapper missing');
  const panel = code.slice(panelStart, panelStart + 800);
  assert(panel.includes('<GatePanel'), 'shared panel not reused');
  assert(panel.includes('report={gateReport}'), 'shared report state missing');
  assert(panel.includes('loading={gateLoading}'), 'shared loading state missing');
  assert(panel.includes('error={gateError}'), 'shared error state missing');
  assert(panel.includes('onRetry='), 'retry missing');
});

check('page: honest copy and honest chips — no guessed states, no fabricated dates', () => {
  const code = stripComments(read(PAGE));
  assert(code.includes('Periods with no runs yet'), 'honest headline missing');
  assert(code.includes('no run is created'), 'read-only honesty missing');
  assert(code.includes("{row.status ? row.status.toUpperCase() : 'UNKNOWN'}"), 'UNKNOWN fallback missing');
  assert(code.includes("' · pay date not set'"), 'pay-date fallback missing');
});

// ── the styling contract (house discipline) ────────────────────────────────
check('styling: dark twins on every colored surface of the section', () => {
  const code = stripComments(read(PAGE));
  assert(code.includes('text-violet-600 dark:text-violet-400'), 'title icon twins missing');
  assert(code.includes('dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'), 'OPEN chip twins missing');
  assert(code.includes('dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'), 'VOIDED chip twins missing');
});

check('styling: tabular stamps, hover + focus-within, header-rail door letterform', () => {
  const code = stripComments(read(PAGE));
  assert(code.includes('text-xs tabular-nums text-muted-foreground'), 'tabular stamps missing');
  assert(code.includes('transition-colors hover:bg-muted/40 focus-within:bg-muted/40'), 'row affordances missing');
  assert(code.includes('hover:ring-1 hover:ring-border focus-visible:ring-1 focus-visible:ring-ring'), 'door ring missing');
  assert(code.includes('font-mono text-[10px] font-medium uppercase tracking-wide'), 'mono chip letterform missing');
});

// ── the test contract ──────────────────────────────────────────────────────
check('tests: v2134 suite exists and pins both the builder and the page', () => {
  const t = read(TEST);
  assert(t.includes('emptyPeriodRows'), 'builder unpinned');
  assert(t.includes('payroll-preflight-section'), 'section unpinned');
  assert(t.includes('toggleGate(row.periodId, row.periodName)'), 'real-id click unpinned');
});

const grandStart = Date.now();
console.log(`\nverify-v2-134-0: ${pass} passed, ${fail} failed (${Date.now() - grandStart}ms)`);
if (fail > 0) process.exit(1);
