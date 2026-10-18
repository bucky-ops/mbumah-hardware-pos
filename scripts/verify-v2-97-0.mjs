#!/usr/bin/env node
// v2.97.0 verification — "every performance list files itself".
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

const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');
const BUILDER = read('src/lib/hr/performance-csv.ts');
const CYCLES_ROUTE = read('src/app/api/hr/performance/cycles/export/route.ts');
const GOALS_ROUTE = read('src/app/api/hr/goals/export/route.ts');
const SERVICE = read('src/lib/hr/goal-service.ts');
const PAGE = read('src/app/(shell)/hr/performance/page.tsx');
const TEST = read('src/tests/perf-cycles-goals-csv.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.97.0', () => {
  assert(atLeast(PKG.version, '2.97.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.97.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.97.0'), 'baseVersion');
});

check('whats-new leads with 2.97.0 and tells the family-completes story', () => {
  const i97 = WN.indexOf("version: '2.97.0'");
  const i96 = WN.indexOf("version: '2.96.0'");
  assert(i97 >= 0, 'no 2.97.0 entry');
  assert(i96 > i97, '2.97.0 does not lead the feed');
  assert(WN.includes('Every performance list files itself'), 'headline');
  assert(WN.includes('The goals file rides your filters'), 'goals bullet');
  assert(WN.includes('keeps the manager'), 'privacy bullet');
});

// ── 2. The pure builders ────────────────────────────────────────────────────
check('both builders reuse the digest escaper (one OWASP guard everywhere)', () => {
  assert(BUILDER.includes("import { csvCell } from '@/lib/hr/digest-csv'"), 'csvCell import');
  const cyclesFn = BUILDER.split('export function cyclesToCsv')[1]?.split('\nexport function')[0] ?? '';
  const goalsFn = BUILDER.split('export function goalsToCsv')[1]?.split('\nexport function')[0] ?? '';
  assert(cyclesFn.includes('.map(csvCell)'), 'cycles cells ride csvCell');
  assert(goalsFn.includes('.map(csvCell)'), 'goals cells ride csvCell');
});

check('cycles builder layout is the governed family: header block, caption, meter columns, CRLF', () => {
  const cyclesFn = BUILDER.split('export function cyclesToCsv')[1]?.split('\nexport function')[0] ?? '';
  assert(cyclesFn.includes("row(['Report', 'Performance cycles'])"), 'Report line');
  assert(cyclesFn.includes("row(['Organization', meta.organizationName])"), 'Organization line');
  assert(cyclesFn.includes("row(['Scope', meta.scopeLabel])"), 'Scope line');
  assert(cyclesFn.includes("row(['Generated (UTC)', generatedAt.toISOString()])"), 'Generated line');
  assert(cyclesFn.includes("row(['Cycle', 'Period start', 'Period end', 'Status', 'Reviews', 'Calibrated', 'Draft', 'Submitted', 'Acknowledged', 'Created'])"), 'columns');
  assert(cyclesFn.includes("lines.join('\\r\\n') + '\\r\\n'"), 'RFC-4180 CRLF');
});

check('goals builder layout is the governed family: header block with filters, caption, CRLF', () => {
  const goalsFn = BUILDER.split('export function goalsToCsv')[1]?.split('\nexport function')[0] ?? '';
  assert(goalsFn.includes("row(['Report', 'Team goals'])"), 'Report line');
  assert(goalsFn.includes("row(['Source', meta.sourceLabel])"), 'Source line');
  assert(goalsFn.includes("row(['Status', meta.statusLabel])"), 'Status line');
  assert(goalsFn.includes("row(['Goal', 'Employee', 'Cycle', 'Source', 'Metric', 'Status', 'Current', 'Target', 'Progress %', 'Due'])"), 'columns');
  assert(goalsFn.includes("lines.join('\\r\\n') + '\\r\\n'"), 'RFC-4180 CRLF');
});

check('privacy floor: the cycles row input cannot carry calibrationNotes; goals row cannot carry narratives', () => {
  const cycIface = BUILDER.split('export interface CycleCsvRow')[1]?.split('\n}')[0] ?? '';
  assert(cycIface.length > 0, 'CycleCsvRow interface missing');
  assert(!cycIface.includes('calibrationNotes'), 'calibrationNotes leaks');
  const goalIface = BUILDER.split('export interface GoalCsvRow')[1]?.split('\n}')[0] ?? '';
  assert(goalIface.length > 0, 'GoalCsvRow interface missing');
  assert(!goalIface.includes('strengths'), 'strengths leaks');
  assert(!goalIface.includes('improvements'), 'improvements leaks');
});

