# EMS Infrastructure Audit

Date: 2026-10-15. Auditor: automated audit run against checkout 6dbce961 (origin/main, v2.18.4).
Scope: full read-only inspection of the repository to determine whether the Employee Management System (EMS) can be implemented safely on the existing foundation.

## 1. Executive verdict

READY_WITH_CORRECTIONS.

The branch workspace foundation, tenant isolation, RBAC extensibility, updater safety, and test infrastructure all pass with evidence. Two correction areas must land before EMS data flows through them:

1. P0-1: employee personally identifiable information (PII) is exported unmasked by the existing employee CSV export.
2. P0-2: the chart of accounts cannot host payroll journals safely. Statutory liability accounts are absent, the seed uses non-idempotent create calls, and one account code (2300) is claimed by two different meanings.

Neither blocker breaks the existing POS. Both are additive, small corrections. After they land, EMS implementation may proceed under feature versions starting at 2.18.5.

## 2. Repository baseline

- Checkout: /home/z/ems, branch docs/ems-infrastructure-audit, HEAD 6dbce961.
- origin/main head at audit time: 6dbce961 "feat: organization console expert diagnostics API and branch slug repair (v2.18.4) (#128)".
- Working tree clean at audit start. No database mutations performed. No migrations run. No seed run.

## 3. Version and release state

- VERSION file: 2.18.4.
- package.json version: 2.18.4 with mbumah metadata { releaseVersion: 2.18.4, baseVersion: 2.18.4, hotfix: 0 }.
- Latest GitHub release: v2.18.4, prerelease false, published 2026-10-15.
- Latest valid local tag: v2.18.4 (three-part, valid).
- Tag ordering is consistent: v2.18.3, v2.18.3.0, v2.18.3.1, v2.18.3.2, v2.18.4.
- No invalid four-part tags without a valid base were found.
- Version sources agree. Authoritative version: 2.18.4.

## 4. Package and build inventory

- Package manager: bun (bun.lock at root). No package-lock.json, yarn.lock, or pnpm-lock.yaml.
- Key dependencies: next ^16.1.1, react ^19, prisma and @prisma/client ^6.19.2, next-auth ^4.24.11, zod ^4, zustand ^5, @tanstack/react-query ^5, vitest ^4.1.9.
- Scripts: test (vitest run), typecheck (tsc --noEmit --strict), lint. No format script.
- vercel-build preserves prisma generate and uses SKIP_ENV_VALIDATION=1 with scripts/setup-prisma-provider.mjs.
- next.config.ts does not hardcode standalone output. resolveStandaloneOutput makes it opt-in via BUILD_STANDALONE=1, disabled on Windows by design (src/lib/build-mode.ts).
- next.config.ts sets typescript.ignoreBuildErrors=true; typecheck runs as a separate job. Documented, unchanged.

## 5. Prisma schema state

- 88 models. Prisma 6.19.2. No enum blocks; roles and statuses are plain strings.
- Store model: slug String? @unique, subdomain String? @unique, code String? @unique, status String @default("ACTIVE"), name, location, address, phone, email, taxPin, organizationId. No isActive boolean and no deletedAt (see section 8).
- User model: email @unique, role String default CASHIER, storeId?, isActive, isEngraved, isSystem, passwordHash, lastLoginAt, lockedUntil, failedLoginAttempts. No deletedAt.
- RolePermission model exists: @@unique([role, resource, action]). Roles are free strings, so adding HR_MANAGER and EMPLOYEE requires no enum migration.
- Money storage: Decimal everywhere. No Float money fields. Integer cents will be used inside the new EMS payroll engine with conversion only at persistence boundaries.
- Existing HR-domain models: Employee, PayrollPeriod, PayrollRun, PayrollDetail, LeaveType, EmployeeLeaveBalance, LeaveRequest, AttendanceRecord, ShiftSchedule.
- idempotencyKey exists on StockMovement, SalesTransaction, DebtLedger, EquipmentRental, Expense. JournalEntry has none.

## 6. Database inspection state

The sandbox cannot inspect the Windows desktop database (C:\Users\kamam\mbumah-pos-data\pos.db). The local checkout database was not touched. Database-dependent claims are based on schema, seed, and code evidence, and on prior release verification records (docs/CURRENT_RELEASE_CHECK.md, docs/TEST_AUDIT_REPORT.md). Items requiring the operator database are marked unverified in EMS_AUDIT_EVIDENCE.md.

