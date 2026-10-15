# EMS Test Plan

Runner: vitest (exists). Verification scripts: node scripts/verify-*.mjs (pattern exists). No new test framework is introduced.

## Verification scripts to add with their releases

| Script | Release | Asserts |
| --- | --- | --- |
| scripts/verify-hr-privacy.mjs | 2.18.4.0 | Export path masks nationalId, kraPin, nssfNumber, nhifNumber, bankAccountName for non-privileged roles; unmask requires permission and writes an audit event; no PII keys in list payloads |
| scripts/verify-hr-schema.mjs | 2.18.4.0 | Chart of accounts upsert seeds all payroll accounts; helper codes resolve to intended accounts; JournalEntry.idempotencyKey unique constraint present; prisma validate and generate pass |
| scripts/verify-ems-infrastructure-audit.mjs | 2.18.5 | Audit docs exist and reference real files; gate doc present; feature flag wired |
| scripts/verify-hr-isolation.mjs | 2.18.5 | Every /api/hr and /api/payroll route composes requireStoreAccess; cross-branch GET and mutation attempts return 403 or safe 404; injectTenant covers new models |
| scripts/verify-attendance-leave.mjs | 2.18.7 | Server-authoritative punch times; duplicate punch suppressed via idempotencyKey; balance recompute idempotent; timesheet approval gate blocks payroll |
| scripts/verify-payroll-engine.mjs | 2.18.8 | Golden fixtures pass; net identity holds; journal lines balance; no float in money pipeline (source scan) |
| scripts/verify-payroll-fixtures.mjs | 2.18.8 | All fixture JSON files produce the stored expected outputs, including historical recompute from archived rate tables |
| scripts/verify-payroll-lifecycle.mjs | 2.18.8 | State machine transitions legal; maker-checker enforced; replay idempotent; posted payslips immutable; corrections reverse and replace |
| scripts/verify-hr-regression.mjs | 2.19.0 | POS regression checklist: transactions, shifts, M-Pesa callback idempotency, branch workspace, audit trail chain verify |

package.json gains a verify:* script for each file only after the file exists.

## Golden fixtures (src/lib/hr/payroll/fixtures/*.json)

1. Below first PAYE band.
2. Band boundary both sides.
3. Top band.
4. NSSF below, at, above Tier I ceiling.
5. Tier II slice.
6. Housing levy, HELB, union dues, asset recovery deduction.
7. Joiner mid-month proration.
8. Leaver mid-month proration.
9. Mid-period raise.
10. Unpaid leave.
11. Casual worker day rates.
12. Overtime weekday, Saturday, Sunday, public holiday.
13. Night shift crossing midnight.
14. Zero gross with statutory minimums.
15. Rounding residual case where the identity must hold exactly.
16. Commission with a voided transaction excluded.
17. Historical recomputation from an archived rate table returning identical amounts.

## Property tests (vitest, integer cents)

1. Net equals gross minus employee deductions for every fixture.
2. Journal debits equal credits for every computed run.
3. Replay with the same idempotency key returns the same result.
4. YTD figures are monotonically non-decreasing within a fiscal year.
5. No float appears in the money pipeline (source scan assertion in verify-payroll-engine.mjs).
6. Every statutory line references a rateTableId.

## Manual regression checklist per release

1. POS sale, refund, void on two branches.
2. Shift open and close with cash reconciliation.
3. M-Pesa STK push and callback replay.
4. Branch workspace open via path and subdomain modes.
5. Org console renders with precise workspace reasons.
6. Audit trail verify passes (hash chain).
7. Login, idle timeout, offline persistence intact.

## Quality gates

1. bun run lint: zero errors.
2. bun run typecheck: no new errors versus the documented baseline.
3. bun run test: zero new failures versus baseline.
4. npx prisma validate and npx prisma generate: pass.
5. Source scans: no Float in src/lib/hr/payroll, no any in src/lib/hr and payroll API code, no decorative emojis, no em or en dashes in touched prose, no secrets in tracked files.
