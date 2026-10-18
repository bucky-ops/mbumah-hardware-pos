#!/usr/bin/env node
// v2.122.0 PR creation — written fresh this round (lesson 25: never derive by sed).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { cwd: '/home/z/ems' }).toString().trim();
const token = remote.match(/x-access-token:([^@]+)@/)[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const H = { 'User-Agent': 'ems-release', 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };

const body = `## v2.122.0 — "The hold takes the desk"

The retention mechanism gets a surface (Task 136 option 7). The nightly sweep has anonymised expired personal data scope by scope since v2.20.0 and legal holds have always been able to block it — but a hold could only be set by a RAW HrSetting write. This release puts the desk on the Privacy tab: the reviewable policies, their live hold state, and the decisions that pause or resume a scope.

### Added
- **Retention & legal holds card** (\`src/app/(shell)/hr/reports/page.tsx\`, Privacy tab): the third Data Protection Act posture card lists every scope in \`HR_RETENTION_POLICIES\` with its humanised window ("3 years after updatedAt", "the row's own expiry (dataRetentionUntil)" — computed server-side and carried on the DTO so the client never imports the service module), its legal basis, and a hold chip — amber "On hold" (with the held-since date in the tooltip) or slate "Sweeping nightly". A counts strip answers "N of 3 scopes on hold", amber-tinted when any scope is paused.
- **The desk read** (\`GET /api/hr/privacy/retention\`): \`hrGuard('hr.report.branch')\` with the consent ledger's VIEW_ROLES trio, folding \`HR_RETENTION_POLICIES\` with the live \`legalHold:<scope>\` HrSetting rows — presence with value \`true\` IS the hold, the exact representation \`getLegalHolds\` (the sweep's single reader) already obeys. \`canDecide\` mirrors the erasure gate.
- **The hold decision** (\`POST /api/hr/privacy/legal-hold\`): reserved to \`hr.settings.manage\` (\`canDecideErasure\` — the same key that decides erasures and consent records; others get 403 \`DECISION_FORBIDDEN\`). Setting creates the row (value \`true\`, \`updatedByUserId\` stamped) and refuses 409 \`HOLD_ACTIVE\`; releasing DELETES the row and refuses 409 \`NO_ACTIVE_HOLD\`. Unknown scopes answer 400 \`UNKNOWN_SCOPE\` naming the valid list; non-boolean \`held\` answers 400 \`INVALID_HELD\`. Both decisions audit \`LEGAL_HOLD_SET\` / \`LEGAL_HOLD_RELEASED\` on the \`legalHold:<scope>\` key (HrSetting resource).
- **Two-step release**: the sweep resuming is the destructive direction, so Release… arms an inline rose confirm row ("Release? The sweep resumes on its next run.") before \`Confirm release\`; setting a hold is one click. The outcome reports in the card's own note (\`role="status"\`, emerald/rose — the report-where-the-action-lives lesson), never the page-level banner three cards away.

### Changed
- The What's-New feed leads with the hold story; the unread-counter test re-anchored for the 2.122.0-fed feed (2.110.0→11, 2.109.0→12, 2.108.0→13, 2.77.0→44).

### Security
- The decision gate fails closed exactly like its siblings: the read is \`hr.report.branch\` + VIEW_ROLES, the write is \`hr.settings.manage\` only, both decisions are audit-logged with field-name-only metadata (scope + held — never record contents), and the release path deletes only rows whose value is \`true\` — a stale or tampered row can neither block the sweep invisibly nor survive a release it should not have.

### Verification
- vitest 2587/2587 (127 files, +18) · lint 0 errors / 421 warnings (= baseline) · tsc 424 source-only (= baseline, 0 in touched files) · verify-v2-122-0 15/15 · build green (webpack@2048, BUILD_ID verified)
- E2E on :3200: owner reads the desk muted ("settings managers decide"), promoted decision-maker holds and releases both ways — chip flips amber/slate with the held-since tooltip, counts strip moves 0→1→0, two-step release (arm → Cancel disarms → Confirm releases), double-hold surfaces 409 HOLD_ACTIVE, garbage answers 400 UNKNOWN_SCOPE (valid list) / INVALID_HELD, unauth GET 401; audit trail carries 4 LEGAL_HOLD_* rows on exact keys with 0 residual settings rows; role reverted; console clean.
`;

const pr = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'feat: the hold takes the desk (v2.122.0)',
    head: 'feat/v2-122-0-hold-takes-the-desk',
    base: 'main',
    body,
  }),
});
const pj = await pr.json();
console.log('PR:', pr.status, pj.number, pj.html_url);
if (!pr.ok) process.exit(1);
