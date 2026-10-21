#!/usr/bin/env node
// create-pr-v2199.mjs - opens the v2.199.0 release PR (the established flow:
// REST API with the PAT from the origin remote; the repo path derived from
// the remote, never hardcoded - LESSON 81).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const TOKEN = (remote.match(/x-access-token:([^@]+)@/) || [])[1] || process.env.GITHUB_TOKEN || '';
const repoPath = (remote.match(/github\.com\/([^/]+\/[^.]+)\.git/) || [])[1];
const REPO = repoPath || 'bucky-ops/mbumah-hardware-pos';
const HEAD = 'release/v2.199.0';
const BASE = 'main';

const body = [
  '## v2.199.0 - The pending tile opens the approval desk',
  '',
  'The KPI command row has had FIVE voices since v2.198.0 - the Revenue card told the money story since v2.173.0, the count face found its week, the ledger opened its book, the shelf opened its watchlist and the yard opened its gate - while the Pending tile badge-summed three queues in silence, even though the named PO roster was already on the wire (`suppliers.purchaseOrders`, the Suppliers Expert panel payload since the Expert panel shipped). This release gives the desk the row sixth voice - and the row LAST silent card speaks: the tile becomes the sixth button, the three queues draw their composition bar, and the drill-down speaks the whole desk - zero new queries, the drill-down composes what the payload already carried.',
  '',
  '### What ships',
  '- **The approval-desk drill-down** (`kpi-row.tsx`): the tile becomes the row sixth button (`data-testid="pending-card"`) and opens **The approval desk** modal in the face indigo - the family vocabulary sixth face (orange revenue, blue transactions, red debt, amber stock, rose rentals, indigo pending) with the **queue** qualifier chip. The card gains the queue **mini bar** (the three queues as one stacked strip: indigo-600 purchase orders -> indigo-500 open shifts -> indigo-400 expenses - one family, three queues; widths are honest shares of the desk, a zero queue draws nothing).',
  '- **The modal anatomy** (`kpi-row.tsx`): the composition bar at reading size (`data-testid="approval-desk-bar"`, `role="img"` with the full aria-label), the three queue cells (`approval-desk-queue-purchaseOrders/openShifts/expenses`) each with dot, count and **honest share of the desk**, and the meta line naming the DB-derived action queue. **The named PO queue**: pending purchase orders - the roster filtered to the SAME two statuses the count reads (`DRAFT | PENDING_APPROVAL`) - loudest order first (`approval-desk-po-row`) with the status chip (draft calm slate / approval indigo), the expected-date voice (`3d late` amber / `due today` indigo / `due in 3d` slate / **honest `no date set`** - never a fabricated "on time"), the branch line (`Unassigned` never dropped) and the order total; the **cap note** (`approval-desk-po-capped`) speaks when the roster 8-row window shows fewer pending POs than the count reads - the count stays the truth, the roster a window. Honesty rules: a clean desk renders NO percentage and no strip (`approval-desk-clear`); the two count-only queues speak where their rosters live **in words** (the Shift Scheduling tab / the Financial tab); an older cached answer without the roster speaks its step-aside (`approval-desk-po-stale`).',
  '- **THE HONEST-DOOR LAW APPLIED - no deep links**: the desk modal is self-contained like its five siblings. A shell-tab deep link would be a role-gated door for some console viewers (INVENTORY_MANAGER cannot read the shift-scheduling or financial tabs), so the pointer lines speak the destination in words instead - the pointer is not a door.',
  '- **QA handle**: the Revenue card is now `data-testid="revenue-card"` (the transactions/lowstock/overdue/debt/pending cards sibling).',
  '- **THE ROUND CONTRAST SWEEP - three re-voices, pinned in reverse** (`kpi-row.tsx`, `chrome.tsx`, `store-matrix.tsx`): (1) the revenue modal lens toggle **ACTIVE GROSS chip rode white-on-emerald-600 - 3.67:1**, under the 4.5 bar its 10px uppercase text must meet, since v2.187.0 (the INACTIVE voice always passed; the violator was the ACTIVE one nobody re-measured after the palette moved). Re-voiced to **emerald-700 (5.37:1)**. (2) The login error line rode **red-600-on-red-50 (4.36:1)** - the exact pairing v2.198.0 found on the Expert OVERDUE badge. Re-voiced to **red-700 (5.88:1)**. (3) The Store Matrix hot debt figure moved red-600 -> **red-700 (6.42:1)** for FAMILY ALIGNMENT (the pre-fix 4.76:1 passes the installed palette bar - the v2.159 knife-edge number came from the older palette - so this is honest consistency, not a violation). All pre-fix states pinned below their bars in reverse; the org-console mover family (the backlog audit half) measured and **already passes** - recorded, no fix owed.',
  '- **Zero wire changes**: the type contract (`primitives.tsx`) and the route (`kpi-summary`) already carried `pending` (the DB-derived action queue) and `suppliers.purchaseOrders` (supplier, store, status, total, expectedDate; newest-first, capped at 8). The modal re-derives the pending slice, the loudest-first order and the date math client-side from the SAME rows; the one-writer rule holds (one queue array, one share fn, one status-chip fn, one date-chip fn).',
  '',
  '### Tests',
  '- `src/tests/approval-desk-v2199.test.ts` (NEW, 32 tests): the desk math executed on the wire sample (the pending slice filters to the count exact statuses, the loudest-order sort, the honest date voice incl. the no-date case, the queue shares 57.1/14.3/28.6, the zero-total rule, the cap rule); the one-writer rule; the card sixth button/face/mini bar + the revenue-card handle; the drill-down testids, honesty gates, chips, tolerances; the **no-deep-links** law; the six-panel dark-half law; the three re-voices pinned at the source; the release surfaces.',
  '- `scripts/contrast-math-approval-desk-v2199.mjs`: **42/42 families pass** over the REAL composite chain (the sweep fixes + ghosts pinned in reverse; light 4.55-14.00:1; dark 5.72-16.28:1; the mover family recorded passing). The composition-bar fills follow the v2.198.0 decoration law - aria-labeled and spoken twice beside it, deliberately not asserted.',
  '- Deliberate pin evolutions with reasoning: transactions-lens-v2195 + debt-ledger-v2196 + stock-watchlist-v2197 + rental-yard-v2198 (the panel dark-half law 5 -> 6 mounts - the desk joins from birth), vat-spark-v2194 (the label voice 50 -> 60 and value voice 15 -> 16 - the desk families join the vocabulary), revenue-net-lens-v2187 (the ACTIVE GROSS chip emerald-600 -> emerald-700 - the round re-voice).',
  '- Head-pin counters re-anchored (88/89/90/121); prior suites pkg pins ride to 2.199.0 across the suite (90 pins, the treadmill tax).',
  '- `verify:v2-199-0` wired - 19/19 PASS. FULL vitest **4097/4097** (200 files) - lint 0 errors / 542 warnings (baseline EXACT) - the contrast script 42/42 - build exit 0.',
  '',
  '### Risk',
  'Low: zero wire changes (the payload was already shipped); the card button swap keeps the light voice (the cards stay white in both modes by design); the indigo face is a NEW hue on a formerly static tile (its own hot grammar measured 8.07:1 light / 5.72:1 dark); the three re-voices are one-token changes on existing surfaces; the fallback paths keep older cached answers calm (the stale note speaks, the count story never breaks); no deep links means no new role-gated doors.',
  '',
  '### Release checklist',
  '- [x] Version bump 2.198.0 -> 2.199.0 (all three package.json slots)',
  '- [x] CHANGELOG + whats-new feed head the release',
  '- [x] `scripts/verify-v2-199-0.mjs` fresh-written, 19/19 PASS',
  '- [x] Full vitest, lint, build gates green before push',
  '- [ ] Required checks green, then squash merge (release.yml tags + publishes)',
];

const res = execSync(
  `curl -sL -X POST -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" ` +
  `-d @- https://api.github.com/repos/${REPO}/pulls`,
  { input: JSON.stringify({ title: 'feat: the pending tile opens the approval desk (v2.199.0)', head: HEAD, base: BASE, body: body.join('\n') }), encoding: 'utf8' },
);
const pr = JSON.parse(res);
if (pr.number) {
  console.log(`PR #${pr.number} created: ${pr.html_url}`);
} else {
  console.error('PR creation failed:', res.slice(0, 500));
  process.exit(1);
}
