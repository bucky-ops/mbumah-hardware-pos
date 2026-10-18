#!/usr/bin/env node
// v2.96.0 verification — "the performance page files itself".
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
const ROUTE = read('src/app/api/hr/performance/reviews/export/route.ts');
const PAGE = read('src/app/(shell)/hr/performance/page.tsx');
const TEST = read('src/tests/perf-reviews-csv.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.96.0', () => {
  assert(atLeast(PKG.version, '2.96.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.96.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.96.0'), 'baseVersion');
});

check('whats-new leads with 2.96.0 and tells the filing story', () => {
  const i96 = WN.indexOf("version: '2.96.0'");
  const i95 = WN.indexOf("version: '2.95.0'");
  assert(i96 >= 0, 'no 2.96.0 entry');
  assert(i95 > i96, '2.96.0 does not lead the feed');
  assert(WN.includes('The performance page files themselves') || WN.includes('The performance page files itself'), 'headline');
  assert(WN.includes('The bench remembers the cycle'), 'bench bullet');
});

// ── 2. The pure builder ─────────────────────────────────────────────────────
check('builder reuses the digest escaper (one OWASP guard everywhere)', () => {
  assert(BUILDER.includes("import { csvCell } from '@/lib/hr/digest-csv'"), 'csvCell import');
  assert(BUILDER.includes('.map(csvCell)'), 'cells ride csvCell');
});

check('builder layout is the governed family: header block, caption, columns, CRLF', () => {
  assert(BUILDER.includes("row(['Report', 'Performance reviews'])"), 'Report line');
  assert(BUILDER.includes("row(['Organization', meta.organizationName])"), 'Organization line');
  assert(BUILDER.includes("row(['Scope', meta.scopeLabel])"), 'Scope line');
  assert(BUILDER.includes("row(['Cycle', meta.cycleLabel])"), 'Cycle line');
  assert(BUILDER.includes("row(['Status', meta.statusLabel])"), 'Status line');
  assert(BUILDER.includes("row(['Generated (UTC)', generatedAt.toISOString()])"), 'Generated line');
  assert(BUILDER.includes("row(['Employee', 'Job title', 'Cycle', 'Status', 'Acknowledged', 'Created'])"), 'columns');
  assert(BUILDER.includes("lines.join('\\r\\n') + '\\r\\n'"), 'RFC-4180 CRLF');
});

check('builder privacy floor: the row input cannot carry a rating', () => {
  const iface = BUILDER.split('export interface ReviewCsvRow')[1]?.split('\n}')[0] ?? '';
  assert(iface.length > 0, 'ReviewCsvRow interface missing');
  assert(!iface.includes('overallRating'), 'overallRating leaks');
  assert(!iface.includes('strengths'), 'strengths leaks');
  assert(!iface.includes('improvements'), 'improvements leaks');
});

check('builder honesty: empty list → null; filename slugs the filters', () => {
  assert(BUILDER.includes('if (reviews.length === 0) return null;'), 'null on empty');
  assert(BUILDER.includes('mbumah-performance-reviews-'), 'filename prefix');
  assert(BUILDER.includes("slug(meta.cycleLabel, 'all-cycles')"), 'cycle slug');
  assert(BUILDER.includes("slug(meta.statusLabel, 'all')"), 'status slug');
});

// ── 3. The route ────────────────────────────────────────────────────────────
check('route is read-guarded and re-runs listReviews — the file cannot drift from the screen', () => {
  assert(ROUTE.includes("hrGuard('hr.performance.review')"), 'guard');
  assert(ROUTE.includes('listReviews(session, {'), 'same service call');
  assert(ROUTE.includes('cycleId: parsed.cycleId ?? undefined'), 'cycle filter passes');
  assert(ROUTE.includes('status: parsed.status ?? undefined'), 'status filter passes');
});

