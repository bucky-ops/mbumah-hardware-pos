# People and payroll by branch

## The panel

Title: People and payroll by branch (N), where N is the number of branches
the server returned. The count is dynamic and comes from the data, never
from a guess.

The panel shows, per branch:

| Metric | Source field | Notes |
|--------|--------------|-------|
| Headcount | headcountActive | Active employees for the branch |
| Employment cost | monthEmploymentCost | KES with thousands separators, 2 decimals |
| Absence | monthAbsenceRatePct | Percent; 10% or more renders emphasized |
| Latest payroll run | latestPayroll | Period name, status, run date, net where served |
| Expiry alerts | expiryAlerts | Documents expiring in 90 days + overdue asset assignments |

## Data source

GET /api/org/summary, the additive hrPerStore block. The same endpoint the
Organization and Expert consoles read. Nothing is computed client-side and
nothing is fabricated: every cell mirrors the org-level tile definitions
from the v2.23.0 contract.

## Where it renders

1. Expert Console (/console), collapsed by default (expert-system density).
2. Main SPA, Finance and Insights group, people-payroll tab, expanded by
   default. Both render the SAME component:
   src/components/finance/people-payroll-by-branch.tsx. There is no second
   table implementation anywhere in the app.

## Role visibility

- The people-payroll tab is offered to SUPER_ADMIN, STORE_OWNER, and
  ACCOUNTANT (ORG_SUMMARY_ROLES, the exact set /api/org/summary's guard
  serves). The sidebar locks it for every other role.
- BRANCH_MANAGER and CASHIER do not get the tab.
- The server re-validates every request. A caller without the HR report
  permission receives a summary without the hrPerStore block.

## Unavailable states and reason codes

Missing data never renders blank, undefined, NaN, or a guessed number. A
precise reason rides every gap: the machine-readable code is in the title
attribute, the human words are in the cell.

| Code | When | Shown as |
|------|------|----------|
| PAYROLL_RUN_NOT_AVAILABLE | The branch has no payroll runs yet | "no runs yet" muted cell |
| PERMISSION_DENIED | The session lacks the HR report permission | Whole-block status card with the code |
| HR_DATA_SOURCE_UNAVAILABLE | The HR module is off for the organization | Whole-block status card with the code |
| API_ERROR_SAFE | The endpoint failed; the error is not leaked | Whole-block status card with the code |

The whole-block card is PeoplePayrollUnavailable: a role=status region with
the panel title, the human explanation, and the code in a mono line.

## Isolation and privacy

- Branch scope is resolved server-side from the session; the client never
  supplies storeId or branchId as authoritative input.
- Rows carry branch (store) names and aggregates only. No employee PII, no
  raw internal IDs by default.
- The endpoint fail-closes: ORG scope + HR module on + report permission,
  or no hrPerStore block is served at all.

## Layout

- Desktop: a dense table with a sticky header inside a max-height scroll
  area (overflow-y-auto; there is no horizontal scroll).
- Mobile (below md): a card list, no horizontal scroll, readable metrics.
- Branch names link into the per-branch headcount report
  (/hr/reports?tab=headcount&storeId=...) where the session permits it.

## Per-branch filter (v2.110.0)

The panel owns a **branch filter** — inside the shared component, so the
Finance & Insights tab and the Expert Console both get it from one
implementation.

- **The one truth**: `filterBranchRows(rows, branchId)` (exported, pure). Both
  the desktop table and the mobile cards render exactly what it returns —
  the filter narrows, it never reorders.
- **'' (empty) = every branch**, in the server's original order. A known
  `storeId` narrows to that branch. An **unknown id is an honest empty**
  ("No branches match this filter."), never a silent fallback to all.
- **UI**: a native `<select>` (keyboard- and mobile-friendly) labelled
  Branch, an "All branches" option, a "showing X of Y" count while filtered,
  and a Reset affordance returning the whole org. Styled to the panel's
  design system: orange focus ring, slate borders, dark variants.
- **Privacy unchanged**: the filter is client-side over already-authorized
  rows; selecting a branch cannot fetch anything the caller could not
  already read.
- **Pinned by** `src/tests/people-payroll-filter-v2110.test.ts` and
  `scripts/verify-v2-110-0.mjs`.

## Deep links (v2.111.0)

The tab speaks two URL parameters:

