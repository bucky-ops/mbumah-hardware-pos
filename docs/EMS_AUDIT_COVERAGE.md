# EMS Audit Coverage Inventory

**Phase 4.8, acceptance 8 — "audit coverage complete".** This inventory answers
one question a reviewer can act on: when a mutation happens in the EMS, does it
leave a row in `AuditLog`? Coverage is claimed per service mutator, verified
against the code, first on 2026-10-19 (v2.127.0), corrected the same day
(v2.128.0). §4 records a correction, not a gap: the v2.127.0 scan named one
gap that turned out to be a false finding — the named mutators DO write
hash-chained audit rows and have since v2.39.0. The gap table now stands at
zero, and this document says so with the evidence rather than quietly.

## 1. What every audit row carries

All HR/EMS mutations go through `hrAudit()` (`src/lib/hr/audit.ts`), which
writes an `AuditLog` row with: `timestamp`, `actorId`, `actorRole`,
`action` (CREATE/UPDATE/APPROVE/DELETE/…), `resourceType`, `resourceId`,
`storeId` (nullable for org-wide events), `reason` (human sentence),
`oldValues`/`newValues` (JSON, when the mutation replaces state), and
`metadata` (structured extras such as retention days). Rows form a hash chain
per the data-protection design; the access ledger reads the same table and
exports only who/when/which-case — never content.

## 2. Coverage by domain (verified 2026-10-19)

| Domain | Mutators audited | Notes |
| --- | --- | --- |
| Recruitment (`recruitment-service.ts`) | createJob, createApplicant, recordStage, createOffer, approveAndSendOffer, convertApplicantToEmployee, rejectApplicant, withdrawApplicant (v2.127.0), closeJob — **9/9** | The live exhibit: the v2.126.0 hiring walk's rows were retained post-cleanup because the hash chain must not lose links. Withdrawal rides UPDATE/APPLICANT with retention days in metadata. |
| Discipline (`discipline-service.ts`) | openCase, updateCase, sweepExpiredCases — 3/3 mutators; reads of restricted cases also audit (RESTRICTED_VIEWED) | Refused reads audit too — the ledger counts DENIED beside OPEN. |
| Employees (`employee-service.ts`) | createEmployee, updateEmployee, archiveEmployee, linkPortalAccount, unlinkPortalAccount — **5/5** mutators | Portal-link rows (UPDATE/EMPLOYEE, `portalLink: LINK`/`UNLINK` + the account's role in metadata, ids never emails) ship since v2.39.0, are pinned by `src/tests/portal-link.test.ts`, and were live-verified against `AuditLog` on 2026-10-19 (v2.128.0) — see §4. |
| Leave (`leave-service.ts`) | requestLeave, editLeaveRequest, decideLeaveRequest, grantBalance — 4/4 decision mutators | Balance recomputes are derived-state repairs, not decisions; governed separately by `leave-balance-governance.ts` (audited). |
| Assets (`asset-service.ts`) | assignAsset, updateAsset — 2/2 | Assignment records the authorizer chain. |
| Goals (`goal-service.ts`) | createGoal, updateGoal, deleteGoal (soft), restoreGoal, recomputeAllGoals — 5/5 | Delete is soft + audited; restore re-arms the audit trail. |
| Performance (`performance-service.ts`) | createCycle, transitionCycle, updateCycleCalibration — 3/3 | Cycle transitions carry the phase sentence in `reason`. |
| Onboarding (`onboarding-service.ts`) | plan + task mutations — audited | The standard template creation is audited from `ensureOnboardingPlan`. |
| Attendance (`attendance-service.ts`) | mutators audited (2 call sites) | Corrections are the audited surface; raw device sync is not an actor event. |
| Payroll (`payroll/run-service.ts`, `disbursement-service.ts`) | prepare, approve, post, correct, disburse + bundle/CSV exports — 12 + 5 call sites, the densest coverage | Maker-checker identities ride every row; the preparer cannot approve or post (RBAC matrix §Enforcement 2). |
| Data protection (`data-protection.ts`) | consent grant/withdraw, unmask, retention sweep preview — 10 call sites | PII unmask logs the field name, never the value (RBAC matrix §Enforcement 3). |
| Reports/exports | digest CSV, payslip bundle, report schedules, period routes | Export endpoints require `hr.report.branch`/`hr.report.all` and are audit logged (RBAC matrix §Enforcement 5). |

Raw count at time of writing: **98 `hrAudit` call sites across 30 files**
(re-counted 2026-10-19, v2.128.0; the v2.127.0 note of 96 under-counted by 2).

## 3. What deliberately does not audit

- **Reads**, with one deliberate exception: restricted discipline case reads
  (and their refusals) audit because confidentiality of those records is the
  point. General list/read endpoints do not audit — the volume would drown
  the signal, and the access ledger covers the sensitive surfaces.
- **Derived-state recomputes with no actor decision** (e.g. scheduled
  retention sweeps) audit under a system actor identity when they change
  state; pure recomputations that change nothing stay silent.
- **Login/logout sessions** are handled by the auth stack's own security
  event log (brute-force lockouts raise SecurityEvents), not `AuditLog` —
  two streams, two purposes, documented here so neither is mistaken for the other.

## 4. Known gaps — NONE (a correction, recorded 2026-10-19, v2.128.0)

The v2.127.0 scan named one gap here: "`linkPortalAccount` /
`unlinkPortalAccount` (`employee-service.ts`) write no audit row — flagged,
fix queued". **That finding was false.** The correction, with the evidence a
reviewer can re-run:

- Both mutators have written hash-chained `UPDATE`/`EMPLOYEE` rows since
  v2.39.0 (`hrAudit` calls with `portalLink: 'LINK'` / `'UNLINK'` and the
  linked account's role in metadata — ids and role labels only, never
  emails, per the PII discipline).
- The behavior is pinned by `src/tests/portal-link.test.ts` ("links a
  same-store active user and writes the LINK audit row with ids only").
- Live verification, 2026-10-19 against v2.127.0 on the sqlite worktree:
  POST `/api/employees/{id}/portal-link` produced an `AuditLog` row with
  reason `Portal account linked.`; DELETE produced `Portal account
  unlinked.`; both rode the hash chain.

Why the scan missed it: the grep sweep that fed the v2.127.0 inventory keyed
on recent change, not on the full mutator surface of each service file. The
lesson is folded into the method: a coverage claim is verified per MUTATOR,
not per FILE, and a named gap is verified against the code BEFORE it is
published — an unverified gap claim is itself a defect in the record.

The gap table stands at **zero**. This inventory is the completeness claim
for acceptance 8: every mutator is accounted for — audited, deliberately
silent, or named as a gap with an owner and a date. The table is expected to
STAY empty; if a real gap is ever found, it returns here with an owner and a
date rather than a silent fix.
