# Changelog

All notable changes to Mbumah Hardware POS are documented in this file (Keep a Changelog format; versions follow package.json).

## [2.115.0] The restricted read leaves a trace

Confidentiality-hardening release: grievance confidentiality (EMS spec Phase 4.7 acceptance 5) was enforced at the detail level since v2.19.0 — descriptions stayed out of lists and behind an explicit allow-list. This release makes the enforcement *traceable*: a restricted read (granted or denied) now leaves an audit record, and the discipline desk grows the search, filters, countdown chips and honest CSV export a working caseload needs.

### Added
- **Restricted-read audit trail** (`src/lib/hr/discipline-service.ts`): `getCaseDetail` writes `DISCIPLINARY_RESTRICTED_VIEWED` when a permitted role opens a RESTRICTED record (actor, role, case id, store — the metadata carries the confidentiality flag, never the description text), and `DISCIPLINARY_RESTRICTED_DENIED` on the allow-list's 403 path, so the refusal is as traceable as the grant. Today the route guard admits exactly the allow-listed roles, so the denied path is defence in depth — the trace exists the day the guard's key ever widens.
- **The discipline desk matures** (`src/app/(shell)/hr/discipline/page.tsx`): employee search (client-side on the already-loaded list), a type filter (warning / grievance / investigation), a live counts line ("N of M cases shown · R restricted"), a filtered-empty state distinct from the true zero, and amber "in Nd" countdown chips on OPEN warnings inside 14 days (past-due never renders — the sweep retires those before the list is built).
- **The case list exports honestly** (`src/lib/hr/discipline-list-csv.ts`): a pure RFC 4180 serializer behind the toolbar's CSV door — columns are exactly the list payload's (case id, employee, type, severity, status, confidentiality, issued, expires); descriptions and resolution notes have no column, so the export can never become a back door around the detail view's gate.
- **The detail dialog says what the audit does**: restricted records wear a violet "Viewing this restricted record is logged to the audit trail." note — the logging is visible to the person it concerns, not a silent background behavior.

### Changed
- The restricted rows in the list carry a violet "Restricted" chip beside the lock icon (the lock alone was easy to scroll past).
- The What's-New feed leads with the traceability story; the unread counter test re-anchored for the 2.115.0-fed feed (2.110.0→4, 2.109.0→5, 2.108.0→6, 2.77.0→37).

### Security
- The audit trail stores no case content: metadata names `confidentiality: 'RESTRICTED'` and nothing else — the trail proves access happened without itself becoming a copy of the sensitive data. The CSV serializer's column set is pinned by tests, so a future column proposal that carries the description fails the build, not a breach review.

## [2.114.0] The assets half of the alert opens its door

Door-completion release: v2.113.0 made the People & Payroll panel's expiry count split honestly — documents became a door, overdue assets stayed text because the assets list was session-scoped. This release teaches the assets list org-scoped, windowed reads, so the second half of the alert opens its own door too.

### Added
- **The overdue-assets door** (`src/components/finance/people-payroll-by-branch.tsx`, `src/lib/workspace/links.ts`): the expiry cell's assets half renders as a link to `/hr/assets?overdue=1&storeId=<id>` (built by the pure `buildOverdueAssetsHref`) with aria-label, title, hover manners and a visible focus ring — same amber family as the documents door, `+N` compact form when the documents door is present, full-size when it is the only alert. Zero halves never render as links; roles the list would refuse keep the same honest text as before.
- **`GET /api/hr/assets` grew two honest query params**: `?overdue=1` mirrors the panel's `assetsOverdue` definition exactly (status ASSIGNED with `dueReturnOn` in the past, deleted excluded) so the door lands on the number the alert promised, and wins over any conflicting status filter; `?storeId=` is honored only for org-scope roles whose organization owns the store (via `storeInOrganization`, fail-closed) or when it matches the session's own store — any other request silently keeps the session scope.
- **The Assets page grew the door's landing** (`src/app/(shell)/hr/assets/page.tsx`): an "Overdue only" toggle (amber, `aria-pressed`, disabled status select while on — overdue assets are assigned by definition), link-seeded `(from link)` chip that retires on the first filter touch, filters mirrored into the URL (shareable views, refresh-stable), a live assignment count, and the same store-scope honesty notice the employees list rides on (only claims a mismatch when a row actually names another store).

### Changed
- `listAssets` (`src/lib/hr/asset-service.ts`) accepts `storeId` + `overdue` filters; the DTO already carried the row's `storeId`, so the mismatch notice needed no schema change.
- The What's-New feed leads with the two-doors story; the unread counter test re-anchored for the 2.114.0-fed feed (2.110.0→3, 2.109.0→4, 2.108.0→5, 2.77.0→36).
- The v2.113.0 panel pin re-anchored (`canOpenExpiry` → `canOpenDocs`) now that a second, parallel gate (`canOpenAssets`) exists beside it.

### Security
- Scope never widened by request: the assets list verifies organization ownership server-side before honoring any explicit branch (`storeInOrganization`, fail-closed); the overdue filter exposes assignment rows the roles already hold — no new data leaves the server; the panel's door is gated client-side on `ASSET_LIST_READ_ROLES` (mirroring the route's `hr.asset.manage` guard) so it can never promise a view the role would be refused.

## [2.113.0] The dead columns open their doors; the HR roster finally exists

Bug-fix-and-doors release: QA found the HR workspace nav's oldest link (`/hr/employees`) landing on a 404 — the page had never shipped. This release builds it, and the People & Payroll panel's last two dead columns (latest run, expiry alerts) become real doors that land somewhere useful.

### Added
- **The `/hr/employees` list page** (`src/app/(shell)/hr/employees/page.tsx` — NEW, fixes the 404): search (name/code/job title, debounced, server-side `?q=`), status filter, and an **expiring-documents toggle** backed by the new `expiringWithinDays` service filter — only employees holding documents whose expiry falls inside `[now, now+N days]`, each annotated with `expiringDocuments` + `nearestExpiry` (a count and a date; the PII contract holds). Desktop table + mobile cards; every row opens the employee record; precise empty states; `(from link)` chip on a link-seeded toggle until first touch; `Clear filters` counts what it clears.
- **The latest-run door** (`src/components/finance/people-payroll-by-branch.tsx`, `src/lib/workspace/links.ts`): `hrPerStore.latestPayroll` now carries `runId` (additive server join in `src/lib/hr/reports.ts`), and the panel's latest-run cell renders as a link to `/hr/payroll?run=<id>` (built by the pure `buildRunDeepLinkHref`) with aria-label, title, hover manners and a visible focus ring. Stale summaries without a run id degrade to the same honest text — never a dead link.
- **The expiry door**: the alerts count splits honestly — the documents half is a link to `/hr/employees?expiring=90&storeId=<id>` (`buildExpiringEmployeesHref`); the assets half stays text because the assets list is session-scoped and a cross-branch door would promise a view it cannot open. Zero halves never render as links. Mobile cards reuse the same cells — one implementation, two surfaces.
- **`?run=` deep link on /hr/payroll**: a lazy initializer seeds the run dialog straight from the URL; a mount effect strips the param once, so a refresh never re-opens a stale dialog; the dialog's own fetch fail-closes when the run is not the session's to see.

### Changed
- **`GET /api/hr/employees` grew two honest query params**: `?expiring=<days>` (clamped 1..365 by `parseExpiringDays`; anything else ignored) and `?storeId=` honored **only** for ORG-scope roles (the same scope model `/api/org/summary` serves) and only when `storeInOrganization` proves the store belongs to the caller's organization — fail-closed 403 on any miss. Branch-scoped roles keep their session store exactly as before; client storeId stays ignored for them.
- The What's-New feed leads with the doors story; the unread counter test re-anchored for the 2.113.0-fed feed (2.110.0→2, 2.109.0→3, 2.108.0→4, 2.77.0→35).
- The shared `OrgSummaryData.hrPerStore` type carries `runId`; the org console and the SPA tab share the same panel, so both homes gained the doors in one move.

### Security
- Scope never widened by request: the employees list verifies organization ownership server-side before honoring any explicit branch (`storeInOrganization`, fail-closed); the expiring filter exposes counts and dates only — never document names, types, or contents; `/hr/payroll?run=` opens the dialog but the run detail endpoint still answers only what the session may see; the doors are display selectors over views the roles already hold.

## [2.112.0] The branch picker hands you the payroll ledger

Reach-and-manners release: branch listings grow a "People & payroll" affordance — the v2.111.0 deep link's natural consumer, in BOTH homes (the Branch Selector's cards and the Organization Console's Workspace column) — and October's BONUS run completed the last leg of the payroll lifecycle (manual disbursement) as the round's live end-to-end proof.

### Added
- **People & payroll hand-over, two homes** (`src/lib/workspace/links.ts`, `src/components/workspace/branch-selector.tsx`, `src/components/workspace/org-console.tsx`): every branch card in the Branch Selector and every row of the Organization Console's Branches table offers "People & payroll" — a new-tab link to `/?tab=people-payroll&branch=<storeId>` built by the pure `buildPeoplePayrollDeepLink`. The selector stays available (one-tab-per-view, spec Phase 8); the shell consumes the deep link exactly as designed: tab applied after rehydrate, branch seeds the panel filter, "(from link)" until first touch. The org console is the owner's real branch-browsing home — that is where the affordance earns its keep.
- **Honest gating**: the affordance renders only for `ORG_SUMMARY_ROLES` — the exact roles the People & Payroll tab honors (`TAB_CONFIG`) — so it can never promise a view the role would be refused. E2E-verified both ways: warehouse@ (multi-store, not an org-summary role) sees the cards with NO payroll door; owner@ sees the door and the tab honors it. Inactive stores never offer the door.
- **The payroll lifecycle's last leg walked in the open**: October's BONUS run (POSTED, five payslips PENDING, KES 197,772.60) was disbursed by hand through the run dialog — every payslip flipped PAID, `paidAt` stamped on the run, the payroll group heard about it (digest + per-employee paid notices), and the lifecycle UI moved to its settled state. Prepare → approve → post → disburse: every leg now has a live E2E on the books.

### Changed
- **Branch cards learned some manners** (styling): a quiet hover lift (`hover:shadow-md`), the branch's own branding color ringing its dot on hover (light and dark via `group-hover:ring-current`), a visible `focus-within` border path for keyboard users, and an emerald-tinted outline variant for the payroll affordance with dark variants — on both homes. All transitions 200ms, all tokens (no raw hex outside the existing branding-color fallback).
- The What's-New feed leads with the hand-over story; the unread counter test re-anchored for the 2.112.0-fed feed (2.110.0→1, 2.109.0→2, 2.108.0→3, 2.77.0→34).

### Security
- The hand-over widens nothing: the link is a display selector over tabs the session can already see; the branch param remains a client-side filter over already-authorized rows; the server guards (`/api/org/summary` ORG_ROLES-only, HR report permission) still fail-closed. `target="_blank"` carries `rel="noopener noreferrer"` like every external-facing link in the selector.

## [2.111.0] The app speaks deep links; every settled run opens its door

Reach-and-auditability release: deep links into the People & Payroll tab (`?tab=` + `?branch=`), run-detail doors on the ledger drawer's settled-run chips, and the October BONUS run walked the full maker-checker lifecycle (approved by a different actor, posted with its journal) as the round's live end-to-end proof.

### Added
- **Deep links** (`src/app/(shell)/page.tsx`): a URL may name the tab (`?tab=<id>`). The boot effect validates the id against TAB_CONFIG and applies it AFTER the persisted store's async rehydrate settles (a synchronous write would be overwritten), then strips the param — a refresh returns to the persisted tab. Unknown ids are ignored silently.
- **Branch deep links** (`src/app/(shell)/tabs/people-payroll-tab.tsx`): `?branch=<storeId>` seeds the shared panel's filter. Every user change mirrors into the URL via `history.replaceState` (no navigation, no history entry); leaving the tab strips the param so a stale filter cannot haunt the next mount. While the filter still holds the link's value (and only then) the count reads "showing 1 of 5 (from link)".
- **Run-detail doors** (`src/app/(shell)/hr/payroll/page.tsx`): the ledger drawer's zero-run chips (slate, violet focus ring) and missing-journal chips (rose, rose focus ring) are real buttons with honest aria labels. Clicking hands the run to the run-detail dialog — the ledger drawer closes first, so two dialogs never stack. An audit starts from the line, not from a hunt.
- **The October BONUS run completed its lifecycle** (live data): prepared and submitted by SUPER_ADMIN, approved by STORE_OWNER (a distinct actor — maker-checker holds), posted with its journal and payslip numbers. The period drawer now shows three posted entries plus the quiet zero run.

### Changed
- `PeoplePayrollByBranch` accepts `defaultBranchId` and `onBranchFilterChange`; every mutation path (select AND Reset) reports through one `changeBranch` funnel.
- The What's-New feed leads with the deep-link story; the unread counter test re-anchored for the 2.111.0-fed feed (2.109.0→1, 2.108.0→2, 2.77.0→33).

### Security
- The deep links widen nothing: `?tab=` only selects among tabs the session can already see (a role-locked tab still renders its locked state, and server guards still fail-closed on every fetch); `?branch=` is a client-side filter over already-authorized rows. No URL value is trusted beyond choosing what to display — no navigation targets, no redirect surface.

## [2.110.0] The drawer knows a zero when it sees one; the people panel learns to filter

Honesty-and-reach release: the payroll period ledger's missing-journal alarm stops firing on zero-value runs (a long-running false alarm on the seeded 0-value LOCKED REGULAR October run), the People & Payroll shared panel gains a per-branch filter, and the period-journal API carries each run's payable truth so the drawer's classification reads server numbers, never guesses.

### Added
- **Zero-run honesty in the period ledger** (`src/lib/hr/payroll/period-journal.ts`): `PeriodLedger` grows a `zeroRuns` bucket — settled runs with nothing payable (totalNet 0 at 2dp) and no journal are surfaced in their own quiet block ("nothing was payable, so no journal posts — correct by design") instead of tripping the red missing-journal alarm. The alarm keeps its teeth: a settled run that owed money without an entry still fires "this must never happen".
- **Payable truth on the wire** (`GET /api/payroll/period-journal`): the runs select now reads `totalNet` and feeds it to the builder, so the value-aware split (money → alarm, dust → quiet) is decided on server numbers at 2dp precision — a float hair (0.004) is still a zero run, and a fake zero can never mask a real debt.
- **Per-branch filter on the People & Payroll panel** (`src/components/finance/people-payroll-by-branch.tsx`): a native select ("All branches" + each branch), a "showing X of Y" count and a Reset affordance, styled to the panel's design system (orange focus ring, dark variants). The filter is ONE pure function (`filterBranchRows`) feeding BOTH the desktop table and the mobile cards; it narrows, never reorders, and an unknown id is an honest empty state, never a silent fallback to all. Because it lives inside the shared panel, the Finance & Insights tab and the Expert Console both get it from one implementation.
- **Documentation**: docs/PAYROLL_LEDGER_ZERO_RUNS.md (the value-aware classification contract) and the filter contract added to docs/PEOPLE_PAYROLL_BY_BRANCH.md.

### Changed
- The period ledger drawer's empty state also counts zero runs before claiming "Nothing posted in this period yet."
- The What's-New feed leads with the zero-run story; the unread counter test re-anchored for the 2.110.0-fed feed (2.108.0→1, 2.107.0→2, 2.77.0→32).

### Security
- No new endpoints and no widened reads: the period-journal route keeps its exact guard (hr.payroll.read.all, the runs list's roles), tenant scoping, and payload shape (additive `zeroRuns` only). The filter is client-side over already-authorized rows — selecting a branch cannot fetch anything the caller could not already read.

## [2.109.0] People and payroll joins Finance and Insights; console navigation and icons unified

Information-architecture release directed by product feedback: the per-branch people and payroll drill-down moves under Finance and Insights, the two consoles share one implementation, the Expert Console gains a Home action back to POS, and the navigation order and icons are made deterministic.

### Added
- **People and Payroll tab (Finance and Insights)**: the "People and payroll by branch" panel now has its own tab in the main SPA's Finance and Insights group (id `people-payroll`, UserCog icon, offered to exactly the roles /api/org/summary's guard serves: SUPER_ADMIN, STORE_OWNER, ACCOUNTANT; locked in the sidebar for everyone else). The tab reads the same additive hrPerStore block the consoles read; per branch it shows headcount, employment cost (KES, thousands separators), absence rate, latest payroll run, and expiry alerts.
- **Shared panel component** (`src/components/finance/people-payroll-by-branch.tsx`): one implementation, two homes (Expert Console collapsed by default, the new tab expanded by default). Missing data shows precise reason codes (PAYROLL_RUN_NOT_AVAILABLE, PERMISSION_DENIED, HR_DATA_SOURCE_UNAVAILABLE, API_ERROR_SAFE), never blank, undefined, NaN, or fabricated numbers. Desktop renders a dense table with a sticky header, mobile renders cards, neither scrolls horizontally.
- **Expert Console Home action**: a Home button (Home icon, accessible name "Back to POS", testid `console-home-pos`) in the /console header, placed first in the actions row so it cannot overlap badges or menus. It returns to the POS workspace through ONE internal helper (`goHomeToPos`: sets the pos tab in the app store, assigns "/"), so it cannot become an open redirect.
- **Unified console shell** (`src/components/console/unified-console.tsx`): Organization Console and Expert Console render through one shared shell (mode "organization" / mode="expert") that unifies the mode contract, the skip-to-content landmark, and the main landmark, while each console keeps its own header design and every existing capability (see docs/CONSOLE_MERGE_PARITY_MATRIX.md).
- **Documentation**: docs/NAVIGATION_INFORMATION_ARCHITECTURE.md, docs/ICON_SYSTEM.md, docs/CONSOLE_MERGE_PARITY_MATRIX.md, docs/FINANCE_INSIGHTS_NAVIGATION.md, docs/EXPERT_CONSOLE_HOME.md, docs/PEOPLE_PAYROLL_BY_BRANCH.md.

