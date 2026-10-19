#!/usr/bin/env node
// v2.131.0 PR creation — "the reports speak their failures".
// Written fresh this round (never patch a prior round's copy — house lesson 25).

import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@github/)?.[1];
const repo = remote.match(/github\.com[:/](.+)\.git/)?.[1];
if (!token || !repo) { console.error('cannot parse remote'); process.exit(1); }

const body = `## The reports speak their failures (v2.131.0)

v2.130.0 taught the Privacy tab's three desks to speak; the other eight report loaders still caught into the shared null state — an eternal skeleton, with (at best) a generic note ABOVE the tab that actually went dark and no retry anywhere near it. This release closes the loop.

### What changed

**Failure strips on all eight report tabs (feature)**
- The six aggregate desks (headcount / employment cost / absence / turnover / time-to-hire / statutory — one \`Promise.all\`), P10 and leave-utilisation each catch into their own \`failed\` flag (set true in the catch, cleared on success) and render an honest rose strip with a Retry on the tab itself: "The headcount desk could not be loaded — the numbers stay dark rather than guess." (and the seven siblings).
- A failed load nulls its data first, so the strip replaces the skeleton — never live data.

**One strip family (styling)**
- The three v2.130.0 privacy strips and the eight new ones share a single \`ReportFailureStrip\` component — same rose frame with dark twins, now with a warning glyph (AlertTriangle) and an in-flight retry spinner (Loader2). \`role="status"\`, a \`data-testid\` per desk, a distinct retry \`aria-label\`; the rose frame lives exactly once in the file.

**The honesty stamp (styling)**
- Every successfully loaded report renders "Updated HH:MM" (24-hour clock, tabular, muted) — on the six aggregate tabs and leave/P10 above the numbers, on the privacy desks beside their counts. No stamp means not fetched yet; a dark desk shows the strip, never a stamp. Each recovery refreshes the stamp.

**In-flight refresh feedback (feature)**
- \`loadConsent\` / \`loadErasure\` / \`loadRetention\` (and P10 / leave loaders) own busy flags; the consent Refresh button and every Retry disable and spin while the fetch runs — a slow or dead API can never read as a dead button.

**Loads leave the shared error alone (Changed)**
- \`load()\` / \`loadP10\` / \`loadLeaveUtil\` no longer write into the page-level ErrorNote — that surface is reserved for actions (adjustments, sweeps, holds, drill-downs), where it always belonged.

### E2E (real walk on :3200)
Healthy baseline (stats live, "Updated 04:54" stamp, 0 strips) → fetch poisoned at the network boundary → Apply period → **headcount strip renders on its tab** (copy exact, retry aria-label "Retry loading the headcount report") → screenshots light+dark → fetch restored → **Retry → strip gone → stats back, stamp refreshed to 04:55**. P10 walk: year change under a poisoned p10 route → **P10 strip** ("The P10 register could not be loaded — the schedule stays dark rather than guess.") → recover → register 2025 live, stamp 04:56. Refresh-busy walk: consent fetch hung → **Refresh disabled + spinner mid-flight**, counts line carries "· updated 04:54". Consent 500 walk through the refactored family strip → strip renders → recover → counts honest, 7 doors, stamp 04:57. Console clean; theme restored.

### Gates
vitest **2732/2732** (136 files, +11/+1) · lint **0 errors / 421 warnings** (= baseline) · tsc **424** source-only (= invariant) · verify-v2-131-0 **12/12** (fresh script; one check searched for a literal the test builds via a loop — fixed the CHECK, not the code) · build green (webpack, page-chunk served = disk).

### Security
- No new endpoint, no new permission, no server round-trip: the strips and stamps are pure client-side render state over the existing guarded report routes. Retry re-uses the exact loaders already permission-checked server-side; no data leaves the page.
`;

const pr = execSync(`curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/pulls -d @-`, {
  input: JSON.stringify({
    title: 'feat: the reports speak their failures (v2.131.0)',
    head: 'feat/v2-131-0-reports-speak',
    base: 'main',
    body,
  }),
  encoding: 'utf8',
});
const j = JSON.parse(pr);
if (j.number) console.log(`PR #${j.number} created: ${j.html_url}`);
else { console.error('FAILED:', pr.slice(0, 500)); process.exit(1); }
