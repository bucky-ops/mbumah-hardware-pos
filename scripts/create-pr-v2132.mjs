#!/usr/bin/env node
// v2.132.0 PR creation — "the columns bend, the branch files itself".
// Written fresh this round (never patch a prior round's copy — house lesson 25).

import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@github/)?.[1];
const repo = remote.match(/github\.com[:/](.+)\.git/)?.[1];
if (!token || !repo) { console.error('cannot parse remote'); process.exit(1); }

const body = `## The columns bend, the branch files itself (v2.132.0)

Two beats, one desk: the consent ledger's export-honesty theme reaches its fourth door — the WHOLE branch files itself, every in-scope employee's consent cycles in one flat CSV built by the drawer's own serializer — and the reports tables learn to bend, closing the EMS spec Phase 4.8 acceptance's last unsatisfied table affordance (sticky headers, column visibility, CSV export and print PDF already shipped).

### What changed

**The branch-level consent export (feature)**
- \`GET /api/hr/privacy/consent/export\` behind the ledger's own guard trio (\`hr.report.branch\` × HR_MANAGER / STORE_OWNER / BRANCH_MANAGER) — a branch-level extract is a view right taken broadly, never a decision right. Read-only by construction; \`text/csv; charset=utf-8\`, attachment disposition, \`Cache-Control: no-store\`.
- \`exportConsentTimelines(session)\` in data-protection.ts: the ledger's own scope where (\`deletedAt: null\` + \`employeeScopeWhere\`, take 200), employees ordered lastName/firstName, each employee's consent records grantedAt-ascending, serialized through \`buildConsentTimelineCsv\` — the drawer's own serializer whose row type already carries employee columns, so the bulk file adds no column the drawer never showed. \`consentTimelinesCsvFilename()\` names it \`consent-timelines-{date}.csv\`.
- The shared clock, extracted: \`stoodDaysBetween\` — whole days floored server-side, null while standing, negatives clamped; \`listConsentHistory\` and the export both ride it (pinned: the day math lives exactly once).

**The Export-all door (feature + styling)**
- A violet outline button beside the consent card's Refresh, rendered only when the ledger has rows (an empty ledger files nothing), tooltip: "One flat CSV: every in-scope employee's consent cycles — who, when, and what purpose. Never content." The fetch rides the cookie session; the filename comes from the Content-Disposition. A failed export speaks: a rose \`role="status"\` line — "The export could not be built — nothing was downloaded."

**Resizable columns (styling — the spec's last table affordance)**
- \`src/lib/hr/column-resize.ts\` (pure, unit-tested): \`clampColWidth\` (88–480), \`nudgeColWidth\` (start + travel, clamped), \`loadColWidths\` (a corrupted store degrades to an empty map, never a broken desk).
- The drag is delegated ONCE to the tabs container: pointerdown within 8 px of a resizable th's right edge opens it, move/up ride window listeners so a drag that leaves the table still lands, hovering the band shows \`col-resize\`, double-click on the edge resets that column.
- Widths persist per browser in localStorage under their column key — two tables sharing a "Period" column share their width on purpose. All 59 data columns across the ten report tables are resizable; the two 2-column headcount breakdowns stay fixed by design. Every resizable head carries \`data-resize-key\`, a live width style, and the edge tooltip; a never-dragged column renders exactly as before.

### E2E (real walk on :3200, real CDP mouse)
Privacy tab healthy (6 active · 0 withdrawn · 1 without, 7 History doors) → **Export-all door live** (aria "Export all consent timelines CSV", honesty tooltip) → click → **consent-timelines-2026-10-19.csv on disk (819 B)**: the ledger's header verbatim + 7 rows — 6 STANDING cycles (empty withdrawn/stood cells) + Mary Wanjiku's 2-cycle story (WITHDRAWN stood 351 → STANDING re-grant), employees ordered Achieng→Wanjiku, the without-consent employee correctly absent, no content columns. **Resize walk (real CDP input)**: drag the Policy column's edge +80 px → **249px live width** → **localStorage carries {"c-policy":249}** → full reload → **249px survives from storage** → double-click the edge → **style drops to default, stored back to {}**. Screenshots qa-v2132-export-all-light / qa-v2132-export-dark / qa-v2132-resize-dark. Console clean; theme restored. (E2E lesson: synthetic dispatchEvent pointerdown does not drive React 19's delegated handlers on this build — the drag walk runs on real CDP mouse input, which is what users send anyway.)

### Gates
vitest **2759/2759** (137 files, +27/+1) · lint **0 errors / 421 warnings** (= baseline) · tsc **424** source-only (= invariant) · verify-v2-132-0 **13/13** (fresh script; the parity check counts 63 TableHead elements = 59 resizable + 4 minis) · build green (webpack@2048, page-chunk served = disk).

### Security
- The export is a read-only GET behind the ledger's existing guard trio; the serializer's row type has no content field, so a branch-wide extract can never carry more than the drawer already showed. The resize mechanism is pure client-side state (localStorage widths); no new permission, no mutation path.
`;

const pr = execSync(`curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/pulls -d @-`, {
  input: JSON.stringify({
    title: 'feat: the columns bend, the branch files itself (v2.132.0)',
    head: 'feat/v2-132-0-columns-bend',
    base: 'main',
    body,
  }),
  encoding: 'utf8',
});
const j = JSON.parse(pr);
if (j.number) console.log(`PR #${j.number} created: ${j.html_url}`);
else { console.error('FAILED:', pr.slice(0, 500)); process.exit(1); }
