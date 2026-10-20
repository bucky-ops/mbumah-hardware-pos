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

### v2.161.0 re-measure — all six pages SSR (production build)

The v2.24.0 row above predates the v2.28.0 SSR completion; the acceptance
re-measure finally ran against the fully server-rendered portal. Mobile
Lighthouse 13.5.0 (`--only-categories=performance,accessibility,best-practices,seo`)
against `:3200/employees/me` on the production daemon build, cashier session.
The measurement method note below ("extra header does not persist") was
written for the v2.23.0 SPA-era portal, where the page fetched its payload
client-side after mount; since v2.28.0 the HTML carries the payload, so a
single header-authenticated run measures real content — the LCP element in
this run was the home card's payslip amount (`MAIN > DIV > SECTION > P`), not
an error state.

| run | perf | a11y | BP | SEO | TBT | note |
|-----|------|------|----|-----|-----|------|
| **v2.161.0 SSR-complete** | **92** | **100** | 96 | 100 | 153 ms | LCP 3.0 s (lab-throttled); FCP = SI 1.39 s; CLS 0 |

Verdict: **spec acceptance 10 (Lighthouse above 90) HOLDS on the SSR-complete
portal.** The remaining performance headroom: LCP element render delay
~177 ms and TBT 153 ms — both micro-optimisation territory.

The 4-point Best-Practices cost is an environment artifact, not an app bug:
`/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js` are
Vercel-managed endpoints that only exist on the Vercel deployment; on the
local daemon they 404 and Lighthouse counts the console noise. On production
Vercel these serve normally.

### The payslip goes home (v2.161.0)

`GET /api/self-service/me/payslips/[id]/pdf` — the employee can finally
download their own payslip PDF from the portal's breakdown dialog. The
contract:

- **One source of truth**: the route reuses the HR PDF route's exact builders
  (`buildPayslipView` + `buildPayslipPdf`) — no re-implementation, the PII
  masking and the layout cannot drift.
- **Masking posture** identical to the JSON detail route: statutory ids are
  masked unless the caller holds `hr.employee.unmask.pii` (computed
  server-side from the session role — never a query parameter).
- **Own-data rule**: the query is scoped by `employeeId: employee.id`; a
  payslip that is not yours is a **404** (existence is not leaked), matching
  `getMyPayslip`.
- **Honest lifecycle gate**: payslips become immutable (and downloadable) the
  moment the run POSTS — the sanctioned issuance write stamps
  `payslipNumber` + `payslipIssuedAt`. A non-issued detail (a DRAFT /
  PENDING_APPROVAL / APPROVED row) answers **409 NOT_ISSUED** with a
  plain-language reason; the dialog shows the same truth ("PDF download
  unlocks once this payslip is issued").
- **The honest flag**: `listMyPayslips` and `getMyPayslip` payloads now carry
  `issued: payslipIssuedAt !== null`. The portal renders the download only
  when `issued === true`, the pending note when `issued === false`, and
  NOTHING when the field is absent (an older offline cache — never a false
  promise). Issued list rows also show their issuance date.
- **Why the dialog**: the payslip row is a `<button>`; an anchor nested
  inside a button is invalid HTML — the dialog is both the valid and the
  natural decision point for taking the document home.

## The thirty-minute contract (v2.162.0)

The EMS spec asks two idle-timeout questions — line 843.6: *"Does idle
timeout protect unattended tills and potentially employee self-service
sessions?"* and line 1068.7: *"Can self-service reuse auth and idle timeout
safely?"* The till half was answered in v2.6.0 (client-side `useIdleTimeout`
in the POS shell: 30 minutes → clear tokens → login screen, cart kept). The
portal half stayed open until v2.162.0: a portal browser kept its 24-hour
cookie session indefinitely, no matter how long it sat unattended. The
answer is now **yes — reused, server-enforced, surface-scoped**:

- **One cadence, two surfaces**: `SELF_SERVICE_IDLE_MS` is the SAME
  30-minute window the till has used since v2.6.0 (`src/lib/session-idle.ts`
  is the pure contract: `idleExpired`, the 401 shape, the constant — no db,
  no clock reads; `now` is always a parameter).
- **Server-side enforcement (the real protection)**: `selfServiceGuard`
  checks `Session.lastActiveAt` on EVERY `/api/self-service/*` request —
  expired → the session ROW is deleted (the cookie dies with it; it cannot
  be replayed) and the request answers **401 `SESSION_IDLE_EXPIRED`**;
  fresh → the window SLIDES (the request re-stamps `lastActiveAt`). The
  SSR half lives in `loadSelfPortal`: an idle-expired page render shows the
  honest "Signed out for your safety" note (Clock icon + Sign in) instead
  of employee data, and deletes the row the same way.
- **The column was already there**: `Session.lastActiveAt`
  ("Track session activity") existed from day one but had zero readers or
  writers until v2.162.0. Legacy rows created before this release carry no
  stamp — `idleExpired` treats a missing or unparseable stamp as NOT
  expired (honest degradation to the v2.161.0 behaviour: absolute 24h
  expiry only; garbage never invents a lockout).
- **The client affordance reuses the literal hook**: `SelfServiceIdleWatch`
  (mounted once in `SelfServiceProviders`) imports the SAME `useIdleTimeout`
  the till uses; on timeout it POSTs `/api/auth/logout` (client and server
  agree — no zombie cookie) and renders an `alertdialog` overlay whose only
  action is Sign in. The overlay is the courtesy; the server check is the
  law — a re-opened tab or a scripted fetch cannot dodge it.
- **Surface-scoped on purpose (the "safely" part)**: the till's API routes
  never pass through `selfServiceGuard` or `loadSelfPortal`, so POS
  behaviour is byte-identical to pre-v2.162.0. One session row can serve
  both surfaces (one login); each surface enforces idle over ITS OWN
  traffic only — a cashier pounding the till all day does not keep an
  abandoned portal tab alive, and an employee reading portal pages does
  not get logged out mid-use (every page render slides the window).
- **No background polling exists on the portal** (verified v2.24.0+): the
  slim shell has no React Query and no interval fetchers, so nothing keeps
  the window alive but actual use.
