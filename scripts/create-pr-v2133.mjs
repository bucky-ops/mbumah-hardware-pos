#!/usr/bin/env node
// v2.133.0 PR creation — "the gate speaks first".
// Written fresh this round (never patch a prior round's copy — house lesson 25).

import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@github/)?.[1];
const repo = remote.match(/github\.com[:/](.+)\.git/)?.[1];
if (!token || !repo) { console.error('cannot parse remote'); process.exit(1); }

const body = `## The gate speaks first (v2.133.0)

The run's guardrails (consent, timesheets) always enforced themselves inside preparePayrollRun — but their verdict only surfaced AFTER a failed prepare attempt, as an amber card of issues. This release asks the SAME gates the SAME question BEFORE anyone tries: a pre-flight, read-only gate read per payroll period — the EMS spec Phase 4.6 lifecycle's front door.

### What changed

**The pre-flight gate read (feature)**
- \`GET /api/payroll/runs/gate?periodId=\` behind the runs list's own read-right quartet (\`hr.payroll.read.all\` × HR_MANAGER / BRANCH_MANAGER / STORE_OWNER / ACCOUNTANT) — seeing the gate is part of reading the desk, not part of running payroll. Read-only by construction: no run created, no payslip computed, no state moved.
- \`src/lib/hr/payroll/run-gate.ts\`: every active employee's verdict — consent gate (\`withdrawnAt: null\`), timesheet gate (\`hasUnapprovedTimesheet\`), evaluated independently, reported in prepare's own block order. \`deriveGateState\` is pure; an employee failing both gates carries both codes (nothing hidden, only ordered). Unknown/cross-branch period → honest 404; a voided period is REPORTED as voided, not checked.
- **The parity contract**: the gate mirrors prepare line for line — same employee where and order, same consent where, same timesheet helper — pinned by tests so the gate can never drift from the run it protects.

**The Gate door (feature + styling)**
- A \`ShieldCheck\` "Gate" pill on the period header's right rail — beside the Ledger door, never inside the fold (the v2.100.0 rail rule). One loader, fresh fetch per open; the toggle closes the same door; Retry reuses the door's period.
- The verdict renders as an inset panel row: counts speak first (\`N clear · N missing consent · N timesheet pending · checked EAT\`), a voided period gets its amber strip, a clear gate gets the emerald "prepare would proceed for all N active employees." strip, and blocked employees speak per-person in prepare's own words with rose/amber mono badges — both codes visible when both fail ("prepare would report MISSING_CONSENT first").
- A failed read renders an honest rose strip with a period-scoped Retry — never a silent spinner.

### Gates
vitest **2776/2776** (138 files, +17/+1) · lint **0 errors / 421 warnings** (= baseline) · tsc **424** source-only (= invariant) · verify-v2-133-0 **13/13** (fresh script) · build green (webpack@2048, page-chunk served = disk).

### Security
- Read-only GET behind the runs list's existing guard quartet; no mutation path anywhere in the feature (the write-verb ban is test-pinned); the gate's verdicts leak nothing an employee row does not already show — employeeCode/name and the same gate codes prepare already reports on attempt.
`;

const pr = execSync(`curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/pulls -d @-`, {
  input: JSON.stringify({
    title: 'feat: the gate speaks first (v2.133.0)',
    head: 'feat/v2-133-0-gate-speaks-first',
    base: 'main',
    body,
  }),
  encoding: 'utf8',
});
const j = JSON.parse(pr);
if (j.number) console.log(`PR #${j.number} created: ${j.html_url}`);
else { console.error('FAILED:', pr.slice(0, 500)); process.exit(1); }
