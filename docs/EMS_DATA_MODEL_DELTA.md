# EMS Data Model Delta

Base schema: 88 models at 6dbce961 (v2.18.4). Rule: no duplication, no destructive alteration. Existing HR models are extended; missing models are added additively.

## Existing models reused (not re-created)

| Spec model | Existing model | Action |
| --- | --- | --- |
| Employee | Employee (schema.prisma:1418) | Reuse. Extend additively: reportingToId String?, deletedAt DateTime?, employeeNo alignment with employeeCode kept as the natural key |
| Payslip and PayslipLine | PayrollPeriod, PayrollRun, PayrollDetail (:1507, :1543, :1581) | Reuse PayrollDetail as the payslip line carrier. Extend additively: rateTableIds Json? trace on PayrollDetail, idempotencyKey String? @unique on PayrollRun, status vocabulary aligned to the run state machine |
| LeaveType, LeaveBalance, LeaveRequest | LeaveType (:1647), EmployeeLeaveBalance (:1672), LeaveRequest (:1709) | Reuse. Add @@unique([employeeId, leaveTypeId, year]) shape check on balance recompute path |
| AttendanceRecord | AttendanceRecord (:1752) | Reuse. Add idempotencyKey String? @unique and adjustment linkage |
| Onboarding gating | User.isActive plus onboarding plan tasks | New models below carry the plan; till gating reads completed tasks |

## New models (additive)

1. EmployeeDocument: id, employeeId, storeId?, type, fileName, fileUrl?, expiryDate?, verificationStatus (PENDING, VERIFIED, REJECTED), verifiedByUserId?, notes?, createdAt, updatedAt, deletedAt?. Indexes: employeeId, expiryDate.
2. Position: id, storeId?, title, description?, department?, isActive default true, createdAt, updatedAt, deletedAt?. Unique: @@unique([storeId, title]).
3. PayGrade: id, storeId?, name, minSalaryCents Int, midSalaryCents Int?, maxSalaryCents Int, currency default KES, createdAt, updatedAt, deletedAt?.
4. SalaryStructure: id, employeeId, effectiveFrom DateTime, effectiveTo DateTime?, positionId?, payGradeId?, payFrequency (MONTHLY, BIWEEKLY, WEEKLY, DAILY), createdAt, updatedAt, deletedAt?. Index: employeeId plus effectiveFrom.
5. SalaryComponent: id, storeId?, code, name, type (EARNING, DEDUCTION, EMPLOYER_CONTRIBUTION), computation (FIXED, PERCENT_OF_BASIC, FORMULA), amountCents Int?, percentBps Int?, isTaxable Boolean default true, isActive default true, createdAt, updatedAt, deletedAt?. Unique: @@unique([storeId, code]).
6. EmployeeSalaryComponent: id, employeeId, salaryComponentId, salaryStructureId, overrideAmountCents Int?, overridePercentBps Int?, createdAt. Unique: @@unique([employeeId, salaryComponentId, salaryStructureId]).
7. RateTable: id, storeId?, organizationId, type (PAYE, NSSF_TIER1, NSSF_TIER2, SHIF, HOUSING_LEVY, HELB, PERSONAL_RELIEF, OVERTIME, NIGHT_ALLOWANCE, LEAVE_POLICY, HOUR_CAP, COMMISSION), code, label, basis (MONTHLY, DAILY, HOURLY, ANNUAL), instrumentReference, verifyWithCounsel Boolean default true, effectiveFrom DateTime, effectiveTo DateTime?, createdByUserId?, createdAt, updatedAt. Unique: @@unique([organizationId, type, code, effectiveFrom]). No updates after insert; corrections insert new rows.
8. RateTableRow: id, rateTableId, order Int, lowerBoundCents Int, upperBoundCents Int?, rateBps Int?, flatAmountCents Int?, reliefCents Int?, employerMatchBps Int?, metadata Json?. Index: rateTableId.
9. AttendanceAdjustment: id, attendanceRecordId, employeeId, storeId?, type (OVERTIME, NIGHT_ALLOWANCE, CASUAL_DAY, CORRECTION), minutes Int?, dayRateCents Int?, amountCents Int?, reason, approvedByUserId?, status (PENDING, APPROVED, REJECTED), createdAt, updatedAt, deletedAt?. Index: employeeId plus createdAt.
10. RecruitmentJob: id, storeId?, organizationId, positionId?, title, description?, openings Int default 1, status (DRAFT, OPEN, CLOSED, FILLED), openedAt?, closedAt?, createdByUserId?, createdAt, updatedAt, deletedAt?.
11. Applicant: id, jobId, storeId?, fullName, email, phone?, coverNote?, consentGrantedAt DateTime?, status (NEW, SCREENING, INTERVIEW, OFFER, HIRED, REJECTED, WITHDRAWN), rejectionReason?, dataRetentionUntil DateTime?, createdAt, updatedAt, deletedAt?. Index: jobId plus status.
12. ApplicationStage: id, applicantId, stage (SCREENING, INTERVIEW_ONE, INTERVIEW_TWO, TASK, REFERENCE, OFFER), outcome (PENDING, PASS, FAIL), notes?, recordedByUserId?, createdAt. Index: applicantId plus createdAt.
13. Offer: id, applicantId, positionId?, payGradeId?, proposedSalaryCents Int, startDate DateTime, status (DRAFT, SENT, ACCEPTED, DECLINED, EXPIRED), sentAt?, respondedAt?, createdByUserId?, approvedByUserId?, createdAt, updatedAt.
14. OnboardingPlan: id, employeeId?, applicantId?, storeId?, templateKey, status (IN_PROGRESS, COMPLETED, SIGNED_OFF), dueDate?, signedOffByUserId?, signedOffAt?, createdAt, updatedAt, deletedAt?. Index: employeeId, status.
15. OnboardingTask: id, planId, title, description?, category (DOCUMENTS, CASH_HANDLING, SYSTEM_ACCESS, SAFETY, POLICY), blocksTillAccess Boolean default false, isComplete Boolean default false, completedByUserId?, completedAt?, createdAt, updatedAt. Index: planId.
16. ReviewCycle: id, storeId?, organizationId, name, periodStart, periodEnd, status (DRAFT, ACTIVE, CLOSED), calibrationNotes?, createdAt, updatedAt, deletedAt?.
17. PerformanceReview: id, cycleId, employeeId, reviewerUserId, overallRating Int?, strengths?, improvements?, status (DRAFT, SUBMITTED, ACKNOWLEDGED, CALIBRATED), employeeAcknowledgedAt?, createdAt, updatedAt, deletedAt?. Unique: @@unique([cycleId, employeeId]).
18. Goal: id, employeeId, cycleId?, title, metricSource (MANUAL, SALES_TOTAL, SALES_COUNT, UPTIME, CUSTOM), metricConfig Json?, targetValue Decimal?, currentValue Decimal?, status (OPEN, ACHIEVED, MISSED, CLOSED), dueDate?, createdAt, updatedAt, deletedAt?. Computed goals read POS data; they are never hand-typed.
19. DisciplinaryCase: id, employeeId, storeId?, type (WARNING, GRIEVANCE, INVESTIGATION), severity Int?, description, status (OPEN, RESOLVED, DISMISSED, EXPIRED), issuedOn DateTime, expiresOn DateTime?, resolutionNotes?, confidentiality (STANDARD, RESTRICTED), createdByUserId?, createdAt, updatedAt, deletedAt?.
20. AssetAssignment: id, employeeId, storeId?, assetName, assetTag?, serialNumber?, assignedOn DateTime, dueReturnOn?, returnedOn?, conditionOut?, conditionIn?, recoveryAuthorizedByUserId?, status (ASSIGNED, RETURNED, LOST, DAMAGED), notes?, createdAt, updatedAt, deletedAt?.
21. PayrollCorrection: id, originalPayrollDetailId, employeeId, runId, reasonCode, explanation, reversalEntryId?, replacementDetailId?, status (PENDING, APPROVED, POSTED, REJECTED), requestedByUserId, approvedByUserId?, createdAt, updatedAt. Corrections reverse and replace; they never edit a posted detail.
22. ConsentRecord: id, employeeId?, applicantId?, purpose, scope, policyVersion, grantedAt, withdrawnAt?, lawfulBasis, createdAt, updatedAt. Index: employeeId, applicantId.
23. HrSetting: id, storeId?, organizationId, key, value Json, updatedAt, updatedByUserId?. Unique: @@unique([organizationId, key]).

