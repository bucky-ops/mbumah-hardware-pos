# Finance and Insights navigation

## Why this group exists

Finance and Insights is the navigation group that collects every money-facing
surface of the main SPA. It existed before v2.109.0 with these members:
Financial, Analytics, Banking, Payroll, and Transfers. v2.109.0 adds one
member and changes nothing else about the group.

## Members (in visible order)

| Order | Tab id | Label | Icon | Roles |
|-------|--------|-------|------|-------|
| 1 | financial | Financial | BarChart3 | SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, ACCOUNTANT |
| 2 | analytics | Analytics | LineChart | SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, ACCOUNTANT |
| 3 | banking | Banking | Landmark | SUPER_ADMIN, STORE_OWNER, ACCOUNTANT |
| 4 | payroll | Payroll | Wallet | MGMT_ROLES |
| 5 | people-payroll | People and Payroll | UserCog | SUPER_ADMIN, STORE_OWNER, ACCOUNTANT |
| 6 | transfers | Transfers | ArrowUpDown | MGMT_ROLES |

The order is the array order in NAV_GROUPS (`src/lib/app-config.ts`), which
the AppSidebar renders group by group. There is no second ordering source.

## People and Payroll by branch

The people-payroll tab is the Finance and Insights home of the "People and
payroll by branch" panel. The panel shows, per branch: headcount, employment
cost, absence rate, latest payroll run, and expiry alerts. It reads the
additive hrPerStore block of GET /api/org/summary, the same server truth the
Organization and Expert consoles read.

Before v2.109.0 the panel lived only on the Expert Console (/console).
It now renders from ONE shared component
(src/components/finance/people-payroll-by-branch.tsx) in two homes:

1. The Expert Console, collapsed by default so the expert-system density
   survives.
2. The people-payroll tab in the main SPA, expanded by default, because
   there the panel is the content.

See docs/PEOPLE_PAYROLL_BY_BRANCH.md for the data contract, the role
visibility rules, and the reason codes shown when data is unavailable.

## Role visibility

The tab is offered to exactly the roles the org-summary guard serves
(SUPER_ADMIN, STORE_OWNER, ACCOUNTANT, exported as ORG_SUMMARY_ROLES). The
sidebar renders it locked for every other role (the v2.12.5 pattern), and
the server re-validates every request. A client that reaches the endpoint
without the HR report permission gets a summary without the hrPerStore
block; the panel then shows the reason code instead of numbers.

## Isolation

Branch scope is resolved server-side from the session. The client never
supplies storeId, branchId, or role as authoritative input. The panel
renders branch names, never employee PII, and the endpoint fail-closes.