## 7. Seed state

- Five stores seeded deterministically by hardcoded stable ids: juja-main (JUJ), thika (THI), ruiru (RUI), nairobi-cbd (NAI), nakuru (NAK). Each sets code, slug, and subdomain on both create and update branches of the upsert.
- Users: admin@mbumahhardware.co.ke (SUPER_ADMIN) upsert by email; five branch managers upsert by email with StoreMembership bindings; demo cashier and accountant use create calls guarded by a user-count check.
- Five employees are seeded with NSSF and NHIF numbers. No PayrollRun or PayrollDetail rows are seeded.
- Accounts: 18-account chart created with prisma.account.create (non-idempotent on partially initialized databases). Payroll statutory liability accounts are absent.
- Known chart-of-accounts conflicts: seed places a supplier payable ("Bamburi Cement - Payable") at 2300 while src/lib/account-helper.ts maps GIFT_CARD_LIABILITY to 2300 and the seed also creates "Gift Cards Outstanding" at 2400. Seed marks 1400 Rental Deposits Held as ASSET while the helper treats 1400 as LIABILITY/CREDIT. SubType naming for 3000 differs between seed (OWNERS_EQUITY) and helper (OWNER_EQUITY).

## 8. Auth and RBAC state

- Authentication is a custom DB-session scheme (Session table, bcryptjs cost 12, constant-random tokens). next-auth appears only for env naming compatibility.
- AuthSession contains userId, email, role, storeId, organizationId. isEngraved and isSystem stay on the User row and are not session claims.
- Enforcement helpers: requireAuth, requireRole, withSessionAuth, requireStoreAccess, assertPermission, hasPermissionOr403, requireFeaturePermission, assertStoreScope, assertBodyStoreScope, withFinancialAuth.
- Central permission layers: FEATURE_PERMISSIONS in src/lib/permissions.ts and PERMISSION_MATRIX in src/lib/types.ts, plus the RolePermission table.
- Adding HR_MANAGER and EMPLOYEE is a data-level change: no enum alteration, no POS role is touched. Gate 3 passes.

## 9. Branch workspace state

- src/proxy.ts enforces a host allowlist, rewrites subdomains to /stores/{slug}/..., and sets advisory resolution headers.
- src/lib/workspace/server.ts resolveStoreContext() resolves the store from the database by subdomain or slug, never from client input, and returns reason codes: store-not-found, store-inactive, user-not-allowed, unauthenticated, missing-slug, schema-drift.
- src/lib/branch-workspace.ts provides resolveBranchWorkspace with href, usedMode, and unavailableReason; isLocalWorkspaceHost gives localhost path-mode fallback.
- src/app/stores/[slug]/layout.tsx exists with placeholder-slug guard and explicit documentation that it is not the authorization boundary.
- Store inactive detection uses the status column (status != ACTIVE). The spec's Store.isActive is satisfied semantically by this field; no schema change is required for Gate 1.

## 10. Tenant isolation state

- ORM-level: injectTenant in src/lib/db.ts auto-adds storeId to queries inside runWithTenant.
- Route-level: assertStoreScope and assertBodyStoreScope reject client-supplied storeId mismatches with 403 and a SecurityEvent.
- Denial auditing is comprehensive: cross-tenant probes, IDOR-class misses, role denials, lockouts, USER_DELETE_BLOCKED for the engraved admin, workspace denials, and M-Pesa callback rejections all write events. The audit log is hash-chained (previousHash and integrityHash).
- Gate 2 passes.

## 11. API surface state

- 69 top-level API route folders. Store-scoped routes use requireStoreAccess plus ORM tenant injection. Representative routes (products, transactions, stores) verified.
- Existing HR-related API folders: employees, payroll (details, periods, runs), attendance, leaves, leave-types, shift-schedules.
- Error handling: withErrorBoundary returns sanitized 500s unless EXPOSE_ERRORS is set. systemLog writes DB logs; masking is opt-in per call site (gap noted in section 17).

## 12. Accounting engine state

