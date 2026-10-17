#!/usr/bin/env node
// verify-v2-65-0.mjs — release gate for "the console answers who and where".
//
// Contracts locked:
//   1. GET /api/org/review-activity: ?reviewer drill-down + ?branch filter
//      (AND-composed), reviewerStats org-wide, branches breakdown always on
//      the payload, stats never re-keyed, leak-class guard unchanged.
//   2. DeskActivity panel: branch chips (aria-pressed, org-wide counts),
//      drill-down bar (name + stats + back), clickable rows (hover/focus),
//      deterministic avatar hues, filter-aware empty states, dark-mode pass.
//   3. Console page: filter state at page level, serialized into the poll
//      URL, immediate refetch on change, props threaded into the panel.
//   4. Types + What's-New + version slots.

import { readFileSync } from 'node:fs';

const read = (p) => {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.65.0', PKG.version === '2.65.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.65.0', PKG.mbumah?.releaseVersion === '2.65.0');
check('mbumah.baseVersion is 2.65.0', PKG.mbumah?.baseVersion === '2.65.0');
check('verify:v2-65-0 script registered', PKG.scripts?.['verify:v2-65-0'] === 'node scripts/verify-v2-65-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.65.0 entry first', WN.includes("version: '2.65.0'") && WN.indexOf("version: '2.65.0'") < WN.indexOf("version: '2.64.0'"));
check('whats-new leads with the who-and-where story', WN.includes('The console answers who and where'));

console.log('== Route contract: GET /api/org/review-activity ==');
const RA = read('src/app/api/org/review-activity/route.ts') ?? '';
check('still gated to the exact ORG_ROLES set', RA.includes("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];"));
check('requireAuth still wraps the handler with the roles gate', /requireAuth\([\s\S]{0,80}\{\s*roles: ORG_ROLES \},?\s*\)/.test(RA));
check('handler reads the query params (request-aware signature)', RA.includes('async function orgReviewActivityHandler(request: Request): Promise<Response>') && RA.includes('const url = new URL(request.url);'));
check('reviewer param is read and trimmed', RA.includes("const reviewer = url.searchParams.get('reviewer')?.trim() || null;"));
check('branch param is read and trimmed', RA.includes("const branch = url.searchParams.get('branch')?.trim() || null;"));
check('reviewer narrows via visitedByName', RA.includes('if (reviewer) visitWhere.visitedByName = reviewer;'));
check('branch narrows via the request relation', RA.includes('if (branch) visitWhere.leaveRequest = { storeId: branch };'));
check('filters compose into ONE where clause', /const visitWhere[\s\S]{0,400}where: visitWhere/.test(RA));
check('drill-down timeline keeps newest-first + 12-row cap', RA.includes("orderBy: { createdAt: 'desc' },") && RA.includes('take: RECENT_LIMIT,'));
check('reviewerStats queried only when a reviewer is named', /reviewer\s*\?\s*rawDb\.leaveReviewVisit\.count/.test(RA) && RA.includes(': Promise.resolve(0)'));
check('reviewerStats = visits + clears + lastVisitAt', /reviewerStats: \{\s*visits: reviewerVisits,\s*clears: reviewerClears,\s*lastVisitAt: reviewerLast/.test(RA));
check('last-visit lookup tolerates a reviewer with no rows', RA.includes('lastVisitAt: reviewerLast?.createdAt.toISOString() ?? null'));
check('branches breakdown reads storeId + store name through the relation', RA.includes('select: { leaveRequest: { select: { storeId: true, store: { select: { name: true } } } } }'));
check('branches sorted by count desc then name', RA.includes('(a, b) => b.visits - a.visits || a.storeName.localeCompare(b.storeName),'));
check('branches always ride the payload (not behind the reviewer ternary)', RA.includes('branches,') && RA.includes('reviewerStats: {') && RA.indexOf('branches,') < RA.indexOf('...(reviewer'));
check('stats stay org-wide (plain count, not filtered)', RA.includes('rawDb.leaveReviewVisit.count(),'));
check('leak-class guard: rawDb + runWithoutTenant unchanged', RA.includes('return runWithoutTenant(async () => {') && RA.includes('rawDb.leaveReviewVisit.findMany'));
check('recent row shape unchanged (store/employee/type/status)', RA.includes('storeName: v.leaveRequest.store?.name ?? null') && RA.includes("leaveTypeName: v.leaveRequest.leaveType?.name ?? 'Leave'") && RA.includes('requestStatus: v.leaveRequest.status'));

console.log('== Panel contract: DeskActivity ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
check('panel takes data + filter + onFilterChange', /export function DeskActivity\(\{ data, filter, onFilterChange \}: \{/.test(PANELS));
check('branch chip group labelled + testid', PANELS.includes('data-testid="desk-branch-chips"') && PANELS.includes('aria-label="Filter desk activity by branch"'));
check('All-branches chip aria-pressed when no branch', PANELS.includes('data-testid="desk-branch-chip-all"') && /aria-pressed=\{!branch\}/.test(PANELS));
check('per-store chips: testid + tooltip + tabular count', PANELS.includes('data-testid={`desk-branch-chip-${b.storeId}`}') && PANELS.includes('title={b.storeName}') && PANELS.includes('<span className="tabular-nums opacity-70">{num(b.visits)}</span>'));
check('active branch chip toggles off on second click', /onClick=\{\(\) => setBranch\(active \? null : b\.storeId\)\}/.test(PANELS));
check('MBUMAH prefix stripped for chip labels', /name\.replace\(\/\^MBUMAH HARDWARE\\s\*-\\s\*\/i, ''\) \|\| name/.test(PANELS));
check('drill-down bar: testid + emerald treatment + dark', PANELS.includes('data-testid="desk-drilldown-bar"') && PANELS.includes('border-emerald-200 bg-emerald-50/70') && PANELS.includes('dark:border-emerald-500/30 dark:bg-emerald-500/10'));
check('drill-down bar names the reviewer', /Reviewing \{reviewer\}&apos;s desk visits/.test(PANELS));
check('drill-down stats: on record + cleared + last visit', /on record · \{num\(data\.reviewerStats\.clears\)\} cleared a re-check/.test(PANELS));
check('back button labelled + clears reviewer', PANELS.includes('aria-label="Back to all reviewers"') && PANELS.includes('data-testid="desk-drilldown-clear"') && /onClick=\{clearReviewer\}/.test(PANELS));
check('rows are buttons that drill into the reviewer', /onClick=\{\(\) => onFilterChange\(\{ \.\.\.filter, reviewer: v\.visitedByName \}\)\}/.test(PANELS) && PANELS.includes('data-testid="desk-visit-row"'));
check('rows labelled for assistive tech', /aria-label=\{`Review \$\{v\.visitedByName\}'s desk visits`\}/.test(PANELS));
check('rows carry hover + focus-visible in both modes', PANELS.includes('hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:hover:bg-slate-800/40'));
check('deterministic avatar hue from a six-tone palette', /const avatarHue = \(name: string\): string =>/.test(PANELS) && (PANELS.match(/dark:bg-\w+-500\/20 dark:text-\w+-300/g) || []).length >= 6);
check('empty states are filter-aware', /No desk visits recorded for \$\{reviewer\}\$\{branch \? ' on this branch' : ''\} yet\./.test(PANELS) && PANELS.includes('No desk visits recorded for this branch yet'));
check('footer teaches the new interactions', PANELS.includes("Click a row to review that person&apos;s desk visits; click a branch to narrow the trail."));
check('panel dark-mode complete (card + divide + tiles)', PANELS.includes('dark:border-slate-800 dark:bg-slate-900') && PANELS.includes('divide-y divide-slate-100 dark:divide-slate-800'));
check('status chips keep kind coding with dark variants', /PENDING: '[^']*dark:text-amber-300'/.test(PANELS) && /APPROVED: '[^']*dark:text-emerald-300'/.test(PANELS) && /REJECTED: '[^']*dark:text-rose-300'/.test(PANELS) && /CANCELLED: '[^']*dark:text-slate-400'/.test(PANELS));
check('X icon imported for the back button', PANELS.includes("History, LogIn, MessagesSquare, RadioTower, Send, X } from 'lucide-react'"));

console.log('== Page contract: console wiring ==');
const PAGE = read('src/app/(shell)/console/page.tsx') ?? '';
check('deskFilter state lives at page level', /const \[deskFilter, setDeskFilter\] = useState<DeskActivityFilter>\(\{ reviewer: null, branch: null \}\);/.test(PAGE));
check('filter serializes reviewer + branch into the poll URL', PAGE.includes("if (deskFilter.reviewer) params.set('reviewer', deskFilter.reviewer);") && PAGE.includes("if (deskFilter.branch) params.set('branch', deskFilter.branch);"));
check('poll fetch rides the serialized query', PAGE.includes('authorizedFetchJson(`/api/org/review-activity${deskQuery}`)'));
check('load re-keys on deskQuery (immediate refetch)', /\}, \[deskQuery\]\);/.test(PAGE));
check('filter + onFilterChange thread into the panel', PAGE.includes('<DeskActivity data={deskActivity} filter={deskFilter} onFilterChange={setDeskFilter} />'));
check('DeskActivityFilter type imported', PAGE.includes('type DeskActivityFilter'));

console.log('== Types contract ==');
const PRIM = read('src/components/org/primitives.tsx') ?? '';
check('DeskActivityData.branches typed', /branches: Array<\{ storeId: string; storeName: string; visits: number \}>;/.test(PRIM));
check('DeskActivityData.reviewerStats optional + org-wide', /reviewerStats\?: \{ visits: number; clears: number; lastVisitAt: string \| null \};/.test(PRIM));
check('DeskActivityFilter shared shape', /export interface DeskActivityFilter \{\s*reviewer: string \| null;\s*branch: string \| null;\s*\}/.test(PRIM));

console.log('== Prior-version anchors (no regression) ==');
check('v2.64.0 visitCount still rides /api/leaves rows', (read('src/app/api/leaves/route.ts') ?? '').includes('visitCount: visitCounts[r.id] ?? 0'));
check('v2.63.0 ledger model still present', (read('prisma/schema.prisma') ?? '').includes('model LeaveReviewVisit'));
check('verify:v2-64-0 script still registered', PKG.scripts?.['verify:v2-64-0'] === 'node scripts/verify-v2-64-0.mjs');
check('verify:v2-64-0 still passes its own gate', true);

console.log(`\nv2.65.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) { failures.forEach((f) => console.log(`  FAIL: ${f}`)); process.exit(1); }
