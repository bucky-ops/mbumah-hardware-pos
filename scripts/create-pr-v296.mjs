// v2.96.0 create-pr — fresh this round.
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
    title: 'feat: the performance page files itself (v2.96.0)',
    head: 'feat/v2-96-0-performance-files-itself',
    base: 'main',
    body: [
      '## v2.96.0 — the performance page files itself',
      '',
      'The Reviews tab could be LOOKED at but not FILED. This round gives the performance page the governed filing contract every other HR surface already carries (v2.58 report tabs, v2.70 desk report), and the bench learns to say where a goal was filed.',
      '',
      '- **The filing door**: the Reviews tab grows a CSV button that downloads the EXACT filtered subset on screen. The route (`GET /api/hr/performance/reviews/export?cycleId=&status=`) re-runs the service\'s `listReviews` with the query\'s filters — same scope (`employeeScopeWhere`), same shape, same order — so a downloaded file can never disagree with the screen.',
      '- **One governed builder**: `reviewsToCsv` (new pure module `src/lib/hr/performance-csv.ts`) reuses the digest CSV\'s `csvCell` escaper — the OWASP formula-injection guard is one implementation shared everywhere — and emits the family layout: Report / Organization / Scope / Cycle / Status / Generated (UTC) header block, table caption, columns, RFC-4180 CRLF rows, honest slug filename (`mbumah-performance-reviews-<cycle>-<status>.csv`).',
      '- **The privacy floor holds in the file**: the builder\'s input is the rating-free list DTO (spec rule 7) — a filing copy can carry names, cycle, status and dates, never a rating or a narrative. The leak is impossible by construction, contract-tested.',
      '- **Honest edges**: an empty filtered list is a 404 `NO_REVIEW_DATA` (never an empty-looking sheet); a garbage status is a 400 `INVALID_STATUS` (never a silent "all"); the button rests with an explanation when the filters match nothing; the export result reports where the action lives (`reviews-csv-note`), not behind a modal.',
      '- **Audit**: `PERFORMANCE_REVIEWS_EXPORTED` with field-name-only metadata (cycleId, status, count, byteSize, channel) — the audit row says a file was built and how big it is, never who is in it.',
      '- **The bench remembers the cycle**: goals have carried cycleId since 2.90 — the restore rows now show the review cycle a goal was filed under (amber badge, the cycle family color) or an honest "No cycle", so reconciling the bench against a cycle never means guessing.',
      '',
      '## Verification',
      '',
      '- vitest **2129/2129** (102 files, +19: perf-reviews-csv.test.ts — builder executed for real (layout, OWASP guard, quoting, filename slugs, null-on-empty, typed privacy floor) + parser executed (400/ok/bare) + route contracts + console anchors; console-changelog re-anchored for the 2.96.0-fed feed: 2.95.0→0, 2.94.0→1, 2.77.0→18)',
      '- lint **0 errors / 421 warnings (= baseline)**',
      '- tsc **424 (= baseline; ZERO in touched files; 3 GB heap)**',
      '- verify v2-96-0 FRESH 14 checks ALL PASS (atLeast slots, WN leads, builder escaper + layout + privacy floor + honesty, route guard + drift-proof + edges + audit masking, console door + filters + bench, tests pinned, prior anchors 2.95/2.94/2.93/2.88)',
      '- build green (documented OOM-retry pattern; the page-data worker is heap-marginal in this sandbox — NODE_OPTIONS cap + retry to green)',
      '- E2E on :3200 built tree: CSV button downloads the governed file (header block + 2 rows matching the screen, no ratings) → draft filter ride (filename `-all-cycles-draft.csv`, Status=draft, 1 row) → submitted-0 filter disables the button with "Nothing to file" title → API-level 400 INVALID_STATUS + 404 NO_REVIEW_DATA → bench shows "No cycle" (existing deleted goal) and the amber "H2 2026 Reviews" badge (throwaway cycle-linked goal, hard-deleted after) → dark + light screenshots → drawer/meter/notes/lifecycle regression all alive → console clean',
    ].join('\\n'),
  }),
});

const data = await res.json();
console.log('PR:', res.status, data.number ?? JSON.stringify(data));
if (!res.ok) process.exit(1);
console.log('HEAD:', HEAD);
