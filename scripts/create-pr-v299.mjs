// v2.99.0 create-pr — fresh this round. (Double-quoted bodies: no escaped
// apostrophes — the over-escaping gotcha does not get a third bite.)
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const m = remote.match(/x-access-token:([^@]+)@github/);
if (!m) throw new Error('no token in remote URL');
const TOKEN = m[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const HEAD = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

const body = [
  '## v2.99.0 — the bench files itself',
  '',
  'The performance filing family completes: the Recently deleted bench grows the same governed CSV door the reviews (v2.96) and the cycles + goals lists (v2.97) carry. Every performance surface a manager can LOOK at now FILEs too.',
  '',
  '- **Pure builder**: `benchToCsv` joins the family in `src/lib/hr/performance-csv.ts` — same header-block layout, same `csvCell` escaper (one OWASP formula-injection guard shared everywhere), RFC-4180 CRLF, honest constant filename (`mbumah-performance-bench.csv`), null-on-empty mapped to an honest 404.',
  '- **The exit story files whole**: goal, employee, cycle, source, metric, status, the values the goal left with (current / target / progress %), due date — and the **Deleted day stamp**, so reconciling the bench against a cycle or an audit never means guessing when a goal left.',
  '- **Honest window**: the service returns the 50 most recent deletions (`take: 50`, newest first). At the cap the header block says `most recent 50 deletions` instead of the file silently posing as the whole bench; the dialog shows the same honesty as an amber window note (`goal-deleted-window-note`).',
  '- **The door rides the dialog**: footer gains Bench CSV (busy state, `Building…`, aria-label) + the note renders where the action lives (`goal-bench-csv-note`, violet ok / rose err). An empty bench disables the button with `Nothing to file — the bench is clear`.',
  '- **Route widens nothing**: `GET /api/hr/goals/deleted/export` — `hr.performance.manage`, the SAME guard the bench list answers through; static segment nests beside `deleted` (the v2.97 static-segment precedent); empty bench = 404 `NO_BENCH_DATA`; audit `PERFORMANCE_BENCH_EXPORTED` (DATA_EXPORT, filename as resourceId, field-name-only metadata).',
  '- **Tests**: perf-bench-csv.test.ts (17) executes the builder for real — header block line-by-line, row quoting (comma-bearing titles), OWASP guard, filename, null-on-empty, window honesty, route guard/audit narrowing, page anchors, feed story; console-changelog re-anchored for the 2.99.0-fed feed.',
  '',
  '## Verification',
  '',
  '- vitest **2182/2182** (105 files, +17: perf-bench-csv; changelog counters re-anchored 2.97.0→1, 2.96.0→2, 2.77.0→21)',
  '- lint **0 errors / 421 warnings (= baseline)**',
  '- tsc **424 (= baseline at source level; ZERO in touched files; 3 GB heap)** — note: the local .next/types artifact noise (5 OmitWithTag lines) is build-state dependent and excluded from the source count',
  '- verify v2-99-0 FRESH **12 checks ALL PASS** (atLeast slots; WN story; builder purity + 11-column contract + Deleted stamp; route guard + window arithmetic + audit masking; page doors + prior anchors; tests pinned; changelog re-anchor; prior stories intact)',
  '- build green (webpack@2048 recipe; BUILD_ID verified before daemon start)',
  '- E2E on :3200 built tree: bench dialog → Bench CSV click → note "Bench CSV downloaded — mbumah-performance-bench.csv" → file on disk (header block + 1 row matching the screen: Close 12 custom warranty calls weekly, David Otieno, CUSTOM, 0/12, deleted 2026-10-18) → audit row confirmed in sqlite (PERFORMANCE_BENCH_EXPORTED, DataExport, filename entityId, newValues null) → unauth API 401 → light + dark screenshots → restore/cycle-column/count-badge anchors alive → What\'s New leads 2.99.0 → console clean',
].join('\n');

const res = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'feat: the bench files itself (v2.99.0)',
    head: 'feat/v2-99-0-bench-files-itself',
    base: 'main',
    body,
  }),
});

const data = await res.json();
console.log('PR:', res.status, data.number ?? JSON.stringify(data));
if (!res.ok) process.exit(1);
console.log('HEAD:', HEAD);
