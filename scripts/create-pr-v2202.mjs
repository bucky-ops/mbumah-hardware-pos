#!/usr/bin/env node
// create-pr-v2202.mjs - opens the v2.202.0 release PR.
import { execSync } from 'node:child_process';
const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const TOKEN = (remote.match(/x-access-token:([^@]+)@/) || [])[1] || process.env.GITHUB_TOKEN || '';
const repoPath = (remote.match(/github\.com\/([^/]+\/[^.]+)\.git/) || [])[1];
const REPO = repoPath || 'collins-muchiri/mbumah-hardware-pos';

const body = [
  '## v2.202.0 - The org\'s quiet row speaks',
  '',
  'The door arc walked three surfaces - the /console KPI command row (v2.195-v2.199, six voices), the branch workspaces\' KPI row (v2.200.0, three) and bottom grid (v2.201.0, two) - while the ORG CONSOLE\'s "Combined organization metrics" section still rendered its SIX tiles as silent divs, even though the summary wire (`GET /api/org/summary`) has carried the per-branch slices all along: `stores[]` with each branch\'s todayRevenue, todayTransactions, lowStockCount, overdueRentals, debtOutstanding + debtCount and pendingMpesa. This release gives the six tiles the door vocabulary and ONE parametrized branch-slice modal - zero new queries.',
  '',
  '### What ships',
  '- **The six doors** (`org-console.tsx` + `desk-doors.tsx`): `StatCard` gains the door vocabulary (`onDoor` / `doorTestId` / `doorEdgeClass` / `doorDotClass` / `doorHot` - role=button, keyboard, the "- open details" aria voice, the family edge bar, the live dot, the hot ring lit ONLY when the metric\'s org total is nonzero). The six tiles wear the /console KPI row\'s own face inventory (orange revenue, blue transactions, amber stock, rose rentals, red debt, indigo pending) and open **the branch slice** for each (`org-desk-card-{metric}`).',
  '- **The branch slice** (`src/components/org/desk-doors.tsx`): ONE parametrized modal (`BranchSliceModal` + the `ORG_DESK_METRICS` registry - the one-writer rule) speaking the named branch rows loudest-first with each branch\'s honest `% of the org`, the count sub-line where the wire carries one (transactions ride the revenue rows; the debt book\'s bill count rides the debt rows), the **quiet branches speaking their 0** (never dropped), the zero-day clear line, the empty step-aside, and the **window note** - the slice reads the branches named on this summary, the branches table carries each workspace\'s door (the pointer in words, not a link - the honest-door law). The zero-total rule: no percentage of nothing.',
  '- **The voice lint** (`scripts/voice-lint.mjs`): the v2.201.1 lesson made mechanical - a grep for the double-currency class (a literal "KES"/"Ksh" wrapped around formatKES, which already speaks "Ksh") across the UI sources; zero findings on the current tree, a finding is a release blocker.',
  '- **The house laws hold from birth**: the panel paints its dark half (the org desk\'s mount of the dark-panel law); no anchors; null wire rows filtered by predicate; the hook-order law; the RBAC is the summary\'s own (the doors compose the slices the viewer already receives).',
  '- **THE ROUND STYLE - the six-hue vocabulary measured BEFORE ship** (`scripts/probe-desk-doors-v2202.mjs`, 36/36): the -700 accents 5.05-8.07:1 on white, the -50 chip grounds 4.87-7.22:1, the -300 dark accents 8.88-12.34:1 on slate-900, the -500/10 dark chip stacks 8.05-10.63:1, the edges as graphics 3.19-6.44:1. ONE honest alignment: the branches table\'s overdue cell rode text-red-600 on bg-card (4.76:1 - a PASS on the installed palette) and re-voiced to red-700 (6.42:1) as the Task-188 family alignment, recorded as alignment, not violation (`scripts/contrast-math-desk-doors-v2202.mjs`, 42/42).',
  '',
  '### Tests',
  '- `src/tests/desk-doors-v2202.test.ts` (NEW, 30 tests): the wire purity; the six-metric registry in the face hues; the ONE modal one-writer rule; the loudest-first sort; the honest shares + zero-total rule; the quiet-branch voice; the count sub-lines; the clear/empty voices; the no-anchors law; the six card handles + hook-order law + honest hot ring; the HR tiles keeping their hrefs; the family voices; the dark-panel law; the alignment record; the probe + voice lint pins; the release surfaces.',
  '- Deliberate pin evolutions: prior suites\' pkg pins ride to 2.202.0 (the treadmill tax); head-pin counters re-anchored (91/92/93/124 -> 92/93/94/125).',
  '- `verify:v2-202-0` wired - 12/12 PASS. FULL vitest **4210/4210** (203 files) - lint 0 errors / 542 warnings (baseline EXACT) - the contrast script 42/42 - the voice lint clean - build exit 0.',
  '',
  '### Risk',
  'Low: zero wire changes (the doors compose the slices the response already carries); the tiles swap div -> button with the light voice kept; the six hues are the /console family\'s own faces (each measured in both modes); the doors render only where the summary already renders; the fallback paths keep older cached answers calm (the empty step-aside, the clear lines, the zero-total silence); no anchors means no new role-gated doors.',
  '',
  '### Release checklist',
  '- [x] Version bump 2.201.1 -> 2.202.0 (all three package.json slots)',
  '- [x] CHANGELOG + whats-new feed head the release',
  '- [x] `scripts/verify-v2-202-0.mjs` fresh-written, 12/12 PASS',
  '- [x] Full vitest, lint, build gates green before push',
  '- [ ] Required checks green, then squash merge (release.yml tags + publishes)',
];
if (!TOKEN) { console.error('NO TOKEN'); process.exit(1); }
const res = execSync(
  `curl -sL -X POST -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" -d @- https://api.github.com/repos/${REPO}/pulls`,
  { input: JSON.stringify({ title: "feat: the org's quiet row speaks (v2.202.0)", head: 'release/v2.202.0', base: 'main', body: body.join('\n') }), encoding: 'utf8' },
);
const pr = JSON.parse(res);
if (pr.number) console.log(`PR #${pr.number} opened: ${pr.html_url}`);
else { console.error('PR FAILED:', res.slice(0, 300)); process.exit(1); }
