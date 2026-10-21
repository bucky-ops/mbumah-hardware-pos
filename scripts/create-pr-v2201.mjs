#!/usr/bin/env node
// create-pr-v2201.mjs - opens the v2.201.0 release PR (the established flow:
// REST API with the PAT from GITHUB_TOKEN; the repo path derived from
// the remote, never hardcoded; curl -sL for the rename redirect).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const TOKEN = (remote.match(/x-access-token:([^@]+)@/) || [])[1] || process.env.GITHUB_TOKEN || '';
const repoPath = (remote.match(/github\.com\/([^/]+\/[^.]+)\.git/) || [])[1];
const REPO = repoPath || 'collins-muchiri/mbumah-hardware-pos';
const HEAD = 'release/v2.201.0';
const BASE = 'main';

const body = [
  '## v2.201.0 - The debt book and the movers speak',
  '',
  'The branch KPI row found its three voices in v2.200.0 - and the assessment that picked this round walked the door arc down the page bottom grid, where TWO cards still rendered their stories in silence even though every figure they could drill into already rode the dashboard wire: the Debt Aging SUMMARY card spoke total + buckets + a bill count while `debtCrisis.customers` carried the wire top-10 NAMED debtors (name, owes, lifetimeSpend, ratio, highRisk) and `highRiskCount` / `warning` / `banner` carried the alarm; the Top Selling Products card ranked today movers five deep while the wire names TEN and a category mix (`topSellingCategories`, the route full GROUP BY over the day lines) the tab had never read. Both cards become doors; both modals compose the SAME answer the cards show - zero new queries.',
  '',
  '### What ships',
  '- **The branch debt book** (`branch-doors.tsx` + `dashboard-tab.tsx`): the Debt Aging card becomes the debt family ROSE door (`testId="branch-debt-card"`, edge bar rose-600, the live dot and the hot ring lit ONLY by the wire own `warning` flag) and opens **The branch debt book** - the aging bar at reading size (role="img" naming all four buckets and the total), the four bucket cells each with dot + label + amount + an honest `% of the book` (a zero bucket draws nothing and says "none"), the named debtors loudest-first with each debtor share of the book and the **wire own risk voice** (a high-risk debtor owes more than twice their lifetime spend - the server rule spoken in words, never re-derived; the wire ratio speaks as "% of it owed"; a debtor with no completed purchases says so), the high-risk count line, the server warning banner verbatim, the unnamed step-aside, the clear-book line, and the **honest window note** - the book names its loudest debtors, the BILL count stays the truth.',
  '- **The day movers** (`branch-doors.tsx`): the Top Products card becomes the VIOLET door - a new hue for products (`testId="branch-movers-card"`, the hot ring lit only when the day has movers) and opens **The day movers** - the headline with the named window totals and the loudest mover spoken in words, the FULL named roster (the wire 10, not the card 5) with qty, revenue and an honest `% of the named window`, and the **category mix** with the wire own category colors and honest `% of the mix` (silent when its named total is zero - no percentage of nothing); the window note names what the doors read; the zero day speaks its line. The tab type gains `topSellingCategories` as a structural subset the wire already carries.',
  '- **The house laws hold from birth**: both panels paint their dark half (`dark:border-slate-700 dark:bg-slate-900` - the branch page next TWO mounts of the dark-panel law, one shared chrome constant); the doors are self-contained focus views with **no anchors** (the honest-door law); null wire rows are filtered by type predicate, never a non-null assertion; the hook-order law (door state before any early return); the doors render only inside the FULL dashboard (the limited row untouched).',
  '- **THE ROUND CONTRAST SWEEP - the -600 straggler family closed** (measured by the pre-derivation probe BEFORE anything was re-voiced): the Alerts count badge white-on-red-500 **3.82:1** -> `bg-red-700` **6.42:1**; the payment DEBT chip rose-600 on rose-100 **3.75:1** -> rose-700 **5.04:1**; the GIFT_CARD chip slate-500 on slate-100 **4.35:1** -> slate-600 **6.90:1**; the alert CRITICAL chip red-600 on red-100 **3.90:1** -> red-700 **5.26:1**; the crisis banner sub-line and the trend DOWN chip red-600 on red-50 **4.36:1** -> red-700 **5.88:1** (the v2.199 login-error pairing, third instance). RECORDED HONESTLY as alignment, not violation: red-600 on white PASSES the installed palette at 4.76:1, so the KPI card values, the shift drawer cash-out, the top-customers "Owes", the high-risk avatar initials and the debt card own total moved -600 -> -700 as FAMILY ALIGNMENT (the v2.199 Store-Matrix precedent) plus margin; the debt book own figures rode in at a knife-edge 4.51:1 and were moved to rose-700/rose-300 (6.06/9.29). The five draft pairs are pinned below the bar in REVERSE.',
  '- **The v2.200.0 carried nit**: the receipts-by-hour aria spoke "with 1 receipts" - now "1 receipt" / "N receipts" (`kpi-doors.tsx`).',
  '',
  '### Tests',
  '- `src/tests/branch-quiet-doors-v2201.test.ts` (NEW, 40 tests): the wire purity (no fetch, no db, structural subsets, the predicate-filter law); the debt book wire-owned risk voice, honest shares, window note, alarm voices, clear/unnamed lines; the movers window shares, category mix, zero-total silence, loudest-mover voice; the two doors faces, hot-ring honesty gates, hook-order law, limited-row untouched, no-anchors law; the sweep five fixes + the alignment record + the ghosts in reverse; the dark-panel law and the carried pluralization nit; the release surfaces.',
  '- `scripts/contrast-math-branch-doors-v2201.mjs`: **43/43 checks pass** (light + dark over the REAL chain, the five ghosts pinned in reverse, the alignment note recorded honestly, the decoration documented per the v2.198.0 law). `scripts/probe-quiet-doors-v2201.mjs`: the pre-derivation evidence.',
  '- Deliberate pin evolutions with reasoning: prior suites pkg pins ride to 2.201.0 across the suite (96 pins, the treadmill tax); head-pin counters re-anchored (89/90/91/122 -> 90/91/92/123); the v2.200 round changelog pin moved to the treadmill-proof ORDER pattern.',
  '- `verify:v2-201-0` wired - 13/13 PASS. FULL vitest **4179/4179** (202 files) - lint 0 errors / 542 warnings (baseline EXACT) - the contrast script 43/43 - build exit 0.',
  '',
  '### Risk',
  'Low: zero wire changes (both doors compose fields the response already carries); the two cards swap div -> button with the light voice kept; rose/violet are the debt family face and one new product hue (each edge measured as a graphic 4.51/5.88 over the white card); the sweep is one-token re-voices measured by the committed probe + pinned in reverse; the fallback paths keep older cached answers calm (the unnamed step-aside, the clear lines, the zero-total silence); no anchors means no new role-gated doors.',
  '',
  '### Release checklist',
  '- [x] Version bump 2.200.0 -> 2.201.0 (all three package.json slots)',
  '- [x] CHANGELOG + whats-new feed head the release',
  '- [x] `scripts/verify-v2-201-0.mjs` fresh-written, 13/13 PASS',
  '- [x] Full vitest, lint, build gates green before push',
  '- [ ] Required checks green, then squash merge (release.yml tags + publishes)',
];

if (!TOKEN) {
  console.error('NO TOKEN: set GITHUB_TOKEN');
  process.exit(1);
}

const res = execSync(
  `curl -sL -X POST -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" ` +
  `-d @- https://api.github.com/repos/${REPO}/pulls`,
  { input: JSON.stringify({ title: 'feat: the debt book and the movers speak (v2.201.0)', head: HEAD, base: BASE, body: body.join('\n') }), encoding: 'utf8' },
);
const pr = JSON.parse(res);
if (pr.number) {
  console.log(`PR #${pr.number} opened: ${pr.html_url}`);
} else {
  console.error('PR FAILED:', res.slice(0, 400));
  process.exit(1);
}