## Existing model extensions (additive, nullable or defaulted)

1. Employee: reportingToId String?, deletedAt DateTime?.
2. PayrollRun: idempotencyKey String? @unique, approvedByUserId String? (maker-checker comparison target), postedJournalEntryId String?, disbursementStatus String?.
3. PayrollDetail: rateTableIds Json? (resolved table ids for reproducibility), roundingAdjustmentCents Int @default(0), payslipNumber String? @unique.
4. AttendanceRecord: idempotencyKey String? @unique, sourceDevice String?.
5. LeaveRequest: approverUserId String? exists check; add delegateApproverUserId String? for delegation.
6. JournalEntry: idempotencyKey String? @unique (correction 2.18.4.0), referenceType vocabulary extended with PAYROLL.

## Money and rate conventions

1. New EMS columns use integer cents with a Cents suffix. Existing Decimal columns are preserved for compatibility; the payroll engine converts at the boundary and performs all arithmetic in integer cents.
2. Percentages use basis points (Int, suffix Bps).
3. Periods use periodYear Int and periodMonth Int where relevant (PayrollPeriod already carries equivalent fields; verify at implementation).
4. Natural keys: Employee.employeeCode unique already; Payslip uniqueness via PayrollDetail runId plus employeeId (verify and add @@unique([runId, employeeId]) if absent); RateTable unique per type, code, effectiveFrom; LeaveBalance per employee, type, year; AttendanceRecord.idempotencyKey; PayrollRun.idempotencyKey.

## Indexes added with new models

- storeId plus status on case-bearing models.
- employeeId plus date-ish column on attendance, adjustments, documents.
- periodYear plus periodMonth on payroll models.
- approverId plus status on leave and corrections.
- reportingToId on Employee.

All additions are nullable or defaulted. No column is dropped. No table is recreated. prisma db push runs after preflight on a database copy in the updater flow, never with accept-data-loss.
