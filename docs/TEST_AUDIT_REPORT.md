# Test audit report (v2.18.4)

Audit date: release v2.18.4 (audit sequence release 5, with the release 6
hygiene residuals bundled). Scope: every automated test file in the
repository, the capability areas they cover, the risks that remain, and the
acceptance checklist for this release. This report closes audit Finding 23
(testing visibility) and is planned maintenance bundled into v2.18.4.

Recommendation (up front): the full vitest suite must run in CI on every
pull request, not only locally before a release. The suite is hermetic
enough for CI (the pretest step prepares a local SQLite database via
scripts/prepare-test-db.mjs and the unit tests mock the database where
needed). The 16 pre-existing failures documented below stay invisible until
someone runs the suite by hand today; a CI gate makes them impossible to
ignore and protects the baseline from silent regressions.

## 1. Test file inventory (27 files)

Every file matching `src/tests/**` and `src/**/__tests__/**`, with the
coverage area taken from its header comment.

### src/__tests__ (8 files)

| File | Coverage (from header) |
| --- | --- |
| src/__tests__/api-helpers.test.ts | Audit-remediation API helpers: pagination parse and meta build (api-pagination), the canonical 400 validation response (validations), and rate limit tier enforcement including the WEBHOOK tier. |
| src/__tests__/api/transactions.test.ts | Transactions API integration tests: the financial invariants of the POS checkout flow. |
| src/__tests__/lib/error-normaliser.test.ts | normaliseError truthfulness: real HTTP status preserved in normalised errors and friendly branch-blocked lookup messages (v2.5 R2/R8 fixes). |
| src/__tests__/lib/financial-math.test.ts | financialMath audit spec: the uniform formula chain (line subtotal, line discount, net, VAT inclusive and exclusive). |
| src/__tests__/lib/money.test.ts | Money class financial-correctness guarantees (currency arithmetic). |
| src/__tests__/lib/payroll-math.test.ts | calculatePayForPeriod against hand-computed Kenya 2024/2025 statutory values (PAYE, NSSF, SHIF, housing levy). |
| src/__tests__/lib/tenant-scoping.test.ts | ORM-level tenant scoping (injectTenant) security regressions: client-supplied where.storeId can never weaken scoping. |
| src/__tests__/lib/transfer-sku.test.ts | Transfer SKU derivation, branch code normalization, employee code formatting, SKU generation. |

### src/tests/lib (19 files)

| File | Coverage (from header) |
| --- | --- |
| src/tests/lib/account-helper.test.ts | recordSaleJournalEntry double-entry bookkeeping invariants the POS checkout relies on (ISO 9001 / GAAP). |
| src/tests/lib/auth-redirect.test.ts | v2.18.1 post-login redirect matrix for branch-bound roles (workspace links). |
| src/tests/lib/branch-workspace.test.ts | v2.18.0.0 / v2.18.3.0: the safe workspace link builder (href, usedMode, precise unavailable reasons) and resolveStoreContext with a mocked database (43 cases). |
| src/tests/lib/build-output-policy.test.ts | v2.18.0.2 / v2.18.3.1: the build log fatal-pattern scan (compile, module-not-found, P2022, prisma:error, standalone trace copy) and the dual-mode start contract. |
| src/tests/lib/compliance.test.ts | Compliance helpers. |
| src/tests/lib/currency-utils.test.ts | Currency utilities. |
| src/tests/lib/debt-helpers.test.ts | Debt management helpers. |
| src/tests/lib/financial-remediations.test.ts | Financial-remediation regression tests pinning the remediated behaviors from the financial module audit. |
| src/tests/lib/immutability.test.ts | Hardened Prisma client extension immutability guards fire for JournalEntry, JournalEntryLine and SystemLog. |
| src/tests/lib/mpesa-idempotency.test.ts | v2.18.3.2: findInFlightStkPush natural-window dedupe query (match, miss, phone normalization, store scoping, status restriction). |
| src/tests/lib/org-diagnostics.test.ts | v2.18.4 (new): deriveSlugFromStoreName canonical mappings and edge cases; computeBranchDiagnostics classification, schema probe caching and drift, batched aggregates and degradation, with the database mocked. 15 cases. |
| src/tests/lib/receipt-format.test.ts | v2.14.0 receipt-rendering formatting helpers (money never wraps, canonical KES formatter reuse). |
| src/tests/lib/release-version.test.ts | v2.18.0.2: release version parser, comparator and tag validator (the real modules the updaters use). |
| src/tests/lib/store-guard.test.ts | v2.17.8: store-scope authorization helpers (requireStoreAccess, assertStoreScope). |
| src/tests/lib/updater-state.test.ts | v2.17.9: staged updater state store defensive reads (pure filesystem, fresh temp dir per test). |
| src/tests/lib/validations.test.ts | Zod validation schemas. |
| src/tests/lib/wac.test.ts | Weighted average cost calculation (IAS 2 layers, hermetic pure function). |
| src/tests/lib/workspace-domain.test.ts | v2.16.0 / v2.17.7: Edge-safe domain helpers consumed by the proxy and workspace resolver, including resolveRequestHost forwarded-host trust. |
| src/tests/lib/workspace-stores.test.ts | v2.16.0: consistency between the three places that define branch workspaces (seed, client store-info, domains tooling). |

