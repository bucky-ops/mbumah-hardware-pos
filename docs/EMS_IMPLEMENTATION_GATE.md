# EMS Implementation Gate

Verdict per gate at 6dbce961 (v2.18.4). A gate passes only when every clause passes or a planned correction covers the gap before dependent EMS work begins.

| Gate | Verdict | Notes |
| --- | --- | --- |
| 1. Branch workspace foundation | PASS | Store.slug and subdomain unique; seed creates deterministic slugs for five branches; console shows precise reason codes since v2.18.3.0; localhost uses path mode; no undefined hrefs (unit-tested). Store availability uses the status column rather than an isActive boolean; equivalent semantics, no change required. |
| 2. Tenant isolation | PASS | Server-side resolver, ORM tenant injection, assertStoreScope and assertBodyStoreScope, IDOR classification, denial auditing, RLS SQL for PostgreSQL. |
| 3. RBAC extensibility | PASS | Roles are plain strings plus RolePermission table and PERMISSION_MATRIX. HR_MANAGER and EMPLOYEE are additive data. No enum migration exists to break. |
| 4. Accounting readiness | FAIL until correction 2.18.4.0 | Double-entry core is sound and balanced, but payroll cannot post: statutory liability accounts absent, JournalEntry has no idempotencyKey, account code 2300 has two meanings, 1400 type disagrees between seed and helper, account seeding is non-idempotent. Correction scoped in EMS_MIGRATION_PLAN.md. |
| 5. Updater safety | PASS | Staging, preflight on DB copy, backup, health smoke, rollback, tag validation with hotfix cap. P2 note: staged-update.mjs relies on select-release for tag validation. |
| 6. Security and privacy | FAIL until correction 2.18.4.0 | Strong edge and auth posture, but employee PII is exported unmasked without gating or audit (P0-1). P1: systemLog masking opt-in; in-memory counters. |
| 7. Testing | PASS | Vitest wired with 27 suites including payroll-math and tenant-scoping; nine verify scripts; golden fixture plan defined in EMS_TEST_PLAN.md. |

## Gate failure resolution

Gate 4 and Gate 6 failures are corrected by release 2.18.4.0 on branch fix/ems-infrastructure-blockers:

1. Mask or role-gate employee PII in the export path and audit every unmasked export.
2. Add payroll liability and employer expense accounts through idempotent upsert seeding.
3. Add nullable JournalEntry.idempotencyKey with a unique constraint and honor it in the posting helper.
4. Resolve the 2300 and 1400 conflicts by aligning the helper constants with the seed reality (gift card liability to 2400; rental deposits type aligned), and make account seeding upsert-based.

After the correction release, gates 4 and 6 are re-run. EMS feature work starts only after both pass.

## Re-run procedure

1. Run scripts/verify-hr-privacy.mjs (added in the correction) and scripts/verify-hr-schema.mjs.
2. Run npx prisma validate and npx prisma generate.
3. Run bun run test and bun run typecheck.
4. Confirm the export endpoint returns masked fields for non-privileged roles and writes an audit event.
5. Confirm the chart of accounts upsert seeds all payroll accounts and helper codes resolve to the intended accounts.
