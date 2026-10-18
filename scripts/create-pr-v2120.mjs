#!/usr/bin/env node
// v2.120.0 PR creation — written fresh this round (lesson 25: never derive by sed).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { cwd: '/home/z/ems' }).toString().trim();
const token = remote.match(/x-access-token:([^@]+)@/)[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const H = { 'User-Agent': 'ems-release', 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };

const body = `## v2.120.0 — "The roster captures its consent"

Onboarding-time consent capture (v2.119.0's option 1, fully realized). The discovery that shaped this round: \`POST /api/hr/employees\` existed with **NO UI surface at all** — hiring happened only through raw API calls (another dead-surface pattern, same family as v2.119.0's consent records) — and a fresh hire onboarded without a ConsentRecord would block the next payroll run on MISSING_CONSENT forever. This release gives hiring a face: an onboarding dialog on the Employees page that files the hire AND the consent they signed.

### Added
- **Onboarding dialog** (\`src/app/(shell)/hr/employees/page.tsx\`): an "Onboard employee" door on the roster — first/last name required, job title, phone, hire date (defaults today), basic salary, and the schema's exact employment-type vocabulary (PERMANENT/CONTRACT/CASUAL/PROBATION/INTERN — no client invention). The success state shows the new hire's code and the honest consent outcome; "Onboard another" resets, "Open record" lands on the detail page.
- **Onboarding-time consent capture** (\`POST /api/hr/employees\` + \`consentPayrollProcessing\`): ticking the checkbox files the new hire's payroll-processing consent (purpose PAYROLL_PROCESSING, lawful basis CONSENT, policy hr-policy-2026-01) through the SAME audited \`grantConsent\` path the Privacy tab's decision routes use — one source of truth for the vocabulary, \`PRIVACY_CONSENT_GRANTED\` audit included. A consent glitch never loses the hire: the 201 keeps the employee and rides back an honest \`{ granted: false, reason }\` outcome.
- **Pure outcome interpreter** (\`src/lib/hr/onboard-consent.ts\` \`describeOnboardConsent\`): folds the route's consent field into the three sentences the dialog can show — emerald "Consent captured" (policy + grant date), amber "No consent on file" (with the MISSING_CONSENT truth), rose "Consent not captured" (with the reason code). Garbage input degrades honestly to rose/UNKNOWN, never to a granted look-alike. \`grantConsent\` now returns a typed \`ConsentGrantResult\` instead of \`Record<string, unknown>\`.

### Changed
- \`GET /api/hr/employees\` now surfaces \`canCreate\`, resolved through the SAME \`hr.employee.create\` permission key the POST guard pins — the server decides who sees the onboard door, the page renders what the answer says (the consent card's canDecide pattern, applied to hiring).
- The What's-New feed leads with the onboarding story; the unread-counter test re-anchored for the 2.120.0-fed feed (2.110.0→9, 2.109.0→10, 2.108.0→11, 2.77.0→42); the v2.113.0 employees-page pin re-anchored to the raw-envelope load.

### Security
- The boundary is a written contract: onboarding capture records a FACT of the hiring paperwork ("the employee signed the consent form") and is available to anyone who may create an employee (\`hr.employee.create\`); the data-protection DECISIONS — grant/withdraw outside onboarding — stay reserved to \`hr.settings.manage\` (403 DECISION_FORBIDDEN on the consent routes), and \`withdrawConsent\` is deliberately not even imported by the employees route (pinned by test). The vocabulary is never re-declared in the route (pinned), a strict \`=== true\` gates the grant, and every onboarding grant lands in the audit trail with employee id, purpose, and policy version — never content.

### Verification
- vitest 2559/2559 (125 files, +13/+1) · lint 0 errors / 421 warnings (= baseline) · tsc 424 source-only (= baseline) · verify-v2-120-0 11/11 · build green (webpack@2048)
- E2E on :3200 (owner session): the onboard door renders only for canCreate=true (server-decided); hire A "Zawadi Kimani" (CONTRACT, KES 25000, consent ticked) → "New hire on file" with EMP-0006 + emerald "Consent captured — hr-policy-2026-01, granted 2026-10-18"; hire B "Kip Chirchir" (no consent) → amber "No consent on file — the next payroll run will report MISSING_CONSENT until their consent is granted"; the Privacy tab's consent card live-reads "6 active · 0 withdrawn · 1 without consent" (rose span) with Zawadi Active + Kip None on file; \`PRIVACY_CONSENT_GRANTED\` landed in AuditLog for the new hire via the shared audited path; unauth API fail-closed (employees GET 401 / POST 403 / consent GET 401); light + dark screenshots; console clean.
`;

const pr = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'feat: the roster captures its consent (v2.120.0)',
    head: 'feat/v2-120-0-roster-consent',
    base: 'main',
    body,
  }),
});
const pj = await pr.json();
console.log('PR:', pr.status, pj.number, pj.html_url);
if (!pr.ok) process.exit(1);
