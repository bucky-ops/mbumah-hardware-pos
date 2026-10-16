# Employee Self-Service (v2.19.0 — EMS Phase 4.7)

The employee-facing portal at `/employees/me` and its API family
`/api/self-service/me/*`. Mobile-first: a bottom tab bar on phones, inline nav
on desktop, and an offline payslip view.

## Identity resolution (cross-employee denial)

Every endpoint resolves the Employee row through the signed-in User via
`Employee.userId` (`@unique`). Client-supplied `employeeId` / `employeeCode`
parameters are ignored by design — queries are hard-scoped to the resolved
employee id, so reading another employee's data is structurally impossible.

Accounts without a linked Employee row receive `403 NO_EMPLOYEE_PROFILE`
(linking is an HR action on the employee record).

## Guard composition

`selfServiceGuard(permission)` runs, in order:

1. Session resolution (Bearer header wins, `mbt_token` cookie fallback — Layer 5).
2. HR module flag (`hr.module.enabled`) → `403 FEATURE_DISABLED`.
3. `hr.*` permission check (fail-closed, deny-logged via
   `recordPermissionDenied`).
4. Employee-link resolution → `403 NO_EMPLOYEE_PROFILE`.

Permission keys per endpoint:

| Endpoint | Permission |
|----------|-----------|
| `/me`, `/me/payslips`, `/me/payslips/[id]` | hr.payroll.read.own |
| `/me/attendance` | hr.attendance.record.own |
| `/me/leave` GET | hr.leave.read.own |
| `/me/leave` POST | hr.leave.request |
| `/me/documents` | hr.documents.read.own (new, additive) |
| `/me/goals`, `/me/reviews`, `/me/reviews/[id]/acknowledge` | hr.performance.read.own |

## Endpoints

- `GET /api/self-service/me` — dashboard: profile (tenure computed server-side),
  latest 3 payslips, leave balances, today's attendance, goal progress,
  pending-request count.
- `GET /api/self-service/me/payslips?year=` — own payslips with period names,
  gross/deductions/net (two-decimal strings), PS numbers.
- `GET /api/self-service/me/payslips/[id]` — full breakdown + stored
  computation figures. Statutory ids are `[REDACTED]` unless the caller holds
  `hr.employee.unmask.pii` (in which case the field is omitted entirely — the
  unmasked values are only ever served by HR endpoints with their own audit).
  Payslips owned by anyone else return 404.
- `GET /api/self-service/me/attendance?limit=&from=` — records + month summary
  (present/late/absent/leave counts, hours, overtime).
- `GET /api/self-service/me/leave` — balances (allocated + carry-forward − used
  − pending, Decimal math) and request history with rejection reasons.
- `POST /api/self-service/me/leave` — request leave; `employeeId`/`storeId` are
  forced to the session employee. Balance shortfalls surface as
  `409 INSUFFICIENT_LEAVE_BALANCE`; leave-service error codes are normalised
  onto safe JSON errors.
- `GET /api/self-service/me/documents` — metadata only (type, file name,
  verification status, issue/expiry). **HR notes are never included.**
- `GET /api/self-service/me/goals` — own goals with progress; POS-sourced goals
  are computed read-only on the fly (never persisted from this path).
- `GET /api/self-service/me/reviews` — own reviews (cycle name, status, dates).
- `POST /api/self-service/me/reviews/[id]/acknowledge` — the subject
  acknowledges their own SUBMITTED review; the service enforces the
  subject-or-HR rule.

## Offline payslip view (spec acceptance 8)

The payslip list and each opened payslip are cached to `localStorage`
(`mbt_self_payslips_cache_v1`, `mbt_self_payslip_v1:<id>`). When the API is
unreachable, cached data renders with a visible "offline" banner. The
dashboard carries the same pattern (`mbt_self_dashboard_cache_v1`).

## Accessibility & styling

Semantic landmarks (`header`/`main`/`nav` with aria-labels), focus-visible
rings on interactive cards, `role="progressbar"` with aria-valuenow on
progress meters, icon-only affordances carry aria-labels, and every colour
pairing has dark-mode variants. Lighthouse target: ≥ 90 on the portal
(reported at Stage H compliance pass).

## Lighthouse (spec acceptance 10)

Target: Lighthouse ≥ 90 on the self-service portal. Measurements must run
against a **production build** (`next build && next start`) — the dev server
(unminified bundles, HMR, on-demand compilation) produces non-representative
scores and is therefore not a valid measurement surface. The portal keeps the
budget-friendly baseline: a single client shell per page, Skeleton loading
states, system-adjacent font stack, no heavy client libraries beyond the
shared shadcn/ui set, and offline caching that avoids refetch loops. If a
production measurement lands below 90, the blocker and remediation are to be
recorded here per the spec's "documented blocker" clause.

