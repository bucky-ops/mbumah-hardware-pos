# Performance Management (v2.19.0 — EMS Phase 4.7)

Review cycles, performance reviews, calibration, and goals. Governed by the EMS
spec: ratings are sensitive data and **never** appear in list payloads; goals
sourced from POS data are **computed, not typed**.

## Review cycles

State machine: `DRAFT → ACTIVE → CLOSED` (CLOSED is terminal).

- `GET /api/hr/performance/cycles` — list (hr.performance.review holders).
- `POST /api/hr/performance/cycles` — create (hr.performance.manage). Body:
  `{ name, periodStart, periodEnd }`. Duplicate names rejected per organization.
- `PATCH /api/hr/performance/cycles/[id]` — `{ action: 'ACTIVATE' | 'CLOSE' }`.
  Activation requires at least one review in the cycle (`EMPTY_CYCLE`).

## Performance reviews

State machine: `DRAFT → SUBMITTED → ACKNOWLEDGED → CALIBRATED`.

| Action | Who | Rules |
|--------|-----|-------|
| UPDATE (rating/strengths/improvements) | assigned reviewer or HR | Only in DRAFT/SUBMITTED. Rating: integer 1–5. |
| SUBMIT | assigned reviewer or HR | Requires a rating (`RATING_REQUIRED`). Captures the reviewer. |
| ACKNOWLEDGE | the reviewed employee (self-service) or HR | Only from SUBMITTED. Stamps `acknowledgedAt`. |
| CALIBRATE | HR only (hr.performance.manage) | Only from ACKNOWLEDGED and only while the cycle is ACTIVE (`CYCLE_NOT_ACTIVE`). |

Endpoints:

- `GET /api/hr/performance/reviews?cycleId=&employeeId=&status=` — list. The
  list payload contains status/dates/employee names **only** — `overallRating`,
  `strengths`, and `improvements` are absent by construction.
- `POST /api/hr/performance/reviews` — `{ cycleId, employeeId }`. One review per
  (cycle, employee) (`REVIEW_EXISTS`); closed cycles reject new reviews.
- `GET /api/hr/performance/reviews/[id]` — full detail including rating and
  narratives. The subject may always read their own review; others need branch
  scope. Cross-branch reads return a safe 404.
- `PATCH /api/hr/performance/reviews/[id]` — `UPDATE | SUBMIT | CALIBRATE`
  (ACKNOWLEDGE is refused here with `USE_SELF_SERVICE` — it belongs to the
  employee's own session via
  `POST /api/self-service/me/reviews/[id]/acknowledge`).

## Goals

Sources: `MANUAL`, `SALES_TOTAL` (sum of completed SALE transaction totals),
`SALES_COUNT` (count of those transactions), `CUSTOM` (manual). A POS goal
resolves the seller through `Employee.userId → SalesTransaction.cashierId`,
scoped to the employee's branch and the goal window
(`metricConfig.periodStart/periodEnd` overrides `createdAt → dueDate`).
Employees without a linked user account have zero POS activity by definition.

- `GET /api/hr/goals` — list with progress (`progressPct`, Decimal-safe).
- `POST /api/hr/goals` — create; POS goals compute their first value immediately.
- `PATCH /api/hr/goals/[id]` — edit title/target/dueDate/status (OPEN/CLOSED).
  Typed `currentValue` writes on POS-sourced goals are refused
  (`POS_GOAL_READONLY`).
- `POST /api/hr/goals/[id]/recompute` — recompute a POS goal; auto-flips
  ACHIEVED (value ≥ target) or MISSED (window passed) unless CLOSED.

Money math is Prisma.Decimal end-to-end (no floats); API payloads carry
two-decimal strings.

## Permission map

| Key | Roles |
|-----|-------|
| hr.performance.manage | HR_MANAGER, STORE_OWNER |
| hr.performance.review | BRANCH_MANAGER, HR_MANAGER, STORE_OWNER |
| hr.performance.read.own | all staff roles |

Every mutation writes a hash-chained hrAudit event with field-name-only
metadata (no rating values in audit payloads).
