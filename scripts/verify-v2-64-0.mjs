#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.64.0 verification
// Scope: the ledger steps into the light.
// (1) GET /api/leaves: every row carries the ledger TOTAL (visitCount) via
//     ONE best-effort groupBy over the page's request ids — the desk sees
//     "looked at 3 times" without opening the dialog.
// (2) Desk rows: the slate visit chip (History icon + honest count) with a
//     last-reviewer tooltip, a count-less "visited" chip for legacy rows
//     reviewed before the ledger, nothing for never-visited rows, and the
//     stamp response keeping the chip in pace live.
// (3) GET /api/org/review-activity: the org-wide ledger audit read —
//     ORG_ROLES gate (kpi-summary's set), rawDb + runWithoutTenant per the
//     v2.58.0 contract, stats (total / week / clears / distinct reviewers),
//     newest-first 12-row recent timeline joined to store + employee +
//     leave type + status.
// (4) The org console composes the DeskActivity panel (stat tiles, emerald
//     cleared chips, kind-coded status chips, empty state) with its own
//     rail entry, 30s poll slot and 401/403 degrade copy.
// Every v2.47–v2.63 feature is asserted intact.
// Run: node scripts/verify-v2-64-0.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.64.0', PKG.version === '2.64.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.64.0', PKG.mbumah?.releaseVersion === '2.64.0');
check('mbumah.baseVersion is 2.64.0', PKG.mbumah?.baseVersion === '2.64.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.64.0 entry first', WN.includes("version: '2.64.0'") && WN.indexOf("version: '2.64.0'") < WN.indexOf("version: '2.63.0'"));
check('whats-new leads with the ledger-in-light story', WN.includes('The ledger steps into the light'));

