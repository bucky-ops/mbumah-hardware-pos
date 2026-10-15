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