### v2.23.0 measurement (authenticated production build)

`scripts/qa-lighthouse-authed.mjs` runs the spec measurement end to end: it
launches Chrome with a persistent profile + CDP, seeds the SPA's
`mbt_token` session cookie via `document.cookie` on an origin page, then
drives `lighthouse@12 --port` against the same instance so the instrumented
tabs share the cookie jar (passing the cookie as an extra HTTP header does
NOT persist across the page's own fetches — the first run measured a 401
error state as the LCP element, which invalidated the scores).

Results on the compile-mode production build (:3200), cashier session,
mobile throttling:

| Run | Performance | Accessibility | Best practices | SEO | TBT | Notes |
|-----|-------------|---------------|----------------|-----|-----|-------|
| v2.23.0 pre-fix | 73 | 95 | 96 | 100 | 580 ms | alert poll fired on mount |
| v2.23.0 poll deferred | 78 | 95 | 96 | 100 | 370 ms | poll deferred to requestIdleCallback |
| **v2.23.0 final** | **81** | **100** | 96 | 100 | 350 ms | progressbars carry accessible names; weighted a11y failures: none |

**RESOLVED in v2.24.0 — target exceeded (81 → 94).** The documented blocker
was remediated exactly as scoped, in two layers:

1. Route-level bundle scoping (v2.24.0): the app router is split into route
   groups — everything POS lives in `src/app/(shell)/` and mounts the full
   `<Providers>` stack there; `/employees/me` lives in
   `src/app/(selfservice)/` with a slim `SelfServiceProviders` (theme +
   crash boundary + console error logging only — no React Query, no auth/app
   stores, no alert popups, no toaster). Root layout now renders only the
   document shell. Effect: TBT 350 → 320 ms, main-thread 2.1 → 1.9 s.
2. The home page is now a SERVER COMPONENT (v2.24.0): the session resolves
   via `getSessionFromCookies()`, the same `getMyDashboard` service the API
   route uses assembles the payload, and the HTML streams with real content
   (`home-view.tsx`, LCP ≈ FCP). The old chain — skeleton, hydrate, fetch,
   re-render — gated LCP behind ~2 extra seconds. The offline localStorage
   mirror is kept by a tiny client island (`cache-writer.tsx`); the
   interactivity-bearing portal pages (payslips, attendance, leave, goals,
   documents) remain client components.

| run | perf | a11y | BP | SEO | TBT | note |
|-----|------|------|----|-----|-----|------|
| v2.23.0 final | 81 | 100 | 96 | 100 | 350 ms | progressbars carry accessible names |
| v2.24.0 route groups | 81 | 100 | 96 | 100 | 320 ms | boot cost down; LCP still fetch-gated |
| **v2.24.0 SSR home** | **94** | **100** | 96 | 100 | **170 ms** | LCP 3.9 → 2.5 s; HTML carries the dashboard |

**v2.28.0 — SSR COMPLETION across the whole portal.** The remaining five
interactivity-bearing pages (payslips, attendance, leave, goals, documents)
are now server components too, closing the "remain client components" caveat
above:

- Every page resolves its session through the shared `loadSelfPortal` guard
  (`self-portal.tsx`) — one implementation of the signed-in / module-enabled /
  employee-linked contract (previously inlined only on the home page, with
  subtly divergent fallbacks on the client pages).
- Read paths call the SAME services the API routes expose
  (`listMyPayslips`, `listMyAttendance`, `listMyLeave`, `listMyGoalProgress`,
  `listMyPerformanceReviews`, `listMyDocuments`) — the HTML carries the
  payload, LCP ≈ FCP on all six portal routes.
- Interactivity stays client-side where it belongs: the payslip breakdown
  dialog (cache-first, offline fallback), the leave request dialog and the
  review acknowledge button now `router.refresh()` the server render after a
  successful POST instead of re-fetching JSON by hand.
- The offline contracts are preserved: payslips mirror the freshly served
  list into the SAME `mbt_self_payslips_cache_v1` key via a cache-writer
  island, and the breakdown dialog still opens from
  `mbt_self_payslip_v1:<id>` when offline; the offline banner now tracks the
  browser's real connection state instead of a failed fetch.
- All six pages share one `SelfPageHeader` (gradient icon tile + title +
  supporting line + optional action slot) — the portal finally reads as one
  product.

Notes: attendance clock times render with an explicit Africa/Nairobi
timezone (previously viewer-local — a silent drift for devices off Kenyan
time). Remaining headroom is the Next.js App Router runtime itself
(~224 KiB framework chunk, irreducible) and the residual hydration work of
the interactive islands (payslip dialog, leave form, acknowledge buttons) —
micro-optimisations only from here.
