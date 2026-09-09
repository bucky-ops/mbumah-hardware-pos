# Code Audit Remediation Tracker

**Source report:** Comprehensive Code Audit Report — MBUMAH HARDWARE POS & ERP (`bucky-ops/mbumah-hardware-pos`)
**Remediation PR:** feature/code-audit-remediation
**Scope note:** Several findings in the source report had ALREADY been remediated by earlier PRs (#12/#14/#17/#18/#19/#20). This document maps every finding to its current status so the team has one authoritative checklist.

---

## Priority 1 — CRITICAL

| Finding | Issue | Status | Where |
|---|---|---|---|
| 1.1 Weak `any` in ORM extension | Type safety on tenancy-critical interceptors | ✅ **Fixed** | `src/lib/db.ts` — `QueryInterceptorArgs`/`TenantFilterableArgs` types; all 30 handlers statically verified; `injectTenant` fully documented |
| 1.2 Hardcoded DB path in scripts | `check-users.ts`, `reset-lockout.ts` | ✅ **Fixed** | `DATABASE_URL` env with portable repo-relative fallback |
| 1.2 (extended) Hardcoded exports dir in PRODUCTION routes | `/api/data-exports*` wrote to `/home/z/...` — **every export failed on Vercel** | ✅ **Fixed (production bug)** | `src/lib/export-paths.ts` → `EXPORTS_DIR` env or OS tmp dir |
| 1.3 `any` variable + weak validation in topup script | Shadowing TS keyword | ✅ **Fixed** | Renamed `hasValidRedemptions` |
| 1.4 Inconsistent API input validation | Mixed 400/500, no field-level errors | ✅ **Fixed (canonical response)** | `validationErrorResponse()` in `src/lib/validations.ts`; `/api/customers` POST migrated; login/checkout/customer/product schemas already enforced by `validateInput` + `requireAuth` layers |
| 1.4 (test coverage for APIs) | No route-level tests | 🟡 **Partially** | Pure-helper suite added (`src/__tests__/api-helpers.test.ts`, 17 tests); route-level integration tests remain open (needs hermetic test DB strategy — tracked as follow-up) |
| — Rate limiting (audit §5.2) | Limiter existed but only on login | ✅ **Fixed** | `WEBHOOK` tier (60/min/IP) on M-Pesa callback + `PAYMENT` tier (20/min/IP) on STK push; 429 + Retry-After + SecurityEvent rows |
| — Type safety in `db.ts` (audit P1 "4h item") | | ✅ **Fixed** | Same as 1.1 |

## Priority 2 — HIGH

| Finding | Status | Where |
|---|---|---|
| Pagination on list endpoints | ✅ **Already largely present + hardened** | products/customers already paginated; debt plans paginated in PR #18; NEW `src/lib/api-pagination.ts` centralises parsing with clamping (fixes `?page=-5` negative skip, `?limit=999999` memory risk, NaN limits) and a canonical meta envelope |
| JSDoc on critical functions | ✅ **Fixed** | `injectTenant`, `runWithTenant`, `withImmutabilityBypass`, `assertMutable`, interceptor contract |
| Structured logging | ✅ **Fixed (notification-service)** | One-JSON-line `log()` helper with `LOG_LEVEL`; API layer already had `withErrorBoundary` structured stdout + SystemLog |
| OpenAPI documentation | ✅ **Fixed** | `/api/openapi` (OpenAPI 3.0.3) covering auth, products, customers, debt plans, health, M-Pesa |
| Test coverage threshold | 🟡 **Config wired, gate deferred** | v8 coverage provider in `vitest.config.ts`; thresholds commented as ramp-up target (would fail CI today at 70%) |

## Priority 3 — MEDIUM (scheduled)

| Finding | Status | Where |
|---|---|---|
| Lazy-loading optimisation | ✅ **Fixed (prefetch)** | `src/lib/tab-preload.ts` single loader map; sidebar prefetches on `pointerenter`/`focus`; page.tsx consumes same map (one source of truth). Role-based eager loading intentionally NOT adopted — chunks are per-tab already; prefetch removes the cold-fetch penalty without restructuring |
| WebSocket heartbeat/cleanup | ✅ **Fixed** | Owned `startHeartbeat`/`stopHeartbeat`, cleared on SIGTERM/SIGINT, zero-client no-op |
| Remaining `any` audit (codebase-wide) | 🟡 **Open** | Interceptor + scripts `any` removed; issue #8 tracks the repo-wide TS-strict backlog (665 pre-existing errors) |
| Seed script Zod validation (`prisma/seed.ts`) | ⏳ **Deferred by design** | Seed is dev-only; a refactor risk without reward right now. Recommend wrapping seed fixtures when the seed is next touched functionally |
| Sentry integration | ℹ️ **Already provisioned** | `/api/health` reports `SENTRY_DSN` status; structured stdout is the drain until a DSN is configured. Adding the Sentry SDK remains a v2.0.0 roadmap item (issue #4) |
| Health check contract | ✅ **Fixed (additive)** | `uptimeSeconds` + `memory.heapUsedMB/rssMB` added; status codes/checks unchanged (already exceeded the audit's recommendation) |

---

## Verification

- `bunx eslint` on every changed file: **0 errors**
- `vitest run` (full suite incl. new tests): **green** (financial suite remains green; known pre-existing `financial-remediations.test.ts` failures reproduce identically on pristine `main` and are tracked separately)
- Notification service smoke test: boot → `/health` 200 → structured logs → clean SIGTERM
- Production behaviour of data-exports fixed by removing the unwritable hardcoded path (Vercel Lambda only allows `/tmp`)

## Security notes (out of audit scope but observed during remediation)

1. `VERCEL_DEPLOY_FIXES.md` previously contained a (now stale/rotated) Neon password — history purge + docs-only policy recommended.
2. CI on Neon free tier shows intermittent socket-timeout flakes — infrastructure, not code.
