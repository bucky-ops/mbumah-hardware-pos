# EMS Audit Evidence

All evidence gathered read-only from /home/z/ems at 6dbce961 (v2.18.4). Sensitive values masked. Where evidence was unavailable in this sandbox the required operator command is listed.

## Baseline commands

- git status --short: clean.
- git rev-parse --short HEAD: 6dbce961.
- git log --oneline -5: 6dbce961 (v2.18.4), 61eaaf4 (v2.18.3.2), 2f89a78 (v2.18.3.1), cb28c0a (v2.18.3.0), 894226e (v2.18.3).
- git ls-remote --tags origin via API: v2.18.4, v2.18.3.2, v2.18.3.1, v2.18.3.0, v2.18.3, v2.18.1, v2.18.0.3, v2.18.0.2, v2.18.0.1, v2.18.0.0, v2.18.0, v2.17.9 and older.
- GitHub releases/latest: v2.18.4, prerelease false.
- VERSION: 2.18.4. package.json version 2.18.4, mbumah block present.

## Gate 1 evidence: branch workspace

- prisma/schema.prisma:64 Store.slug String? @unique.
- prisma/schema.prisma:68 Store.subdomain String? @unique.
- prisma/schema.prisma:61 Store.code String? @unique.
- prisma/schema.prisma:77 Store.status String @default("ACTIVE") with values ACTIVE, CLOSED, RENOVATING. Semantically equivalent to Store.isActive for availability gating; no isActive column exists.
- prisma/seed.ts:280-378 five store upserts keyed by stable ids, slug and subdomain set in both branches. Slugs: juja-main, thika, ruiru, nairobi-cbd, nakuru.
- src/lib/workspace/server.ts:35-86 modes and reason codes (store-not-found, store-inactive, user-not-allowed, unauthenticated, missing-slug, schema-drift).
- src/lib/workspace/server.ts:196-385 resolveStoreContext resolves from DB only.
- src/lib/branch-workspace.ts:134,206,219 resolveBranchWorkspace, isLocalWorkspaceHost, getBranchWorkspaceHref.
- src/proxy.ts:281-314 host allowlist and subdomain rewrite; src/proxy.ts:283 403 on invalid host.
- src/app/stores/[slug]/layout.tsx exists, placeholder-slug guard at :25-45.
- Console workspace column precise reason badges shipped in v2.18.3.0 (cb28c0a).

## Gate 2 evidence: tenant isolation

- src/lib/db.ts:206 runWithTenant, :215 runWithoutTenant, :667 injectTenant.
- src/lib/auth.ts:459-500 assertStoreScope; :521-551 assertBodyStoreScope; both raise 403 and SecurityEvent on mismatch.
- src/lib/workspace/server.ts:144-179 logDeniedWorkspaceAccess.
- src/lib/auth.ts:564-633 auditRecordMiss for IDOR-class misses; :1010-1095 recordPermissionDenied; :1120-1226 noteDeniedAndMaybeLock.
- src/app/api/users/[id]/route.ts:267-278 USER_DELETE_BLOCKED for engraved admin.
- prisma/sql/rls_store_isolation.sql: database-level RLS for PostgreSQL production.
- Cross-branch denial behavior returns 403 or safe 404 with SecurityEvent; no branch existence leak.

## Gate 3 evidence: RBAC

- prisma/schema.prisma:166 role String @default("CASHIER"). Zero enum blocks in schema (rg "enum " count 0). Adding HR_MANAGER and EMPLOYEE is data, not DDL on an enum.
- prisma/schema.prisma:253-262 RolePermission with @@unique([role, resource, action]).
- src/lib/permissions.ts:47-87 FEATURE_PERMISSIONS map; :98 hasFeaturePermission fail-closed with SUPER_ADMIN bypass.
- src/lib/types.ts PERMISSION_MATRIX referenced by permissions.ts:3-8.
- src/lib/auth.ts:179 requireAuth, :249 requireRole, :302 withSessionAuth, :653 requireStoreAccess, :746 assertPermission, :968 requireFeaturePermission, :806-814 financial role bundles.
- Session shape src/lib/auth.ts:45-51 AuthSession { userId, email, role, storeId, organizationId }.

## Gate 4 evidence: accounting

