# Employee Documents & Retention (v2.20.0 — EMS Phase 4.8)

How employee documents are stored, verified, and eventually retired, plus the
retention/legal-hold machinery introduced in v2.20.0.

## Document records

`EmployeeDocument` rows carry: type (`CONTRACT`, `ID_COPY`, `KRA_PIN_CERT`,
`NSSF_CARD`, `CERTIFICATE`, `OTHER`), file name, optional file URL, issue and
expiry dates, verification status (`PENDING/VERIFIED/REJECTED` with verifier),
and optional HR-only notes.

- Upload/verify lives in the HR employee console (`/api/hr/employees/[id]/documents`,
  `hr.employee.*` permissions; verification is HR-manager territory).
- Employees see their own documents' metadata in self-service
  (`/api/self-service/me/documents`): type, file name, verification status,
  expiry — **HR notes are never served to the employee**, and file bytes are
  only reachable through the permission-gated HR route.
- The self-service documents page warns about expiries within 90 days.

## Retention (v2.20.0)

Three HR retention scopes run nightly from `GET /api/cron/retention`
(see `docs/hr/data-protection.md` for the full contract):

| Scope | What happens at expiry | Window |
|-------|------------------------|--------|
| `hr_applicant_rejection_data` | contact fields + cover note anonymised (`REDACTED (retention)`) | each rejected applicant row's own `dataRetentionUntil` (set at rejection) |
| `hr_disciplinary_closed` | case description + resolution notes anonymised | 3 years after the case was closed |
| `hr_attendance_daily` | device identifier cleared | 2 years after the day |

Payroll, payslips, journals, audit trail, and consent records are **not**
swept: they carry statutory retention (Employment Act s.74, Tax Procedures
Act) and remain reproducible for the full retention period (P10 reads the
stored payroll lines — see `reporting.md`).

## Legal hold

`HrSetting` key `legalHold:<scope>` = `"true"` blocks the sweep for that scope
across the organization (e.g. `legalHold:hr_disciplinary_closed` freezes all
closed disciplinary cases). Holds are settings-managed (`hr.settings.manage`),
take effect on the next nightly run, and the sweep result reports
`held: true` per held scope.

## Erasure vs retention

Erasure requests (Data Protection Act posture) erase **non-statutory**
personal data — document files and notes, review narratives, contact fields —
and always record the decision and legal basis on the `ErasureRequest` row.
Statutory records are retained and the request lands as
`PARTIALLY_EXECUTED` with `retentionApplies = true`. Full contract in
`data-protection.md`.