console.log('== Route contract: GET /api/leaves ==');
const LV = read('src/app/api/leaves/route.ts') ?? '';
check('the visit count is ONE groupBy over the page\u2019s request ids', LV.includes('db.leaveReviewVisit.groupBy') && LV.includes("by: ['leaveRequestId']") && LV.includes('_count: { _all: true }'));
check('the groupBy is scoped to the fetched requests', LV.match(/leaveRequestId:\s*\{\s*in:\s*requests\.map\(\(r\) => r\.id\)/) !== null);
check('the count read is best-effort under its own guard', LV.includes('// Visit-count read is best-effort by design.'));
check('an empty page skips the ledger read', LV.match(/if \(requests\.length > 0\)/) !== null);
check('every row carries visitCount defaulting to 0', LV.includes('visitCount: visitCounts[r.id] ?? 0'));

console.log('== Styling: the desk row visit chip ==');
const PT = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('the row type grew visitCount', PT.match(/visitCount\?: number;/) !== null);
check('the counted chip renders only for ledger-known rows', PT.includes('{l.deskReviewedAt && (l.visitCount ?? 0) > 0 ? (') && PT.includes('data-testid="desk-visit-chip"'));
check('the chip wears the History icon + honest singular/plural count', PT.includes("<History className=\"h-2.5 w-2.5\" aria-hidden /> {l.visitCount} {l.visitCount === 1 ? 'visit' : 'visits'}"));
check('the tooltip names the last reviewer + points at the dialog trail', PT.includes('on record') && PT.includes('The full trail (who looked, when, who cleared a re-check) lives in the request dialog.'));
check('legacy rows show the count-less visited chip', PT.includes('data-testid="desk-visit-chip-legacy"') && PT.includes('before the visit ledger kept history'));
check('the chip is informational slate (re-check stays the only alarm)', PT.includes('border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium text-slate-600') && PT.includes('dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300'));
check('the stamp response keeps the chip in pace', PT.includes("visitCount: typeof data.visitCount === 'number' ? data.visitCount : l.visitCount"));

console.log('== Route contract: GET /api/org/review-activity ==');
const RA = read('src/app/api/org/review-activity/route.ts') ?? '';
check('the route exists', RA !== null);
check('gated to the kpi-summary ORG_ROLES set', RA.includes("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];") && RA.match(/requireAuth\(\s*orgReviewActivityHandler,\s*\{\s*roles: ORG_ROLES \},?\s*\)/) !== null);
check('reads through rawDb inside runWithoutTenant (v2.58.0 contract)', RA.includes('return runWithoutTenant(async () => {') && RA.includes('rawDb.leaveReviewVisit.'));
check('the recent timeline is newest-first, capped at 12', RA.includes('const RECENT_LIMIT = 12;') && RA.match(/orderBy:\s*\{\s*createdAt: 'desc'\s*\}/) !== null);
check('recent rows join store + employee + leave type + status', RA.includes('store: { select: { name: true } }') && RA.includes('leaveType: { select: { name: true } }') && RA.match(/employee:\s*\{\s*select:\s*\{\s*firstName: true,\s*lastName: true\s*\}\s*\}/) !== null);
check('stats compute total / week / clears / distinct reviewers', RA.match(/rawDb\.leaveReviewVisit\.count\(\)/) !== null && RA.match(/count\(\{\s*where:\s*\{\s*createdAt:\s*\{\s*gte: weekAgo \},\s*clearedRecheck: true\s*\}\s*\}\)/) !== null && RA.includes("distinct: ['visitedByName']") && RA.includes('weekReviewers: weekReviewerRows.length'));
check('the payload is { generatedAt, stats, recent } with ISO times', RA.includes('generatedAt: now.toISOString()') && RA.match(/visitedAt: v\.createdAt\.toISOString\(\)/) !== null);

console.log('== Org console: the DeskActivity panel ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
const PRIM = read('src/components/org/primitives.tsx') ?? '';
const PAGE = read('src/app/(shell)/console/page.tsx') ?? '';
check('primitives declare DeskActivityData', PRIM.includes('export interface DeskActivityData'));
check('the panel renders the ledger heading + live pill', PANELS.includes('export function DeskActivity({ data }: { data: DeskActivityData })') && PANELS.includes('Desk activity — leave review ledger') && PANELS.includes('anim-live'));
check('the four stat tiles render', PANELS.includes("['Visits · 7 days', stats.weekVisits]") && PANELS.includes("['Cleared re-checks', stats.weekClears]") && PANELS.includes("['Reviewers active', stats.weekReviewers]") && PANELS.includes("['On record', stats.total]"));
check('clearing visits wear the emerald chip', PANELS.includes('<BadgeCheck className="h-2.5 w-2.5" aria-hidden /> cleared a re-check'));
check('reviewer initial avatars render', PANELS.includes('v.visitedByName.trim().charAt(0).toUpperCase()'));
check('the status chip is kind-coded per decision state', PANELS.includes('DESK_STATUS_CHIP') && PANELS.includes('APPROVED: \'border-emerald-200 bg-emerald-50 text-emerald-700\''));
check('an empty ledger degrades to the empty state', PANELS.includes('No desk visits recorded yet — the ledger fills as approvers open leave requests.'));
check('the console page fetches the endpoint in the 30s poll', PAGE.includes("authorizedFetchJson('/api/org/review-activity')") && PAGE.match(/const \[summaryRes, kpiRes, deskRes\] = await Promise\.all/) !== null);
check('the panel composes with its own rail entry + section id', PAGE.includes("{ id: 'desk-activity', label: 'Desk activity', icon: History }") && PAGE.includes('<div id="desk-activity">'));
check('401/403 degrade with role-explicit copy', PAGE.includes("'Sign in to load desk activity.'") && PAGE.includes("'Desk activity is limited to org roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER).'"));

console.log('== Tests ==');
const TS = read('src/tests/leave-visit-surface.test.ts') ?? '';
check('the v2.64.0 suite exists', TS.includes('the ledger steps into the light'));
check('the suite pins the row-level count contract', TS.includes('the ledger total rides each row'));
check('the suite pins the desk chip contract', TS.includes('the visit chip on every reviewed row'));
check('the suite pins the org audit contract', TS.includes('the org audit read'));

console.log('== History: v2.47–v2.63 anchors intact ==');
check('v2.58.0 tableToCsv still present', (read('src/lib/hr/digest-csv.ts') ?? '').includes('export function tableToCsv'));
check('v2.57.0 rawDb feed fix still present', (read('src/lib/db.ts') ?? '').includes('rawDb'));
check('v2.59.0 re-check chip still present', PT.includes('re-check'));
check('v2.60.0 reviewer stamp still personal', LV.includes('deskReviewedByName: r.deskReviewedByName ?? null'));
check('v2.61.0 employee bell still gated + named', (read('src/app/api/leaves/[id]/review/route.ts') ?? '').includes('kind: LEAVE_REVIEW_SEEN_METADATA_MARKER'));
check('v2.62.0 answered fan-out still present', (read('src/app/api/leaves/[id]/review/route.ts') ?? '').includes('kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER'));
check('v2.63.0 dialog timeline still renders', PT.includes('data-testid="leave-visit-history"') && PT.includes("<History className=\"h-3 w-3\" aria-hidden />"));
check('v2.63.0 ledger model still present', (read('prisma/schema.prisma') ?? '').includes('model LeaveReviewVisit'));
check('v2.63.0 verify script still exists', !!read('scripts/verify-v2-63-0.mjs'));

console.log('');
if (failures === 0) {
  console.log('v2.64.0 verification: ALL PASS');
} else {
  console.log(`v2.64.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