## 2. Role matrix

Roles x capability areas. Values: Direct (tests pin the behavior for this
role), Indirect (covered through shared helpers this role depends on), None
(no test in the suite; guarded by route-level auth gates and lint), Blocked
by design (the role is denied the capability and no test asserts the
denial).

| Capability area | SUPER_ADMIN | STORE_OWNER | BRANCH_MANAGER | CASHIER | ACCOUNTANT | Unauthenticated |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication and session | Indirect | Indirect | Indirect (auth-redirect) | Indirect (auth-redirect) | Indirect | None |
| Tenant isolation (injectTenant) | Indirect | Indirect | Indirect | Indirect | Indirect | None |
| Store-scope authorization (requireStoreAccess, assertStoreScope) | Indirect (store-guard) | Indirect (store-guard) | Indirect (store-guard) | Indirect (store-guard) | Indirect (store-guard) | None |
| POS checkout financial invariants | Indirect | Indirect | Indirect | Indirect | Indirect | None |
| Journal entries and financial math | Indirect | Indirect | None | None | Indirect | None |
| Payroll calculation | Indirect | Indirect | None | None | Indirect | None |
| Debt management | Indirect | Indirect | Indirect (debt-helpers) | None | None | None |
| Rentals | None | None | None | None | None | None |
| Inventory (WAC) | Indirect | Indirect | None | None | None | None |
| M-Pesa STK push idempotency | Indirect | Indirect | None | None | None | None |
| M-Pesa callback settlement | None (route-level) | None (route-level) | None | None | None | None |
| eTIMS | None | None | None | None | None | None |
| Workspace routing and link safety | Direct (branch-workspace, workspace-domain) | Direct (branch-workspace) | Indirect | Indirect | Indirect | Direct (unauthenticated fallbacks) |
| Organization console diagnostics (v2.18.4) | Indirect (data layer is role-agnostic; routes gate) | Indirect (routes gate) | Blocked by design | Blocked by design | Blocked by design | Blocked by design |
| User management | None (route-level) | None (route-level) | None | None | None | None |
| Build and updater safety | Indirect | Indirect | None | None | None | None |
| Receipts | Indirect | Indirect | Indirect | Indirect | None | None |

Honest gaps: route-level behavior (role gates, rate limits, 401/403
responses) is guarded by the in-route patterns and the static verification
scripts, not by route integration tests in this repository. The rentals,
eTIMS, M-Pesa callback, and user management areas have no dedicated test
file; they are the next candidates when the suite moves into CI.

## 3. Module matrix

