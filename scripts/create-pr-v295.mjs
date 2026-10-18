// v2.95.0 create-pr — fresh this round.
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const m = remote.match(/x-access-token:([^@]+)@github/);
if (!m) throw new Error('no token in remote URL');
const TOKEN = m[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const HEAD = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

const res = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'feat: the drawer takes the wheel - lifecycle rides inside (v2.95.0)',
    head: 'feat/v2-95-0-drawer-takes-wheel',
    base: 'main',
    body: [
      '## v2.95.0 — the drawer takes the wheel: lifecycle rides inside',
      '',
      'The natural v2.94 sequel (Task-134 round): the cycle detail drawer stopped being a read-only window — Activate and Close now ride inside it, beside the calibration meter, with the EMPTY_CYCLE guard explaining itself BEFORE it can fire.',
      '',
      '- **The facts ride with the detail**: `CycleDetailDto` gains `canManageLifecycle` (mirrors the manage trio exactly, so the drawer never offers an action the PATCH route would refuse) and `lifecycleBlock` — the guard\'s own explanation, derived server-side from the SAME count the EMPTY_CYCLE guard runs (non-deleted reviews of the cycle, org-wide), never the viewer\'s scoped list length. The disabled state cannot drift from the 409 the next PATCH would raise.',
      '- **The strip**: a manage-gated LIFECYCLE panel rides under the meter. DRAFT shows the emerald Activate (resting, with the guard\'s reason inline, while `lifecycleBlock` stands); ACTIVE shows Close behind a two-step armed confirm (rose panel states exactly what closing ends — "a closed cycle is history and cannot reopen"); CLOSED wears its history honestly ("The meter keeps its final shape and the notes no longer take ink"). Reviewers see none of it — the status badge tells their story.',
      '- **Honest errors**: lifecycle failures report INSIDE the drawer (`cycle-detail-action-error`), not on the page-level note hidden behind the modal. A clean transition refetches the drawer\'s own detail so status, meter, notes and the strip all tell the new truth, then refreshes the table behind it.',
      '- **The table obeys the same rule** (QA-caused fix): the row\'s Activate/Close buttons now render manage-only — a BRANCH_MANAGER saw buttons that only ever answered 403. Reviewers get an honest muted dash.',
      '- **Privacy intact**: the DTO and the drawer render no ratings or narratives anywhere (contract-tested on scoped slices).',
      '',
      '## Verification',
      '',
      '- vitest **2110/2110** (101 files, +13: perf-cycle-lifecycle.test.ts file-level contracts; console-changelog re-anchored for the 2.95.0-fed feed: 2.94.0→0, 2.93.0→1, 2.77.0→17)',
      '- lint **0 errors / 421 warnings (= baseline)**',
      '- tsc **424 (= baseline; ZERO in touched files; 3 GB heap)**',
      '- verify v2-95-0 FRESH 12 checks ALL PASS (atLeast slots, WN leads, lifecycle DTO floor + guard arithmetic + transition map, route contract, manage-gated strip + table gate, inline block, two-step close, runner self-refetch + drawer-local errors, privacy floor, prior anchors)',
      '- build green; E2E on :3200 built tree: ACTIVE drawer strip (Close cycle + "the walk is one-way, so the drawer asks twice") → arm → rose confirm row → Cancel disarms → re-arm → Confirm close → drawer refetches in place (closed badge, history line, frozen notes, table row closed with empty actions) → `PERFORMANCE_CYCLE_CLOSED` audit @ 04:07:57Z → draft cycle drawer shows Activate disabled with the guard\'s reason inline ("Add at least one review before activating — reviews are created from the Reviews tab.") → dark-mode strip verified → What\'s-New 2.95.0 modal → post-fix regression: admin sees table buttons, BRANCH_MANAGER sees the honest dash → throwaway cycle deleted + status restored (pre-round DB state preserved)',
    ].join('\\n'),
  }),
});

const data = await res.json();
console.log('PR:', res.status, data.number ?? JSON.stringify(data));
if (!res.ok) process.exit(1);
console.log('HEAD:', HEAD);