- Account, JournalEntry, JournalEntryLine models are complete with posting lifecycle, approval, voiding with reversingEntryId, financial periods, and Decimal debit and credit columns.
- src/lib/account-helper.ts enforces balance within 0.01 tolerance on sale, gift card, and goods-receipt postings. src/lib/accounting-helpers.ts validateJournalEntryBalancing plus createJournalEntry, postJournalEntry, voidJournalEntry provide the generic path.
- src/lib/payroll-helpers.ts computes NSSF, SHIF, housing levy, PAYE, and pay for period with constants hardcoded in code, and processPayrollRun writes no journal entries.
- Gate 4 verdict: PARTIAL, fails for payroll readiness until P0-2 correction lands (liability accounts, idempotent posting hook, code collision fix). The double-entry core itself is sound.

## 13. M-Pesa state

- STK push supports an optional idempotencyKey with a 10-minute in-flight dedupe window (src/lib/mpesa-idempotency.ts).
- The callback is idempotent by CheckoutRequestID with a terminal-state gate, an atomic claim update, a unique constraint on (storeId, mpesaReceiptNumber), amount-mismatch reconciliation handling, and symmetric compensating restock on failure. Credentials are constant-time compared with an IP allowlist.
- B2C disbursement is not present. Payroll M-Pesa disbursement is therefore marked future work, not a blocker.
- Gate contribution: no double-posting risk found in C2B flow.

## 14. Offline resilience state

- use-state-persistence and use-idle-timeout hooks exist with the mbt_ key namespace.
- src/lib/offline-sync.ts maintains an IndexedDB outbox with client idempotency keys and server-side replay dedupe on SalesTransaction.idempotencyKey; 409 is treated as already-applied.
- EMS plan: attendance punches reuse the idempotency key pattern. Sensitive payroll data must not be written to localStorage; self-service caching will keep masked data only.

## 15. Updater state

- scripts/staged-update.mjs: staging directory, https-only artifact fetch, schema preflight on a throwaway DB copy, DB backup, health smoke test, and rollback that restores both the install dir and the DB.
- deploy/nodocker/update-pos.sh: build verification via scripts/verify-build-output.mjs, pre-update DB backup, automatic code rollback with rebuild and health gate, JSON ledger, dormant-window execution.
- scripts/release/validate-tag.mjs rejects four-part tags without a valid base and limits hotfixes to .0 through .5.
- Minor note: staged-update.mjs relies on select-release.mjs for tag validation rather than importing validate-tag directly. Documented as P2.
- Gate 5 passes.

## 16. Prisma config and Windows build state

- prisma.config.ts exists: warns about the deprecated package.json#prisma block, configures schema, migrations, and bun seed, loads .env with env-wins precedence, and pins Prisma 6.x.
- No prerelease upgrade notices are actionable; updaters and CI pin 6.x.
- Standalone output is opt-in and disabled on Windows. The EINVAL traced-files class is guarded by verify-build-output.mjs.
- No corrections required.

## 17. Security and privacy state

- Edge hardening: host allowlist, CSRF exact-origin fail-closed, tiered rate limits including payment and auth tiers, 1 MB body cap.
- Gaps found:
  - P0-1: src/lib/data-export-utils.ts writes nationalId, kraPin, nssfNumber, nhifNumber, and bankAccountName in clear text into the employee CSV export, with salary fields, without role gating or audit logging.
  - P1: systemLog does not auto-apply sanitizeForLog; masking is opt-in per call site.
  - P1: in-memory abuse-lock and denial counters do not persist across serverless instances (documented in code).
- PII masking helpers exist (sanitizeForLog, maskEmail, maskPhone) and will be reused by EMS.

## 18. Testing and observability state

- Vitest with jsdom, 27 test files across src/tests/lib and src/__tests__, including tenant-scoping, store-guard, mpesa-idempotency, branch-workspace, money, and payroll-math suites.
- Nine verify-*.mjs scripts cover branch workspace, build output, release selection, standalone policy, Windows build safety, prisma config, and org console expert information.
- Health surface: 12 routes under /api/health with role-gated schema drift detail.
- No coverage thresholds enforced yet (P2).

## 19. Docs, env, and deployment state

- 40+ docs including database-migration-policy, release-versioning, staged-updates, branch-workspaces, store-context-resolution, TEST_AUDIT_REPORT. No EMS or HR docs exist yet.
- .env.example covers workspace mode variables, M-Pesa variables, ALLOWED_HOSTS, cookie hardening variables. UPDATE_ON_START is documented in deployment docs and start scripts rather than .env.example (P2).
- Release machinery: release.yml cuts a tag and publishes a GitHub Release when the version is bumped on main; tags are never reused.

