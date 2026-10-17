#!/usr/bin/env node
// verify-v2-67-0.mjs — release gate for "the desk writes its own morning note".
//
// Contracts locked:
//   1. /api/org/review-activity ships a `yesterday` digest derived from the
//      previous EAT (Nairobi) calendar day — a real [00:00, 24:00) window.
//   2. The digest is org-wide by contract: never narrowed by the panel's
//      drill-down/branch filters (same rule as stats/branches).
//   3. The DeskActivity panel renders the dawn strip: Sunrise heading,
//      four figures, busiest-branch + top-reviewer chips, per-branch mini
//      chips, honest quiet-day empty state — dark-mode complete.
//   4. Types (DeskActivityData.yesterday) + What's-New 2.67.0 + version slots.
//   5. Prior surfaces intact (drill-down, branch chips, rows, tiles).

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
// v2.68.0 precedent: prior-release version pins are looser every round —
// this script must keep passing on this and later versions.
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.67.0', atLeast(PKG.version, '2.67.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.67.0', atLeast(PKG.mbumah?.releaseVersion, '2.67.0'));
check('mbumah.baseVersion is >= 2.67.0', atLeast(PKG.mbumah?.baseVersion, '2.67.0'));
check('verify:v2-67-0 script registered', PKG.scripts?.['verify:v2-67-0'] === 'node scripts/verify-v2-67-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.67.0 entry first', WN.includes("version: '2.67.0'") && WN.indexOf("version: '2.67.0'") < WN.indexOf("version: '2.66.0'"));
check('whats-new leads with the morning-note story', WN.includes('The desk writes its own morning note'));
check('whats-new feed has grown to 67+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 67);

console.log('== Morning-note read: /api/org/review-activity ==');
const RA = read('src/app/api/org/review-activity/route.ts') ?? '';
check('yesterday is the previous EAT calendar day (UTC+3)', RA.includes('const EAT_OFFSET_MS = 3 * 3_600_000;') && /const eatNow = new Date\(now\.getTime\(\) \+ EAT_OFFSET_MS\);/.test(RA));
check('window is [yesterdayStart, todayStart), not a trailing 24h', /const yesterdayStart = new Date\(todayStart\.getTime\(\) - DAY_MS\);/.test(RA) && /createdAt: \{ gte: yesterdayStart, lt: todayStart \}/.test(RA));
check('day label derived server-side on the EAT wall clock', /toLocaleDateString\('en-GB', \{\s*weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',\s*\}\)/.test(RA));
check('payload ships the full yesterday block', ['date: yesterdayStart.toISOString(),', 'label: yesterdayLabel,', 'visits: digestVisits,', 'clears: digestClears,', 'reviewers: reviewerDigest.size,', 'requests: requestIds.size,', 'branches: digestBranches,'].every((s) => RA.includes(s)));
check('busiest branch + top reviewer derive to honest nulls on a quiet day', /busiestBranch: digestBranches\[0]\s*\?\s*\{/.test(RA) && /topReviewer: digestTopReviewer\s*\?\s*\{/.test(RA));
check('digest figures derived in one pass over the window rows', RA.includes('for (const row of yesterdayRows) {') && RA.includes('requestIds.add(row.leaveRequestId);'));
check('the note is org-wide — never narrowed by visitWhere', /Deliberately NOT narrowed by visitWhere/.test(RA));
check('org gate + rawDb + runWithoutTenant unchanged', RA.includes("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];") && RA.includes('return runWithoutTenant(async () => {'));
check('timeline query still uses the filter predicate', RA.includes('where: visitWhere,'));

console.log('== Dawn strip: the DeskActivity panel ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
const digestStart = PANELS.indexOf('data-testid="desk-digest"');
const tiles = PANELS.indexOf('Stat tiles — org-wide figures');
check('strip renders between the header and the stat tiles', digestStart > -1 && tiles > digestStart);
const D = digestStart > -1 ? PANELS.slice(digestStart, tiles) : '';
check('dawn gradient card in both colour modes', D.includes('bg-gradient-to-r from-amber-50/90 via-white to-emerald-50/70') && D.includes('dark:from-amber-500/10 dark:via-slate-900 dark:to-emerald-500/10'));
check('Sunrise heading with the day label', D.includes('<Sunrise className="h-3.5 w-3.5 text-amber-500"') && D.includes('Yesterday at the desk') && D.includes('{yesterday.label}'));
check('status role + aria label', D.includes('role="status"') && D.includes('aria-label="Yesterday at the desk"'));
check('every figure under an honest testid', ['desk-digest-heading', 'desk-digest-label', 'desk-digest-visits', 'desk-digest-clears', 'desk-digest-reviewers', 'desk-digest-requests'].every((id) => D.includes(`data-testid="${id}"`)));
check('busiest-branch chip (emerald, short name)', D.includes('data-testid="desk-digest-busiest"') && D.includes('busiest · {shortStoreName(yesterday.busiestBranch.storeName)}'));
check('top-reviewer chip wears the deterministic reviewer hue', D.includes('data-testid="desk-digest-top-reviewer"') && D.includes('${avatarHue(yesterday.topReviewer.name)}'));
check('per-branch mini chips capped at three on multi-branch days', /yesterday\.branches\.slice\(0, 3\)\.map\(\(b\) => \(/.test(D) && D.includes('data-testid="desk-digest-branches"'));
check('quiet day says so honestly (empty state, no fake zeros)', D.includes('data-testid="desk-digest-empty"') && D.includes('The desk was quiet yesterday — no visits on record.'));
check('singular/plural honesty on every figure', ['visit{yesterday.visits === 1', 'correction{yesterday.clears === 1', 'reviewer{yesterday.reviewers === 1', 'request{yesterday.requests === 1'].every((s) => D.includes(s)));
check('strip is dark-mode complete', D.includes('text-emerald-600 dark:text-emerald-400') && D.includes('dark:border-amber-500/20 dark:bg-amber-500/5') && D.includes('dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400'));

console.log('== Types ==');
const PRIM = read('src/components/org/primitives.tsx') ?? '';
check('DeskActivityData declares the yesterday block', /yesterday: \{\s*date: string;\s*label: string;\s*visits: number;\s*clears: number;\s*reviewers: number;\s*requests: number;\s*busiestBranch: \{ storeName: string; visits: number \} \| null;\s*topReviewer: \{ name: string; visits: number \} \| null;\s*branches: Array<\{ storeId: string; storeName: string; visits: number \}>;\s*\};/.test(PRIM));
check('type documents the org-wide contract', PRIM.includes('the note never re-keys under the panel\'s filters'));

console.log('== Prior-version anchors (no regression) ==');
check('v2.65.0 drill-down bar still in the panel', PANELS.includes('data-testid="desk-drilldown-bar"'));
check('v2.65.0 branch chips still in the panel', PANELS.includes('data-testid="desk-branch-chips"') && PANELS.includes('data-testid="desk-branch-chip-all"'));
check('v2.65.0 timeline rows + empty state intact', PANELS.includes('data-testid="desk-visit-row"') && PANELS.includes('data-testid="desk-empty-state"'));
check('v2.64.0 ledger model still present', (read('prisma/schema.prisma') ?? '').includes('model LeaveReviewVisit'));
check('v2.66.0 changelog modal contract untouched', (read('src/components/org/chrome.tsx') ?? '').includes('data-testid="changelog-modal"'));
check('console page still threads data + filter into the panel', /<DeskActivity data=\{deskActivity\} filter=\{deskFilter\} onFilterChange=\{setDeskFilter\} \/>/.test(read('src/app/(shell)/console/page.tsx') ?? ''));
check('verify:v2-66-0 script still registered', PKG.scripts?.['verify:v2-66-0'] === 'node scripts/verify-v2-66-0.mjs');
check('digest test suite present', (read('src/tests/desk-digest.test.ts') ?? '').includes('the desk writes its own morning note'));

console.log(`\nv2.67.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) { failures.forEach((f) => console.log(`  FAIL: ${f}`)); process.exit(1); }
