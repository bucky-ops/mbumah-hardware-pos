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
