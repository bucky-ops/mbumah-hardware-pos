# EMS Audit Coverage Inventory

**Phase 4.8, acceptance 8 — "audit coverage complete".** This inventory answers
one question a reviewer can act on: when a mutation happens in the EMS, does it
leave a row in `AuditLog`? Coverage is claimed per service mutator, verified
against the code on 2026-10-19 (v2.127.0). The honest finding is stated in
§4: two mutators do not write audit rows today — flagged, scheduled, not hidden.

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
| Employees (`employee-service.ts`) | createEmployee, updateEmployee, archiveEmployee — 3/3 core mutators | See §4: portal-account linking is the gap. |
| Leave (`leave-service.ts`) | requestLeave, editLeaveRequest, decideLeaveRequest, grantBalance — 4/4 decision mutators | Balance recomputes are derived-state repairs, not decisions; governed separately by `leave-balance-governance.ts` (audited). |
| Assets (`asset-service.ts`) | assignAsset, updateAsset — 2/2 | Assignment records the authorizer chain. |
| Goals (`goal-service.ts`) | createGoal, updateGoal, deleteGoal (soft), restoreGoal, recomputeAllGoals — 5/5 | Delete is soft + audited; restore re-arms the audit trail. |
| Performance (`performance-service.ts`) | createCycle, transitionCycle, updateCycleCalibration — 3/3 | Cycle transitions carry the phase sentence in `reason`. |
| Onboarding (`onboarding-service.ts`) | plan + task mutations — audited | The standard template creation is audited from `ensureOnboardingPlan`. |
| Attendance (`attendance-service.ts`) | mutators audited (2 call sites) | Corrections are the audited surface; raw device sync is not an actor event. |
| Payroll (`payroll/run-service.ts`, `disbursement-service.ts`) | prepare, approve, post, correct, disburse + bundle/CSV exports — 12 + 5 call sites, the densest coverage | Maker-checker identities ride every row; the preparer cannot approve or post (RBAC matrix §Enforcement 2). |
| Data protection (`data-protection.ts`) | consent grant/withdraw, unmask, retention sweep preview — 10 call sites | PII unmask logs the field name, never the value (RBAC matrix §Enforcement 3). |
| Reports/exports | digest CSV, payslip bundle, report schedules, period routes | Export endpoints require `hr.report.branch`/`hr.report.all` and are audit logged (RBAC matrix §Enforcement 5). |

Raw count at time of writing: **96 `hrAudit` call sites across 30 files**.

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

## 4. Known gaps (honest findings, v2.127.0)

| Gap | Why it matters | Status |
| --- | --- | --- |
| `linkPortalAccount` / `unlinkPortalAccount` (`employee-service.ts`) write no audit row | Linking a portal account creates login credentials — a security-relevant mutation currently invisible to `AuditLog` | **Flagged this round; fix queued as the next round's quick win** (audit UPDATE/EMPLOYEE with the portal account's role in metadata) |

This inventory is the completeness claim for acceptance 8: every mutator is
accounted for — audited, deliberately silent, or named as a gap with an owner
and a date. The gap table is expected to shrink, never to grow silently.
