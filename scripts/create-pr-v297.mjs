// v2.97.0 create-pr — fresh this round.
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
    title: 'feat: every performance list files itself (v2.97.0)',
    head: 'feat/v2-97-0-family-files-itself',
    base: 'main',
    body: [
      '## v2.97.0 — every performance list files itself',
      '',
      'The filing family completes: the Cycles and Goals tabs grow the same governed CSV door the Reviews tab has carried since v2.96 — the exact rows on screen download as the governed filing file, built by the same pure server builders through the same contract.',
      '',
      '- **The family completes**: two new builders (`cyclesToCsv`, `goalsToCsv`) join `reviewsToCsv` in the pure module `src/lib/hr/performance-csv.ts` — same header-block layout, same `csvCell` escaper (one OWASP formula-injection guard shared everywhere), RFC-4180 CRLF, honest filenames (`mbumah-performance-cycles.csv`, `mbumah-performance-goals-<source>-<status>.csv`).',
      '- **The cycles file keeps the manager\\'s notes out**: the export is read-guarded (`hr.performance.review`) while `calibrationNotes` are manage-only content — `CycleCsvRow` omits the field and the route\\'s mapping narrows the DTO, so a reviewer who can file the list can never receive the private notes in the file. Impossible by construction, contract-tested (the same typed floor the reviews file gives ratings).',
      '- **The goals file rides the filters**: employee / source / status chips steer the query. The service\\'s `listGoals` grew the `source` predicate this round, so the route re-runs the screen\\'s exact filters server-side — the file cannot disagree with the board. Garbage status/source are 400s `INVALID_STATUS` / `INVALID_SOURCE` (never a silent "all"); an empty subset is 404 `NO_GOAL_DATA` (never an empty-looking sheet).',
      '- **Honest doors**: both buttons rest with an explanation when there is nothing to file; both report where the action lives (`cycles-csv-note`, `goals-csv-note` — the v2.95 lesson); both render for readers while the create actions stay manage-gated.',
      '- **Audit**: `PERFORMANCE_CYCLES_EXPORTED` / `PERFORMANCE_GOALS_EXPORTED` (DATA_EXPORT) with field-name-only metadata — the audit row says a file was built and how big it is, never who is in it.',
      '- **Static segment precedent**: `/api/hr/performance/cycles/export` rides beside `[id]` exactly like the goals bench\\'s static `deleted` segment — static wins, no collision.',
      '',
      '## Verification',
      '',
      '- vitest **2156/2156** (103 files, +27: perf-cycles-goals-csv.test.ts — both builders executed for real (layout line-by-line, OWASP guard, RFC-4180 quoting, filename slugs, null-on-empty, typed privacy floors), goals parser executed (400/ok/bare), route contracts, console anchors, prior anchors; console-changelog re-anchored for the 2.97.0-fed feed: 2.96.0→0, 2.95.0→1, 2.77.0→19; perf-goal-edit re-anchored to the always-rendered action row)',
      '- lint **0 errors / 421 warnings (= baseline)**',
      '- tsc **424 (= baseline; ZERO in touched files; 3 GB heap)**',
      '- verify v2-97-0 FRESH 17 checks ALL PASS (atLeast slots, WN leads, both builders\\' layout + privacy floors + honesty, both route guards + drift-proof re-runs + edges + audit masking, service source predicate, console doors + filter rides + gating order, tests pinned, prior anchors)',
      '- build green (documented OOM-retry pattern; BUILD_ID verified before start)',
      '- E2E on :3200 built tree: cycles CSV downloads the governed file (header block + row matching the screen, no notes) → goals CSV downloads all 6 rows in board order → status=open chip rides (`Status,open` + 3 rows, filename `-all-open.csv`) → source=CUSTOM (0 matches) disables the button with "Nothing to file" title → API-level 400 INVALID_STATUS + 400 INVALID_SOURCE + 404 NO_GOAL_DATA + source=SALES_TOTAL ride → audit rows confirmed in sqlite (both actions, DataExport, filename as resourceId, newValues null) → light + dark screenshots → bench door + drawer + meter regression all alive → console clean',
    ].join('\\n'),
  }),
});

const data = await res.json();
console.log('PR:', res.status, data.number ?? JSON.stringify(data));
if (!res.ok) process.exit(1);
console.log('HEAD:', HEAD);
