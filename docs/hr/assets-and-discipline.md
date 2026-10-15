# Assets & Discipline (v2.19.0 — EMS Phase 4.7)

Company asset assignments and the disciplinary/grievance register. Both
consoles live under /hr (HR_MANAGER and STORE_OWNER via hr.asset.manage /
hr.discipline.manage).

## Asset assignments

Model: who received what (name, tag, serial), when, the condition on issue, the
expected return date, and the condition on return.

- `GET /api/hr/assets?employeeId=&status=` — list; ASSIGNED rows past their
  `dueReturnOn` carry `overdue: true` (row also tinted in the console).
- `POST /api/hr/assets` — assign (`employeeId`, `assetName`, optional
  `assetTag`, `serialNumber`, `dueReturnOn`, `conditionOut`, `notes`).
- `PATCH /api/hr/assets/[id]` — outcome or metadata edit.

### Recovery requires authorization (spec acceptance 3)

| Outcome | Requirements |
|---------|--------------|
| RETURNED | `conditionIn` required. No authorizer needed. |
| LOST / DAMAGED | `recoveryAuthorizedByUserId` required — must be an **active** user holding `hr.asset.manage`, and **must differ from the acting user** (`RECOVERY_SELF_AUTHORIZATION` otherwise). Notes are mandatory (`NOTES_REQUIRED`). |

The server resolves and validates the authorizer user row itself; the console's
authorizer picker (`GET /api/hr/performance/authorizers`) only lists eligible
users and already excludes the caller.

Illegal transitions (anything out of ASSIGNED) return 409
ILLEGAL_TRANSITION. `recoveryAuthorizedByUserId` is stamped on the row and the
audit event records that an authorizer was named (id not the point — the role
check is).

## Disciplinary cases

Types: `WARNING`, `GRIEVANCE`, `INVESTIGATION`; severity 1–5; confidentiality
`STANDARD` or `RESTRICTED` (grievances default to RESTRICTED).

- `GET /api/hr/discipline?employeeId=&status=&type=` — list. Running the list
  lazily **expires due warnings** first (see below). List payloads never
  contain `description` — sensitive-data rule, regardless of confidentiality.
- `GET /api/hr/discipline/[id]` — detail **including** description. RESTRICTED
  records additionally require HR_MANAGER / STORE_OWNER / SUPER_ADMIN
  (`CONFIDENTIALITY_RESTRICTED` otherwise).
- `POST /api/hr/discipline` — open a case. Description ≥ 10 chars; expiry must
  follow issue date; grievance default confidentiality enforced server-side.
- `PATCH /api/hr/discipline/[id]` — `RESOLVE` (notes ≥ 5 chars required) or
  `DISMISS`. Only OPEN cases can close (`ILLEGAL_TRANSITION` on re-close).

### Warning expiry (spec acceptance 4)

`sweepExpiredCases` flips `OPEN + type=WARNING + expiresOn < now` to `EXPIRED`
in one updateMany scoped to the caller's branch, then writes a single batch
audit event (`DISCIPLINARY_WARNINGS_EXPIRED`, count in metadata). The sweep
runs on list and detail reads — no scheduler required for correctness.

## Audit

Every mutation (assign, recovery record, case open/close, expiry sweep) writes
a hash-chained hrAudit event. Metadata carries field names and counts only —
never description text.
