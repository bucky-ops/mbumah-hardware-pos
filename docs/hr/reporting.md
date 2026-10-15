# HR Reporting (v2.20.0 — EMS Phase 4.8)

Six governed reports plus the P10 statutory register, served from
`/api/hr/reports/*` and rendered in `/hr/reports`. Reports are **aggregates**:
per-employee rows carry `employeeCode` + job title only — no names, national
IDs, or raw database ids anywhere in payloads or tables.

## Scope model

| Role | Scope |
|------|-------|
| STORE_OWNER, HR_MANAGER, ACCOUNTANT | `ORG` — whole organization |
| BRANCH_MANAGER | `BRANCH` — own store only (session-resolved) |
| everyone else | denied (fail-closed) |

`resolveReportScope` returns `null` for unauthorised roles; every route maps
that to `403 PERMISSION_DENIED`.

## The six reports

| Report | Endpoint | Highlights |
|--------|----------|------------|
| Headcount | `/api/hr/reports/headcount` | Active/on-leave/suspended, hires & exits in period, average tenure, by employment type and by branch (branch names, not ids). |
| Employment cost | `/api/hr/reports/employment-cost` | Gross + employer statutory (NSSF employer match + AHL employer match, mirroring the engine) = total cost, monthly series, from posted lines. |
| Absence | `/api/hr/reports/absence` | Recorded days by status, unscheduled absence rate, leave rate, approved leave days in range. |
| Turnover | `/api/hr/reports/turnover` | Exits, hires, annualised rate, average tenure at exit, exit register (employeeCode + title + tenure). |
| Time to hire | `/api/hr/reports/time-to-hire` | Converted applicants: applied → offer accepted; median + average days; pipeline rows. |
| Statutory liability | `/api/hr/reports/statutory-liability` | PAYE / NSSF / SHIF / housing levy / PAYE arrears per month from posted lines — the statutory debt the journals already carry. |

Every report accepts `?from=&to=` (ISO dates); defaults cover the trailing 12
months.

## P10 statutory register

`GET /api/hr/reports/p10?year=YYYY[&format=csv]`

- **Reproduces from stored lines** (spec: "P10 reproduces from stored
  lines"): every figure reads the immutable `PayrollDetail` columns of
  POSTED/LOCKED runs in the requested tax year. Nothing is recomputed, so the
  register always matches the journals and payslips exactly.
- Groups by `employeeCode` with months counted, plus a TOTAL row.
- `format=csv` streams a CSV download (repo export conventions, UTF-8 BOM)
  and **writes a DATA_EXPORT audit event** (`P10_EXPORTED`) — exports are
  audit logged per spec.

## The /hr/reports workspace

Dense tables with the Phase 4.8 acceptance contract:

- sticky table headers (also inside scroll containers),
- per-table **column visibility** toggles (Show all columns reset),
- **CSV export** per table (client-side, BOM-prefixed),
- **print-to-PDF** via browser print with dedicated print styles (toolbars
  hidden, shadows flattened),
- no horizontal scroll on supported viewports (tables fit `max-w-7xl`;
  long tables scroll vertically with a max height),
- no badge overlap (status chips are single-line), no raw ids rendered.

Tabs: Headcount · Employment cost · Absence · Turnover · Time to hire ·
Statutory · P10 · Privacy.

## Org-console HR tiles

`GET /api/org/summary` now embeds an `hr` block (only when the HR module is
enabled and the caller holds an `hr.report.*` permission; the console hides
the section otherwise). Five tiles per spec: **Active headcount, Employment
cost (month), Absence rate (month), Payroll status (latest run), Expiry
alerts (documents expiring in 90 days + overdue assets)**. Tiles are additive
— an HR failure never breaks the console payload.