| Module | Test files | Notes |
| --- | --- | --- |
| Auth, session and redirects | auth-redirect, store-guard | Redirect matrix and store-scope helpers. |
| Workspace routing | branch-workspace, workspace-domain, workspace-stores | Link builder, domain helpers, cross-file consistency. |
| Tenant scoping | tenant-scoping | ORM-level regression tests. |
| Financial math and money | financial-math, money, account-helper, financial-remediations, wac | The strongest-covered area in the suite. |
| Payroll | payroll-math | Kenya statutory rules. |
| Debt | debt-helpers | Helper level. |
| M-Pesa | mpesa-idempotency | Dedupe query; callback route itself untested (route-level). |
| Receipts | receipt-format | Formatting contracts. |
| API infrastructure | api-helpers, error-normaliser, validations | Pagination, rate limit tiers, error normalization, Zod schemas. |
| Build and release tooling | build-output-policy, release-version, updater-state | Updater and release safety. |
| Organization diagnostics (v2.18.4) | org-diagnostics | Slug derivation and the diagnostics classifier with a mocked database. |
| Compliance and currency | compliance, currency-utils | Helper level. |
| Transactions API | src/__tests__/api/transactions | Checkout invariants. |

## 4. Risk register

| ID | Risk | Status | Mitigation |
| --- | --- | --- | --- |
| R1 | 471 strict-typecheck errors on pre-existing lineage files (the documented baseline since the v2.18.3 reconciliation; CI runs Type Check as advisory). | Accepted baseline, not a v2.18.4 regression. | v2.18.4 contributes zero new strict errors (gate below). Future releases chip away at the baseline; the advisory CI check keeps it visible. |
| R2 | 16 pre-existing vitest failures (551 passed / 16 failed / 20 skipped at the v2.18.3 baseline). | Accepted baseline, not a v2.18.4 regression. | Run the full vitest suite in CI (this report's headline recommendation) so the count is enforced on every pull request. |
| R3 | Route-level behavior (auth gates, rate limits, status codes) has no integration tests in the repository. | Open. | Compensating controls: the uniform requireAuth/requireRole patterns, the static verify scripts, and lint. Route tests are the first candidate after the CI gate lands. |
| R4 | computeBranchDiagnostics tests run against a mocked database; a real-database exercise happens later in CI (prepare-test-db) and on live deployments. | Open, by design for v2.18.4. | The data layer degrades on every failure mode; the schema drift probe reports drift or unknown rather than throwing. |
| R5 | Release verification in some environments cannot trust rendered terminal output for content patterns. | Process risk, handled. | Verification uses base64 encoding, YES/NO boolean checks, and git object-store reads in single processes (the release gates below do exactly this). |

## 5. Acceptance checklist (v2.18.4)

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | New diagnostics data layer with documented reason-code vocabulary | Pass | src/lib/org/diagnostics.ts; vocabulary contract checked by scripts/verify-org-console-expert-info.mjs |
| 2 | Expert console and diagnostics API routes role-gated and rate-limited | Pass | requireRole('SUPER_ADMIN', 'STORE_OWNER') pattern in all routes; verified by scripts/verify-org-console-expert-info.mjs |
| 3 | Slug repair preview non-mutating, apply confirm-gated, SQLite-only, backup-first, duplicate-refusing, idempotent, audited | Pass | Route guards in src/app/api/org/slug-repair/*; static checks in the verify script |
| 4 | Unit tests for slug derivation and diagnostics classification | Pass | src/tests/lib/org-diagnostics.test.ts: 15 cases green (vitest run) |
| 5 | Regression selection stays green (branch-workspace, mpesa-idempotency, build-output-policy) | Pass | vitest run of the four selected files, all passing at release time |
| 6 | ESLint clean on all touched files | Pass | bunx eslint on the touched file list: 0 errors |
| 7 | Zero new strict-typecheck errors in touched files | Pass | bunx tsc --noEmit --strict filtered to touched files: 0 hits (baseline R1 unchanged) |
| 8 | Full vitest suite green in CI | Blocked | Blocked on the CI job landing (recommendation above); local baseline 551/16/20 documented as risk R2 |
| 9 | Full strict-typecheck baseline zero | Blocked | Blocked on the 471-error lineage baseline (risk R1); tracked for future correction releases |
| 10 | Documentation set present | Pass | docs/org-console-expert-information.md, docs/org-console-roadmap.md, docs/database-migration-policy.md, this report (md and json) |

## 6. Recommendation

Run the full vitest suite (`npm test`, which prepares the test database and
executes every file inventoried above) as a required CI check on every pull
request. The pre-existing 16 failures should be triaged in the next
correction release (v2.18.5 slot or earlier) so the CI gate can start from a
green baseline instead of a known-red one.
