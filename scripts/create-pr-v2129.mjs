#!/usr/bin/env node
// v2.129.0 PR creation — "the ledger shows its timeline".
// Written fresh this round (never patch a prior round's copy — house lesson 25).

import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@github/)?.[1];
const repo = remote.match(/github\.com[:/](.+)\.git/)?.[1];
if (!token || !repo) { console.error('cannot parse remote'); process.exit(1); }

const body = `## The ledger shows its timeline (v2.129.0)

The consent ledger's \`re-granted ×N\` chip (v2.128.0) **counted** an employee's append-only consent history; this round the history becomes **readable**. A History door on every consent row opens a timeline drawer that reads the ledger the way it is stored: cycle by cycle, oldest first, verbatim — what was granted, when it was withdrawn, how many whole days it stood, and whether it still stands.

### What changed

**The consent timeline read-back (service)**
- \`listConsentHistory(session, employeeId)\` in \`src/lib/hr/data-protection.ts\` serves ONE employee's full \`ConsentRecord\` ledger, scope-checked like every ledger read (a cross-branch or deleted id 404s — \`CONSENT_HISTORY_NOT_FOUND\` — it does not leak).
- Events arrive oldest → newest (a timeline reads like a ledger) with 1-based \`cycle\` numbers (every value ≥ 2 is a re-grant cycle) and \`stoodDays\` computed SERVER-side — whole days between grant and withdrawal, floored from the exact span; a standing consent reports \`stoodDays: null\` (an open consent has no honest day count, only a standing-since date). \`standing\` rides the response so the drawer states the run-gate consequence without recomputing anything.

**The history route (view right, never a decision right)**
- \`GET /api/hr/privacy/consent/[employeeId]/history\` behind the ledger's identical guard — \`hrGuard('hr.report.branch', VIEW_ROLES)\`. Read-only; no mutation verbs. The dynamic param is read optional-chained (no non-null assertion) with a cast to the segment's real shape — a malformed context degrades to the honest 404.

**The History door + timeline drawer ([M] styling)**
- A ghost History button rides every consent row's action cell — rendered for EVERY viewer of the ledger, deliberately OUTSIDE the \`canDecide\` branch: history is a read, not a decision.
- The drawer (\`hr-privacy-consent-history\`) renders an \`<ol>\` timeline: emerald dot for a standing cycle, amber for a withdrawn one (dark twins on both, rims matching the dialog surface), a cycle chip, an indigo \`re-grant\` chip on every cycle ≥ 2 — the door behind the v2.128.0 counter — a \`stood N days\` tabular chip on closed cycles (server-computed; tooltip states the span), the consent's purpose + policy version, and granted/withdrawn stamps in the page's shared date format.
- The footer says what the ledger says: "N records on file · append-only — nothing is edited or deleted", plus the honest consequence ("The newest consent stands; the run gates on it." / "No active consent stands; the run reports MISSING_CONSENT until a re-grant."). Loading, error-with-retry (retry reuses the door's employee through the single loader), and the empty-ledger zero render honestly; all four state atoms reset on close so one employee's history never greets the next open.

### E2E (real walk on :3200)
7 History doors live on the Privacy tab (one per consent row, beside "settings managers decide"). MBH-1-002 (Mary Wanjiku, the \`re-granted ×1\` row) → timeline: **Cycle 1** amber dot + Withdrawn chip + "stood 351 days" + "Granted 1 Nov 2025 · Withdrawn 18 Oct 2026 · policy hr-policy-2026-01"; **Cycle 2** emerald dot + Standing chip + indigo re-grant chip + "still standing"; footer "2 records on file · append-only — nothing is edited or deleted. The newest consent stands; the run gates on it." Close → open EMP-0007 (None on file) → honest empty state, ZERO stale content from the previous employee. API: bogus id in-session → **404**; unauth from shell → **401** fail-closed. Screenshots light + dark (dark twin verified: dots, border, chips all flip); console clean; theme restored.

### Gates
vitest **2703/2703** (134 files, +14/+1) · lint **421 warnings** (= baseline; the round's own +1 — the dynamic route's non-null assertion — was fixed away with the optional-chained param read) · tsc **424** source-only (= invariant; the params-union error was real, fixed via the segment-shape cast) · verify-v2-129-0 **12/12** · build green (webpack, BUILD_ID 2TA9vSa2rf7D-FqX0Hrxh).

### Security
- No new permission surface: the history read rides the SAME \`hr.report.branch\` + view-trio guard as the ledger itself; scope discipline pins \`deletedAt: null\` + the branch where (cross-branch 404, test-pinned). The route is read-only by assertion. No PII beyond what the ledger card already shows (code, name, purpose, timestamps — never salary, never notes).
`;

const pr = execSync(`curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/pulls -d @-`, {
  input: JSON.stringify({
    title: 'feat: the ledger shows its timeline (v2.129.0)',
    head: 'feat/v2-129-0-ledger-shows-timeline',
    base: 'main',
    body,
  }),
  encoding: 'utf8',
});
const j = JSON.parse(pr);
if (j.number) console.log(`PR #${j.number} created: ${j.html_url}`);
else { console.error('FAILED:', pr.slice(0, 500)); process.exit(1); }
