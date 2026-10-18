#!/usr/bin/env node
// v2.123.0 PR creation — written fresh this round (lesson 25: never derive by sed).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { cwd: '/home/z/ems' }).toString().trim();
const token = remote.match(/x-access-token:([^@]+)@/)[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const H = { 'User-Agent': 'ems-release', 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };

const body = `## v2.123.0 — "The sweep shows its hand"

Task 137 option 2: the retention desk could say the sweep runs nightly, but never WHAT it would sweep. This release adds the dry run — per-scope counts of what the next nightly run would anonymise, computed with the exact same criteria the sweeper executes, so the desk and the sweep can never disagree about what "in scope" means.

### Added
- **Next sweep column** (\`src/app/(shell)/hr/reports/page.tsx\`, retention card): each scope row now carries a dry-run label — "N in scope", "N waiting behind the hold" (amber, matching the hold vocabulary), "nothing to sweep", or "nothing waiting" — computed server-side and carried on the DTO (the page still never imports the service module). The column header's tooltip discloses the dry run; a held row's tooltip says what releasing would unblock.
- **Backlog counts strip** (\`hr-privacy-retention-sweep-count\`): a second line under the holds strip answers "N rows would be anonymised on the next nightly run", with an honest zero state ("nothing to sweep tonight — every scope sits inside its window") and a pacing disclosure when the backlog exceeds one night ("the sweep takes up to 500 per night").
- **The dry run** (\`previewRetentionSweep\`, \`src/lib/hr/data-protection.ts\`): three \`count()\` queries — one per scope, changing nothing. A held scope still reports its backlog with \`held: true\`: the hold freezes the sweep, not the truth about what releasing would unblock. \`sweepableTotal\` sums over non-held scopes only — what the next run actually targets.

### Changed
- **Single source of truth for "in scope"**: the sweep's three inline WHERE clauses are now three pure, exported where-builders (\`applicantSweepWhere\` / \`disciplinarySweepWhere\` / \`attendanceSweepWhere\`) consumed by BOTH the executing sweep and the preview counts; the \`REDACTED (retention)\` marker rides every clause as a shared constant. No behaviour change — the refactor was verified clause-for-clause.
- The What's-New feed leads with the dry-run story; the unread-counter test re-anchored for the 2.123.0-fed feed (2.110.0→12, 2.109.0→13, 2.108.0→14, 2.77.0→45).

### Security
- The preview is read-only by construction: it rides the desk's existing read guard (\`hr.report.branch\` + the VIEW_ROLES trio), counts instead of selects (no personal data crosses the wire — a number and a label per scope), and its WHERE clauses are the sweep's own by shared code rather than by promise. Rows already carrying the redaction marker are excluded from every count.

### Verification
- vitest 2600/2600 (128 files, +13) · lint 0 errors / 421 warnings (= baseline) · tsc 424 source-only (= baseline, 0 in touched files) · verify-v2-123-0 15/15 · build green (webpack@2048, BUILD_ID verified)
- E2E on :3200: the Next sweep column renders server-computed labels per scope, the backlog strip answers the live dev-DB counts, unauth GET 401 fail-closed, console clean; light + dark screenshots.
`;

const pr = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'feat: the sweep shows its hand (v2.123.0)',
    head: 'feat/v2-123-0-sweep-shows-its-hand',
    base: 'main',
    body,
  }),
});
const pj = await pr.json();
console.log('PR:', pr.status, pj.number, pj.html_url);
if (!pr.ok) process.exit(1);
