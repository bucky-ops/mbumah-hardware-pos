#!/usr/bin/env node
// v2.88.0 verification — "the cycle shows its shape".
// Written fresh this round (never patch a prior round's copy): every check
// reads the SOURCE OF RECORD, not memory.

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
const PAGE = read('src/app/(shell)/hr/performance/page.tsx');
const SERVICE = read('src/lib/hr/performance-service.ts');
const GOALS_VIEW = read('src/app/(selfservice)/employees/me/goals/goals-view.tsx');

// ── 1. Version slots ────────────────────────────────────────────────────────
// atLeast semantics from birth (the v2-85 lesson: a === pin breaks on every
// later bump and forces a re-anchor round).
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.88.0', () => {
  assert(atLeast(PKG.version, '2.88.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.88.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.88.0'), 'baseVersion');
});

// ── 2. What's-New 2.88.0 leads the feed ─────────────────────────────────────
check("What's-New 2.88.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.88.0'");
  assert(at > -1, '2.88.0 entry missing');
  assert(at < WN.indexOf("version: '2.87.0'"), '2.88.0 does not lead');
  assert(/shows its shape/.test(WN), 'title missing');
  assert(/calibration meter/i.test(WN), 'meter bullet missing');
  assert(/View reviews/.test(WN), 'cross-link bullet missing');
  assert(/Showing X of Y/.test(WN), 'count-line bullet missing');
  assert(/never appear in any list/i.test(WN), 'privacy bullet missing');
});