check('builder honesty: empty lists return null; filenames stay slugged and honest', () => {
  const cyclesFn = BUILDER.split('export function cyclesToCsv')[1]?.split('\nexport function')[0] ?? '';
  const goalsFn = BUILDER.split('export function goalsToCsv')[1]?.split('\nexport function')[0] ?? '';
  assert(cyclesFn.includes('if (cycles.length === 0) return null;'), 'cycles null on empty');
  assert(goalsFn.includes('if (goals.length === 0) return null;'), 'goals null on empty');
  assert(BUILDER.includes("mbumah-performance-cycles.csv'"), 'cycles filename');
  assert(BUILDER.includes('mbumah-performance-goals-'), 'goals filename prefix');
  assert(BUILDER.includes("slug(meta.sourceLabel, 'all')"), 'source slug');
  assert(BUILDER.includes("slug(meta.statusLabel, 'all')"), 'status slug');
});

// ── 3. The routes ───────────────────────────────────────────────────────────
check('cycles route is read-guarded and re-runs listCycles — the file cannot drift', () => {
  assert(CYCLES_ROUTE.includes("hrGuard('hr.performance.review')"), 'guard');
  assert(CYCLES_ROUTE.includes('listCycles(session)'), 'same service call');
  const map = CYCLES_ROUTE.split('cycles.map((c) => ({')[1]?.split('})),')[0] ?? '';
  assert(map.includes('statusCounts'), 'counts ride the filing slice');
  assert(!map.includes('calibrationNotes'), 'notes stay out of the mapping');
});

check('goals route is read-guarded and re-runs listGoals with all four filters', () => {
  assert(GOALS_ROUTE.includes("hrGuard('hr.performance.review')"), 'guard');
  assert(GOALS_ROUTE.includes('listGoals(session, {'), 'same service call');
  assert(GOALS_ROUTE.includes('employeeId: parsed.employeeId ?? undefined'), 'employee filter');
  assert(GOALS_ROUTE.includes('cycleId: parsed.cycleId ?? undefined'), 'cycle filter');
  assert(GOALS_ROUTE.includes('status: parsed.status ?? undefined'), 'status filter');
  assert(GOALS_ROUTE.includes('source: parsed.source ?? undefined'), 'source filter');
});

check('service learned the source predicate — one read path for screen and file', () => {
  assert(SERVICE.includes('source?: string'), 'filter signature');
  assert(SERVICE.includes('filters.source ? { metricSource: filters.source } : {}'), 'source where');
});

check('route honesty: garbage filters 400 with named codes; empty lists 404 with named codes', () => {
  assert(GOALS_ROUTE.includes("'INVALID_STATUS'"), 'INVALID_STATUS');
  assert(GOALS_ROUTE.includes("'INVALID_SOURCE'"), 'INVALID_SOURCE');
  assert(CYCLES_ROUTE.includes("'NO_CYCLE_DATA'"), 'NO_CYCLE_DATA');
  assert(GOALS_ROUTE.includes("'NO_GOAL_DATA'"), 'NO_GOAL_DATA');
});

check('both exports are audited with field names only', () => {
  assert(CYCLES_ROUTE.includes("action: 'PERFORMANCE_CYCLES_EXPORTED'"), 'cycles audit action');
  assert(GOALS_ROUTE.includes("action: 'PERFORMANCE_GOALS_EXPORTED'"), 'goals audit action');
  assert(CYCLES_ROUTE.includes('HrEntityType.DATA_EXPORT'), 'cycles DATA_EXPORT');
  assert(GOALS_ROUTE.includes('HrEntityType.DATA_EXPORT'), 'goals DATA_EXPORT');
  const cyclesAudit = CYCLES_ROUTE.split('await hrAudit')[1]?.split('}).catch')[0] ?? '';
  const goalsAudit = GOALS_ROUTE.split('await hrAudit')[1]?.split('}).catch')[0] ?? '';
  assert(cyclesAudit.includes('byteSize: file.byteSize'), 'cycles byteSize');
  assert(goalsAudit.includes('byteSize: file.byteSize'), 'goals byteSize');
  assert(!goalsAudit.includes('employeeName'), 'employee names ride the audit row');
});

