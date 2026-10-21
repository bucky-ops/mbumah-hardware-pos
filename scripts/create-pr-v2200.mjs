#!/usr/bin/env node
// create-pr-v2200.mjs - opens the v2.200.0 release PR (the established flow:
// REST API with the PAT from GITHUB_TOKEN; the repo path derived from
// the remote, never hardcoded - LESSON 81; curl -sL for the rename
// redirect - LESSON from the v2.199.0 round).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const TOKEN = (remote.match(/x-access-token:([^@]+)@/) || [])[1] || process.env.GITHUB_TOKEN || '';
const repoPath = (remote.match(/github\.com\/([^/]+\/[^.]+)\.git/) || [])[1];
const REPO = repoPath || 'collins-muchiri/mbumah-hardware-pos';
const HEAD = 'release/v2.200.0';
const BASE = 'main';

const body = [
  '## v2.200.0 - The branch row speaks',
  '',
  'The org console KPI row finished its door arc in v2.199.0 with every card speaking - and the assessment that picked this round asked the worklog own open question: does a BRANCH-level dashboard have a row of quiet tiles with named wires behind them? It does. The branch workspaces KPI row had three quiet tiles - Todays Revenue, Transactions and Avg Transaction rendered divs with no affordance - even though every story they could tell already rode the dashboard wire: `hourlySalesBreakdown` (the full day, hour by hour), `paymentMethodBreakdown` (a full GROUP BY - the complete tender mix, not a window) and `recentTransactions` (the API named 10-row window on the day). This release gives the three tiles the door vocabulary and three self-contained focus views - zero new queries, the doors compose the SAME answer the cards show.',
  '',
  '### What ships',
  '- **The row three doors** (`dashboard-tab.tsx`): `KpiCard` gains the door vocabulary - an optional `testId` handle, the left **edge bar**, the **live dot** and the **hot ring** (lit only when the day is live; a quiet day stays quiet). Todays Revenue opens **The day ledger** (`testId="branch-revenue-card"`, emerald edge/dot), Transactions opens **The day receipts** (`branch-transactions-card`, teal), Avg Transaction opens **The basket ladder** (`branch-atv-card`, amber) - the branch row own hue story, the family vocabulary branch face.',
  '- **The day ledger** (`kpi-doors.tsx`): the revenue headline with its receipts meta, the **16 business-hour bars** (6 AM - 9 PM, the page chart own window) with a zero hour drawing nothing, the **peak hour spoken twice** (in the bar container aria-label AND in the `day-ledger-peak` line), the **tender mix** from the full GROUP BY sorted loudest-tender-first with each method count, total and honest `% of the day` share (a zero-total mix renders NO percentage and says so), and the **latest receipts** mini-roster (newest first, capped at 5) under the honest window note.',
  '- **The day receipts** (`kpi-doors.tsx`): the count headline with the revenue/ATV composition line, the **receipts-per-hour strip** with the **busiest hour spoken twice** (aria + `day-receipts-busiest`), and the **named roster** newest-first - each row speaks the receipt tail, the stable `HH:MM` clock voice (no locale drift), the method chip (teal), the status chip (`PAID`/`COMPLETED` emerald / every other state calm slate), the customer (or the honest `Walk-in`), the cashier and the amount; the **window note** speaks when the count outruns the wire 10-receipt window (`the wire 10-receipt window - N more on the day`) - the count stays the truth.',
  '- **The basket ladder** (`kpi-doors.tsx`): the ATV headline with its composition line, and the day named receipts sorted into **four size buckets** (under KES 1,000 / 1-5k / 5-20k / over 20k - gaps impossible by construction) each with its count and honest `% of the named` share; a zero bucket bar draws nothing while its cell still speaks its 0; the **window note** names what the ladder reads (`The ladder reads the N receipts named on this answer`). The zero day speaks its line (`basket-ladder-clear`).',
  '- **The house laws hold from birth**: all three panels paint their dark half (`dark:border-slate-700 dark:bg-slate-900` - the branch row THREE new mounts of the dark-panel law); the doors are self-contained focus views with **no anchors** (the honest-door law - the full sections already live on the page below the row; the door is the story, not a shortcut); null wire rows are filtered by type predicate, never a non-null assertion; and the doors render only inside the FULL KPI row (the server already refuses the revenue payload for limitedView roles; the limited row is untouched).',
  '- **THE ROUND CONTRAST FIND - caught before ship** (`kpi-doors.tsx`): the doors 10px window notes and hour-axis labels were drafted as `text-slate-400` in light - **2.63:1** on the white panel, under the 4.5 bar their small text must meet - with `text-slate-500` in dark (**3.74:1** on slate-900, the same miss on the dark half). The shipped voice is **`text-slate-500 dark:text-slate-400` (4.77:1 / 6.79:1)**, and the draft pair is pinned below the bar in reverse in the round contrast script so the ghost cannot return. The bars pastel fills are documented as **DECORATION** per the v2.198.0 house rule (the key figures are aria-labeled on the bar containers AND spoken twice beside: the peak line, the busiest line, every bucket count + share; the dark fills measure 5.08-5.59:1, the light fills 1.86-2.10:1 by design).',
  '',
  '### Tests',
  '- `src/tests/branch-kpi-doors-v2200.test.ts` (NEW, 42 tests): the wire purity (no fetch, no db, the structural-subset type); the hook-order law (door state before the early return); the three buttons faces and handlers; the hot-ring honesty gates; the non-door tiles keeping their voices; the three modals mount and testids; every honesty gate (zero-day lines, zero-total rule, zero-bucket rule, window notes, gaps-impossible buckets); the status/method chip voices; the twice-spoken peak/busiest hours; the stable clock; the no-anchors law; the predicate-filter law; the limited row untouched; the contrast script ghosts and the docs numbers; the release face.',
  '- `scripts/contrast-math-branch-doors-v2200.mjs`: **28/28 families pass** (the shipped voices + the draft pair pinned in reverse; the edge/dot hues measured as graphics over the white card; the bar fills documented DECORATION per the v2.198.0 law).',
  '- Deliberate pin evolutions with reasoning: head-pin counters re-anchored (88/89/90/121 -> 89/90/91/122); prior suites pkg pins ride to 2.200.0 across the suite (the treadmill tax).',
  '- `verify:v2-200-0` wired - 22/22 PASS. FULL vitest **4139/4139** (201 files) - lint 0 errors / 542 warnings (baseline EXACT) - the contrast script 28/28 - build exit 0.',
  '',
  '### Risk',
  'Low: zero wire changes (the doors compose the SAME answer the cards show); the three tiles swap div -> button with the light voice kept (the cards stay white in both modes by design); the three hues are the branch face of the family vocabulary (each hot grammar measured); the contrast find was caught BEFORE ship and its draft pair is pinned in reverse; the doors render only in the full KPI row - the limitedView row is untouched.',
  '',
  '### Release checklist',
  '- [x] Version bump 2.199.0 -> 2.200.0 (all three package.json slots)',
  '- [x] CHANGELOG + whats-new feed head the release',
  '- [x] `scripts/verify-v2-200-0.mjs` fresh-written, 22/22 PASS',
  '- [x] Full vitest, lint, build gates green before push',
  '- [ ] Required checks green, then squash merge (release.yml tags + publishes)',
];

if (!TOKEN) {
  console.error('NO TOKEN: set GITHUB_TOKEN (the ems remote is clean after the transfer)');
  process.exit(1);
}

const res = execSync(
  `curl -sL -X POST -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" ` +
  `-d @- https://api.github.com/repos/${REPO}/pulls`,
  { input: JSON.stringify({ title: 'feat: the branch row speaks (v2.200.0)', head: HEAD, base: BASE, body: body.join('\n') }), encoding: 'utf8' },
);
const pr = JSON.parse(res);
if (pr.number) {
  console.log(`PR #${pr.number} opened: ${pr.html_url}`);
} else {
  console.error('PR FAILED:', res.slice(0, 400));
  process.exit(1);
}