- **`?tab=people-payroll`** — consumed ONCE at app boot (validated against
  TAB_CONFIG, applied AFTER the persisted store's async rehydrate, then
  stripped). A refresh returns to the persisted tab. Unknown ids are
  ignored silently.
- **`?branch=<storeId>`** — owned by the tab: read on mount to seed the
  panel's filter, mirrored on every change via `history.replaceState`
  (no navigation, no history entry), stripped on unmount so a stale filter
  cannot haunt the next visit.

While the filter still holds the link's value — and only until the user's
first manual change — the count reads "showing 1 of 5 (from link)".

Nothing widens: the deep links only choose what to display; every server
guard still fail-closes, and `?branch=` filters rows the session could
already read.

## Branch Selector hand-over (v2.112.0)

The deep link's natural front doors (v2.112.0) — the affordance wears TWO
homes, because branches are browsed in two places:

1. **The Branch Selector** (`/branches/select`, the multi-store user's
   landing): every branch card grows a **People & payroll** affordance that
   opens `/?tab=people-payroll&branch=<id>` in a NEW TAB — the same
   one-tab-per-view contract as "Open workspace" (spec Phase 8), so the
   selector stays available.
2. **The Organization Console** (`/org/dashboard`, the org-summary roles'
   branch table): every row's Workspace column wears the same
   **People & payroll** door beneath "Open branch workspace". This is where
   owners and accountants actually browse branches, so this is where the
   affordance earns its keep.

- **Builder**: `buildPeoplePayrollDeepLink(storeId)` in
  `src/lib/workspace/links.ts` — pure, `URLSearchParams`-encoded, relative.
- **Honest gating**: the affordance renders only for `ORG_SUMMARY_ROLES`
  (the exact roles `TAB_CONFIG` honors for the people-payroll tab). E2E
  verified both ways: a multi-store WAREHOUSE_MANAGER sees the selector
  cards with NO payroll door; a STORE_OWNER sees the door and the tab
  honors it. Inactive stores never offer the door.
- **Inheritance**: because the hand-over lands on the v2.111.0 boot path,
  it inherits everything for free — tab applied after rehydrate, the
  branch filter seeded and mirrored into the URL, the "(from link)" hint
  retiring on first touch.
- **Styling**: emerald outline variant (light and dark), quiet 200ms
  hover lift on the selector card, the branch's branding color ringing its
  dot on hover, and a `focus-within` border path for keyboard users.
- **Pinned by** `src/tests/branch-selector-handover-v2112.test.ts` and
  `scripts/verify-v2-112-0.mjs`.

## The dead columns become doors (v2.113.0)

The per-branch table's last two read-only columns learned to move:

- **Latest payroll → the run detail**: `hrPerStore.latestPayroll` now carries
  `runId` (an additive server join in `src/lib/hr/reports.ts`). The panel's
  latest-run cell renders as a link to `/hr/payroll?run=<id>` — the payroll
  page consumes the param as a lazy seed, opens the run detail dialog, and
  strips the param once on mount (a refresh never re-opens a stale dialog;
  the dialog's own fetch fail-closes when the run is not the session's to
  see). Stale summaries without a run id degrade to the same honest text —
  never a dead link.
- **Expiry alerts → the pre-filtered roster**: the alert count splits
  honestly. The DOCUMENTS half is a door to
  `/hr/employees?expiring=90&storeId=<id>` — the HR employees list (which
  this release also builds; the nav link had pointed at a 404 since v2.18.x)
  pre-filtered to people whose documents expire inside the same window the
  panel counts. The ASSETS half stays text: the assets list is
  session-scoped, and a cross-branch door would promise a view it cannot
  open. Zero halves never render as links.
- **Builders**: `buildExpiringEmployeesHref(storeId, days)` and
  `buildRunDeepLinkHref(runId)` in `src/lib/workspace/links.ts` — pure,
  encoded, relative.
- **Scope stays fail-closed**: `/api/hr/employees` honors an explicit
  `storeId` only for ORG-scope roles whose organization owns the store
  (`storeInOrganization` verification, 403 otherwise); every other role
  keeps the session's own store and the page says so honestly when the
  answer came from somewhere else.
- **Pinned by** `src/tests/panel-doors-v2113.test.ts` and
  `scripts/verify-v2-113-0.mjs`.