### Changed
- **Navigation order**: the workspace links (Branch Selector, Organization Console, Expert Console, Global Chat) moved below the navigation rail so their visible order now follows the Admin module exactly: Admin, Branch Selector, Organization Console, Expert Console, Global Chat.
- **Icons**: Admin wears ShieldCheck; Branch Selector wears Building2; Organization Console wears Network; Expert Console keeps Gauge; Global Chat keeps MessagesSquare (clearly a chat icon, consistent with the app's existing chat surfaces). Every TAB_CONFIG entry carries a required icon (type-enforced), with no duplicate ids or labels.
- **The Expert Console page consumes the shared panel**; the old inline per-branch table was removed (its logic lives only in the shared component now).

### Security
- The people-payroll tab is offered to exactly the roles the org-summary endpoint's guard serves; the server re-validates every request and fail-closes (no HR module or no HR report permission means no hrPerStore block).
- The Home action navigates through one internal helper that accepts no external URL, so it cannot become an open redirect.
- One shared database and storeId tenant isolation are unchanged; no destructive database operations were performed.

## [2.30.0] Payroll tab leave/attendance contract fix + manager approval UX completion

QA-caught crash fix with a feature completion pass. Browser QA on v2.29.1 reproduced "Unable to load Payroll" (`SectionErrorBoundary:Payroll`, `TypeError: Cannot read properties of undefined (reading 'firstName')`) the moment the Payroll tab was opened with the seeded PENDING leave request in the database — the first leave request in any store crashed the whole tab. Root cause: the Leave sub-tab rendered `l.employee.firstName` / `l.leaveType.name`, but `GET /api/leaves` returns FLAT DTOs (`employeeName`, `employeeJobTitle`, `leaveTypeName`… — no nested objects); the interface in the tab described a shape the API never shipped. The Attendance sub-tab carried the identical latent bug (`r.employee.firstName` vs the flat `/api/attendance` DTO) and would have crashed on the first attendance record. A second latent bug hid underneath: the approve/reject buttons sent lowercase `action: 'approve' | 'reject'` while `PUT /api/leaves` requires UPPERCASE `'APPROVE' | 'REJECT'` — every decision click would have 400'd even without the crash. The seeded PENDING request from v2.29.1 is what finally exposed both.

### Fixed
- **Leave sub-tab crashed the Payroll tab on the first leave request**: rewritten against the real flat DTO (`employeeName`, `employeeJobTitle`, `photoUrl`, `leaveTypeName`, `leaveTypeCode`, `isPaid`, `isStatutory`, `workingDays`, `halfDay`, `reason`, `rejectionReason`, `returnDate`, `approvedAt`, `emergencyContact`). The Attendance sub-tab received the same contract fix (`employeeName`, `employeeJobTitle`, `overtimeHours`, `lateMinutes`). A static contract test (`src/tests/lib/payroll-tab-contracts.test.ts`) now forbids `l.employee.*` / `r.employee.*` / `l.leaveType.*` / `l.days` reads in the tab and pins the flat field names, so the shape drift can never ship again.
- **Approve/reject actions 400'd**: the mutation now sends the UPPERCASE actions the API requires, and the toast copy no longer reads "APPROVEd successfully".
- **Approving leave never incremented `usedDays` (silent balance corruption)**: QA exercising the approve flow found the manager-approved request left the employee's balance at `used: 0`. Root cause: Prisma returns Decimal columns as decimal.js objects whose `valueOf()` is a STRING, so the inline arithmetic in `updateLeaveBalanceOnStatusChange` did `usedDays + days` as string concatenation (`"0" + "2" = "02"`) and `round2()` collapsed it to 0 — every approval since the Decimal migration silently refunded the taken days. (The REJECT path only looked healthy because `-` coerces numerically — exactly the asymmetry that hid the bug.) All transitions now route through the pure, Decimal-safe `leaveStatusTransitionDelta` (Number() coercion at the boundary, unit-tested with a decimal.js `valueOf` stub), and `PUT /api/leaves` additionally runs the idempotent aggregate-derived `recomputeBalances()` after every decision, which also HEALS balances corrupted by the old bug.
- **The same Decimal trap, closed everywhere it was live in the leave domain**: `GET /api/leaves?balances=true` computed `availableDays` with a bare `+` — a 21-day allocation rendered as **"210 of 21 d available"** (the QA screenshot caught it: `"21" + "0"` = `"210"`, then `-` coerced numerically). `getOrCreateLeaveBalance` computed the same corrupt `available` (so the POST leave-balance guard could never trip), the POST handler inflated `pendingDays` the same way (`"3" + 2` → 32 days once a balance already had pending rows), and the legacy payroll run's overtime reducer (`sum + Decimal`) concatenated multiple overtime records into garbage totals. All four sites now coerce with `Number()` before arithmetic. (TypeScript flagged every one of these as pre-existing TS2365/TS2363 baseline errors — the audit traced them and closed the live ones in the leave/attendance/payroll path; remaining flagged sites in other domains are listed in the worklog for a dedicated hygiene round.)
- **Attendance rows crashed on Decimal-serialized strings (QA-caught on the rebuilt build)**: setting the attendance date range to a window WITH records crashed the tab again — `TypeError: workingHours.toFixed is not a function`. `GET /api/attendance` serializes the Decimal columns (`workingHours` / `overtimeHours` / `lateMinutes`) through `Response.json`, where decimal.js' `toJSON` emits a STRING — calling `.toFixed()` on it throws. The rows (and the Avg Hours reducer, which would have string-concatenated the same way) now read every numeric field through the tab's `toNum()` money-guard; the contract test extends to forbid direct `.toFixed()` on DTO fields.

### Added
- **Reject-with-reason dialog**: rejecting a request now requires a reason (`rejectionReason`), persisted by the existing `PUT /api/leaves` contract and displayed to the employee as "Declined: …" in their self-service portal (the portal already rendered the field — the manager side just never collected it). Rejected rows show the reason inline (truncated with tooltip).
- **Request details dialog** ("View" on every row): full decision context — type, status, from/to, working days, paid/unpaid, half day, expected return, the employee's stated reason, rejection reason, emergency contact, and the decision timestamp — with Approve/Reject actions inline for PENDING rows.
- **Balances panel**: `GET /api/leaves?balances=true` always returned per-employee balance rows, but the tab (and the generic `apiFetch` helper, which unwraps only `data`) dropped them. A new `apiFetchEnvelope` helper preserves the full response envelope, and the new Balances card lists each employee × leave type with available/allocated days, a color-coded utilisation progress bar (emerald <50%, amber 50–79%, rose ≥80%), and pending-day counts. The pure presentation rules live in `src/lib/leave-tab.ts` (`balanceTone`, `balanceUtilization`, `initialsOf`, `leaveTypeStyle`) with unit coverage.
- **Tests**: 22 new cases (902 total) — the static contract guard (6), presentation-helper units (9: tone buckets incl. NaN fail-soft, utilization clamps, initials edge cases, per-code badge colors), and the balance-transition delta units (7: the Decimal `valueOf` stub reproducing the exact `"0" + "2" = "02"` trap, every transition row, negative/NaN/undefined clamps).
- **scripts/verify-v2-30-0.mjs** (`npm run verify:v2-30-0`): static checks over the flat-DTO rewrite, the uppercase actions, the envelope helper, the Decimal-safe transition delta + the recompute healing call, the pure module's directive-free state, the contract test's coverage, and version metadata (including the `mbumah.releaseVersion` lockstep check).

### Changed
- **Styling pass on the leave desk (and attendance table)**: status accent rails on request rows (amber PENDING / emerald APPROVED / rose REJECTED), initial avatars, type-colored badges (per-leave-type color families from `leaveTypeStyle`), tabular numerals on all date/time columns, hover elevation on cards and balance rows, spinner states on decision buttons, and an overtime/late-minutes sub-line on attendance rows.

## [2.29.1] Correction: SSR portal pages crashed when calling formatters imported from the client module

Correction release. QA on the v2.29.0 production build caught `/employees/me/payslips` crashing ("Something went wrong") for every employee with payslips; the regression hunt then surfaced a second latent instance of the same bug on the documents page.

### Fixed
- **Server pages called client-module functions during the server render**: the v2.29.0 payslips page imported `formatKes` from `@/components/hr/self-service-ui` — a `'use client'` module. On the server, plain-function exports of a client module are client REFERENCES, not functions, so invoking one inside the server component threw and the whole route hit the crash boundary. The formatter was moved to the import it was architected for (`@/components/hr/self-service-format`, the directive-free pure module both graphs can import — the same one `home-view.tsx` already used). The documents page had the identical latent bug with `formatDate`: it rendered fine only because the QA account had zero documents — any employee with a dated document would have crashed that route too. Both imports now come from the pure module; no other portal page imports formatters (statically verified).

### Added
- **Regression guard** (`src/tests/lib/self-service-server-format.test.ts`, 8 cases): statically enforces that all six `/employees/me/*` server pages never import `formatKes`/`formatDate` from the client module, that the two corrected pages import them from the pure module, and that the pure module stays directive-free (`'use client'`/`server-only` free) — the boundary violation can never ship again.
- **scripts/verify-v2-29-1.mjs** (`npm run verify:v2-29-1`): static checks over both corrected imports, the other four pages, the pure module's directives, the guard's coverage, and version metadata.

## [2.29.0] Self-service depth: SSR payslip year switcher, leave provisioned for everyone, email-log CSV export

Feature release (post-EMS polish round). Deepens the just-SSR'd self-service portal (v2.28.0) with the payslip year dimension, closes the leave happy-path gap (the dev data had zero leave types, so the request form was unreachable), and gives admins the offline audit affordance carried over since v2.26.0.

### Added
- **SSR payslip year switcher** (`/employees/me/payslips`): the page reads a validated `?year=YYYY` search param (anything non-4-digit falls back to the unfiltered latest-60 window) and renders a segmented-control switcher — "All years" plus every year the employee actually has payslips in, derived by the new pure-DB helper `listMyPayslipYears` (distinct `getUTCFullYear` buckets over the same 60-row window the list reads, newest first; a UTC bucket matches the `Date.UTC` bounds the list endpoint filters with, so a viewer's timezone can never put a period in the wrong year). Switching years is plain `<Link>` navigation — every view is server-rendered. Each view gains a `tabular-nums` summary line ("N payslips · KSh X net", `aria-live="polite"`).
- **Email-log CSV export** (`Admin` → Email delivery log → "Export CSV"): `GET /api/notifications/logs?format=csv` streams the full filtered history (active status/type filters apply; pagination ignored; hard cap 2 000 rows as a runaway guard) as RFC 4180 CSV — `text/csv; charset=utf-8`, dated `Content-Disposition` filename, `Cache-Control: no-store`. The branch short-circuits BEFORE the paginated query so an export never pays for the page fetch + count. The serializer lives in its own pure module (`src/lib/email-log-csv.ts`: comma/quote/CR/LF cells quoted, embedded quotes doubled, nulls → empty cells, dates → ISO, `message_id` pulled from parsed metadata, `triggered_by` as `Name <email>`); the viewer renders the export as a real anchor whose href carries the active filters — the download always matches what is on screen.
- **Leave provisioned for everyone** (`scripts/qa-seed-leave-dev.mjs`, idempotent): upserts the five standard Kenyan leave types (ANNUAL 21 / SICK 10 / MATERNITY 90 / PATERNITY 14 / COMPASSIONATE 5, statutory flags per the Employment Act, carry-forward rules on ANNUAL only) and grants every employee a current-year balance per type (`allocatedDays = defaultDaysPerYear`, carry-forward 0 — usage stays owned by `recomputeBalances`, mirroring `grantBalance` semantics). Dev DB before this round: **0 leave types, 0 balances** — the portal request form was unreachable; after: 5 types, 30 balances (6 employees × 5 types), and the request-dialog happy path is QA-able end to end.
- **Tests**: 10 new cases (872 total) — `email-log-csv.test.ts` (7: plain cells, quote/comma/CR/LF escaping with doubled quotes, null→empty + ISO dates, header row + CRLF framing, full row shape incl. `message_id`/`triggered_by`/error, absent-metadata empty cells) and `payslip-years.test.ts` (3: distinct years newest-first over the 60-row window with the same `take: 60` contract asserted, UTC bucketing not viewer-local, empty list without payslips).
- **scripts/verify-v2-29-0.mjs** (`npm run verify:v2-29-0`): static checks over the year helper (UTC bucket + window), the page's param validation + SSR switcher + summary line, the serializer + route short-circuit + role gate + viewer anchor, the seed's idempotency + type coverage, and version metadata (including the `mbumah.releaseVersion` lockstep check added after the v2.28.0 near-miss).

## [2.28.0] Self-service SSR completion: the whole portal server-renders, plus the notification "Email failed" filter

Feature release (post-EMS polish round). Closes the longest-standing item on the self-service list (carried since v2.24.0): the five remaining client-side portal pages — payslips, attendance, leave, goals, documents — are now server components behind one shared guard, so every `/employees/me/*` route arrives with its data already in the HTML. The notification center gains an "Email failed" filter so a broken digest send is one tap away.

### Added
- **SSR completion across the self-service portal**: `payslips`, `attendance`, `leave`, `goals` and `documents` are now server components (`export const dynamic = 'force-dynamic'`) that render through the SAME services the API routes expose (`listMyPayslips`, `listMyAttendance`, `listMyLeave`, `listMyGoalProgress` + `listMyPerformanceReviews`, `listMyDocuments`) — LCP ≈ FCP on all six portal routes, matching the v2.24.0 home-page remediation. The API routes remain for the interactive islands and programmatic consumers.
- **Shared portal guard** (`self-portal.tsx`): one `loadSelfPortal(permission)` implementation of the signed-in → module-enabled → employee-linked contract, shared by all six pages (previously inlined only on the home page; the client pages rendered bare error notes with a sign-in affordance divergence). The guard returns the resolved employee or the ready-to-render `PortalNote`.
- **Notification-center "Email failed" filter**: a new filter tab (rose `MailX` marker) that narrows the feed — active AND dismissed lists — to digest copies whose email delivery FAILED, backed by the pure fail-soft predicate `isFailedEmailDigest` in `digest-notification-view.ts`. The tab appears only when the feed actually carries `hr_digest` rows, so it is never dead chrome.
- **Styling pass (shared header)**: all six portal pages now render one `SelfPageHeader` — gradient icon tile (per-page tone), title, supporting line, optional action slot — plus per-card polish: payslip cards carry status accent rails (emerald POSTED / amber LOCKED), attendance tiles and rows gain hover states and tabular numerals, leave/goal/document cards gain consistent hover elevation, and the attendance month line names the month explicitly.
- **scripts/verify-v2-28-0.mjs** (`npm run verify:v2-28-0`): static checks over the shared guard, the five SSR pages (server-only, force-dynamic, permission, service), the preserved offline contracts (cache keys `mbt_self_payslips_cache_v1` / `mbt_self_payslip_v1:<id>`, connection-tracked offline banner), the POST-then-`router.refresh()` flows, the filter predicate + tab gating, and version metadata.
- **Tests**: 4 new cases (862 total) covering `isFailedEmailDigest` — matching rows, non-matching rows (SENT / no stamp / other types), fail-soft behavior on malformed input (null / scalar / array), and junk-tolerant matching.

### Changed
- **Leave request and review acknowledge flows** now `router.refresh()` the server render after a successful POST instead of hand-refetching JSON — the dialog closes onto freshly server-rendered balances/requests/reviews.
- **Payslips offline banner** now tracks the browser's real connection (`online`/`offline` events) instead of a failed fetch — accurate now that the list itself is server-rendered; the offline cache-first behavior of the breakdown dialog is unchanged.
- **docs/hr/self-service.md**: the "portal pages remain client components" caveat is replaced by the v2.28.0 SSR-completion section (guard consolidation, service-rendered reads, preserved offline contracts, shared header).

## [2.27.0] Delivery intelligence: per-recipient delivery expansion, digest rows that link to their schedule

Feature release (post-EMS polish round). Closes the two remaining delivery-observability gaps from the v2.25.0/v2.26.0 loop: a delivery attempt now expands to show exactly which addresses it was addressed to, and the notification center's digest copies finally tell you what happened to the email — and jump straight to the schedule that produced them.

### Added
- **Per-recipient delivery expansion** (Reports → Schedules → History): every delivery-history row is now expandable (chevron + `aria-expanded`, full-row button with focus ring) and reveals a per-recipient chip list parsed server-side from the envelope's address column — each chip carries the attempt's outcome glyph (✓/×/…) and a tooltip ("address — attempt FAILED"). The row header now shows the parsed address count instead of the metadata-derived number, so the two can never disagree. Expansion collapses automatically when the panel closes or another schedule's history opens.
- **Digest-row intelligence in the notification center**: HR digest copies (v2.24.0) previously rendered as generic info rows — a FAILED email looked identical to a healthy one. The `/api/notifications` route now flattens each digest copy's `Notification.metadata` through a pure fail-soft mapper (`parseDigestNotificationExtras`, shape-guarded, allow-list only) into three feed fields: `emailStatus` renders a delivery chip ("Email sent" emerald / "Email failed" rose), `manual` renders a sky "manual" marker, and `scheduleId` renders a violet **"Manage schedule"** affordance next to "Open report" that navigates to `/hr/reports?tab=schedules&schedule=<id>`. Digest rows also gain a violet left accent rail so they scan as a distinct class at a glance.
- **Per-schedule deep-link highlight** (Schedules tab): the reports page reads a new `?schedule=<id>` query param and passes it into the Schedules tab, which scrolls the matching card into view and ring-highlights it (violet ring, offset) for four seconds — so "Manage schedule" lands you on the exact schedule, not just the tab.
- **Tests**: 9 new cases (858 total / 46 files) — `hr-schedule-deliveries.test.ts` extends the delivery mapping with `recipientList` parsing (joined pair, messy input with spaces/empty/address-less fragments, single recipient) and the new mapper test file `digest-notification-view.test.ts` covers the full fail-soft contract (valid payloads, null/non-string input, malformed JSON, non-object JSON, shape-guard drops, allow-list behavior).
- **scripts/verify-v2-27-0.mjs** (`npm run verify:v2-27-0`): static checks over the service parser, the UI expansion + reset semantics, the mapper + route flattening + API types, the notification-center chips/deep link, the reports-page param pass-through, the card highlight, and version metadata.

## [2.26.0] Delivery ops console: admin email log viewer, digest recipient management, schedule write scope

Feature release (post-EMS polish round). Completes the delivery-observability loop started in v2.25.0 with an ops-facing surface: the Admin tab gains a read-only viewer over the (now durable) email delivery log, scheduled digests gain in-place recipient management with live validation, and schedule writes are finally as fail-closed as schedule sends.

### Fixed
- **Schedule PATCH/DELETE bypassed the branch scope (fail-closed doctrine violation)**: `updateSchedule` and `deleteSchedule` accepted any schedule in the organization from any role the route guard admits — including BRANCH_MANAGER. A branch manager could edit, pause or delete an org-wide or another branch's schedule, or worse, add their own address to an org-scope digest and start receiving aggregates of branches they must never see (send/preview/history have been fail-closed since v2.24.0; writes were not). Both writes now run `assertScheduleScope` (BRANCH managers may only manage their own branch's schedule; org-wide stays out of their scope; `STORE_SCOPE_FORBIDDEN` 403 otherwise), the PATCH/DELETE routes pass the real actor role/store, and the UPDATE/DELETE audit rows carry the actual actor identity instead of the synthetic `SYSTEM`.

### Added
- **Admin email delivery log viewer** (`Admin` tab → "Email delivery log"): a read-only console over `/api/notifications/logs` — the endpoint restored in v2.25.0 that no UI consumed until now. Every outbound email attempt (receipts, low-stock alerts, HR digests, …) is listable with status filters (ALL/SENT/FAILED/PENDING chips), a type filter mirroring the API whitelist, 15-per-page pagination with a total counter, 60s auto-refresh, and per-row expansion showing the delivery error, the parsed metadata (messageId, scheduleId, reportKey, actor), and the attributed user when known. Status/type chips and all interactive elements carry dark variants and focus rings; subject/recipient truncate with tooltips to keep the dense table scroll-free on mobile.
- **Digest recipient management** (Reports → Schedules): every schedule card's recipient chips and a new "Recipients" action open an editor dialog — one address per line, live per-address validation (invalid addresses highlighted red, valid ones green), automatic dedupe/trim/lowercase mirroring the server rules, a save button that stays disabled until the draft is valid and actually changed, and inline surfacing of scope errors (the new 403). Saving PATCHes `recipients` and refreshes the list; the next scheduled fire uses the updated list.
- **Tests**: 6 new cases (849 total / 45 files) — schedule write scope: BRANCH manager org-wide PATCH 403 with no DB write, other-branch PATCH 403, own-branch PATCH succeeds with recipients normalized (trim/lowercase/dedupe) and the real actor audited, org-role PATCH of org-wide still allowed, DELETE 403 + real-role audit on success, 404 precedence before scope checks.
- **scripts/verify-v2-26-0.mjs** (`npm run verify:v2-26-0`): static checks over the scope enforcement + audit attribution, the route actor pass-through, the viewer component/filters/pagination + admin-tab mount, the recipient editor affordances, and version metadata.

## [2.25.0] Digest delivery observability: durable email log, delivery history, dry-run preview

Feature release (post-EMS polish round). Makes email delivery observable end to end: the delivery log that the central email service has been trying to write since the email feature shipped actually persists now (the Prisma model had never been created), every scheduled digest gains a per-schedule delivery history with health dots, and a new dry-run preview shows exactly what the next digest email will contain — without sending anything.

### Fixed
- **The email delivery log was silently dead since it shipped (P0 latent)**: `src/lib/email-service.ts` writes every outbound attempt to `db.notificationLog`, and `GET /api/notifications/logs` reads the same table — but the `NotificationLog` model had never been added to `schema.prisma` (verified against the full git history). Writes were swallowed by the best-effort try/catch (emails still sent, history lost) and the logs endpoint failed at runtime for the only roles allowed to call it (SUPER_ADMIN / STORE_OWNER). The model now exists (`notification_logs` table: type, recipient, subject, status PENDING|SENT|FAILED, error, metadata JSON, sentAt), with a `User` relation on `ON DELETE SET NULL` so history survives user deletion, indexes on (type, createdAt), (status, createdAt), userId and createdAt, and a migration for the `migrate deploy` path (drifted databases converge via the schema-sync fallback as before). Attribution semantics unchanged: a failed log write still never masks the send result.

### Added
- **Per-schedule delivery history** (`GET /api/hr/reports/schedules/[id]/deliveries`): the last 10 `HR_REPORT_DIGEST` delivery attempts for a schedule, correlated via the `metadata.scheduleId` the digest sender stamps on every send (scheduled sweep and manual alike). Read-only and fail-closed on the same scope as send-now: BRANCH managers may read only their own branch's schedule (`STORE_SCOPE_FORBIDDEN` 403 otherwise, org-wide schedules included); org roles may read any schedule of their organization; unknown schedules 404. The Schedules tab renders it as an inline expandable panel (status chips, timestamps, recipient counts, manual-send markers, the provider error line) plus a "health dots" strip — the last 10 sends as green/red/amber dots with per-dot tooltips and an accessible summary label.
- **Dry-run digest preview** (`GET /api/hr/reports/schedules/[id]/preview`): computes exactly what the next email would contain through the same governed report functions and fail-closed scope as a real send — without sending email, writing any log/notification, or touching `lastRunAt`/`lastStatus`. The new `nextScheduleRunAt` helper computes the next due instant from the frequency slot AFTER both "now" and the last run (manual sends never move the cadence; DAILY/WEEKLY/MONTHLY semantics mirror `isScheduleDue`). The Schedules tab opens it in a dialog styled like the email itself: gradient header strip with report name/period/scope, headline stat grid, the aggregate table, recipient chips, the next scheduled send time, and the aggregates-only notice. When the report has no data for the period the dialog shows the reason instead of the stats.
- **Notification bell a11y**: the sidebar bell (both expanded and collapsed variants) now has an accessible name with the unread count ("Notifications (3 unread)") plus `aria-haspopup="dialog"`; previously it was an icon-only button with no name (caught in browser QA with a tree search for named buttons).
- **Tests**: 23 new cases across two files — `hr-schedule-deliveries.test.ts` (nextScheduleRunAt DAILY/WEEKLY/MONTHLY including the lastRunAt cadence guard; deliveries 404/403/metadata mapping/limit capping/malformed-metadata fallback; preview 404/403 + the pure-read assertion set: no email, no NotificationLog row, no notification row, no lastStatus stamp; unavailableReason path) and `email-delivery-log.test.ts` (SENT row with sentAt + messageId metadata, provider-failure row, Resend error-payload variant, unconfigured-key row, invalid-recipient row without touching the provider, and the log-write-failure-never-masks-the-result contract). Suite: 843 tests / 45 files.
- **scripts/verify-v2-25-0.mjs** (`npm run verify:v2-25-0`): static checks over the schema/migration/relation, the service scope + correlation contracts, the pure-read preview, the UI affordances, the bell a11y, and version metadata.

### Changed
- `tsc` baseline improves 477 → 473: restoring the missing model fixed the five pre-existing "type 'never'" errors in `/api/notifications/logs` and shrank the select-type mismatch noise in `/api/notifications/settings`.

## [2.24.0] Slim self-service portal (Lighthouse 94), digest send-now, in-app digest copies

Feature release (post-EMS polish round). Closes the documented Lighthouse blocker by splitting the app router into route groups and server-rendering the self-service home (performance 81 → 94, TBT 350 → 170 ms), and completes the digest loop with an on-demand "Send now" plus notification-center copies of every digest outcome.

### Added
- **Route-group bundle scoping**: the root layout now renders only the document shell; the POS provider stack (React Query, auth/app stores, alert popups, toaster) moved into the new `(shell)` route group, while `/employees/me` lives in `(selfservice)` with a slim `SelfServiceProviders` (theme + crash boundary + console error logging only). URLs are unchanged. The self-service portal no longer boots the POS runtime, which used to cost ~2.3 s of main-thread work on the Lighthouse mobile CPU.
- **Server-rendered self-service home**: `/employees/me` is now a server component — session via the new `getSessionFromCookies()` (cookies()-based RSC session resolution with the same expiry/lockout semantics as the request path), dashboard payload via the same `getMyDashboard` service the API route uses, HTML streamed with real content (`home-view.tsx`; LCP 3.9 → 2.5 s, LCP score 0.53 → 0.89). The offline localStorage mirror is preserved by a tiny client island (`cache-writer.tsx`) writing the same cache key. Attendance clock times now render with an explicit Africa/Nairobi timezone (previously viewer-local). Pure formatters moved to the directive-free `self-service-format.ts` so server components can call them (a `'use client'` module's functions may not be invoked from the server).
- **Digest "Send now"** (`POST /api/hr/reports/schedules/[id]/send-now`): sends a schedule's aggregate digest immediately without touching the cadence (`lastRunAt` stays — a manual send is not a schedule fire; `lastStatus`/`lastError` reflect the last attempt). Scope is fail-closed: BRANCH managers may only send their own branch's schedule (`STORE_SCOPE_FORBIDDEN` 403 otherwise, org-wide schedules included); org roles may send any schedule of their organization. Every send is audit-logged with the real actor and a `manualSend` marker.
- **In-app digest copies**: every digest outcome — scheduled sweep or manual send — writes a notification-center copy (`Notification` category `HR`) addressed to the schedule creator / acting user, with the digest headline (aggregate-only), the delivery status, and a deep link to the exact report tab (`/hr/reports?tab=…&storeId=…`). Successes stay quiet (info); failed deliveries ride priority HIGH so the alert popup host surfaces a silently broken cadence. The `/api/notifications` feed gained an `hr_digest` section (user-addressed, read via `runWithoutTenant` like the security rows), the Alerts panel renders them with a chart icon, visible "Open report" affordance and deep-link navigation, and the Schedules tab confirms each manual send with an inline result banner.
- **Tests**: 5 new `sendScheduleNow` cases (404 unknown/cross-org, BRANCH out-of-scope 403, own-branch SENT with `lastRunAt` untouched + actor-attributed audit + quiet notification, FAILED stamps + HIGH-priority copy, SKIPPED no-data path still writes the copy). Suite: 820 tests / 43 files.
- **scripts/verify-v2-24-0.mjs** (`npm run verify:v2-24-0`): static checks over the route-group layout, slim providers, SSR home + cache island, formatter extraction, send-now route/service contract, digest notification wiring, feed/UI handling, and version metadata.

### Fixed
- **Bodyless POSTs through the lean `apiSend` helper were rejected with 415** ("Content-Type must be application/json"): the helper omitted the Content-Type header whenever the body was undefined, and the proxy's `validateContentType` requires it on POST/PATCH. QA caught this on the new digest send-now button; the same latent defect silently broke goal acknowledge (`/api/self-service/me/reviews/[id]/acknowledge`) and goal recompute (`/api/hr/goals/[id]/recompute`). The helper now always declares the header, matching the main `lib/api` request wrapper.
- **The committed Prisma schema has carried `provider = "sqlite"` since v2.18.4.0**: a local postinstall provider flip was committed despite the schema header documenting `postgresql` (production builds were never affected - `vercel-build` re-runs `setup-prisma-provider.mjs` against the real `DATABASE_URL` before `prisma generate`). The committed schema is restored to `postgresql`, and the Security & Schema CI job gained a flip-proof guard that reads the provider from the git OBJECT and fails any commit carrying a non-postgresql provider.

### Changed
- `docs/hr/self-service.md`: the Lighthouse blocker section is resolved with the measured v2.24.0 table (81 → 94) and the two-layer remediation record (route groups + SSR home).

## [2.23.0] Per-branch HR drill-down, scope-aware digests, self-service perf pass

Feature release (post-EMS polish round). Adds the organization console's per-branch "People & payroll" drill-down with deep links into per-branch report views, per-branch scoping for reports and scheduled digests with fail-closed store enforcement, and the first authenticated Lighthouse measurement of the self-service portal (performance 73 → 81, accessibility 100).

### Added
- **Per-branch report drill-down** (`?storeId=` on the six report routes): ORG-scope callers (SUPER_ADMIN/STORE_OWNER/HR_MANAGER/ACCOUNTANT) can narrow any aggregate report to one branch. Fail-closed by construction — the store must belong to the caller's organization (`STORE_NOT_FOUND` 404), BRANCH-scope callers are rejected outright (`STORE_NARROWING_FORBIDDEN` 403; they are already scoped to their own store), and even a hostile storeId cannot widen access because the org-membership condition stays ANDed in every where-clause. The /hr/reports page reads `?storeId=` from the URL (bookmarkable), shows a clearable "Branch: <name>" chip, and appends the filter to every tab's fetch.
- **Org-console "People & payroll by branch"**: `GET /api/org/summary` now embeds an additive `hrPerStore` block (headcount, month cost, absence rate, latest payroll run, expiry alerts per branch — the exact tile definitions reused via grouped queries + per-store counts) and BOTH org consoles render it: the expert console (/console) as a collapsed "People & payroll by branch (n)" panel with per-branch rows deep-linking into `/hr/reports?tab=…&storeId=…`, and the workspace console (/org/dashboard) as an expandable table with sticky headers, status badges and dark variants. Rows carry store names only — aggregates stay PII-free.
- **Per-branch scheduled digests**: the Schedules tab gains a "Branch scope" selector (All branches / per branch, fed by the new session-scoped `GET /api/hr/stores`) and schedule cards badge the scoped branch. Enforcement is scope-aware server-side: BRANCH managers are PINNED to their own store (`STORE_SCOPE_FORBIDDEN` 403 on any other store — a manager can never schedule a digest for a branch they cannot see), ORG scopes may target any store of their organization or leave it org-wide, and the digest sweep computes branch-scoped reports under a BRANCH_MANAGER-scoped synthetic session exactly as before.
- **Authenticated Lighthouse measurement** (`scripts/qa-lighthouse-authed.mjs`): launches Chrome with a persistent profile + CDP, seeds the SPA's `mbt_token` cookie via `document.cookie` on an origin page, then drives `lighthouse@12 --port` against the same instance so instrumented tabs share the cookie jar (passing the cookie as an extra HTTP header does not persist across the page's own fetches — the naive run measured a 401 error state as the LCP element and invalidated the scores). Results and the documented blocker for the remaining performance gap are recorded in docs/hr/self-service.md per the spec's clause.
- **Self-service perf pass**: the app-wide alert popup poll no longer fires on mount — the first fetch is deferred to `requestIdleCallback` (2s fallback) after authentication, taking it out of the hydration/render critical path (TBT 580 → 350 ms, performance 73 → 81 on the measured build). `ProgressMeter` gained an accessible-name prop and all three call sites pass contextual labels (`aria-progressbar-name` now passes; accessibility 95 → 100, zero weighted failures).
- **Tests**: 10 new cases (store-narrowing validation incl. cross-org 404 + BRANCH 403, narrowed where-clause keeping org membership, per-store console rows mirroring the tile math with an aggregates-only assertion, BRANCH manager store pinning, ORG store target validation). Suite: **815 tests / 43 files**.
- **scripts/verify-v2-23-0.mjs** (`npm run verify:v2-23-0`): static checks over the narrowing service contract, route threading, console/filter UI, scope-aware schedule enforcement, the Lighthouse recipe, and version metadata.

## [2.22.0] B2C retry recovery, scheduled report digests, trace hardening

Feature release (post-EMS polish round). Adds targeted recovery for failed or stuck M-Pesa B2C payroll disbursements, scheduled email digests for every aggregate HR report, and hardens the payslip trace parser against legacy trace shapes.

### Added
- **M-Pesa B2C retry + stuck-status recovery** (`POST /api/payroll/runs/[id]/disburse-mpesa` with `mode`): `retry-failed` re-sends only payslips whose latest B2C attempt FAILED and which are still unpaid (a payslip with an active PENDING/PROCESSING/COMPLETED transaction is never touched, so double-payment stays structurally impossible; a no-op run answers `NOTHING_TO_RETRY 409`); `refresh-stuck` re-queries Safaricom via the Daraja Transaction Status endpoint (`/mpesa/transactionStatus/v1/query`, `TransactionStatusQuery`) for PROCESSING transactions with no result callback for 10 minutes (`B2C_STALE_PROCESSING_MS`) — an accepted query makes Safaricom re-emit the result on the existing webhook, which settles the payslip through the same idempotent path. Mock mode (staging opt-in) resolves stuck transactions immediately with a SIM receipt so hermetic QA exercises the full settle loop. Every run GET now embeds an additive, PII-free `disbursement` block (per-payslip attempts, last status, settled) that powers the new run-dialog affordances: **Retry failed (n)** and **Check status (n)** buttons, plus per-payslip state chips ("B2C failed · retry ready", "B2C processing · n attempts") with explanatory tooltips, in light and dark variants.
- **Scheduled HR report digests** (`/hr/reports → Schedules` tab): any of the six aggregate reports (headcount, employment cost, absence, turnover, time to hire, statutory liability) can be emailed on a DAILY/WEEKLY/MONTHLY schedule with a UTC send hour. Additive `HrReportSchedule` model (`hr_report_schedules`), CRUD routes (`/api/hr/reports/schedules[/id]`, soft delete), and a CRON_SECRET-gated sweep (`/api/cron/hr-report-digests?force=1` for ops) wired into the nightly dispatcher. Digests are computed at send time through the same governed, fail-closed report service (a store-scoped schedule runs under a BRANCH_MANAGER-scoped synthetic session; org schedules under SUPER_ADMIN-org) and rendered with a branded, escaped HTML template + plain-text variant — **aggregates only, never names / national IDs / raw ids**. Delivery outcome is stamped on the row (`lastRunAt/lastStatus/lastError`) and surfaced as status chips + summary counters in the Schedules tab; every send is audit-logged (`REPORT_SCHEDULE`).
- **Tests**: 25 new cases (legacy trace normalisation incl. the QA-caught 500 shape, net-from-identity derivation, retry idempotency + NOTHING_TO_RETRY, per-payslip state aggregation without PII, stuck-transaction recovery, freshness guard, schedule validation, due-date catch-up semantics, sweep SENT/FAILED/SKIPPED stamping, force mode, aggregates-only digest assertion). Suite: **805 tests / 42 files**.
- **scripts/verify-v2-22-0.mjs** (`npm run verify:v2-22-0`): 50+ static checks over the parser hardening, recovery service contract, schedule schema/RBAC/sweep wiring, nightly dispatch, UI affordances, and version metadata.

### Fixed
- **STORE_OWNER and ACCOUNTANT were locked out of /hr/reports entirely** (v2.20.0 regression, QA-caught): the report routes gate on `hr.report.branch`, whose role list lacked both roles, so the guard denied them before the scope resolver — which explicitly grants them ORG scope — ever ran. The permission map now includes both roles (additive, commented); the scope resolver remains the fail-closed authority for how much each caller sees. Surfaces: interactive report tabs, P10, org-console HR tiles, and the new schedules CRUD. Regression-tested in hr-permissions.test.ts.
- **Payslip trace dialog returned 500 on legacy computationTraces** (QA-caught on the v2.21.0 QA build): traces written before `rateTableIds`/`trace` existed (early engine versions, external triggers, QA fixtures) crashed `describePayslip` on `result.rateTableIds.length`. `parseTrace` now normalises every optional array, accepts the `engineSteps` alias, lifts legacy string step logs to the `{step, detail}` contract, and derives `netCents` from the gross − deductions identity when missing — only the identity-bearing fields stay mandatory. The hermetic seed now writes the exact engine shape, and the pre-existing legacy rows double as a live regression fixture.

## [2.21.0] M-Pesa B2C payroll disbursement + org-console deep links + payroll UI polish

Feature release (post-EMS polish round, spec Phase 4.6 optional M-Pesa B2C). Adds the optional payslip disbursement channel, makes the org-console HR tiles one-click deep links into the exact report, and upgrades the payroll run dialog with a lifecycle stepper, colored payment states, and per-payslip M-Pesa receipts.

### Added
- **M-Pesa B2C payslip disbursement** (`POST /api/payroll/runs/[id]/disburse-mpesa`, STORE_OWNER + `hr.payroll.disburse`): sends every pending payslip with net pay above zero to the employee's registered number as a Daraja B2C `SalaryPayment`. One payslip has at most one active disbursement transaction (additive nullable `MpesaTransaction.payrollDetailId` column) so re-running the action skips instead of double-paying; employees without a phone number are skipped with a reason and per-employee initiation failures never abort the batch.
- **Settlement webhooks** (`/api/payments/mpesa/b2c/result`, `/api/payments/mpesa/b2c/queue-timeout`): the result webhook claims the callback exactly once per transaction (atomic `callbackReceived` claim), settles successful payslips `PAID` with an `MPESA-<receipt>` reference through the append-only bypass (audit logged), and leaves failed transfers `PENDING` for retry. Security mirrors the C2B callback contract: HTTP Basic credentials (constant-time compare), optional IP allowlist, SecurityEvent logging on every rejection, rate limited.
- **Explicit mock mode**: without Daraja B2C credentials the disbursement completes with `SIM…` receipts so QA exercises the full loop; development defaults to mock, a production build must opt in via `MPESA_B2C_ALLOW_MOCK=true` (staging/hermetic QA, audit-recorded), and without the opt-in production refuses with `B2C_NOT_CONFIGURED` — money movement is never silently simulated. Real mode keeps payslips `PENDING` until Safaricom reports the result.
- **Org-console HR tile deep links**: the five "People & payroll" tiles now link to their exact destination (`?tab=headcount|cost|absence` into /hr/reports, the payroll tile into /hr/payroll, expiry alerts into /hr/assets) with hover/focus affordances and keyboard focus rings; /hr/reports tabs are deep-linkable via `?tab=` (bookmarkable via replaceState, unknown values fall back to headcount).
- **Payroll run dialog styling pass**: animated lifecycle stepper (Prepare → Submit → Approve → Post → Disburse → Lock) with done/current/todo states and ARIA labelling; colored payment status badges (PENDING slate / PAID emerald / FAILED rose / HELD amber) in light and dark variants; M-Pesa receipt chips on paid payslips; B2C confirmation dialog with the pending payslip count and net total before sending, plus a structured result summary (initiated / already active / skipped / failed / mock receipts).
- **Tests**: 15 new cases (state guard, production mock refusal + staging opt-in, phone/amount validation, idempotent re-run, no-phone skip, per-employee failure isolation, mock settlement, webhook settlement exactly once, duplicate delivery, failed-result handling, trace-shape gate + stored-columns payslip fallback). Suite: **780 tests / 41 files**.
- **scripts/verify-b2c.mjs** (`npm run verify:b2c`): static checks over the schema column, Daraja payload, idempotency branch, webhook auth contract, UI affordances, and deep links.
- **Docs**: docs/hr/payroll-run-lifecycle.md (disbursement section rewritten for both paths), docs/EMS_ENV_AND_DEPLOYMENT_NOTES.md (B2C env variables and webhook registration).

### Security
- The B2C result webhook stays public for Safaricom but is credentialed exactly like the C2B callback (Basic auth constant-time, IP allowlist, SecurityEvent rows); settlements are idempotent and the payslip-side writes go through the append-only bypass with audit events.
- Mock disbursements are impossible in production without the explicit `MPESA_B2C_ALLOW_MOCK` opt-in, eliminating any path that could mark payslips paid without a real Daraja transaction or an explicit manual confirmation.

### Fixed
- **Payslip views degraded to 0.00 when the stored computationTrace was missing or schema-mismatched** (row stubs from external triggers/imports). `buildPayslipView` now falls back to the authoritative `PayrollDetail` columns (the same stored lines the P10 register reads) with engine-stable line codes, keeping the gross − deductions = net identity exact; statutory identifiers stay masked in the fallback path.

## [2.20.0] EMS HR reporting, P10, org-console tiles, retention & erasure

Feature release (Stage H, EMS Phase 4.8 — final EMS phase). Completes the module with the six governed HR reports, the P10 statutory register reproduced from stored payroll lines, five HR tiles in the organization console, per-record-type retention with legal hold, and Data Protection Act erasure handling with recorded decisions.

### Added
- **Six HR reports** (`/api/hr/reports/{headcount,employment-cost,absence,turnover,time-to-hire,statutory-liability}`): aggregates only — per-employee rows carry employeeCode + job title, never names, national IDs, or raw ids. Scope model: STORE_OWNER/HR_MANAGER/ACCOUNTANT see the organization (hr.report.all), BRANCH_MANAGER sees their own branch (session-resolved), everyone else is denied fail-closed. Employment cost mirrors the engine's employer match (NSSF + AHL). All reports accept `?from=&to=`.
- **P10 statutory register** (`/api/hr/reports/p10?year=&format=csv|json`): **reproduces from stored posted payroll lines** — every figure reads the immutable PayrollDetail columns of POSTED/LOCKED runs in the tax year; nothing is recomputed, so the register always matches the journals and payslips. Groups by employeeCode with months + TOTAL row; CSV follows the repo export conventions and every export writes a `P10_EXPORTED` DATA_EXPORT audit event.
- **/hr/reports workspace**: dense tables with sticky headers, per-table column-visibility toggles, CSV export, print-to-PDF (dedicated print styles), no horizontal scroll on supported viewports (vertical scroll containers with max height), no badge overlap, no raw ids. Tabs: Headcount · Employment cost · Absence · Turnover · Time to hire · Statutory · P10 · Privacy.
- **Organization console HR tiles** (spec: headcount, employment cost, absence, payroll status, expiry alerts): `GET /api/org/summary` now embeds an `hr` block computed when the HR module is on and the caller holds an hr report permission; the console renders a five-tile "People & payroll" section (additive — an HR failure never breaks the console) linking to /hr/reports.
- **Retention per record type + legal hold**: `HR_RETENTION_POLICIES` (applicant rejection data per its own dataRetentionUntil; closed disciplinary cases 3y; attendance device data 2y — all documented, reviewable defaults, not legal advice). The nightly `GET /api/cron/retention` now also runs the per-organization HR sweep, which **anonymises in place** (`REDACTED (retention)`) so foreign keys and audit history stay intact, and **skips scopes under legal hold** (`HrSetting legalHold:<scope>=true`). Batch audit events per scope.
- **Erasure requests (Data Protection Act posture)**: additive `ErasureRequest` model + `/api/hr/privacy/erasure-requests` family. Opening is one-PENDING-per-employee; **execution erases non-statutory personal data only** (document files + notes, review narratives, contact fields) and lands `PARTIALLY_EXECUTED` with `retentionApplies=true` because payroll/audit rows keep statutory retention; rejection requires a decision reason and a legal basis; both are recorded with the decider id. Decisions reserved to `hr.settings.manage` (SUPER_ADMIN). Full audit coverage.
- **Ride-along**: `scripts/qa-seed-stage-g-dev.mjs` committed (Stage G hermetic QA seed, previously local-only).
- **Tests**: 16 new cases (report scoping incl. fail-closed roles, aggregate/no-raw-id payloads, employer-match math, P10 grouping/CSV/year filtering from stored lines, org tiles math, retention windows + legal hold + anonymisation, erasure execution/partial-execution/rejection contracts). Suite: **760 tests / 39 files**.
- **scripts/verify-stage-h.mjs** (`npm run verify:stage-h`): 50+ static checks over report routes/guard composition, P10 stored-lines contract, dense-table acceptance contract, tile payloads, retention/legal-hold wiring, erasure decision recording, docs, and version.
- **Docs**: docs/hr/reporting.md, docs/hr/data-protection.md, docs/hr/documents-and-retention.md.

### Security
- Reports and P10 are permission-gated with deny logging; aggregate payloads carry no names or raw identifiers; the P10 export is audit logged as DATA_EXPORT.
- Erasure decisions are SUPER_ADMIN-only with the decision, legal basis, and decider recorded; statutory records are never erased.
- Retention sweeps anonymise instead of hard-deleting and honour legal holds; each scope outcome (held/anonymised count) is audit logged.
- Security headers and rate limiting remain the platform-layer controls documented in docs/hr/data-protection.md (CSP/HSTS/COOP/CORP via the proxy; login rate limiting via x-ratelimit-*).

### Note
This completes the EMS implementation phases (4.1–4.8, Stages A–H). Remaining non-code items: statutory rate tables keep verifyWithCounsel=true pending owner review; Lighthouse ≥90 on /employees/me is scheduled against the production build in the next maintenance window (dev-mode scores are not representative — documented in docs/hr/self-service.md).

## [2.19.0] EMS performance, goals, assets, discipline, and employee self-service

Feature release (Stage G, EMS Phase 4.7). Adds the performance console (review cycles, reviews, calibration, POS-computed goals), asset assignments with authorization-gated recovery, disciplinary cases with automatic warning expiry and grievance confidentiality, and the mobile-first employee self-service portal at /employees/me.

### Added
- **Review cycles** (`/api/hr/performance/cycles`): DRAFT → ACTIVE → CLOSED state machine — a cycle needs at least one review to activate, CLOSED is terminal, calibration happens only while ACTIVE. Duplicate names rejected per organization.
- **Performance reviews** (`/api/hr/performance/reviews`): DRAFT → SUBMITTED → ACKNOWLEDGED → CALIBRATED. One review per (cycle, employee); ratings must be integers 1–5; only the assigned reviewer or HR edits/submit; the employee acknowledges their own review through self-service (`POST /api/self-service/me/reviews/[id]/acknowledge`); calibration is HR-only. **Ratings and narratives never appear in list payloads** (spec sensitive-data rule) — only the permission-gated single-review detail returns them.
- **Goals with POS-sourced computation** (`/api/hr/goals`): SALES_TOTAL / SALES_COUNT goals aggregate the linked employee's completed SalesTransaction rows (cashierId ← Employee.userId, scoped to the branch and the goal window, which metricConfig can override) — the value is computed, never typed; typed writes to POS-sourced goals return 409 POS_GOAL_READONLY. ACHIEVED flips automatically at target, MISSED after the window passes without achievement. All money math on Prisma.Decimal. `/recompute` refreshes on demand; self-service recomputes read-only for display.
- **Asset assignments** (`/api/hr/assets`): issue assets with tags/serials/condition-out and expected-return dates; RETURN records the condition back in; **LOST / DAMAGED require a named recovery authorizer** — an active user holding hr.asset.manage who must differ from the acting user (no self-authorization) — plus mandatory notes. Overdue assignments flagged in list payloads; `/api/hr/performance/authorizers` lists eligible authorizers (excluding the caller).
- **Disciplinary cases** (`/api/hr/discipline`): WARNING / GRIEVANCE / INVESTIGATION with 1–5 severity. **Warnings expire automatically** — a lazy sweep flips OPEN warnings past their expiry to EXPIRED on list/detail reads and writes one batch audit event. **Grievance confidentiality**: grievances default to RESTRICTED; case descriptions never appear in list payloads (any confidentiality level) and RESTRICTED detail is readable only by HR_MANAGER / STORE_OWNER / SUPER_ADMIN. Resolve requires resolution notes; double-closing is a 409.
- **Employee self-service portal** (`/employees/me` + `/api/self-service/me/*`): dashboard (profile with tenure, latest payslip, leave availability, today's attendance, goal progress), payslips (list + full breakdown dialog + plain-language stored computation), attendance (records + month summary tiles), leave (balances with availability meters, request form via the governed leave service, request history), goals (+ own reviews with acknowledge), and documents (metadata + verification status + 90-day expiry warnings). Every endpoint resolves the Employee row through the session User (`Employee.userId`) and **ignores client-supplied identity parameters entirely** — cross-employee reads are structurally impossible. Unlinked accounts get 403 NO_EMPLOYEE_PROFILE. Statutory ids stay [REDACTED] in self-view unless the caller holds hr.employee.unmask.pii.
- **Offline payslip view**: the payslip list and each opened payslip are cached to localStorage and render with an "offline" banner when the device cannot reach the API (spec acceptance 8).
- **Mobile-first self-service shell**: sticky header, mobile bottom tab bar (6 tabs, safe-area aware), desktop inline nav, gradient hero profile card, rounded stat tiles with icons, progress meters, and status badges with full dark-mode variants.
- **RBAC (additive)**: new permission key `hr.documents.read.own` (all staff roles) for the self-service documents endpoint; existing hr.performance.*/hr.asset.*/hr.discipline.* keys wired through hrGuard with deny logging.
- **HR workspace nav**: Performance, Assets, and Discipline consoles linked from the /hr header; lightweight `/api/hr/performance/people` picker endpoint returns id/name/jobTitle only (no PII-grade fields).
- **Tests**: 50 new cases across stage-g-performance, stage-g-goals, stage-g-assets-discipline, and stage-g-self-service (state machines, maker-of-review rules, list-payload masking, POS computation with Decimal parity, recovery authorization matrix, expiry sweep, confidentiality gates, guard composition, cross-employee denial, leave error mapping). Suite: 744 tests / 37 files.
- **scripts/verify-stage-g.mjs** (`npm run verify:stage-g`): 60+ static checks over routes, guard composition, sensitive-data rules, recovery authorization, POS-goal computation, self-service scoping, RBAC keys, UI surface, and docs.
- **Docs**: docs/hr/performance.md, docs/hr/assets-and-discipline.md, docs/hr/self-service.md.

### Security
- Self-service endpoints compose a dedicated guard: session → HR module flag → hr.* permission (deny-logged) → employee-link resolution, in that order, with fail-closed responses.
- Review ratings, case descriptions, and document notes are excluded from every list payload; RESTRICTED grievances additionally require elevated roles on the detail fetch.
- Recovery authorization is enforced server-side (role + active + not-self); the UI authorizer list also excludes the caller.
- All Stage G mutations write hash-chained audit events with field-name-only metadata.

### Note
Phase 4.8 (HR reporting/P10/org-console tiles/compliance hardening) is the next FEATURE slot: v2.20.0 per the version scheme (2.19.0 onward).

## [2.18.9] EMS payroll run lifecycle: maker-checker, idempotent posting, payslips, corrections

Feature release (Stage F completion, EMS Phase 4.6). Wraps the v2.18.8 engine in the governed run lifecycle: state machine, maker-checker approvals, idempotent journal posting through the existing accounting helper, payslip issuance with zero-dependency PDFs and plain-language traces, and reverse-and-replace corrections. Issued payslips are append-only.

### Added
- **Payroll run state machine**: DRAFT → PENDING_APPROVAL → APPROVED → POSTED → LOCKED, with REJECTED (approver sends back with a reason), VOIDED (pre-post cancellation), FAILED. Illegal transitions return 409 INVALID_TRANSITION; the state vocabulary and transition map are exported from `src/lib/hr/payroll/run-service.ts`.
- **Maker-checker (spec rule 21)**: `preparedByUserId` is captured at submit; `/approve` refuses the same user with 403 MAKER_CHECKER_VIOLATION regardless of role — no role combination (including SUPER_ADMIN) bypasses it. Corrections apply the same rule to their own requests.
- **Prepare-time gates** (`POST /api/payroll/runs/[id]/validate`): computes every active employee through the engine and blocks the run with per-employee reason codes — MISSING_CONSENT, TIMESHEET_NOT_APPROVED (unapproved attendance days), RATE_TABLE_MISSING / OVERLAPPING_RATE_TABLES, NEGATIVE_NET, DEDUCTION_CAP_EXCEEDED. Blocked runs stay DRAFT with the issue list persisted; nothing posts.
- **Idempotent posting** (`POST /api/payroll/runs/[id]/post`): aggregates stored integer-cent traces per account (5200/5210/5215 debits; 2210/2215/2220/2225/2250/2240 credits), asserts the aggregate balances (JOURNAL_IMBALANCE otherwise), verifies chart-of-accounts readiness (MISSING_CHART_ACCOUNT), then posts one combined journal through `createJournalEntry` with `idempotencyKey = payroll-run:{runId}` — a retried post returns the same entry and never double-journals. Payslip numbers (PS-YYYYMMDD-NNNN, gapless per-store sequence) are issued at post time; posting a replacement run flips its APPROVED corrections to APPLIED.
- **Payslip presentation**: `GET /api/payroll/runs/[id]/payslips` and `/api/payroll/payslips/[id]` return shaped views where national ID, KRA PIN, NSSF/SHIF numbers, bank account, and M-Pesa numbers are [REDACTED] unless the viewer holds hr.employee.unmask.pii; `/trace` renders the computation in plain language ("NSSF is deducted first; PAYE is computed on gross pay minus NSSF…") with the exact rate-table ids; `/pdf` streams a valid PDF 1.4 built by a zero-dependency writer fed by the already-masked view (the writer has no database access).
- **Corrections: reverse and replace** (`/api/payroll/corrections`): UNDERPAYMENT posts DR 5200 / CR 2240 for the signed delta and opens an idempotent SUPPLEMENTARY replacement run; OVERPAYMENT posts the reverse; REVERSAL re-uses the engine journal of the original payslip with debits and credits swapped. The replacement run goes through the normal maker-checked lifecycle; PayrollDetail rows are never edited.
- **/hr/payroll console**: status-colored run table with gross/deductions/net columns, lifecycle action bar that disables approval for the preparer (with an inline maker-checker explanation), blocked-employee issue cards with code badges, per-payslip trace expansion and PDF download, corrections queue with request dialog (payslip picker, signed amount with adjusted-net preview, ≥10-char reason) and maker-checked approve/reject. Payroll nav item added to the HR workspace.
- **Schema (additive)**: PayrollRun lifecycle fields (idempotencyKey unique, prepared/approved/rejected/posted/locked user+timestamps, journalEntryId), PayrollDetail issuance fields (payslipNumber unique, rateTableIds, roundingAdjustmentCents, computationTrace, payslipIssuedAt), and the new PayrollCorrection model (type, signed integer-cent amount, status, journalEntryId, replacementRunId). Sequence prefix PS registered in sequence.ts.
- **docs/hr/payroll-run-lifecycle.md**: state machine diagram, permission matrix, gate and posting contracts, corrections design, storage conventions.
- **scripts/verify-payroll-lifecycle.mjs** (`npm run verify:payroll-lifecycle`): static contract checks — state machine exported, maker-checker present, posting idempotency key, all Phase 4.6 routes compose hrGuard, PII masking, no float math in the lifecycle service, audit coverage.
- **Tests**: 22 cases in src/tests/lib/payroll-run-lifecycle.test.ts (state machine legality, maker-checker refusal, gate blocking with issue lists, engine-parity computation, balanced idempotently-keyed posting, replay no-op, missing-account block, correction immutability, reversal line swap, replacement-run creation).

### Note
Statutory rate tables still carry verifyWithCounsel=true pending owner review. Disbursement is manual confirmation (M-Pesa B2C remains optional future work). P10/statutory extracts and HR reporting land in v2.19.0 reading the stored payslip lines.

### Legacy compatibility
- `/api/payroll/runs` GET keeps the legacy POS Payroll-tab contract (periodName, numeric money fields per the v2.3.1 decimal fix, detailCount, status/payrollPeriodId filters) alongside the new lifecycle fields, so the existing tab keeps rendering.
- `POST /api/payroll/runs?process=true` (legacy "run payroll now") no longer auto-posts — that would bypass maker-checker, which the spec forbids. It now maps to prepare + submit-for-approval: payslips are computed and the run lands in PENDING_APPROVAL for a separate approver. The run detail console is /hr/payroll.
- `POST /api/payroll/runs/[id]/void` now requires hr.payroll.approve (STORE_OWNER) and records the caller-supplied reason in the audit metadata; voiding remains impossible once a run is POSTED or LOCKED (use corrections).
- **Proxy auth correction (affects the whole /hr workspace)**: the edge authentication gate accepted only Authorization: Bearer, while `getSessionFromRequest` (v2.16.0) also resolves the `mbt_token` workspace session cookie — so every cookie-authenticated page fetch (the /hr pages attach no Authorization header) was 401'd at the edge before reaching route guards. Layer 5 now accepts the same "header wins, cookie is a bootstrap fallback" pair; mutations still pass the CSRF gate first, and route guards still validate the token against the DB session.

## [2.18.8] EMS payroll engine: the hard gate

Feature release (Stage F of the EMS implementation protocol, Phase 4.5). Ships the pure computation engine and passes the payroll hard gate: golden fixtures and property tests green before any payroll UI exists. The run lifecycle with maker-checker and journal posting lands next (Phase 4.6).

### Added
- **Pure payroll engine (src/lib/hr/payroll/)**: integer-cents computation with no Prisma, React, or Next imports. Rate resolution from versioned tables (RATE_TABLE_MISSING and OVERLAPPING_RATE_TABLES guardrails), progressive PAYE bands with personal relief, NSSF Tier I and II on pensionable basic with employer match, SHIF with minimum contribution, Affordable Housing Levy with employer match, proration for unpaid leave, per-line-floored overtime, casual day rates, commission, and other deductions. NEGATIVE_NET blocks any run whose deductions exceed gross. Consent is a guardrail (MISSING_CONSENT).
- **Balanced journal construction**: buildPayrollJournal maps the computed payslip onto the reserved payroll chart (5200, 5210, 5215, 2210, 2215, 2220, 2225, 2250, 2240) and asserts debits equal credits before returning; JOURNAL_IMBALANCE is unreachable by construction but enforced. The idempotencyKey flows from the caller for replay-safe posting in the lifecycle release.
- **Golden fixtures**: ten hand-verified cases (below-band, band boundary, top band, NSSF exemption, Tier II slice, casual day rates, unpaid-leave proration, overtime, commission, other deductions) with frozen integer-cent expectations, plus the zero-gross minimum-SHIF case as a guardrail assertion. Property tests: net identity (net = gross - deductions exactly), journal balance, replay determinism, integer-only money, monotonic net across gross, rateTableId on every statutory line, and historical recompute equality.
- **docs/hr/payroll-worked-examples.md**: five hand-checkable worked examples an accountant can verify manually.
- **scripts/verify-payroll-engine.mjs**: source guarantees (no float, no server imports, complete guardrail vocabulary, frozen fixtures).
- **Tests**: 23 cases in src/tests/lib/payroll-engine.test.ts.

### Note
Rates remain versioned data with verifyWithCounsel=true. The engine consumes resolved tables as plain data; the run lifecycle (Phase 4.6: state machine, maker-checker, journal posting through createJournalEntry, payslip issuance) follows as the next EMS release.

## [2.18.7] EMS attendance and leave: replay-safe punches, timesheet gating, idempotent balances

Feature release (Stage E of the EMS implementation protocol, Phase 4.4). Extends the existing AttendanceRecord, LeaveRequest, and EmployeeLeaveBalance models additively and reuses the Shift system as the source of truth for till duty.

### Added
- **Attendance punch (/api/attendance/punch)**: server time is authoritative (client timestamps ignored), duplicate punch IN is suppressed per day, and punches carry an optional idempotencyKey so an offline replay returns the existing record unchanged (AttendanceRecord.idempotencyKey unique, nullable).
- **Timesheet approval (/api/attendance/timesheets/approve)**: approves a day range per employee; hasUnapprovedTimesheet() is the payroll gate implementing the TIMESHEET_NOT_APPROVED guardrail, and attendanceShiftVariance() surfaces attendance/Shift mismatches without mutating either system (ghost-shift logic remains canonical in the Shift API).
- **Leave (/api/leave/)**: balance-checked request submission (INSUFFICIENT_LEAVE_BALANCE and PERIOD_MISMATCH guardrails), approve and reject with optional delegation (LeaveRequest.delegateApproverUserId), balance grants that never overwrite usage aggregates, and recomputeBalances() deriving used/pending entirely from the request table so repeated runs are drift-free. Month-end spanning ranges recompute per leave year.
- **Schema extensions**: AttendanceRecord gains idempotencyKey, timesheetApprovedByUserId/At, sourceDevice; LeaveRequest gains delegateApproverUserId.
- **Tests**: punch replay, duplicate suppression, first-punch creation, punch-out refusal, recompute idempotency (two runs identical), and balance-row creation (8 cases in src/tests/lib/hr-attendance-leave.test.ts).

## [2.18.6] EMS recruitment, onboarding, and till access gating

Feature release (Stage D of the EMS implementation protocol, Phase 4.3). Builds on the 2.18.5 foundations. Additive schema only.

### Added
- **Recruitment pipeline (/api/recruitment/)**: job creation and listing, applicant registration with mandatory consent (ConsentRecord with purpose, scope, policy version, lawful basis), stage recording with outcome tracking, offer drafting in integer cents, owner-tier offer approval and send, and hiring conversion. Rejections set a 90-day data retention window (dataRetentionUntil) and hired applicants can no longer be rejected.
- **Applicant to employee conversion**: idempotent per (storeId, applicant email); a repeat call returns the existing employee and a same-email duplicate heals the provenance link instead of creating a second row. Provenance is preserved via Applicant.convertedEmployeeId. Conversion creates the standard onboarding plan and schedules a probation-end notification (persistent Notification row with a deep link).
- **Onboarding (/api/hr/onboarding/)**: plan creation from template, idempotent task completion with completion auditing, and sign-off that refuses while any blocksTillAccess task is open (409 TILL_ACCESS_BLOCKED with the named tasks). isTillAccessGranted() is the single gating function the POS can consult before granting till permissions to a probationary employee.
- **HR workspace pages**: /hr/recruitment (open jobs, consent-gated applicant registration, pipeline with stage-appropriate actions) and /hr/onboarding (plan cards with task checklists, blocks-till badges, sign-off gating state).
- **Tests**: till access gating (denies with no plan, denies with open blocking tasks, grants on completion and sign-off), conversion idempotency and duplicate healing, and the consent requirement (8 cases in src/tests/lib/hr-onboarding.test.ts).

## [2.18.5] EMS foundations: HR workspace, employee records, and versioned statutory rate tables

Feature release opening the Employee Management System (Stage C of the EMS implementation protocol, Phases 4.1 and 4.2 core). Builds on the audit deliverables (docs/EMS_INFRASTRUCTURE_AUDIT.md) and the 2.18.4.0 corrections. Additive schema only; the existing POS, payroll, and attendance behavior is untouched.

### Added
- **EMS foundation layer (src/lib/hr/)**: typed role constants (HR_MANAGER and EMPLOYEE join the platform as data, no enum migration), the hr.* permission matrix with fail-closed checks and the maker-checker role split, the PII masking service (strip for lists, mask for details, permission-gated unmask), the HR audit service wrapping the hash-chained audit trail, and the data-driven HR_MODULE_ENABLED flag (HrSetting row, 30-second cache, default on) with a calm kill switch.
- **HR API surface (/api/hr/)**: employees list and create (branch-resolved from the session; client storeId ignored outside the documented SUPER_ADMIN path), employee detail with masked statutory identifiers and an audit-logged unmask parameter, employee update and archive (soft delete), document registration and verification with expiry tracking, org-scoped rate table reads, and the module settings endpoint. Every route composes the shared hrGuard: feature flag, hr.* permission, store scope, and deny logging through the existing SecurityEvent path.
- **HR workspace UI (/hr)**: overview with branch-scoped headcount, casual worker count, in-force rate tables, and module status; an employees list with sticky-header dense table, search, and inline create; an employee detail view with statutory identifier masking, permission-gated unmask (banner explains the audit trail), pay summary, and a documents list with verification badges.
- **Versioned statutory rate tables**: hr_rate_tables and hr_rate_table_rows store PAYE bands, personal relief, NSSF Tier I and II, SHIF, and the Affordable Housing Levy as insert-only data with instrument references and verifyWithCounsel=true. Seeded idempotently by scripts/seed-rate-tables.mjs (wired into vercel-build). Rates are reviewable defaults, not legal advice.
- **Additive schema (21 models)**: EmployeeDocument, Position, PayGrade, SalaryStructure, SalaryComponent, EmployeeSalaryComponent, RateTable, RateTableRow, RecruitmentJob, Applicant, ApplicationStage, Offer, OnboardingPlan, OnboardingTask, ReviewCycle, PerformanceReview, Goal, DisciplinaryCase, AssetAssignment, ConsentRecord, HrSetting; Employee gains reportingToId and deletedAt.
- **Verification**: scripts/verify-ems-infrastructure-audit.mjs (audit reproducibility), scripts/verify-hr-isolation.mjs (route guard composition and safe 404s), plus unit tests for the permission matrix (fail-closed, maker-checker split) in src/tests/lib/hr-permissions.test.ts.

## [2.18.4.0] EMS infrastructure corrections: payroll accounting readiness and employee PII masking

Correction release required by the EMS implementation gate (docs/EMS_IMPLEMENTATION_GATE.md). Fixes the two P0 blockers that prevented the Employee Management System from building on a safe foundation. All changes are additive; no existing flow, route, or record is altered destructively.

### Fixed
- **Employee PII export masking (P0-1)**: the employee CSV export (Data Exports dashboard) now masks national ID, KRA PIN, NSSF number, NHIF number, and bank account name by default for every role. Unmasked output requires the acting user to be SUPER_ADMIN or STORE_OWNER (PII unmask permission), and every employee export writes a hash-chained audit event (action EXPORT, metadata piiIncluded, reason string; field names only, never values). Names, contacts, job data, and salary figures remain readable as before.
- **Gift card liability account mapping**: the account helper mapped GIFT_CARD_LIABILITY to code 2300, which the seeded chart of accounts defines as a supplier payable, so gift card journal movements could post against a supplier account. Gift card liability now resolves to 2400 (Gift Cards Outstanding), matching the seed and the auto-create default.
- **Rental deposits account classification**: the helper's auto-create default for 1400 disagreed with the seeded chart (LIABILITY versus ASSET). The default now matches the seeded reality; posting directions were always explicit at call sites and are unchanged.
- **Idempotent account seeding**: the seed created accounts with bare create calls, crashing on partially initialized databases. Both account loops now upsert by (organizationId, code) and never overwrite an operator-modified row.

### Security
- **JournalEntry.idempotencyKey (nullable, unique)**: createJournalEntry performs a replay lookup when a key is provided and returns the existing entry instead of creating a duplicate, so a retried payroll post can never double journal. This is the posting-safety prerequisite for EMS payroll.
- **Payroll chart of accounts**: seed adds ten reserved accounts: 2210 PAYE Payable, 2215 NSSF Payable, 2220 SHIF Payable, 2225 Housing Levy Payable, 2230 HELB Payable, 2240 Net Pay Payable, 2250 Other Deductions Payable, 2260 Payroll Clearing, 5210 Employer NSSF Expense, 5215 Employer Housing Levy Expense.
- **Payroll account healing script**: scripts/seed-payroll-accounts.mjs idempotently upserts the payroll accounts for every organization on existing databases (wired into vercel-build after sync-db-schema; safe to run manually on desktop installs). It never modifies existing rows and reports present/expected counts.

### Documentation
- Added the twelve EMS audit deliverables on docs/ems-infrastructure-audit (audit, evidence, gate, risk register, data model delta, integration map, RBAC matrix, migration plan, test plan, environment notes, security and privacy notes, README hygiene findings).
- Added scripts/verify-hr-privacy.mjs and scripts/verify-hr-schema.mjs plus a masking unit test (src/__tests__/lib/hr-privacy.test.ts).

## [2.18.4] Organization console expert diagnostics and branch slug repair

Feature release completing the expert information minimum from the release integrity audit (Finding 3) and bundling the planned maintenance residuals of the audit sequence (Findings 15, 16, 19, 20, 23, 25 hygiene documentation and test visibility). This release supersedes no one: it stacks directly on v2.18.3.2, keeps every existing route and contract intact, and the maintenance residuals land as documentation and test-report hygiene rather than behavior changes.

### Added
- **Expert console snapshot (`/api/org/expert-console`)**: one SUPER_ADMIN/STORE_OWNER endpoint that answers the operator's three questions per branch (can the workspace open, why not, what next) plus the release identity, the workspace routing configuration as the server sees it, the acting user record, an org KPI roll-up with a documented health breakdown, and the per-branch diagnostics. Rate limited per user and client IP (30 per minute); org-wide reads follow the runWithoutTenant pattern of the existing org routes.
- **Branch diagnostics (`/api/org/branch-diagnostics`, `/[storeCode]`, `/refresh`)**: the per-branch diagnostics list, a single-branch lookup resolved by slug, code or store id (404-safe), and a force-refresh variant that bypasses the 60 second schema-probe cache and writes an ORG_DIAGNOSTICS_REFRESH audit entry. Every operational figure comes from batched groupBy queries (about ten queries total for all stores) and degrades to zeros or unknown instead of failing the response.
- **Diagnostics data layer (`src/lib/org/diagnostics.ts`)**: the documented reason-code vocabulary (ORG_DIAGNOSTIC_REASON_CODES), the pure slug derivation shared with the repair routes (canonical mappings: juja-main, thika, ruiru, nairobi-cbd, nakuru), the reason classifier with calm remediation text, and a 60-second cached schema drift probe running the two cheapest checks from /api/health/schema. Probe failures report drift or unknown; they never throw.
- **Branch slug repair (`/api/org/slug-repair/preview` + `/apply`)**: a non-mutating preview that lists planned fixes and conflicts, and a guarded apply that is SUPER_ADMIN-only, confirm-gated, refuses PostgreSQL with migration guidance, runs scripts/backup-db.mjs first and aborts when the backup fails, never overwrites or renames another store, derives the subdomain only when it is empty, audits ORG_SLUG_REPAIR_APPLIED (WARN), and is idempotent (a second run reports "Nothing to repair.").
- **Expert panel in the Branches table (`src/components/workspace/org-console.tsx`)**: a per-row Expert affordance opening a dialog with slug, subdomain, status, reason code, remediation, schema status and missing columns, and the last checked time. Copy diagnostics (with an aria-live confirmation), Refresh, and Open path workspace actions. Loading and error states are calm text with retry; Escape closes; status is always carried by text.

### Fixed
- **Maintenance residuals bundled as planned**: the hygiene items from the audit sequence land in this release as documentation rather than code changes: the database migration policy (db:push with preflight, backup and additive repair locally; prisma migrate deploy only, operator-run, in production) and the migration of slug writes for broken stores from ad-hoc scripts to an audited, confirm-gated API where a local backup is mandatory.

### Docs
- docs/org-console-expert-information.md: API shapes, the reason-code table with remediation text, the safety rules, and UI notes.
- docs/org-console-roadmap.md: the deferred expert modules sequenced from v2.18.5 (Inventory and Debt) through v2.18.9 (operator experience groundwork), building on the existing /console modules.
- docs/database-migration-policy.md: local SQLite convergence policy and the production PostgreSQL migration boundary (the updater never runs migrate deploy against production automatically).
- docs/TEST_AUDIT_REPORT.md and docs/TEST_AUDIT_REPORT.json: the full test inventory (27 files), role and module matrices, risk register (including the documented 471 strict-typecheck baseline and the 16 pre-existing vitest failures, unchanged by this release), acceptance checklist, and the recommendation to run the full vitest suite in CI.

### Tests
- 15 new unit cases cover the slug derivation (canonical mappings, prefix tolerance, punctuation variants, unusable names) and the diagnostics classification (ready, missing-slug, store-inactive, workspace-disabled, schema drift and probe caching, batched aggregates, degradation) with the database mocked (`src/tests/lib/org-diagnostics.test.ts`).
- New release verification script (`scripts/verify-org-console-expert-info.mjs`, npm run verify:org-console-expert) statically checks the role gate, the reason-code contract, the slug repair guards, and the documentation set.

## [2.18.3.2] Tenant isolation and payment-safety corrections

Correction release completing the security and tenant isolation residuals from the release integrity audit (Findings 17, 18, 21, 22): STK Push retries can no longer double prompt the customer, deleting the engraved admin is durably audited, the schema health endpoint is role-gated in production, and the heavy operational endpoints are rate limited.

### Fixed
- **STK Push idempotency (`src/lib/mpesa-idempotency.ts` + stkpush route)**: the M-Pesa callback already settles exactly once (terminal-state gate, atomic claim, one-receipt-per-store constraint); the remaining double-prompt window is now closed. Callers may send an optional `idempotencyKey`; when a matching push (same store, normalised phone and amount, status PENDING or PROCESSING) exists within a 10 minute window, the existing push is returned with `duplicate: true` and no second Daraja request is fired. Omitting the key keeps the previous behavior unchanged; the dedupe lookup is best-effort and can never block payment initiation. No schema change.
- **Engraved admin deletion audit (`src/app/api/users/[id]/route.ts`)**: a blocked DELETE of the engraved administrator now writes a durable `USER_DELETE_BLOCKED` security log (WARN) with the acting account and target metadata before the existing 403 `ENGRAVED_ADMIN_PROTECTED` response.
- **Schema health role gate (`src/app/api/health/schema/route.ts`)**: in production the drift picture is restricted to SUPER_ADMIN and STORE_OWNER; outside production (trusted local desktop mode) any signed-in role keeps working. Rate limited per client IP (10 per minute) because the probes run real database queries.
- **System heal rate limit (`src/app/api/system/heal/route.ts`)**: the full repair and power-on-self-test scan is capped per client IP (5 per hour) ahead of the existing authentication and role checks.

### Tests
- 7 new unit cases cover the dedupe query: match and miss paths, phone normalisation, store scoping, the PENDING/PROCESSING restriction, the default window, and the unusable-phone guard (`src/tests/lib/mpesa-idempotency.test.ts`).

## [2.18.3.1] Updater activation guards and dual-mode start

Correction release completing the updater and build safety residuals from the release integrity audit (Finding 12 detail and the start-command fallback): the build log scanner now catches the remaining fatal failure classes before an update is activated, and the package start command delegates to the dual-mode launcher instead of assuming a standalone build exists.

### Fixed
- **Build log scan coverage (`scripts/verify-build-output.mjs`)**: the fatal-everywhere scan now includes `Cannot find module`, webpack `Module not found`, Prisma drift error `P2022`, and `prisma:error` log lines, in addition to the existing compile, build-error, type-error, and standalone trace-copy checks. The updater refuses to activate a release whose build log contains any of them; the `P2022` pattern is boundary-guarded so unrelated digit sequences never trip it.
- **Dual-mode start (`package.json`)**: `npm start` / `bun start` previously ran `.next/standalone/server.js` unconditionally, which fails on a normal (non-standalone) build, for example on Windows where BUILD_STANDALONE is ignored by policy. The start command now runs `deploy/nodocker/start-server.mjs`, the existing launcher that applies the repo .env (env-wins precedence), starts the standalone server when one was built, otherwise falls back to `next start` against the plain build output, and fails fast with clear guidance when no build output exists.

### Tests
- 6 new unit cases cover the added fatal patterns, the every-mode contract, and the boundary guard against false positives (`src/tests/lib/build-output-policy.test.ts`).

## [2.18.3.0] Branch workspace reason codes in the organization console

## [2.18.3.0] Branch workspace reason codes in the organization console

Correction release completing the branch workspace foundation residuals found by the release integrity audit (Findings 1 and 7, re-verified with evidence against the unified lineage): the org console Workspace column now states the precise reason a workspace cannot open instead of a generic unavailable message, and the branch workspace route gained a server-side layout guard.

### Fixed
- **Precise Workspace badges (`src/components/workspace/org-console.tsx`)**: the Workspace column now renders "Missing branch slug", "Branch inactive", or "Workspace disabled" with a remediation hint in the tooltip, replacing the single generic "Branch workspace unavailable" text. A "Path fallback ready" chip appears when a public host had to fall back from a branch subdomain to the path workspace. Text always carries the meaning; color never does.
- **Reason-code resolver (`src/lib/branch-workspace.ts`)**: new pure `resolveBranchWorkspace` exposes `href`, `usedMode` (subdomain or path) and `unavailableReason` (`missing-slug`, `store-inactive`, `workspace-disabled`) from the exact same rules the href builder has used since v2.18.0.0; `getBranchWorkspaceHref` remains a thin wrapper with an unchanged contract, plus `isLocalWorkspaceHost` for callers that must tell local path mode from a fallback.
- **Workspace route layout guard (`src/app/stores/[slug]/layout.tsx`)**: placeholder slugs ("undefined"/"null") are rejected server-side with a calm message before any database query, valid requests get a server-resolved screen-reader status region with the store name and location, and raw database errors never surface. The layout is not an authorization boundary: the gateway and every API route keep re-validating access.
- **VERSION file alignment**: the root VERSION file had drifted to 2.18.1 while package.json and the running app reported 2.18.3; the file is restored as the single full-version surface (2.18.3.0) with package.json keeping the three-part base 2.18.3 per the release versioning policy.

### Tests
- 15 new unit cases cover the precise reason codes, the used-mode classification, placeholder-slug handling and host classification (`src/tests/lib/branch-workspace.test.ts`, 43 cases green).

## [2.18.3] Organization Console — Expert Information System on the unified lineage

Feature release completing the reconciliation promised by the v2.18.2 sandbox branch (`release/v2.18.2.1-org-console`): the org-console **product work** now runs natively on the 88-model PostgreSQL-canonical lineage with multi-tenant auth, instead of the parallel 43-model SQLite implementation. The sandbox branch remains archived as a prerelease; this release supersedes it.

### Added
- **Expert console at `/console`** (`src/app/console/` + `src/components/org/{chrome,kpi-row,store-matrix,experts,panels,primitives}.tsx`): dark glassmorphism chrome with official brand logo, health gauge, KPI command row, **Store Intelligence Matrix** (rendered from the real `Store` rows via `/api/stores`), Decision Support, Recent Activity, Global Chat, Live Feed, and the 9 domain expert modules (Inventory, Debt/Mkopo, Rentals, Financials, Suppliers, M-Pesa, eTIMS, Audit, System). Every figure comes from live main-lineage APIs; sections whose endpoint denies the caller degrade to an explicit "unavailable" state — never a fake number.
- **`/api/org/kpi-summary`**: org-level KPI aggregate (revenue, transactions, low stock, overdue, debt, pending, health breakdown) computed with `runWithoutTenant` and role-gated (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER / ACCOUNTANT / INVENTORY_MANAGER).
- **`SectionErrorBoundary`** wraps every console section: a crash in one panel degrades to a styled retry card instead of blanking the console.
- **Sidebar entry point**: org-wide roles get an "Expert console" link in the app sidebar workspace links (`buildExpertConsoleUrl`).
- **Official brand assets**: vector logo master (`public/logo.svg`), PNG/WebP renditions, favicon/icon marks and `docs/BRAND.md` guide.

### Reconciliation notes (per docs/PUSH_RELEASE_INSTRUCTIONS.md §5, closed by this release)
- Console product work re-targeted from `Branch`→`Store`, `Transaction`→`SalesTransaction` data surfaces; no new data models were required — the unified schema already covers every expert domain.
- Console data flows through the lineage's real auth (`requireAuth`/`requireRole` + store-scope guards) — no standalone scrypt sessions.
- Multi-branch workspaces and subdomain routing remain the lineage's existing, authoritative implementation.

### Quality
- `eslint`: 0 errors (401 pre-existing warnings unchanged). `tsc --strict`: 0 errors in all ported files (471-error baseline on pre-existing lineage files unchanged). `vitest`: 551 passed / 16 failed / 20 skipped — identical to the pre-port baseline (no regressions introduced).

## [2.18.1] Branch manager user-store binding

Feature release binding every branch to its own manager account. Each branch manager signs in with a unique email and lands directly in their own branch workspace; the branch is determined by the database relation (User.storeId plus an ACTIVE StoreMembership row), never by client input, email parsing, cookies, headers, or URLs.

### Added
- **One branch manager per store in the seed (including Juja Main)**: the seed now upserts five branch managers (Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru) by email, so repeated seeding never duplicates users and never overwrites existing names, phones or passwords. Each manager also receives an ACTIVE StoreMembership row for the workspace layer. The Juja Main manager (juja.manager@mbumahhardware.co.ke) closes the one-store gap in the previous seed.
- **Ensure-pass on already-initialized databases**: the seed's first-boot guard previously skipped databases that already had users, so older installations never received the Juja Main manager. A new idempotent ensure-pass runs on every seed invocation and creates any missing manager and membership without touching other data; failures are logged and never break boot.
- **Post-login redirect for branch-bound roles**: BRANCH_MANAGER and CASHIER sign-ins now land in their own branch workspace (subdomain URL when the current host is subdomain-capable, otherwise /stores/{slug}/dashboard). The target comes from the database relation through the login response's store summary (slug, subdomain and status added to it). Accounts with no branch assignment are sent to the new /account/pending-branch page instead of the organization console; accounts whose store has no slug configured stay on the pinned root app. The /api/auth/me response gained flat storeSlug / storeName / workspaceModeHint aliases.
- **User-creation hardening**: BRANCH_MANAGER and CASHIER require a storeId at creation time, enforced in the Zod schema and again in the route handler; the assigned store must exist, be ACTIVE, and belong to the caller's organization. Every user creation now also writes a tamper-evident, hash-chained AuditLog entry next to the existing SystemLog rows.
- **Branch manager schema repair (scripts/repair-branch-manager-schema.mjs, npm run db:repair-branch-managers)**: raw-SQL additive repair for users.storeId / users.isActive, deterministic storeId backfill for branch-bound users from the {town} email convention, duplicate email detection before the unique index, backup-first with automatic restore, idempotent no-op on healthy databases, and a hard refusal for PostgreSQL with migration guidance.
- **Branch manager verification (scripts/verify-branch-manager-users.mjs, npm run verify:branch-manager-users)**: read-only proof that every store has exactly one bound manager, emails are unique, bindings resolve, memberships are ACTIVE, and no account stores a plaintext or missing password value.
- **Documentation**: docs/branch-manager-users.md (binding rules, seeded credentials, canonical demo email domain decision, repair and verification), a README credentials pointer, and a What's New entry.

### Fixed
- **Seed stage 24 no longer fails silently on SQLite**: the global-chat createMany used skipDuplicates, which the SQLite connector does not support; every local database skipped the global chat messages. The messages are now inserted idempotently behind the existing count guard.

### Security
- Branch-bound roles cannot exist unassigned: the API rejects the shape at two layers, and an unassigned account is redirected away from the organization console at sign-in.
- Cross-branch access remains blocked server-side (403 or safe 404) with SecurityEvent audit rows; this release adds no new access surface and changes no tenancy behavior.
- Demo passwords remain bcrypt hashes (cost 12); no plaintext credential storage anywhere.

## [2.18.1] Branch manager user-store binding

Feature release binding every branch to its own manager account. Each branch manager signs in with a unique email and lands directly in their own branch workspace; the branch is determined by the database relation (User.storeId plus an ACTIVE StoreMembership row), never by client input, email parsing, cookies, headers, or URLs.

### Added
- **One branch manager per store in the seed (including Juja Main)**: the seed now upserts five branch managers (Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru) by email, so repeated seeding never duplicates users and never overwrites existing names, phones or passwords. Each manager also receives an ACTIVE StoreMembership row for the workspace layer. The Juja Main manager (juja.manager@mbumahhardware.co.ke) closes the one-store gap in the previous seed.
- **Ensure-pass on already-initialized databases**: the seed's first-boot guard previously skipped databases that already had users, so older installations never received the Juja Main manager. A new idempotent ensure-pass runs on every seed invocation and creates any missing manager and membership without touching other data; failures are logged and never break boot.
- **Post-login redirect for branch-bound roles**: BRANCH_MANAGER and CASHIER sign-ins now land in their own branch workspace (subdomain URL when the current host is subdomain-capable, otherwise /stores/{slug}/dashboard). The target comes from the database relation through the login response's store summary (slug, subdomain and status added to it). Accounts with no branch assignment are sent to the new /account/pending-branch page instead of the organization console; accounts whose store has no slug configured stay on the pinned root app. The /api/auth/me response gained flat storeSlug / storeName / workspaceModeHint aliases.
- **User-creation hardening**: BRANCH_MANAGER and CASHIER require a storeId at creation time, enforced in the Zod schema and again in the route handler; the assigned store must exist, be ACTIVE, and belong to the caller's organization. Every user creation now also writes a tamper-evident, hash-chained AuditLog entry next to the existing SystemLog rows.
- **Branch manager schema repair (scripts/repair-branch-manager-schema.mjs, npm run db:repair-branch-managers)**: raw-SQL additive repair for users.storeId / users.isActive, deterministic storeId backfill for branch-bound users from the {town} email convention, duplicate email detection before the unique index, backup-first with automatic restore, idempotent no-op on healthy databases, and a hard refusal for PostgreSQL with migration guidance.
- **Branch manager verification (scripts/verify-branch-manager-users.mjs, npm run verify:branch-manager-users)**: read-only proof that every store has exactly one bound manager, emails are unique, bindings resolve, memberships are ACTIVE, and no account stores a plaintext or missing password value.
- **Documentation**: docs/branch-manager-users.md (binding rules, seeded credentials, canonical demo email domain decision, repair and verification), a README credentials pointer, and a What's New entry.

### Fixed
- **Seed stage 24 no longer fails silently on SQLite**: the global-chat createMany used skipDuplicates, which the SQLite connector does not support; every local database skipped the global chat messages. The messages are now inserted idempotently behind the existing count guard.

### Security
- Branch-bound roles cannot exist unassigned: the API rejects the shape at two layers, and an unassigned account is redirected away from the organization console at sign-in.
- Cross-branch access remains blocked server-side (403 or safe 404) with SecurityEvent audit rows; this release adds no new access surface and changes no tenancy behavior.
- Demo passwords remain bcrypt hashes (cost 12); no plaintext credential storage anywhere.

## [2.18.0.3] Branch workspace store-context and repair correction

Correction release completing the branch workspace unavailable diagnosis: the store context resolver now derives the branch slug from the `/stores/{slug}/...` pathname itself, the proxy publishes resolved workspace context headers, and a safe raw-SQL repair script restores the store workspace columns on drifted local SQLite databases. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.3` lives in the `mbumah.releaseVersion` metadata block, the root `VERSION` file and every app-reported version surface.

### Added
- **Pathname slug derivation (`extractSlugFromPathname`)**: `resolveStoreContext` resolves path-mode workspaces from a bare `/stores/{slug}/...` pathname when the caller passes no explicit slug, so a request to `/stores/thika/dashboard` needs no separate slug plumbing. An explicit non-empty slug still wins; the missing-slug short-circuit only fires when neither source can resolve (unit tested).
- **Resolved workspace context headers**: the proxy sets `x-resolved-store-slug`, `x-resolved-store-subdomain` and `x-resolved-workspace-mode` (`subdomain` on rewritten subdomain requests, `path` on `/stores/{slug}/...` pages). Advisory only; API routes and server components keep re-resolving server-side and the store ID is never transported in a header.
- **Safe store workspace schema repair (`scripts/repair-branch-workspace-store-schema.mjs`)**: adds missing `slug` / `subdomain` / `status` columns to the stores table of a local SQLite database, backfills deterministic slugs from the branch names (case-insensitive, tolerant of the "MBUMAH HARDWARE - " display prefix), derives subdomains from slugs, and creates the unique indexes only after duplicate checks pass. The script uses raw SQL only (no Prisma model queries), backs the database up first, rehearses on a scratch copy, is idempotent, restores the backup on any failure, and refuses PostgreSQL with migration guidance instead.
- **Database preflight in `scripts/verify-branch-workspace.mjs`**: a read-only check of the local SQLite stores table (missing columns, stores without slug, duplicate slugs/subdomains, non-ACTIVE stores) with a pointer to the repair script; skips cleanly for PostgreSQL URLs, missing databases and runtimes without node:sqlite.
- **Documentation**: store-context-resolution.md gains the pathname derivation, resolved-context headers and the local database repair walkthrough; branch-workspaces.md links the repair path.

### Fixed
- **Path-mode store resolution no longer depends on callers pre-parsing the URL slug**: empty explicit slugs with a resolvable `/stores/{slug}/...` pathname resolve the branch instead of answering missing-slug (the short-circuit remains for genuinely unresolvable requests and still makes no database call).

## [2.18.0.2] Updater release selection, Windows build mode and Prisma config correction

Correction release covering the defects visible in the field report of a Windows laptop updating from 2.17.7 straight to v2.18.0.0: the updater treated a four-part correction tag as the next normal release, the build ran with standalone output it did not need on Windows, and the Prisma CLI warned about the deprecated package.json configuration block. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.2` lives in the `mbumah.releaseVersion` metadata block, the root `VERSION` file and every app-reported version surface.

### Added
- **Validated release selection (`scripts/release/parse-version.mjs`, `validate-tag.mjs`, `select-release.mjs`)**: the updaters no longer take GitHub's `releases/latest` verbatim. Every release tag is parsed and validated against the release rules: three-part tags are normal releases, four-part tags are correction hotfixes that are only valid while their three-part base release exists, hotfix numbers stop at .5, prerelease suffixes are rejected. Invalid tags are ignored and reported (`Ignored invalid release tag: ...` with the reason) instead of being installed. The selector never downgrades and never jumps a 2.17.7 machine to a four-part tag.
- **Update channels (`UPDATE_CHANNEL`)**: stable (default, three-part releases only), hotfix (three-part releases plus valid hotfixes for the installed base), manual (explicit `-ToVersion`, still validated). `UPDATE_DRY_RUN=1` prints the current version, the latest valid stable release, the latest valid hotfix for the installed base, the selected release with its reason, and what would happen, then changes nothing.
- **Update state file**: the script updaters publish their progress to `%USERPROFILE%\mbumah-pos-data\update-state.json` (same schema as the staged updater's `updater/update-state.json`): current/pending version, state (idle through activated, rolled-back, failed), progress, backup path, build log path, channel, rollback availability.
- **Pre-build checks**: free disk space (fail under 2 GB, warn under 5 GB), database file writability, dependency manifest presence, and an install-location advisory when the app lives under Downloads, Compressed or OneDrive folders (recommendation: `C:\MbumahPOS`).
- **Build log capture and scanning**: updaters write every build to `mbumah-pos-data/logs/build-{version}-{timestamp}.log`; `scripts/verify-build-output.mjs` scans that log and fails the update on real build errors in every mode, and on the standalone trace-copy failure class (`EINVAL`, `Failed to copy traced files`) whenever a standalone build was expected.
- **Release safety gates in CI**: `verify:prisma-config`, `verify:release-selection` and `verify:windows-build` run in the Security & Schema job so the release rules and the build-mode wiring cannot regress silently.
- **Documentation**: docs/windows-local-builds.md, docs/standalone-output.md, docs/prisma-config.md, docs/updater-release-channels.md, docs/release-versioning.md, plus a troubleshooting entry.

### Fixed
- **Updater release selection (field report: 2.17.7 updated to v2.18.0.0)**: four-part correction tags are no longer treated as the next feature release. On the stable channel a 2.17.7 machine now moves to the latest valid three-part release (for example v2.18.0), and a machine already on the hotfix's base picks the hotfix. The selector is unit tested end to end (vitest plus `scripts/verify-release-selection.mjs` in CI).
- **Windows laptops build normal output (v2.18.0.2 policy)**: standalone output is now Docker/Linux only (`resolveStandaloneOutput` in `src/lib/build-mode.ts`). Windows never builds standalone even if BUILD_STANDALONE=1 is set (it warns instead), the Windows installer/updater dropped the standalone assembly step, and the launcher (`start-server.mjs`) starts the plain build with `next start` when no standalone output exists. This removes the entire Windows trace-copy/EINVAL failure class and the "Build output missing (.next/standalone/server.js)" failure mode. A stale standalone output from an older release is deleted during the rebuild and its presence after a normal build is a hard verification failure.
- **Process-tree stop on Windows**: the updater stops the POS with `taskkill /T /F` so the `next start` child process cannot survive as an orphan holding port 3000, and already-exited processes no longer produce errors.
- **Prisma configuration warning removed**: the deprecated `package.json#prisma` block (removal planned in Prisma 7) is gone; the seed command lives in `prisma.config.ts` (Prisma 6.16+), which loads the repo `.env` with the same ".env wins" precedence as the runtime launchers and defaults DIRECT_URL to DATABASE_URL. `prisma validate`, `prisma generate`, `prisma db push` and `prisma db seed` all verified; the Docker runner image copies `prisma.config.ts` so container seeding keeps working.
- **Prisma version drift guard**: `prisma` and `@prisma/client` are pinned to the current stable line (^6.19.2); the new `verify:prisma-config` check fails CI on any prerelease tag (such as 8.0.0-rc.22) or major drift. Update notices like "Update available 6.19.2 -> 8.0.0-rc.22" are informational only and never trigger upgrades.

### Security
- The updater now fails safe: it verifies the build output (build log scan plus output shape, including the stale-standalone check) BEFORE declaring success, publishes its state, and rolls the code back to the previous version automatically with the calm message "Update could not be completed. The previous version is still available."
- Invalid release tags can no longer be activated through the updater; the manual channel still validates tag format and base existence.
- No authorization, tenancy or data-handling changes; the database is only touched by the existing guarded schema converge, and the field log's in-sync database needed no repair.

## [2.18.0.1] Windows standalone build correction (EINVAL chunks, sharp, updater)

Field-report correction release for Windows laptop installs (ZIP, no git), covering the three defects visible in the v2.17.6/v2.17.7 update logs: "Failed to copy traced files ... EINVAL" build warnings, "Could not load the sharp module using the win32-x64 runtime" image errors, and an "UPDATE COMPLETE" banner followed by a start failure ("Build output missing (.next/standalone/server.js)").

### Added
- **Standalone build verifier (`scripts/verify-standalone.mjs`)**: after every installer/updater build, proves that `.next/standalone/server.js` exists, the client static assets were assembled, and EVERY server chunk referenced by any route or runtime file is actually present in the standalone output. An incomplete build is now a hard failure that triggers the updater's automatic rollback (and stops the installer with a clear message) instead of a restart into a broken server.

### Fixed
- **Windows EINVAL chunk loss (field log: `/api/batch`, `/api/cron/nightly`)**: Turbopack emits asynchronously imported node builtins as chunk files named after the specifier, e.g. `[externals]_node:inspector_7a4283c6._.js`. NTFS forbids colons in file names, so Windows standalone builds dropped those chunks with EINVAL copyfile warnings and the affected routes (batch operations, the nightly maintenance cron and everything sharing their chunks) broke at runtime while Linux and Vercel builds worked. Every `node:*` builtin is now aliased to its identical bare specifier (`turbopack.resolveAlias` in `next.config.ts`), so Turbopack's chunk file names never contain a colon on any platform - the runtime modules are byte-for-byte the same Node builtins.
- **`node:fs/promises` dynamic import in `src/lib/data-retention.ts`** converted to a static import: static built-in imports are inlined by the bundler and produce no chunk file at all (this was the nightly-cron half of the EINVAL pair).
- **sharp win32-x64 missing** (the "Could not load the sharp module" 500s on every optimized image): installers and updaters now install with `npm install --include=optional` so a machine-level npm config can never skip sharp's platform binary, repair a missing win32-x64 binary automatically (`npm install --no-save --os=win32 --cpu=x64 sharp`), and - as the final safety net - `next.config.ts` probes sharp at BUILD time and bakes `images.unoptimized` into standalone laptop builds whose machine has no usable binary, so product photos always serve (without resizing) instead of erroring.
- **Update loop on correction releases**: the updater compared `package.json` "version" (three-part, "2.18.0") against the release tag (four-part, "v2.18.0.0"), which can never match - a machine that installed v2.18.0.0 would download and rebuild it again on EVERY start. The Windows and macOS/Linux updaters now prefer the `mbumah.releaseVersion` metadata when comparing, so correction releases settle to "Already up to date" like every other release; the Start POS "was updated to" message reads the same field.
- **Scary-but-harmless stop error**: `Start POS` no longer prints the red "[ERROR] Cannot find a process with the process identifier ..." line when the server process exited early; it points at the reason printed above it and the two most common fixes instead.

### Security
- No authorization, tenancy or data-handling changes; the verifier only reads build output and the sharp repair only runs npm install scoped to the sharp package.

## [2.18.0.0] Branch workspace path fallback correction

Correction release for the "This branch workspace does not exist or is no longer available" error when opening a branch workspace from the organization console. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.0` lives in the `mbumah.releaseVersion` metadata block, a new root `VERSION` file, and every app-reported version surface (footer, login screen, `/api/health`, openapi.json).

### Added
- **Safe branch workspace link builder (`src/lib/branch-workspace.ts`)**: one pure, client-safe and server-safe `getBranchWorkspaceHref` function that turns a store record plus the current origin into the correct new-tab URL: an absolute subdomain URL only when every safety check passes, otherwise `/stores/{slug}/dashboard`; `null` when no safe URL exists (missing slug, inactive store, mode off). It never produces `/stores/undefined`, `/stores/null` or unresolvable `//undefined..` URLs, and it re-uses the reserved-subdomain rules from `src/lib/workspace/config.ts`.
- **Server-side store context resolver reason codes**: `resolveStoreContext` and the `/api/me/store-context` payload now carry a stable, client-safe `reasonCode` alongside the unchanged internal `reason` (store-not-found, store-inactive, user-not-allowed, unauthenticated, missing-slug, schema-drift). The workspace gateway renders one calm message per cause, replacing the single generic "does not exist or is no longer available" copy.
- **New resolver detections**: a present-but-empty slug short-circuits to `missing-slug` without a database call, and a Prisma known request error during the store lookup (for example P2022, a missing column) is answered as `schema-drift` without leaking any error text. Denial audit rows now also carry the request host, pathname and request id for correlation.
- **Workspace environment safe defaults (`.env.example`)**: the branch workspace keys ship with safe local defaults (path mode, no shared cookie domain, minimal host allowlist, forwarded-host trust off) plus a comment block pointing at `.env.local-offline.example`, `.env.lan.example` and `.env.online.example` and the automatic path-fallback rule for localhost, 127.0.0.1 and raw IPs.
- **Hosts helper extension (`scripts/domains/print-hosts.mjs`)**: an optional second block from the `LOCAL_LAN_IP` environment variable and an explicit note that raw localhost needs no hosts entries in path mode; the script still only prints entries and never touches the hosts file.
- **Verification script and tests (`scripts/verify-branch-workspace.mjs`, `bun run verify:branch-workspace`; `src/tests/lib/branch-workspace.test.ts`)**: a read-only environment and hygiene check for branch workspace configuration, and 27 new vitest cases covering the link builder safety matrix (localhost, 127.0.0.1, raw IPv4/IPv6, path mode, reserved subdomains, missing slug, inactive stores, broken slug data) and the resolver reasonCode matrix (path/subdomain resolution, slug fallback, inactive denial, cross-store denial, SUPER_ADMIN/STORE_OWNER/warehouse-manager rules, schema drift, non-Prisma error re-throw).
- **Documentation**: `docs/branch-workspaces.md` (modes, fallback rules, button behavior, local/online setup), `docs/store-context-resolution.md` (resolver modes, reasonCode vocabulary, security properties), a "This branch workspace does not exist" entry in the troubleshooting guide with all six messages and their fixes, and cross-links from the README and the workspace docs.

### Fixed
- No broken `/stores/undefined` or `/stores/null` links: the organization console's "Open branch workspace" button now uses the safe builder and shows a calm inline message ("Branch workspace unavailable. Store slug is not configured.") instead of opening a dead tab when the store slug is missing.
- Localhost, 127.0.0.1, `*.localhost`, ::1 and raw LAN IPs no longer attempt invalid subdomain workspaces: branch links always fall back to `/stores/{slug}/dashboard` on those hosts, even when the environment asks for subdomains.
- A missing or whitespace store slug is handled safely end to end (calm console message, `missing-slug` gateway state, no database call).
- Inactive store access is blocked with a clear message ("This branch is currently inactive. Contact the store owner or system administrator.") at the button and in the gateway.
- Cross-store branch access stays denied server-side; the gateway wording and the audit trail make the cause explicit instead of a generic not-found.
- Schema drift on local databases now shows a calm, actionable "schema update needed" message instead of a misleading branch-not-found error.

### Security
- **Branch workspace resolution is validated on the server**: the store is re-derived from the request host or path slug for every call, never from client input, and authorization (role rules plus ACTIVE memberships) is enforced inside the resolver before any workspace payload is returned.
- **Denied access attempts are logged safely**: `UNAUTHORIZED_ACCESS` SecurityEvent rows for workspace denials now include the request host, pathname and request id, while never exposing error text, stack traces or secrets; audit failures still never change the access decision.

## [2.18.0] Full QA verification release

### Added
- **Full QA report (`docs/v2.18.0-qa-report.md`)**: the complete audit of the v2.17.x feature line - quality gates, hygiene sweeps, security and tenant isolation, workspace resolution, the staged updater contract, hosting modes, data integrity and observability - with per-area pass/fail/blocked results, evidence references, known gaps and the release verdict.
- **QA evidence for the v2.17.x feature line**: static gates re-measured at the 2.17.9 baseline (lint 0 errors and 396 warnings, typecheck 472 advisory, vitest 507/507, prisma validate valid), a 21-check runtime matrix on the seeded SQLite development server (auth, RBAC, cross-store 404-indistinguishable probing, store-context allow/deny, updater 401/400/202/409, subdomain and forwarded-host behavior, gateway page, chat) and a browser pass verifying the organization console login and the five branch workspace links.

### Fixed
- Nothing. This is a verification release: no runtime behavior changes are intended; the changes are the QA report, the version bump and release notes.

## [2.17.9] Staged updates and login progress UI

### Added
- **Staged update orchestrator (`scripts/staged-update.mjs`)**: the self-hosted staged update pipeline as one detached run - download, schema preflight on a throwaway copy of the database, verified database backup, install (install-directory swap when `MBUMAH_INSTALL_DIR` is set), activation and a bounded health smoke test - with automatic rollback of the previous release and database once the backup step has completed. Refuses to run on Vercel serverless (exit code 2); never runs destructive SQL; writes no secrets to the state file.
- **Updater state store (`src/lib/updater/state.ts`)**: the shared server-side state file (`updater/update-state.json`) with phase/percent/message progression, atomic tmp+rename writes, path-sanitized error text, and idle defaults (never a 500) on missing or corrupt files.
- **Update endpoints**: `GET /api/update/status` (public minimal progress; SUPER_ADMIN and STORE_OWNER additionally receive startedAt, sanitized error and pid) and `POST /api/update/prepare` (admin-only; 409 while an update is active, 501 on Vercel).
- **Login page update progress bar (`src/components/updater/update-progress-bar.tsx`)**: an iPhone-style amber progress banner that polls the public status endpoint every 2.5 s during maintenance windows and renders nothing at any other time, so the login form is untouched.
- **Documentation (`docs/staged-updates.md`)**: the phase table, the endpoint contract, orchestrator CLI usage, `UPDATE_ON_START` semantics and rollback behavior.

### Fixed
- `UPDATE_ON_START=0` now disables only the remote version check at startup; the local schema preflight (the start-time schema self-heal) always runs.

### Security
- **Update preparation is restricted to SUPER_ADMIN and STORE_OWNER**: `POST /api/update/prepare` validates the DB-backed session in-file (401 unauthenticated, 403 otherwise) before accepting a run and refuses serverless environments outright.
- **Public status exposes progress only**: `GET /api/update/status` answers phase, percent, message, target version and timestamp to everyone; error detail, process id and start time require an owner/administrator session, and even the stored error text is stripped of filesystem paths before it is written to disk.

## [2.17.8] Security, RBAC and tenant isolation hardening

### Fixed
- **`requireAuth` now enforces store-scope validation**: the wrapper skipped `assertStoreScope`, so (a) a non-admin session WITHOUT a store assignment ran handlers in `runWithoutTenant` (no ORM tenant filtering at all) and (b) cross-store `?storeId=` probes were silently answered instead of rejected. Both paths now return 403 and file the same SecurityEvent as `withSessionAuth` / `requireStoreAccess`. SUPER_ADMIN and validated multi-store members are unaffected.
- **Unauthenticated data routes closed**: `GET /api/suppliers/[id]/performance` (order trends, payment history, balances) and `GET /api/etims/dashboard` were exported with no session validation at all (the edge proxy checks Bearer PRESENCE, never validity); they now run behind `requireStoreAccess`. `POST /api/etims/test-connection` and `POST /api/etims/register-product` (an outbound KRA eTIMS action) require a manager-or-above session.
- **`X-Powered-By` removed from page responses**: the API headers block blanked it on `/api/*` only; `poweredByHeader: false` (next.config.ts) stops advertising the framework on every response.

### Security
- **Body storeId validation (`assertBodyStoreScope`)**: several mutating routes accepted `storeId` in the JSON body, and Prisma `create` is deliberately NOT tenant-intercepted (injectTenant only narrows read/update/delete), so a cross-store body value was a REAL cross-tenant write. The new shared guard applies the query-param policy (SUPER_ADMIN/STORE_OWNER pass, active StoreMembership passes, same store passes; otherwise 403 + SecurityEvent) and is wired into stock-movements POST, M-Pesa STK push, KRA submit, eTIMS invoice cancel, debt reminder process/schedule, and gift-card redemption. `reports/export` and receipt distribution already resolve the store server-side (the session wins) and are covered by the requireAuth fix.
- **[id] 404 policy + denied-attempt audit (`auditRecordMiss`)**: store-scoped `[id]` routes answer 404 for a missing record AND for another store's record (ORM tenancy narrows the unique lookup) - the caller cannot distinguish the two (no enumeration oracle), but a foreign-store id now writes a SecurityEvent (UNAUTHORIZED_ACCESS, blocked) plus a `CROSS_TENANT_RESOURCE_DENIED` ops log so IDOR probing is visible. Wired into `/api/products/[id]` (GET/PUT/DELETE), `/api/customers/[id]` (GET/PUT), `/api/transactions/[id]` (GET) and `/api/suppliers/[id]/performance`. Truly-missing ids stay silent.

### Added
- 12 new security regression tests (src/tests/lib/store-guard.test.ts) covering the body storeId policy matrix (SUPER_ADMIN / STORE_OWNER / active membership / no store assignment / cross-store deny with SecurityEvent) and the 404 classifier (silent for missing and own-store records, SecurityEvent for foreign-store records, probe failures swallowed so auditing never changes the response).

## [2.17.7] Online hosting and public subdomains

### Added
- **Trusted forwarded host support (`TRUST_X_FORWARDED_HOST`)**: the new `resolveRequestHost` helper (src/lib/workspace/config.ts, Edge-safe, no Prisma) resolves the client-visible request host from the first `x-forwarded-host` value when the flag is truthy ('1', 'true', 'yes', 'on', case-insensitive), falling back to the plain `Host` header. Wired into the proxy workspace pipeline (page routing, host allowlist, CORS preflight) and the workspace host readers (`/api/me/store-context`, `/api/stores/[storeSlug]`). Off by default everywhere: with the flag absent, request handling is byte-for-byte the pre-2.17.7 behavior.
- **Online tunnel env template (`.env.online.example`)**: copy to `.env` for a self-hosted public deployment on your own domain (`app.mbumah.co.ke` console plus the branch wildcard) behind Cloudflare Tunnel or Caddy, with secure shared cookies, the host allowlist, the forwarded-host trust flag, and commented production PostgreSQL and M-Pesa callback placeholders. Raw localhost and LAN IPs always fall back to path mode automatically.
- **Online hosting guide (`docs/online-hosting.md`)**: the production counterpart to the dev-focused tunnel guide. Covers the environment, the `x-forwarded-host` trust contract, a named Cloudflare Tunnel setup (ingress rules for the console host and the `*.mbumah.co.ke` wildcard, `cloudflared tunnel route dns`, Host header preservation notes) and a Caddy reverse proxy option (site blocks for the app host and the wildcard, automatic HTTPS via the DNS-01 challenge, admin endpoint off, no debug).

### Fixed
- The ngrok recipe in `docs/tunnel-development.md` is now explicitly marked DEV/TESTING ONLY (free tunnels rotate URLs and cannot serve branch wildcards) and points production readers at the online hosting guide; cross-links to the new guide were added from the self-hosting, subdomain-workspaces, LAN deployment, local offline setup and documentation index pages.

### Security
- `x-forwarded-host` is honored only when `TRUST_X_FORWARDED_HOST` is enabled, and the security contract is documented at the helper and in both hosting guides: enable it only behind a proxy or tunnel that overwrites the header (Cloudflare Tunnel, Caddy), never on a directly exposed server. The resolved host still passes the `ALLOWED_HOSTS` validation, so spoofed or unknown hosts are rejected with 403 regardless.

## [2.17.6] LAN hosting and localhost fallback completion

### Added
- **Protected db-schema health endpoint (`/api/health/schema`)**: an authenticated operator view of the full drift picture that the public `/api/health` only hints at. Probes every known drift-sensitive column (the five nullable `idempotencyKey` columns and `users.isEngraved`), reports per-probe results, the resolved provider, and row counts for the operational tables, and returns the matching remediation ("run the updater" or `npm run db:repair`). The endpoint never throws on a drifted database - reporting is its job.
- **LAN env template (`.env.lan.example`)**: copy to `.env` on the shop server for `mbumah.lan` (or the static LAN IP variant, documented inline) with the one shared SQLite database, plain-HTTP shared cookies and mock M-Pesa. Referenced from the LAN deployment guide.
- **Windows Firewall guidance** in `docs/lan-deployment.md`: the exact `New-NetFirewallRule` invocation for the POS port (private/domain profiles), a cross-device `Test-NetConnection` verification, and the Docker Desktop note.

### Verified (already shipped, unchanged)
- The no-Docker launcher binds `0.0.0.0` (`HOSTNAME` is forced in `deploy/nodocker/start-server.mjs`) and localhost plus raw LAN IPs fall back to path mode automatically (`resolveWorkspaceHostMode` returns `organization` for them); dnsmasq, Pi-hole and router DNS wildcard options are documented in the LAN guide.

## [2.17.5] Branch workspaces and organization console: verification release

### Verified
- The full branch workspaces and organization console matrix shipped in v2.16.0 was re-verified end to end against the current build (browser E2E on the seeded local database): SUPER_ADMIN login lands on `/org/dashboard` (5 branches, KPIs, per-branch revenue table); "Open branch workspace" actions open NEW TABS; `/stores/thika/dashboard` renders the pinned branch shell with its own page title and branch badge; the warehouse manager's branch selector lists exactly the assigned branches (Juja Main, Thika); a Juja cashier opening the Thika workspace receives the calm "You do not have access to this branch" denial; the global chat channel is readable from a branch account (chat visibility stays separate from branch data access). All roles share the one database; every workspace request is re-authorized server-side.

### Changed
- The global chat composer input now declares `type="text"` explicitly (consistency for input styling and accessibility queries; behavior unchanged).

## [2.17.4] Local offline subdomain foundation: env template and hosts writer

### Added
- **Local offline env template (`.env.local-offline.example`)**: copy to `.env` for a single-shop offline install where every branch behaves like its own website. Pre-wires the `mbumah.test` root domain (the default host allowlist then covers the root and every branch subdomain), SQLite paths for the one shared database, plain-HTTP shared-cookie settings (`.mbumah.test`, secure off) and the sandbox M-Pesa callback. Referenced from `docs/local-offline-setup.md`.
- **Hosts file writer (`npm run domains:write-hosts`)**: companion to the print-only helper. Writes an idempotent, clearly marked managed block (root domain plus all five seeded branch subdomains, LAN IP or 127.0.0.1 via `--ip`, custom root via `--domain`), takes a timestamped backup of the hosts file before every write, verifies the result, supports `--remove`, and refuses cleanly with the exact elevated command when not run as root/Administrator. Verified: the write, re-run (single replaced block, foreign entries preserved), remove, and the non-elevated refusal path.

The remaining foundation items of this phase (Store slug and subdomain schema, seeded slugs and subdomains for the five branches, store context resolver, middleware host resolution, allowed-host validation, `/stores/[storeSlug]` path fallback, reserved subdomain blocking) shipped in v2.16.0 and are unchanged here.

## [2.17.3] Database safety tooling and standalone opt-in

### Added
- **Schema preflight (`npm run db:preflight`)**: answers "will this schema apply safely?" BEFORE an install or update touches the live shop database. It copies the SQLite database to a throwaway preflight file, runs the read-only `prisma migrate diff` between the copy and the models, then classifies the convergence on the copy: `in-sync`, `lossless-converge`, `additive-converge` (the known safe case for this project's nullable idempotencyKey / isEngraved columns) or `unsafe` (even `--accept-data-loss` fails; callers must abort). The live database is never written. Server databases are diffed read-only via `PREFLIGHT_DATABASE_URL`. `KEEP_PREFLIGHT_DB=1` keeps the copy for inspection.
- **Safe additive repair (`npm run db:repair`)**: one operator command for the "Schema drift detected" state: verified backup first (`db:backup` semantics), then the ensure-schema converge (plain push, and only on the known additive-drift refusal a pre-converge SQLite backup plus `--accept-data-loss`), then a verification push that must be a clean no-op. Exit 0 means repaired and verified.
- **Windows standalone output is now opt-in** (`BUILD_STANDALONE=1`): the Docker image and both no-Docker installers/updaters set the flag (their launchers run `.next/standalone/server.js`); plain `next build` and Vercel build without it, which also avoids the Windows EINVAL copyfile errors the standalone file walk can trigger. `users.isEngraved` was audited and confirmed deliberate (self-healing bootstrap admin); its schema documentation stands.

### Investigated and blocked
- **`prisma.config.ts` migration (the deprecated `package.json#prisma` seed block stays for now)**: adding a Prisma config file changes Prisma 6.19 CLI behavior - the CLI then resolves the datasource from the .env file and ignores inherited environment variables, and schema management rides `directUrl`, so the entire self-host toolchain (ensure-schema converge, installers, CI database preparation, the new preflight and repair targets) silently loses explicit-target control. Reproduced and documented; reverted. Revisit when adopting Prisma 7, together with a toolchain-wide env strategy.

## [2.17.2] File organization and duplicate file removal

### Removed
- **Retired duplicate brand assets**: `public/logo.png` and `public/logo.svg` (the old flat logo generation) are gone. Every surface now uses the current 3D brand set: the app sidebar, receipts and printed documents, the PDF statement report (which now embeds the 3D gear mark), and the service worker precache (cache version bumped so clients pick up the new asset list).
- **One-shot operational workflow removed**: `.github/workflows/delete-duplicate-vercel-project.yml` served its purpose once the duplicate Vercel project was confirmed deleted; the workflow remains recoverable from git history if ever needed again.

### Changed
- **.gitignore hardened**: SQLite/PostgreSQL local database variants (`*.sqlite`, `*.db.wal`/`*.db.shm`) and OS or editor droppings (`Thumbs.db`, `*.swp`) are now ignored, alongside the existing env, log, and database exclusions. One shared database remains the rule: nothing in the repo creates per-branch databases.
- The Edge proxy matcher explicitly excludes the 3D brand assets from the workspace pipeline so they are always served statically.
- Project structure documentation updated to describe the current brand asset set.

## [2.17.1] Professional repository writing standards

### Changed
- **Decorative emojis removed from the product surface**: seed and tooling console output now uses plain status markers ([ok] / [skip] / Warning: / [FAIL]); the offline page, WhatsApp receipt text, email subjects and headings, staff message templates, PDF statement activity rows, and client error logs read as plain professional text. Typographic status glyphs used by financial tables (check and cross marks) and the Mac Command key notation are preserved.
- **AI-style em and en dashes removed** from prose, comments, documentation (including the archive), console output, and config banners across the repository. Technical hyphens inside identifiers, URLs, CLI flags, package names, and version strings are untouched.
- **Terminology standardized in prose**: M-Pesa, Daraja API, STK Push, TypeScript, Next.js, PostgreSQL. Code identifiers, enum values, and endpoint paths are unchanged.
- **Demo credentials labeled as local-only**: the README, client setup guide, and self-host READMEs now explicitly mark the seeded admin login as a local default that must be changed immediately after first login.

### Fixed
- **Brand consistency**: receipts, printed documents, and the PWA shortcuts now use the current 3D gear brand mark (the same set as the app sidebar and favicon) instead of the retired flat logo; the two PWA shortcut icons point at the standard icon set; staff-facing email placeholders use the mbumahhardware.co.ke domain.
- **Self-host README corrections**: removed a stale version reference and repaired a malformed documentation link.

## [2.17.0] Hosting readiness audit corrections (external spec review)

### Added
- **Hosting readiness audit** (`docs/hosting-readiness-audit.md`): the external "hosting and subdomain phases" specification and the "local and online hosting guide" were reviewed against the repository. The audit maps all seven spec phases to what actually shipped (v2.15.0 through v2.16.0), records where the documents' assumptions no longer match the codebase (custom Bearer auth instead of NextAuth, IndexedDB instead of localStorage, `isEngraved` is a deliberate feature, the v2.15.0 series is already released so remaining work uses 2.17.0+), and keeps a prioritized gap register with dispositions.
- **Deployment posture fields on `/api/health`**: new informational top-level fields `appMode` (APP_MODE vocabulary: local-offline / development / production), `workspaceMode` (auto / subdomain / path / off) and `databaseProvider` (sqlite / postgresql, derived from the DATABASE_URL scheme). Monitors, tunnel checks and the LAN health gates can now tell which deployment posture answered. Additive only; the status computation is unchanged.
- **Database backup tooling** (`scripts/backup-db.mjs`, `npm run db:backup`): timestamped SQLite backup with `-wal`/`-shm` sidecars, file-missing and empty-file refusal, size verification, `BACKUP_DIR` destination and `BACKUP_KEEP`/`--keep` retention (newest 20 by default). PostgreSQL URLs print masked pg_dump / snapshot guidance instead of handling credentials. `npm run db:verify` runs the provider-aware `prisma validate`.

### Fixed
- **STK Push now rides the PAYMENT rate tier** (20/min) in the Edge proxy instead of the generic WRITE tier; initiating a customer-facing M-Pesa payment prompt is money-touching and must not share the 30/min write budget.
- **Docs corrected**: `/api/healthy` never existed as a route - `docs/deployment.md` and `docs/self-hosting.md` now document the real authenticated aggregated status endpoint `/api/health/system-status`, and the `/api/health` field lists include the new posture fields.

## [2.16.0] Feature: subdomain workspaces for offline and localhost modes

### Added
- **Branch subdomain workspaces** - every branch can now be reached as its own website (`juja-main.mbumah.co.ke`) while everything stays on one shared database. The root domain remains the organization console; path mode (`/stores/juja-main/dashboard`) remains the universal fallback for localhost, raw IPs, previews and tunnels without wildcard DNS. Mode selection is automatic (`NEXT_PUBLIC_STORE_WORKSPACE_MODE=auto`) with explicit `subdomain`, `path` and `off` overrides.
- **Host security layer in the Edge proxy** (extends the previous API-only pipeline to pages): Host header allowlist (`ALLOWED_HOSTS`, built-in defaults cover localhost, LAN IPs, `*.vercel.app` and the configured root domain), port stripping, reserved-subdomain protection (www, api, auth, admin, app, ...), branch subdomain rewrites to the internal path workspace, advisory `x-store-subdomain` / `x-store-slug` request headers, and a CORS OPTIONS preflight answer for trusted origins only (never a wildcard with credentials).
- **Store workspace schema**: `Store.slug` + `Store.subdomain` (unique, RFC 1123 labels, reserved-word protected) and `Store.brandingColor` (branch accent). Production-safe idempotent backfill (`scripts/backfill-store-slugs.mjs`, wired into `vercel-build` and `npm run db:backfill-slugs`) stamps legacy rows without touching populated values.
- **Multi-store memberships**: new `StoreMembership` model (unique active row per user+store) grants additional branch access; `assertStoreScope` now honors org-wide roles (SUPER_ADMIN, STORE_OWNER) and active memberships, and the ORM tenant context follows the validated requested store so branch workspaces show the right branch's data. A demo WAREHOUSE_MANAGER (`warehouse@mbumahhardware.co.ke`, password123) is seeded with Juja Main + Thika assignments.
- **Organization console** (`/org/dashboard`): combined metrics (revenue, transactions, low stock, overdue rentals, debt aging, pending M-Pesa), per-branch performance table, recent audit events, and "Open branch workspace" actions that open a new tab (subdomain URL when available, path mode otherwise). SUPER_ADMIN and STORE_OWNER get the full view; ACCOUNTANT a read-only financial view; branch-only roles are denied and the attempt is audit-logged.
- **Branch selector** (`/branches/select`) for multi-store members: shows only assigned active stores, opens workspaces in new tabs, auto-redirects single-store members, calm empty state for unassigned users.
- **Global chat across subdomains** (`/chat` + `/api/chat/*`): a singleton GLOBAL channel readable by every authenticated user of every branch (chat visibility is separate from data access), branch origin badges on messages, store threads unchanged, Zod-validated sends (2000 char cap) on the MESSAGING rate tier, 5s/15s polling fallback - no WebSocket dependency, serverless-friendly.
- **Cross-subdomain session sharing (opt-in)**: when `NEXTAUTH_COOKIE_DOMAIN` is configured, login also sets a shared `mbt_token` cookie; branch subdomain origins adopt it at boot and validate via `/api/auth/me`. Without it, behavior is unchanged (Bearer in localStorage, per-origin login).
- **Workspace routing for the SPA**: `/stores/[slug]/[[...rest]]` renders the exact same shell (extracted to `src/components/app/main-app.tsx`) pinned to the resolved branch, with per-branch page titles (`{Store Name} | Mbumah Hardware POS`), a branch badge in the top bar, and the branch accent color. Single-branch roles no longer see a store switcher in a pinned workspace; org roles keep it (the server still validates every switch).
- **Local setup tooling**: `npm run domains:print` prints copy-pasteable hosts-file entries (macOS/Linux/Windows instructions in the docs), `npm run domains:verify` runs a PASS/FAIL verification matrix against a running server (subdomain resolution, host header attacks, reserved subdomains, port stripping, health through a branch host).

### Tests
- 28 new unit tests: workspace domain helpers (host parsing, allowlist, reserved subdomains, mode resolution, internal rewrites) and workspace store definitions consistency (seed vs client store-info vs domains config). Suite: 19 files / 475 tests green; lint 0 errors; typecheck at baseline.

### Notes
- All branches keep sharing one database; tenant isolation is unchanged and every workspace request is re-authorized server-side (denied attempts are written to the security event feed).
- Docs: `docs/subdomain-workspaces.md` (master reference), `docs/local-offline-setup.md`, `docs/lan-deployment.md`, `docs/tunnel-development.md`, `docs/multi-store-workspaces.md`, `docs/global-chat.md`, `docs/rbac.md`, `docs/architecture.md`, `docs/vercel-deployment.md`, `docs/self-hosting.md`.

## [2.15.2] Hotfix: offline laptops self-heal database schema drift

### Fixed
- **Critical (offline incident): laptops updated to a release whose schema added unique columns kept serving Prisma P2022 errors** - "The column `equipment_rentals.idempotencyKey` does not exist in the current database" on `/api/notifications`, `/api/debt`, `/api/reminders/debt/overdue` and `/api/stock-movements`. Root cause: v2.14.0 added five nullable `idempotencyKey @unique` columns; Prisma classifies adding a unique constraint to a NON-EMPTY existing database as a data-loss warning and REFUSES `prisma db push` in non-interactive mode ("Use the --accept-data-loss flag"). Every self-hosted path (Windows installer, updater, Linux laptop scripts, docker entrypoint) ran the bare push with no fallback, so the database silently stayed behind the code while `/api/health` stayed green (row counts never touch new columns).

### Added
- **`scripts/ensure-schema.mjs` - the self-healing schema converge step** now behind `npm run db:push` everywhere (installer, updater, laptop scripts, CI prepare): plain push first (fast no-op when in sync); when refused, it backs the SQLite file up (`pos.db.pre-heal-<timestamp>.db`, newest 5 kept) and converges with `--accept-data-loss` - safe for this project's recurring additive drift (new nullable unique columns).
- **Startup self-heal**: the standalone server launcher (`deploy/nodocker/start-server.mjs`) converges the schema on EVERY boot before starting the POS (~1s no-op when in sync), so an install whose update schema step was skipped repairs itself the next time the shop opens the till. Disable with `SKIP_SCHEMA_HEAL=1` in `.env`. The docker entrypoint uses the same converge step (replacing the blind push + retry).
- **Schema-drift sentinel in `/api/health`**: when row counts succeed but the schema lags the code, `database_stats` degrades from `ok` to `warning` with a self-service fix hint. The probe uses the generated Prisma client (an ORM `findFirst` on the sentinel column) - a raw `SELECT "idempotencyKey"` probe would be blind on SQLite, which treats a double-quoted unknown identifier as a string literal instead of erroring. The start-pos and update-pos health gates key on exactly this status, so a drifted database can no longer pass the update health gate unnoticed.

### Notes
- Data safety: the converge fallback only ever runs after a plain push is refused, takes a timestamped SQLite file backup first, and the updater still takes its full pre-update backup before the rebuild. No changes to totals, VAT math, payments, debt or discount gates.
- Immediate remedy for affected laptops (works on any version): close the POS, run `npm run db:push` in the app folder, start the POS. Updating to 2.15.2+ does this automatically.

## [2.15.1] Hotfix: offline sales actually queue (mutation networkMode)

### Fixed
- **Critical: the offline sale flow never fired while offline** - TanStack Query pauses mutations when `navigator.onLine` is false under its default `networkMode: 'online'`, so `checkoutMutation.mutationFn` never ran, `saveOfflineTransaction()` was never reached and tapping "Process Payment" offline silently did nothing (queue stayed empty, no synthetic receipt). The app-wide QueryClient now sets `mutations.networkMode: 'always'`; the checkout mutationFn's own `navigator.onLine` check routes offline sales into the IndexedDB queue, and mutations without an offline path surface their network error via their normal `onError` handlers.
- Caught by the post-release browser E2E (release-process step 3): `[HANDLE-CHECKOUT]` logged while the mutation function never did; after the fix the full loop was verified live on the POS - offline sale saved locally with amber queue badge and synthetic receipt, reconnect auto-synced it to the server (real receipt number, Completed), queue drained to the green dot, and exactly one "Offline sales synced" success toast appeared (no duplicates).

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates. The offline queue engine, idempotent replay and indicator were already correct - only the mutation gating blocked them.

## [2.15.0] Release: audit corrections, realtime self-hosting wiring, offline polish

### Fixed
- **Duplicate sync toasts at the till**: an automatic background sync with the POS tab mounted toasted twice for the same event (POS tab's own success toast + the global OfflineIndicator's transition toast). Toast ownership is now explicit - the top-bar indicator owns the single "Offline sales synced" success per queue transition, and the POS tab surfaces only what the indicator cannot see: per-sync failure detail (which sales will retry). Manual "Sync now" and offline/online announcements are unchanged.
- **Latent self-hosted startup bug**: nginx `proxy_pass http://nextjs_app` referenced a hostname the compose file never defined (the app container had been renamed to `mbumah_app`), so `docker-compose.prod.yml` failed at nginx startup with "host not found in upstream". The app service now carries the `nextjs_app` network alias (documented in place).
- **Fresh-clone test suite**: `bun run test` failed 16 DB-dependent tests locally because the hermetic SQLite test database (`prisma/prisma/dev.db`) only existed in CI. A new `pretest` hook (`scripts/prepare-test-db.mjs`) mirrors the CI prepare step (schema push + seed against the forced URL, committed postgresql schema text restored afterwards), making the suite self-sufficient: 17 files / 447 tests green on a fresh clone (was 411/16 failed).

### Added
- **Realtime notifications ship self-hosted**: `mini-services/notification-service` now has a production Dockerfile (bun runtime, frozen lockfile) and runs as an internal-only `notification` service in `docker-compose.prod.yml` (healthcheck on `/health`, nginx `depends_on` healthy). Nginx routes same-origin `/socket.io/` traffic to it with websocket upgrade headers and 24h timeouts. Verified end-to-end: Engine.IO polling handshake 200, websocket connect, `join-store` -> `room-joined`. On Vercel the client degrades gracefully (no realtime push, everything else unchanged).
- **Offline mode documentation** (`docs/offline-mode.md`): queue flow (queue -> replay -> dedupe -> cleanup), cashier-facing surfaces, step-by-step offline testing, developer notes; indexed from `docs/README.md`.
- **Health endpoints guide** (`docs/deployment.md`): documents the `/api/health` (public, automation) vs `/api/healthy` (authenticated, in-app) split and the realtime service wiring.

### Improved
- Repository organization phase 2: client source materials consolidated under `docs/assets/`, ops runbook moved to `docs/runbooks/`, sandbox template artifacts removed, repo-wide markdown hygiene (single H1, no emoji headings, no em dashes), gitignore env-variant coverage.

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.
- Version reads from `package.json` everywhere (API, footer badge, OpenAPI) per the release process.

## [2.14.0] Production hardening: self-test, engraved admin, offline queue UX, stock contract

### Added
- **POST self-test + engraved-admin self-heal**: `/api/system/post` runs isolated production checks (PASS/FAIL/DEGRADED); `/api/system/heal` repairs the seeded engraved super admin idempotently; engraved accounts cannot be deleted, deactivated or demoted via the users API (403 `ENGRAVED_ADMIN_PROTECTED`); Admin tab gains a System Health card and shield badge.
- **Offline queue UX**: top-bar `OfflineIndicator` (green/amber dot + Offline Queue dialog listing every queued sale) on every tab, single per-transition reconnect toast, `clearOfflineQueue()` for the confirmed dialog action; canonical import path `@/lib/offline` with the queue contract documented in `src/lib/offline/README.md`.
- **Stock shortage contract**: checkout pre-validates every sellable line and fails with one structured 400 (`INSUFFICIENT_STOCK` + per-product details) before any charge; race losers map to the same contract; the POS clamps lines to available stock and routes zero-stock lines to the existing low-stock popup.
- **Ops**: `scripts/backup.sh` (sqlite3 `.backup` -> gzip with retention), database idempotency keys on `DebtLedger`/`EquipmentRental`/`Expense`/`StockMovement`.

### Improved
- **Fullscreen sidebar autohide**: in browser fullscreen the sidebar collapses to a 64px icon rail, auto-hides after 2s idle, peeks from a left-edge sensor, and restores state on exit; icon tooltips show F2-F5 shortcut hints; user menu gains "Toggle Fullscreen".
- **Inventory reorder prefill**: at/below-reorder products show "Reorder (+N)" (row menu, detail panel and a quick-fill chip in the Adjust Stock dialog) that prefills the suggested quantity to restore the stock level.
- **Typography sweep**: repo-wide string-literal cleanup (em dashes -> hyphens, decorative emojis out of internal UI); customer-facing templates exempt.
- **Repository organization phase 1**: Windows installers under `deploy/windows/`, QA screenshots and sandbox scripts removed, `bun.lock` as the sole lockfile, governance files (CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/CHANGELOG/SUPPORT) and `.github` templates in place.

### Notes
- Receipts gained print/PDF parity (`<receipt-number>.pdf`), amount no-wrap, unit abbreviations and a fixed totals strip.
- No changes to totals, VAT math, payments, debt or discount gates.

## [2.13.3] Feature release: functional POS + new 3D logo + smart recommendations

### Added
- **New 3D brand logo everywhere (spec PART 1)**: the official MBUMAH HARDWARE artwork (navy gear · orange house · silver trowel · "Your Building Partner in Juja") now anchors the sidebar in a white rounded-xl container with drop shadow so it sits cleanly on the dark `#0f172a` rail; the old flat green "MH" initials square is gone. A gear-only crop marks the top bar (visible even when the sidebar is collapsed) and the favicon/PWA icons are regenerated from the same artwork. Light backgrounds use the full-color logo as-is; dark surfaces get the white-container wrapper.
- **Smart Sell More recommendations (spec PART 3)**: a client-side product-affinity engine (`src/lib/product-affinities.ts`) maps what's in the cart to what the same customer very likely still needs (cement → spade + mixer + nails; mabati → timber + nails; rebar → cement + binding wire…), ranks by frequency, drops items already in the cart or out of stock, and shows the top 6 as tappable chips (+ icon, category dot, price). Works from the first cart, with no sales history needed (the server's co-occurrence engine is merged in and takes over as history accumulates). An empty cart shows best-seller chips; a cart with no mapped affinity shows the coach text plus best sellers below. The section is collapsible and the collapse state persists per device.
- **Thika branch catalog aligned to spec (PART 2)**: `scripts/seed-thika-catalog.ts` (idempotent, owner-run, StockMovement-audited) ensures the THI branch carries the 11 spec products at exact prices and stock: 4-inch Nails (Ksh 150/kg · 350), Bamburi Cement 50kg (750 · 180 bags), Dulux Weathershield 20L (8,500 · 20), Mabati 28/30-Gauge 8ft (800/650 · 200/350), Plywood 8x4ft 18mm (2,800 · 45), PVC Pipe 4-inch x 3m (800 · 90), Rebar 12mm x 12m (1,200 · 280), Simba Cement 50kg (720 · 120 bags), Spade Heavy Duty (1,200 · 40), Timber 2x4 x 12ft Cypress (800 · 60), plus the rental Concrete Mixer (Ksh 85,000, RENTAL) and Chain Link 6ft x 50m (4,500) used by the demo cart.

### Improved
- **Instant, honest cart feedback (spec PART 2)**: product tiles now show a blue "1 in cart / 2 in cart" pill the moment a line lands (optimistic, under 100ms, no network involved; pops on every re-add), add-toasts name the product and price ("Added Spade (Heavy Duty) - Ksh 1,200"), and Hold toasts say exactly what was parked ("Cart held - 7 items").
- **Faster search**: the products query debounce drops 200ms → 150ms per the functional-POS spec; the input itself stays instantly responsive and barcode-scan Enter-to-cart behaviour is unchanged.
- **Zero-sales KPI honesty (new branches)**: when a branch has no sales today, the Today's Revenue card shows a gray trend badge (never green or red at zero) with a hover tooltip "No sales yet today - start selling!" and the same coaching line as the card sub-text. Live/updated/auto-refresh-30s behavior from v2.13.0 is untouched.

### Notes
- RBAC, manager-PIN overrides, abuse detection and the audit trail (v2.12.x-v2.13.0) are unchanged and fully enforced.
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.

## [2.13.2] Hotfix: checkout 500 regression + limited-dashboard money card

### Fixed
- **Critical: checkout 500 on every sale (v2.13.1 regression)**: the new VAT-ledger line chained `.mul()` on the `Money` wrapper (which exposes `multiply()`/`taxComponent()`, not `mul()`), throwing `TypeError: KES(...).mul is not a function` and failing **every** `POST /api/transactions` with a 500. Replaced with the vetted helper `KES(finalTotal).taxComponent(rate).toNumber()`, the exact intended formula (`total × rate/(100+rate)`), Decimal-safe, 2dp HALF_UP. Caught by the post-deploy prod E2E (network log captured the 500 body) within minutes of rollout.
- **Cashier dashboard "Today's Sales" showed a count as money**: the limited payload's `todaySales` carried the transaction COUNT, so one sale rendered as "Ksh 1.00" while the real net revenue only surfaced via Avg Order. Now returns net revenue (same semantic as the full dashboard), keeping "Transactions" as the count card.

## [2.13.1] Fixed: VAT alignment & cashier KPI scoping

Closes the two acceptance nuances documented at the v2.13.0 E2E verification. No schema changes; no changes to totals, payments, debt or discount-gate math.

### Fixed
- **VAT figure is now receipt-true (spec formula)**: the info-only "VAT (x% incl.)" line on the POS cart, checkout summary and printed receipt shows the VAT component **inside the amount the customer actually pays**: `Total × rate / (100 + rate)`. Previously it showed the pre-discount per-line VAT component, so a Ksh 220 cart with a Ksh 50 discount (Total 170) displayed VAT 30.34 instead of 23.45.
- **Server VAT ledger aligned (Kenya VAT Act)**: `SalesTransaction.taxAmount`, the journal `VAT_PAYABLE` credit, the eTIMS payload `vatTotal` and the receipt's taxable-amount derivation now all use the post-discount consideration, since a discount given at the time of supply reduces the taxable value. Net revenue (`totalAmount − taxAmount`) therefore increases by the discount's VAT component on discounted sales, which is correct under IFRS 15 (revenue at transaction price).
- **Journal entry restructure**: the cart-level discount is no longer booked to the `SALES_DISCOUNTS` contra-revenue account (it is already netted inside the transaction-price revenue; booking both would unbalance the entry by exactly the discount). The discount remains recorded on the transaction row (`discountAmount`) for analytics. Entries created before v2.13.1 are untouched and remain balanced.
- **Cashier dashboard KPIs strictly own-scoped**: the limited dashboard's "Today's Sales", "Transactions" and "Avg Order" aggregates now filter on `cashierId = session.userId` and are captioned "your sales", matching the RBAC spec ("My Sales", not the branch total). Low Stock remains a store-level signal (no revenue leakage; previously true by construction).

### Notes
- Historical transactions keep their stored figures (documents are immutable history); only sales created on/after v2.13.1 use the aligned VAT derivation.
- Info-only guarantee still holds: Totals, Subtotals, Discounts, payments, debt, gift-card redemptions and the discount permission gates are byte-identical to v2.13.0 behavior.

## [2.13.0] Feature release: RBAC & Audit

The v2.12.1 → v2.13.0 ladder completes the RBAC roadmap. This release's headline is already live since v2.12.5-v2.12.8; v2.13.0 adds the release polish and ships the full ladder together.

### The ladder (v2.12.1 v2.12.8)
- **v2.12.2-v2.12.5, RBAC core**: 16-key dotted feature-permission matrix (`src/lib/permissions.ts`) with a 5-role system (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, INVENTORY_MANAGER), backend `403 PERMISSION_DENIED` enforcement, role-filtered sidebar with lock affordances, LockedCard + access requests, cashier limited dashboard, manager step-up authorization at the counter (`POST /api/auth/manager-authorize`) for >5% discounts and high-risk debt (KES 150k+).
- **v2.12.6-v2.12.8, Audit & abuse**: consolidated Audit Trail page with CSV export, discount-spam abuse detection (>3 denials/1h → SecurityEvent + manager notifications), privilege-abuse lockout (5 denials/10 min → 15-minute lock + Super Admin alerts), Security tab in the notification center, inventory price guard for INVENTORY_MANAGER.
- **v2.12.1, POS hotfix**: per-unit fallback ("per " bug), product-card badge overlap, FAB overlap on checkout, category scrollbar, VAT "(incl.)" labels, stock counter units, duplicate-image cleanup script.

### Added (v2.13.0)
- **What's New dialog**: on first launch after an update, a "Karibu! What's New in Mbumah POS" modal summarizes the release (latest version highlighted, previous entries below) with a direct link to this changelog on GitHub. Shown once per version via `localStorage.mbt_seen_version`; SSR-safe, and it does not repeat when storage is unavailable.
- **Footer status chip**: the Connected dot is now a live online indicator (mirrors `navigator.onLine` via online/offline events): green pulsing dot when connected, red "Offline" when the connection drops. Hidden on xs screens.
- **Footer Shortcuts button**: opens the existing Keyboard Shortcuts help dialog (previously reachable only via the `?` shortcut).

### Deprecated
- **Versions prior to v2.13.0 are deprecated for support purposes; self-hosted stores should update via the in-app updater (v2.9.0+) or the Remote Access Kit flow.**

## [2.12.8] Audit Trail page

### Added
- **Audit Trail view in the Security tab**: a second view ("Security Dashboard | Audit Trail" toggle, dashboard stays default) rendering a consolidated table of permission denials, manager overrides and manager authorizations: timestamp (with time-ago), user (name + truncated email), role, color-coded action badge (red denial / amber override / green authorized), resource + reason, result (DENIED / SUCCESS), branch, IP address.
- **Filters**: role select, user search (name/email), date range (from/to), "Denied only" switch, free search (permission/resource/reason), Prev/Next pagination with totals, and **Export CSV** (`mbumah-audit-trail-YYYYMMDD.csv`) honoring the active filters.
- Loading skeletons, error state and an explicit empty state ("No audit events match your filters"); long tables scroll inside a `scrollbar-thin` container.

## [2.12.7] Abuse detection & security alerts

### Added
- **Discount-spam pattern alert**: a cashier (or any role) denied `pos.discount.gt5` more than 3 times in 1 hour now writes a `PRIVILEGE_ABUSE_PATTERN` SecurityEvent and notifies every active BRANCH_MANAGER and SUPER_ADMIN of the org (WARNING / SECURITY notification, e.g. "Grace Wanjiku (Cashier) attempted 4x discount >5% in 1h, 14:32"). In-memory sliding window per instance (same best-effort posture as the lockout engine); the SecurityEvent feed is the durable record.
- **Inventory price guard**: an INVENTORY_MANAGER whose product-price update deviates more than ±20% from the cost basis (or from the old price when cost is null) gets `403 MANAGER_APPROVAL_REQUIRED` + a `HIGH_RISK_ATTEMPT` security record. The same `managerOverride` credential object used at checkout lets a Branch Manager+ approve inline (writes a MANAGER_OVERRIDE audit row with `PRODUCT_PRICE_GUARD` context); 3 wrong approvals in 5 minutes trip the existing brute-force window.
- **Security tab in the Alerts panel**: role-gated (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER) red-shield filter tab listing SECURITY-category notifications, with the 10 most recent abuse-set SecurityEvents (permission denials, high-risk attempts, brute force, lockouts, abuse patterns) merged below as read-only, red-tinted entries. The bell badge now reflects security alerts too; `/api/notifications` previously surfaced none of the durable SECURITY notification rows.

### Changed
- `/api/security/events` accepts BRANCH_MANAGER (store-scoped) and supports a comma-separated `eventTypes` filter.

## [2.12.6] Audit logging consolidation

### Added
- **GET /api/admin/audit-trail** (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER): one consolidated, paginated feed merging hash-chained AuditLog rows (`PERMISSION_DENIED`, `MANAGER_OVERRIDE`, `MANAGER_AUTHORIZED`) with SecurityEvent denial rows (`PERMISSION_DENIED` / `HIGH_RISK_ATTEMPT`) that have no AuditLog twin, so every denial appears exactly once (nearest-timestamp dedup, HIGH_RISK kind carried from the twin). Branch-scoped for non-super-admin callers; `format=csv` streams the compliance export.

### Deferred
- **`pos.void` endpoint**: still does not exist (verified); nothing was invented for it. The `requireFeaturePermission('pos.void')` gate, manager-override flow and Audit Trail visibility are ready the moment the endpoint lands. Void >2/shift manager approval ships with it.
- **Email digest option** for security notifications (daily/weekly summary), scheduled for a later release.

## [2.12.5] RBAC stable

Umbrella release of the v2.12.2 → v2.12.5 RBAC ladder: the role/permission system is now enforced end-to-end: backend 403s with typed denial payloads, role-filtered navigation with lock affordances, manager approval flows at the counter, and a dedicated limited view for cashiers. See the individual sections below for what shipped in each step.

### Highlights
- One permission model, two layers: the resource→action matrix (`hasPermission`) for CRUD checks plus the dotted feature keys (`hasFeaturePermission`) for business rules like discounts and dashboards.
- Manager approvals are now a first-class counter workflow: the cashier can complete a gated sale by collecting a manager's credentials, and every approval/denial is durably audited.
- Cashiers see an honest, useful workspace instead of broken analytics: own-activity KPIs, their own sales, and a clear "request access" path.

### Notes
- No database migrations required (User.role is a string column; the permission matrix is code-defined in `src/lib/permissions.ts`).

## [2.12.4] Cashier Limited View

### Added
- **Limited dashboard for revenue-denied roles** (CASHIER, INVENTORY_MANAGER): the dashboard API early-returns a minimal payload (`limitedView: true`, today's sales, transaction count, average order value, low-stock counts and the caller's own last 10 sales (`mySales`)) and never computes or ships revenue trends, debt exposure, top products/customers, payment-method amounts or inventory value for these roles (restricted by construction).
- **Cashier dashboard layout**: greeting hero, 4 KPI cards only (Today's Sales, Transactions, Avg Order, Low Stock), a "My Sales" feed (receipt tail, payment-method badge, amount, time-ago), an info banner ("You're viewing a limited dashboard. Revenue, debt and analytics are hidden for your role.") and a 2-column grid of LockedCards for Revenue Trend, Debt Aging, Store Health and Financial Reports, each with a "Request Access" action.
- **High-risk debt warning in POS**: selecting a customer whose outstanding balance exceeds KES 150,000 shows a red inline warning in the customer selector; amounts appear only for roles holding `customers.view.debt`; cashiers see the generic "Credit approval required for this customer".

## [2.12.3] RBAC core: matrix, sidebar filtering, locked cards

### Added
- **INVENTORY_MANAGER role** (frontend surfaces): catalog, inventory, suppliers, purchase orders and transfers now grant the role; role labels and tier order shared app-wide (`ROLE_LABELS`, `requiredRoleLabelFor`).
- **Sidebar lock affordances**: tabs a role cannot open are no longer silently hidden; they render as a grayed row with a 14px Lock icon, a "Requires {role}" tooltip (e.g. "Requires Branch Manager"), `aria-disabled` non-clickable behavior, and just the lock icon when the sidebar is collapsed. Accessible tabs keep the orange active-item style.
- **Cashier navigation narrowed to spec**: exactly Dashboard, POS, Customers, Transactions (Messaging/Chat moved out of the cashier's reach).
- **LockedCard component** (`src/components/rbac/locked-card.tsx`): premium locked-section card matching the dashboard design language: lock glyph in a muted circle, "Requires {role}" title, one-line explanation from the permission copy, and a debounced "Request Access" button.
- **Access-request flow** (`POST /api/access-requests`): records a `SecurityEvent(ACCESS_REQUEST, INFO)` with the permission key, requester email and role, and creates Notification rows for every active SUPER_ADMIN and BRANCH_MANAGER of the organization (requester excluded). Grants remain a Super Admin action.
- **Top-bar role badge**: muted role chip next to the top-bar actions (hidden on very small screens); SUPER_ADMIN renders "SA · System Administrator".
- **Feature-permission hook layer**: `usePermissions()` now exposes the `feature` group (`posSell`, `posDiscountGt5`, `dashboardRevenue`, `inventoryViewCost`, …) built on `hasFeaturePermission`, plus a plain `canFeature(role, key)` helper.

### Fixed
- **Cost hiding**: where the products API strips `costPrice` to null (roles without `inventory.view.cost`), the inventory table, detail dialog, stock-value summary and CSV export now render "•••" ("Cost hidden for your role") instead of 0 / blank / NaN margins.

## [2.12.2] Security: backend permission middleware + 403 handling

### Added
- **Feature permission matrix** (`src/lib/permissions.ts`): 16 dotted keys (`pos.sell`, `pos.void`, `pos.discount.gt5`, `pos.discount.gt10`, `pos.view.all_sales`, `dashboard.view.revenue`, `dashboard.view.profit_margin`, `dashboard.view.debt_aging`, `inventory.edit`, `inventory.view.cost`, `customers.view.debt`, `customers.create`, `debt.approve.high_risk`, `financial.view`, `settings.roles.manage`) with SUPER_ADMIN bypass and fail-closed behavior, plus shop-floor denial copy and per-key required-role labels.
- **Backend enforcement**: `requireFeaturePermission(key)` wrapper returns `403 { code: 'PERMISSION_DENIED', permission, message }`; every denial writes a hash-chained AuditLog row and a SecurityEvent, and feeds the privilege-abuse engine (5 denials / 10 min → 15-minute lockout + SUPER_ADMIN notifications).
- **Manager step-up authorization**: `POST /api/auth/manager-authorize` verifies a manager's email + password (shared bcrypt path with login), gates on manager-tier roles, records `MANAGER_AUTHORIZED` audit rows, and rate-limits to 3 failed attempts / 5 min per email+IP (`429 BRUTE_FORCE_PIN`).
- **Checkout gates**: discounts > 5% require the manager tier or a verified `managerOverride` credential object; discounts > 10% require Store Owner tier (never cashier-overridable); credit sales to customers owing more than KES 150,000 require `debt.approve.high_risk` or a verified override; every override writes a `MANAGER_OVERRIDE` audit row.
- **Products cost stripping**: list/detail/search endpoints return `costPrice: null` for roles without `inventory.view.cost`; product create/update/delete restricted to manager tier + INVENTORY_MANAGER.
- **Role management segregation**: creating users and changing roles are now Super Admin-only (`settings.roles.manage`).
- **Wire format**: `ApiRequestError` now carries the parsed error body so the frontend can branch on `code` / `permission` / `requiresManagerOverride` instead of matching message text.

## [2.12.1] Hotfix

### Fixed
- **POS "per NULL" unit bug**: products saved with a NULL `unitType` (e.g. Bamburi Cement) rendered a dangling "per " on product cards and empty/"null" unit badges in the cart, catalog, inventory and POS views. All unit render sites now share one null-safe `unitLabel()` helper (`src/lib/units.ts`), with a `UNIT` fallback. Ships with an owner-run backfill script, `scripts/fix-null-units.ts` (cement/Bamburi → `BAG`, other NULL units → `PIECE`).
- **Product card badge overlap**: the top-left badge stack (NEW / RENTAL / BUNDLE / BEST SELLER / ON SALE) is capped at 55% width with per-badge truncation, and the top-right LOW STOCK / OUT OF STOCK badge at 42% with truncation, so they can no longer collide on narrow cards (both stay z-20; NEW badge rule unchanged).
- **FAB overlap on POS**: the floating home button is now hidden while the POS tab is active (it covered the checkout area on short viewports) and remains on every other tab.
- **Category chips scrollbar**: removed the `scrollbar-none` override so the existing slim `scrollbar-thin` scrollbar (6px, rounded, muted thumb, transparent track) is always visible; scroll behavior and arrows unchanged.
- **VAT labels marked "(incl.)"**: POS cart totals, last-sale receipt, checkout dialog and the printable receipt now read "VAT (16% incl.)", an info-only clarification that prices are VAT-inclusive (KE default; VAT = Total × 0.16 / 1.16). No tax math was changed.
- **Stock counter unit**: product-card stock labels now carry a short unit suffix ("393 kg left", "12 bags left") via a shared `unitShort()` helper.
- **Duplicate nail images**: owner-run script `scripts/fix-duplicate-images.ts` clears `imageUrl` on duplicate nail product rows (one canonical image kept per size variant) so the grid falls back to category images.

### Notes
- Shift math fix, debt-crisis logic, low-stock counts, system-activity sanitization, alert dedup, and revenue-outlier handling shipped in v2.12.0 (PR #86).