check('route honesty: unknown status 400 INVALID_STATUS; empty list 404 NO_REVIEW_DATA', () => {
  assert(ROUTE.includes("'INVALID_STATUS'"), 'INVALID_STATUS');
  assert(ROUTE.includes('INVALID_STATUS'), 'code returned');
  assert(ROUTE.includes("'NO_REVIEW_DATA'"), 'NO_REVIEW_DATA');
  assert(ROUTE.includes('reviews.length === 0'), 'empty check');
});

check('route audits PERFORMANCE_REVIEWS_EXPORTED with field names only', () => {
  assert(ROUTE.includes("action: 'PERFORMANCE_REVIEWS_EXPORTED'"), 'audit action');
  assert(ROUTE.includes('HrEntityType.DATA_EXPORT'), 'DATA_EXPORT entity');
  const audit = ROUTE.split('await hrAudit')[1]?.split('}).catch')[0] ?? '';
  assert(audit.includes('count: reviews.length'), 'count metadata');
  assert(audit.includes('byteSize: file.byteSize'), 'byteSize metadata');
  assert(audit.includes("channel: 'ad_hoc_download'"), 'channel metadata');
  assert(!audit.includes('employeeName'), 'employee names ride the audit row');
});

// ── 4. The console ──────────────────────────────────────────────────────────
check('Reviews tab carries the filing door in the slate governed family', () => {
  const reviews = PAGE.split('<TabsContent value="reviews"')[1]?.split('<TabsContent value="goals"')[0] ?? '';
  assert(reviews.includes('data-testid="reviews-csv"'), 'csv button testid');
  assert(reviews.includes("'Building…'"), 'busy label');
  assert(reviews.includes('Nothing to file — no reviews match the current filters'), 'honest idle title');
  assert(reviews.includes('border-slate-300 text-slate-600'), 'slate family');
  assert(reviews.includes('data-testid="reviews-csv-note"'), 'local note');
});

check('the export rides the current filters and reports where the action lives', () => {
  const logic = PAGE.split('const exportReviewsCsv')[1]?.split('const run =')[0] ?? '';
  assert(logic.includes("/api/hr/performance/reviews/export"), 'endpoint');
  assert(logic.includes("qs.set('cycleId', filterCycleId)"), 'cycle rides');
  assert(logic.includes("qs.set('status', filterStatus)"), 'status rides');
  assert(logic.includes('Content-Disposition'), 'filename from server');
  assert(logic.includes('The governed filing format (header block, injection guard)'), 'success copy');
});

check('the bench remembers the cycle: amber badge or honest No cycle', () => {
  const bench = PAGE.split('the bench: recently deleted goals')[1]?.split('the cycle detail drawer')[0] ?? '';
  assert(bench.includes('goal-deleted-cycle-${g.id}'), 'cycle testid');
  assert(bench.includes('border-amber-300 text-amber-700'), 'amber family');
  assert(bench.includes('No cycle'), 'honest empty');
  assert(bench.includes('the same cycle it was filed under'), 'description copy');
});

// ── 5. Tests + prior anchors ────────────────────────────────────────────────
check('the new test suite pins the builder, the route and the console', () => {
  assert(TEST.includes("from '@/lib/hr/performance-csv'"), 'builder imported');
  assert(TEST.includes('parseReviewsExportQuery'), 'parser executed');
  assert(TEST.includes('OWASP formula-injection guard'), 'guard test');
  assert(TEST.includes('PERFORMANCE_REVIEWS_EXPORTED'), 'audit test');
});

check('prior anchors hold: 2.95 lifecycle, 2.94 notes, 2.93 bench, 2.88 filters', () => {
  assert(PAGE.includes('data-testid="cycle-detail-lifecycle"'), '2.95 strip');
  assert(PAGE.includes('data-testid="cycle-detail-notes-edit"'), '2.94 notes');
  assert(PAGE.includes('data-testid="goal-deleted-open"'), '2.93 bench door');
  assert(PAGE.includes('data-testid="review-filter-cycle"'), '2.88 filters');
});

const NAME = process.argv[1].split('/').pop();
console.log(`\n${NAME}: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
