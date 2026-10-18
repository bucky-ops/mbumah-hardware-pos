#!/usr/bin/env node
// v2.124.0 PR creation — written fresh this round (lesson 25: never derive by sed).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { cwd: '/home/z/ems' }).toString().trim();
const token = remote.match(/x-access-token:([^@]+)@/)[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const H = { 'User-Agent': 'ems-release', 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };

const body = `## v2.124.0 — "The broom answers the desk"

Task 138 option 1: the dry run (v2.123.0) shows what the nightly sweep WOULD anonymise — but a settings manager who saw a backlog still had to wait for the cron. This release gives the decision a door: a manual "Sweep now" run that executes the exact same audited function the nightly cron runs, asks twice because anonymisation is destructive, and reports per scope where the action lives.

### Added
- **Sweep now door** (\`src/app/(shell)/hr/reports/page.tsx\`, retention card): a card-level "Sweep now…" button renders ONLY for settings managers (\`canDecide\` — everyone else's desk is unchanged). Arming shows a rose confirm row quoting the live backlog ("N rows would be anonymised immediately.", or the honest zero "Nothing is in scope — held scopes are skipped, in-window rows are untouched."), then Confirm sweep / Cancel. Arming one action disarms the other (release arm ↔ sweep arm).
- **The manual run route** (\`POST /api/hr/privacy/retention-sweep\`): \`hrGuard('hr.report.branch')\` read guard + in-handler 403 \`DECISION_FORBIDDEN\` (the erasure / consent / legal-hold decision pattern verbatim), then \`runHrRetentionSweep(session.organizationId, session.userId)\` — the EXACT function the nightly cron executes, with actor attribution. A manual run can never diverge from the nightly one: legal holds skip, redacted rows stay invisible, every anonymised batch audits \`RETENTION_*\`. The envelope carries \`results\` plus \`sweptAt\`.
- **The pure outcome humaniser** (\`src/lib/hr/sweep-outcome.ts\`): \`describeSweepOutcome\` turns the per-scope results into the card's own note — "Sweep ran — 2 rows anonymised (2 applicant records)." with held scopes named as skipped, the honest "nothing to anonymise" on a zero run, and the ROSE truth when the answer is unreadable (never a fake success). Client-safe: no db import.

### Changed
- After a manual run the desk refetches, so the dry-run counts (v2.123.0) drop to the zero the sweep just made true — the preview and the door close each other's loop. The What's-New feed leads with the door; the unread-counter test re-anchored for the 2.124.0-fed feed (2.110.0→13, 2.109.0→14, 2.108.0→15, 2.77.0→46).

### Security
- The manual run is gated exactly like every other decision on the desk: the read is \`hr.report.branch\`, the run is \`hr.settings.manage\` only (403 \`DECISION_FORBIDDEN\` otherwise), the execution is the nightly function itself — same holds, same redaction guards, same \`RETENTION_*\` audits with the acting user attributed — and the outcome note names what was anonymised per scope without ever exposing record contents.

### Verification
- vitest 2617/2617 (129 files, +14) · lint 0 errors / 421 warnings (= baseline) · tsc 424 source-only (= baseline, 0 in touched files) · verify-v2-124-0 12/12 · build green (webpack@2048, BUILD_ID verified)
- E2E on :3200: owner (canDecide=false) sees NO door and the API refuses 403 DECISION_FORBIDDEN; promoted SUPER_ADMIN arms the door (confirm row quotes the live backlog "1 row would be anonymised immediately."), Cancel disarms, re-arm + Confirm runs the sweep — emerald note "Sweep ran — 1 row anonymised (1 applicant record).", desk refetches to the honest zero, the applicant row reads REDACTED (retention) in place, and the RETENTION_APPLICANTS_ANONYMISED audit lands attributed to the actor; seeded backlog cleaned to 0 residual and the role reverted; unauth POST fails closed at the CSRF layer (platform-consistent); light + dark screenshots (door armed + zero view); console clean.
`;

const pr = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'feat: the broom answers the desk (v2.124.0)',
    head: 'feat/v2-124-0-broom-answers-the-desk',
    base: 'main',
    body,
  }),
});
const pj = await pr.json();
console.log('PR:', pr.status, pj.number, pj.html_url);
if (!pr.ok) process.exit(1);
