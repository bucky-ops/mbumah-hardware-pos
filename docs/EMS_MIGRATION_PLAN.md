# EMS Migration Plan

## Principles

1. Additive schema only. No DROP TABLE, no DROP COLUMN, no TRUNCATE, no migrate reset, no accept-data-loss.
2. Backup before every schema change that writes data (correction or implementation phases only, never audit).
3. Preflight every schema change on a copy of the database before touching the live database (existing updater behavior: scripts/preflight-schema.mjs inside staged-update.mjs).
4. One conventional commit per logical correction or feature unit.
5. Local SQLite uses prisma db push after preflight. Production PostgreSQL uses migrate deploy with generated migrations once the EMS model set stabilizes. The dual policy is documented in docs/database-migration-policy.md and preserved.

## Correction 2.18.4.0 (fix/ems-infrastructure-blockers)

1. Add nullable unique JournalEntry.idempotencyKey.
2. Seed payroll chart of accounts via upsert on (organizationId, code): PAYE Payable, NSSF Payable, SHIF Payable, Housing Levy Payable, HELB Payable, Net Pay Payable, Other Deductions Payable, Employer NSSF Expense, Employer Housing Levy Expense, Payroll Clearing. Codes chosen in the free 2200 to 2600 and 5200 to 5500 ranges avoiding all existing codes and the documented conflicts.
3. Fix the helper constant GIFT_CARD_LIABILITY from 2300 to 2400 (matching the seeded Gift Cards Outstanding) and align RENTAL_DEPOSITS_HELD typing with the seed reality.
4. Convert account seeding and the guarded demo user seeding to upserts.
5. Mask employee PII in the export path with role-gated unmask and audit logging (verify-hr-privacy.mjs added).
6. Re-run prisma validate, prisma generate, lint, typecheck, and the test suite.

Rollback: restore the pre-update DB backup (updater flow) or revert the single commit; all changes are additive and reversible.

## Feature migration sequence

| Release | Schema delta | Notes |
| --- | --- | --- |
| 2.18.5 foundations | New models: EmployeeDocument, Position, PayGrade, SalaryStructure, SalaryComponent, EmployeeSalaryComponent, RateTable, RateTableRow, ConsentRecord, HrSetting. Extensions: Employee.reportingToId, Employee.deletedAt | Feature flag HR_MODULE_ENABLED gates UI and routes |
| 2.18.6 recruitment | RecruitmentJob, Applicant, ApplicationStage, Offer, OnboardingPlan, OnboardingTask | Applicant conversion links to Employee |
| 2.18.7 attendance and leave | AttendanceAdjustment; AttendanceRecord.idempotencyKey; LeaveRequest delegation field | Idempotent balance recompute service |
| 2.18.8 payroll | PayrollRun.idempotencyKey plus approval and posting fields; PayrollDetail trace fields; PayrollCorrection | Rate tables seeded for current and previous periods; payslip reproducibility fields |
| 2.18.9 performance and self-service | ReviewCycle, PerformanceReview, Goal, DisciplinaryCase, AssetAssignment | Self-service reads own data only |
| 2.19.0 reporting and compliance | No new models expected; indexes and retention job | P10 extract, statutory liability report, retention and legal hold |

## Role changes

No Role enum exists. HR_MANAGER and EMPLOYEE are introduced as string constants with:

1. Typed constants in src/lib/hr/roles.ts.
2. RolePermission rows seeded by upsert for the new roles.
3. FEATURE_PERMISSIONS and PERMISSION_MATRIX entries added in code.
4. A verify-hr-schema.mjs assertion that no unknown role strings exist beyond the known set.

No user rows are role-migrated automatically. Creating the first HR_MANAGER is a manual owner action through the existing users admin surface.

## PostgreSQL production notes

1. prisma migrate dev generates the additive migrations; prisma migrate deploy applies them.
2. Nullable additions and backfilled defaults avoid table rewrites for large tables.
3. The existing RLS policy file gains coverage for new store-scoped EMS tables when they land.
4. Neon credential rotation workflow remains untouched.