## 20. EMS readiness assessment

| Area | Verdict |
| --- | --- |
| Branch-isolated employee records | Ready: storeId pattern plus injectTenant plus requireStoreAccess |
| Attendance integration with Shift | Ready: Shift and AttendanceRecord exist; ghost-shift canonical check is endedAt null |
| Leave balances | Ready: EmployeeLeaveBalance and LeaveRequest exist; recompute logic to be added idempotently |
| Payroll posting to GL | Blocked until P0-2 lands |
| Payroll rate tables | Must be added: current rates are code constants, spec requires versioned RateTable data |
| RBAC extension | Ready: string roles plus permission matrix; HR_MANAGER and EMPLOYEE are additive |
| Self-service | Ready: auth, idle timeout, and masking helpers reusable |
| Payslip PDF | Reuse receipt PDF pipeline; PayrollDetail carries the line data |
| Exports | Reuse report export patterns after P0-1 fix |
| PII masking and audit | Blocked for employee data until P0-1 lands |
| Updater deployment of EMS schema | Ready: preflight plus backup plus rollback |

Overall: READY_WITH_CORRECTIONS.

## 21. P0 blockers

1. P0-1: unmasked employee PII in the CSV export (src/lib/data-export-utils.ts). Violates the spec rule that national ID, KRA PIN, bank details, and statutory numbers must never appear unmasked in list or export payloads.
2. P0-2: chart of accounts cannot host payroll journals. Missing statutory liability and employer expense accounts, non-idempotent account seeding, account code 2300 double meaning, 1400 type disagreement between seed and helper, no idempotencyKey on JournalEntry.

## 22. P1 required items

1. Apply sanitizeForLog by default inside systemLog.
2. Role-gate salary fields in employee list payloads; keep gross figures out of generic lists.
3. Add JournalEntry.idempotencyKey as part of the P0-2 correction so payroll posting can be replay-safe.
4. Persist abuse-lock counters or document single-instance limitation in the EMS deployment notes.
5. Rate-table seed data must carry verifyWithCounsel true and an instrument reference for every statutory default.

## 23. P2 hygiene items

1. staged-update.mjs could import validate-tag.mjs directly for defense in depth.
2. UPDATE_ON_START missing from .env.example.
3. Vitest coverage thresholds commented out; enable after EMS tests land.
4. No format script; formatting is ad hoc.
5. Seed demo users and accounts use create under a coarse guard; convert to upserts for full idempotency during EMS work.

## 24. Recommended implementation sequence

1. Correction release 2.18.4.0: P0-1 and P0-2 on fix/ems-infrastructure-blockers.
2. Feature 2.18.5: EMS foundations plus employee records, documents, positions, grades, salary structures (Stage C, Phase 4.1 and 4.2).
3. Feature 2.18.6: recruitment and onboarding (Stage D, Phase 4.3).
4. Feature 2.18.7: attendance and leave completion (Stage E, Phase 4.4).
5. Feature 2.18.8: payroll engine with golden fixtures, run lifecycle, journal posting, payslips (Stage F, Phases 4.5 and 4.6; hard gate).
6. Feature 2.18.9: performance, assets, disciplinary, self-service (Stage G, Phase 4.7).
7. Feature 2.19.0: HR reporting, organization console tiles, compliance hardening, P10, retention (Stage H, Phase 4.8).

## 25. Required human decisions

1. Statutory defaults are seeded with verifyWithCounsel true. A Kenyan payroll-literate reviewer must confirm rate tables before production use. The system treats them as reviewable data, not legal advice.
2. Whether M-Pesa B2C payroll disbursement is pursued later; it is out of scope for 2.18.5 through 2.19.0 and marked future.
3. Whether employee self-service uses the existing User session (recommended) or a separate login surface; the plan assumes the existing session.

## 26. Evidence appendix

See docs/EMS_AUDIT_EVIDENCE.md for the command and file evidence matrix, docs/EMS_IMPLEMENTATION_GATE.md for the gate table, and docs/EMS_RISK_REGISTER.md for scored risks.