// ── 3. Service: statusCounts join CycleDto additively ───────────────────────
check('service folds per-cycle status counts from one grouped query', () => {
  assert(SERVICE.includes('export interface CycleStatusCounts'), 'CycleStatusCounts missing');
  assert(/statusCounts:\s*CycleStatusCounts/.test(SERVICE), 'CycleDto did not grow statusCounts');
  assert(/db\.performanceReview\.groupBy\(\{/.test(SERVICE), 'groupBy missing');
  assert(/by: \['cycleId', 'status'\]/.test(SERVICE), 'groupBy keys drifted');
  assert(/deletedAt:\s*null,\s*cycleId:\s*\{\s*in:/.test(SERVICE), 'groupBy scope drifted');
  // the old shape stays intact
  assert(/reviewCount: c\._count\.reviews/.test(SERVICE), 'reviewCount drifted');
  assert(/_count:\s*\{\s*select:\s*\{\s*reviews:\s*true\s*\}\s*\}/.test(SERVICE), '_count include drifted');
});

// ── 4. Console: the calibration meter ───────────────────────────────────────
check('cycle rows wear a calibration meter with an honest fraction', () => {
  assert(PAGE.includes('data-testid={`cycle-meter-${c.id}`}'), 'meter testid missing');
  assert(PAGE.includes('data-testid={`cycle-meter-text-${c.id}`}'), 'meter text testid missing');
  assert(PAGE.includes('<ProgressMeter'), 'ProgressMeter missing');
  assert(/\{c\.statusCounts\.CALIBRATED\} of \{c\.reviewCount\} calibrated/.test(PAGE), 'fraction copy missing');
  assert(/label=\{`Calibration progress for \$\{c\.name\}/.test(PAGE), 'accessible name missing');
});

check('the meter is honest about empty cycles and the remainder', () => {
  assert(PAGE.includes('No reviews yet'), 'empty-cycle copy missing');
  assert(/\$\{c\.statusCounts\.DRAFT\} draft/.test(PAGE), 'draft remainder missing');
  assert(/\$\{c\.statusCounts\.SUBMITTED\} submitted/.test(PAGE), 'submitted remainder missing');
  assert(/\$\{c\.statusCounts\.ACKNOWLEDGED\} acknowledged/.test(PAGE), 'acknowledged remainder missing');
  assert(/pct >= 100 \? 'good' : pct > 0 \? 'info' : 'warn'/.test(PAGE), 'tone rule drifted');
});

// ── 5. Console: the meter is a door ─────────────────────────────────────────
check('View reviews cross-link jumps into the filtered reviews tab', () => {
  assert(PAGE.includes('data-testid={`cycle-view-reviews-${c.id}`}'), 'cross-link testid missing');
  assert(/const viewCycleReviews = \(cycleId: string\) => \{/.test(PAGE), 'jump fn missing');
  assert(/setFilterCycleId\(cycleId\);/.test(PAGE), 'cycle seed missing');
  assert(/setFilterStatus\('ALL'\);/.test(PAGE), 'status reset missing');
  assert(/setTab\('reviews'\);/.test(PAGE), 'tab switch missing');
  assert(/<Tabs value=\{tab\} onValueChange=\{setTab\}/.test(PAGE), 'tabs not controlled');
});

// ── 6. Console: the reviews tab gains handles ───────────────────────────────
check('cycle picker + status chips with live counts', () => {
  assert(PAGE.includes('data-testid="review-filter-cycle"'), 'cycle select missing');
  assert(PAGE.includes('aria-label="Filter by cycle"'), 'select aria missing');
  assert(PAGE.includes('<SelectItem value="ALL">All cycles</SelectItem>'), 'ALL option missing');
  assert(/data-testid=\{`review-filter-status-\$\{s\}`\}/.test(PAGE), 'status chips missing');
  assert(/aria-pressed=\{active\}/.test(PAGE), 'chips not pressed-aware');
  assert(/const count = s === 'ALL' \? \(reviews \?\? \[\]\)\.length : reviewStatusCounts\[s as keyof CycleStatusCounts\];/.test(PAGE), 'chip counts not full-list');
});

check('active chips wear their own badge families, light and dark', () => {
  assert(PAGE.includes("SUBMITTED: 'bg-amber-100 text-amber-800 border-amber-300"), 'submitted family missing');
  assert(PAGE.includes("ACKNOWLEDGED: 'bg-sky-100 text-sky-800 border-sky-300"), 'acknowledged family missing');
  assert(PAGE.includes("CALIBRATED: 'bg-emerald-100 text-emerald-800 border-emerald-300"), 'calibrated family missing');
  assert(PAGE.includes("DRAFT: 'bg-slate-100 text-slate-800 border-slate-300"), 'draft family missing');
});

check('filtering is real, and the picture stays honest', () => {
  assert(/const filteredReviews = useMemo\(/.test(PAGE), 'filtered subset missing');
  assert(/\(filterCycleId === 'ALL' \|\| r\.cycleId === filterCycleId\)/.test(PAGE), 'cycle predicate missing');
  assert(/\(filterStatus === 'ALL' \|\| r\.status === filterStatus\)/.test(PAGE), 'status predicate missing');
  assert(PAGE.includes('{filteredReviews.map((r) => ('), 'table not filtered');
  assert(PAGE.includes('data-testid="review-filter-count"'), 'count line missing');
  assert(/Showing \{filteredReviews\.length\} of \{\(reviews \?\? \[\]\)\.length\} reviews/.test(PAGE), 'count copy drifted');
  assert(PAGE.includes('data-testid="review-filter-clear"'), 'clear button missing');
  assert(PAGE.includes('No reviews match the current filters.'), 'filtered empty state missing');
});

// ── 7. The sensitive-data rule survives the new shape ───────────────────────
check('lists and meters never carry ratings; the dialog still gates them', () => {
  const listRegion = PAGE.split('const [tab, setTab]')[1]?.split('Review detail dialog')[0] ?? '';
  assert(listRegion.length > 0, 'list region parse failed');
  assert(!listRegion.includes('overallRating'), 'list region references a rating');
  assert(!listRegion.includes('strengths') && !listRegion.includes('improvements'), 'list region references narratives');
  assert(PAGE.includes('detail.overallRating'), 'detail dialog rating drifted');
  const dto = SERVICE.split('export interface CycleDto')[1].split('}')[0];
  assert(!/overallRating|strengths|improvements/.test(dto), 'CycleDto grew sensitive fields');
  // self-service read half stays intact (v2.87.0 anchor)
  assert(GOALS_VIEW.includes('data-testid="my-review-panel"'), 'my-review panel drifted');
});

// ── 8. Prior anchors ────────────────────────────────────────────────────────
check('v2.87.0 write/read loop intact (edit form + save gate)', () => {
  assert(PAGE.includes("'Write review' : 'Edit review'"), 'edit affordance drifted');
  assert(PAGE.includes('perf-save-draft'), 'save-draft testid drifted');
  assert(/disabled=\{busy \|\| editRating === null\}/.test(PAGE), 'rating gate drifted');
});

check('v2.86.0 who’s-next surface intact (strip + waiting-since)', () => {
  const RUNS_PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
  const DIALOG = read('src/components/hr/payroll-run-dialog.tsx');
  assert(RUNS_PAGE.includes('payroll-run-waiting-since'), 'waiting-since cell drifted');
  assert(DIALOG.includes('Waiting on <span className="font-semibold">you</span>'), 'strip seats drifted');
});

check('desk-report family stays archived (v2.82 anchors)', () => {
  const DESK = read('src/lib/hr/desk-report.ts');
  assert(DESK.includes('deskReportRequestLedger'), 'desk ledger drifted');
});

console.log(`\nv2.88.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