- prisma/schema.prisma:718-745 Account (type String: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE; @@unique([organizationId, code])).
- prisma/schema.prisma:747-843 JournalEntry and JournalEntryLine; Decimal totals and unsigned debit/credit columns; reversingEntryId @unique.
- src/lib/account-helper.ts:506-508 and :677 balanced-entry throws; :364 recordSaleJournalEntry; :533 gift card; :624 goods receipt.
- src/lib/accounting-helpers.ts:252 validateJournalEntryBalancing; :528 createJournalEntry; :731 postJournalEntry; :832 voidJournalEntry.
- src/lib/account-helper.ts:20 GIFT_CARD_LIABILITY mapped to 2300; prisma/seed.ts:1567 creates a supplier payable at 2300; prisma/seed.ts:1566-1575 creates Gift Cards Outstanding at 2400. Conflict verified by direct file read.
- src/lib/account-helper.ts:45 RENTAL_DEPOSITS_HELD 1400 as LIABILITY/CREDIT versus prisma/seed.ts:1144 seeding 1400 as ASSET. Type disagreement verified.
- prisma/seed.ts:1160-1162 and :1577-1579 prisma.account.create (non-idempotent).
- src/lib/payroll-helpers.ts:59-85 NSSF_RATES, SHIF_RATES, HOUSING_LEVY_RATES, PAYE_BANDS constants in code; :197-355 calculators; :512 processPayrollRun; rg for journalEntry in payroll-helpers.ts returns 0 hits (no GL posting).
- Repo-wide search for "PAYE Payable|NSSF Payable|SHIF Payable|Housing Levy Payable|Net Pay Payable": 0 hits. No statutory liability accounts exist.
- idempotencyKey on JournalEntry: absent. Present on StockMovement :393, SalesTransaction :522, DebtLedger :629, EquipmentRental :684, Expense :979.

## Gate 5 evidence: updater

- scripts/staged-update.mjs: :238,310 staging dir; :224 https-only; :357-366 preflight on throwaway DB copy; :369-390 backup; :437-452 bounded health smoke; :269-296 rollback restores install dir and DB.
- deploy/nodocker/update-pos.sh: :212-213 build verification gate; :471-486 pre-update backup; :582-650 automatic rollback with rebuild and health gate; :360 select-release call.
- scripts/release/validate-tag.mjs:34-56 four-part validity requires existing base; hotfix cap .5; prereleases rejected.
- deploy/nodocker/rollback-pos.{sh,ps1} and backup-pos.{sh,ps1} exist.

## Gate 6 evidence: security and privacy

- src/proxy.ts:45-55 rate limit tiers; :108-123 CSRF exact-origin fail-closed; body cap 1 MB.
- src/app/api/payments/mpesa/callback/route.ts: :274-285 terminal-state idempotent gate; :321 atomic claim; :20 unique (storeId, mpesaReceiptNumber); :108-140 constant-time credential check with IP allowlist.
- src/app/api/payments/mpesa/stkpush/route.ts:82-86 optional idempotencyKey; src/lib/mpesa-idempotency.ts:49-79 ten-minute in-flight dedupe.
- src/lib/logger.ts:52-89 sanitizeForLog with LOG_REDACT_KEYS; masking is opt-in per call site.
- src/lib/data-export-utils.ts:504-510 employee export includes nationalId, kraPin, nssfNumber, nhifNumber, bankAccountName in clear text; :528-556 CSV columns include those PII fields plus salary fields. No role gate, no audit log on export. P0-1.
- Health routes: 12 files under src/app/api/health; schema drift detail role-gated to SUPER_ADMIN and STORE_OWNER (schema/route.ts:34-36).

## Gate 7 evidence: tests and verification

- package.json: test = vitest run with pretest prepare-test-db; typecheck = tsc --noEmit --strict.
- 27 test files: 19 in src/tests/lib, 8 in src/__tests__. Relevant existing suites: payroll-math, money, tenant-scoping, store-guard, mpesa-idempotency, branch-workspace.
- scripts/verify-*.mjs: branch-workspace, branch-manager-users, build-output, org-console-expert-info, prisma-config, release-selection, standalone, windows-build-safety, plus scripts/domains/verify-subdomains.mjs.

## Seed and demo data

- prisma/seed.ts:383-397 admin upsert; :113-148 branch manager upserts with StoreMembership; :1870-1930 five employees with statutory numbers; demo email domain const at :44 (mbumahhardware.co.ke).
- Global user-count guard :226-228; stage progress tracking :22-40.

## Unverified items and required operator commands

The Windows desktop database is not reachable from this environment. To close those items, run on the operator machine:

1. sqlite3 "C:\Users\kamam\mbumah-pos-data\pos.db" "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%store%';"
2. sqlite3 "C:\Users\kamam\mbumah-pos-data\pos.db" "PRAGMA table_info(stores);"
3. sqlite3 "C:\Users\kamam\mbumah-pos-data\pos.db" "SELECT slug, subdomain, status FROM stores;"
4. sqlite3 "C:\Users\kamam\mbumah-pos-data\pos.db" "SELECT email, role, storeId, isActive FROM users;"
5. sqlite3 "C:\Users\kamam\mbumah-pos-data\pos.db" "SELECT code, type, name FROM accounts ORDER BY code;"

These are read-only commands. Marked unverified: operator database account codes (whether 2300 carries the supplier payable or gift card liability on live data), operator store slugs, operator user bindings.