// ── 4. The console ──────────────────────────────────────────────────────────
check('Cycles tab carries the filing door in the slate governed family', () => {
  const cycles = PAGE.split('<TabsContent value="cycles"')[1]?.split('<TabsContent value="reviews"')[0] ?? '';
  assert(cycles.includes('data-testid="cycles-csv"'), 'csv button testid');
  assert(cycles.includes("'Building…'"), 'busy label');
  assert(cycles.includes('Nothing to file — no cycles yet'), 'honest idle title');
  assert(cycles.includes('border-slate-300 text-slate-600'), 'slate family');
  assert(cycles.includes('data-testid="cycles-csv-note"'), 'local note');
});

check('Goals tab carries the filing door riding the current filters', () => {
  const goals = PAGE.split('<TabsContent value="goals"')[1]?.split('<TabsContent value="cycles"')[0] ?? '';
  assert(goals.includes('data-testid="goals-csv"'), 'csv button testid');
  assert(goals.includes('Nothing to file — no goals match the current filters'), 'honest idle title');
  assert(goals.includes('data-testid="goals-csv-note"'), 'local note');
  const logic = PAGE.split('const exportGoalsCsv')[1]?.split('const run =')[0] ?? '';
  assert(logic.includes('/api/hr/goals/export'), 'endpoint');
  assert(logic.includes("qs.set('employeeId', filterGoalEmployee)"), 'employee rides');
  assert(logic.includes("qs.set('source', filterGoalSource)"), 'source rides');
  assert(logic.includes("qs.set('status', filterGoalStatus)"), 'status rides');
});

check('the doors render for readers while create actions stay manage-gated', () => {
  const cycles = PAGE.split('<TabsContent value="cycles"')[1]?.split('<TabsContent value="reviews"')[0] ?? '';
  const rowBeforeCard = cycles.split('{cyclesCsvNote ?')[0] ?? '';
  assert(rowBeforeCard.indexOf('cycles-csv') >= 0, 'csv door missing');
  assert(rowBeforeCard.indexOf('cycles-csv') < rowBeforeCard.indexOf('canManage ?'), 'door must precede the gated create');
  const goals = PAGE.split('<TabsContent value="goals"')[1]?.split('<TabsContent value="cycles"')[0] ?? '';
  const goalsRow = goals.split('{goalsCsvNote ?')[0] ?? '';
  assert(goalsRow.indexOf('goals-csv') >= 0, 'goals csv door missing');
  assert(goalsRow.indexOf('goals-csv') < goalsRow.indexOf("data-testid=\"goal-deleted-open\""), 'door must precede the manage bench door');
});

// ── 5. The tests are pinned ─────────────────────────────────────────────────
check('the new suite executes both builders and the parser for real', () => {
  assert(TEST.includes("import { cyclesToCsv, goalsToCsv } from '@/lib/hr/performance-csv'"), 'builder import');
  assert(TEST.includes("import { parseGoalsExportQuery } from '@/app/api/hr/goals/export/route'"), 'parser import');
  assert(TEST.includes("expect(lines[0]).toBe('Report,Performance cycles')"), 'cycles header executed');
  assert(TEST.includes("expect(lines[0]).toBe('Report,Team goals')"), 'goals header executed');
  assert(TEST.includes("toContain(\"'=HYPERLINK\")"), 'OWASP executed');
  assert(TEST.includes("'mbumah-performance-goals-sales-total-open.csv'"), 'filename slug executed');
});

check('prior anchors: v2.96 reviews door, v2.95 lifecycle, v2.94 notes all pinned', () => {
  assert(TEST.includes('export function reviewsToCsv'), 'v2.96 builder pinned');
  assert(TEST.includes('cycle-detail-action-error'), 'v2.95 error door pinned');
  assert(TEST.includes('cycle-detail-notes'), 'v2.94 notes pinned');
  const reviewsTest = read('src/tests/perf-reviews-csv.test.ts');
  assert(reviewsTest.includes("data-testid=\"reviews-csv\""), 'reviews door test stays');
});

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
