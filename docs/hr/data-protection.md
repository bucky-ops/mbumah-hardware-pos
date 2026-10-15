# Data Protection (v2.20.0 — EMS Phase 4.8)

The EMS Data Protection Act posture, as specified: consent records, retention
windows per record type, legal hold, erasure with recorded decisions, PII
masking, and audit-logged exports. Companion pages: `documents-and-retention.md`
and `reporting.md`.

## What already exists (from earlier phases)

| Control | Where |
|---------|-------|
| Consent records (purpose, scope, policy version, grantedAt, withdrawnAt) | `ConsentRecord` model; payroll prepare blocks without `PAYROLL_PROCESSING` consent; recruitment captures applicant consent. |
| PII masked by default / unmask audit logged | `src/lib/hr/pii.ts`, payslip views (`[REDACTED]` statutory ids), `hr.employee.unmask.pii` permission. |
| Cross-tenant denial + deny logging | `hrGuard`, `selfServiceGuard`, `recordPermissionDenied`. |
| Self-service minimisation | Self endpoints resolve the Employee via session; client identity params ignored. |

## New in v2.20.0

### Retention windows per record type

`HR_RETENTION_POLICIES` in `src/lib/hr/data-protection.ts` defines reviewable
defaults (**not legal advice** — every default is replaceable and documented
with its basis):

| Scope | Window (measured from) | Basis |
|-------|------------------------|-------|
| `hr_applicant_rejection_data` | the row's own `dataRetentionUntil` | DPA data-minimisation for rejected/withdrawn applicants. |
| `hr_disciplinary_closed` | 3 years from last update | warning history usually relevant 2–3 years. |
| `hr_attendance_daily` | 2 years from the day | operational need ends with approval + disputes; payroll keeps the statutory copy. |

The sweep **anonymises in place** (`REDACTED (retention)`) instead of hard
deleting, so foreign keys, statistics, and audit history stay intact. It runs
from the nightly `GET /api/cron/retention` (CRON_SECRET gated) alongside the
ISO policies, per organization, and writes batch audit events
(`RETENTION_*_ANONYMISED`) with counts and field names only.

### Legal hold

Setting the `HrSetting` key `legalHold:<scope>` to `"true"` skips that scope
entirely (`getLegalHolds`). Scopes match the policy list exactly, so a hold
blocks archival for litigation or audit without code changes.

### Erasure requests

Model: `ErasureRequest` (additive) — employee, requester, status
(`PENDING → EXECUTED | PARTIALLY_EXECUTED | REJECTED`), decision text, legal
basis, `retentionApplies`, decider.

Flow on `/hr/reports → Privacy`:

1. **Open** (`POST /api/hr/privacy/erasure-requests`) — one PENDING request
   per employee (`REQUEST_PENDING` otherwise).
2. **Execute** (`POST .../[id]/execute`, SUPER_ADMIN only) — erases
   **non-statutory** personal data (document files + notes, review narratives,
   contact fields), closes open goals, and marks the request
   `PARTIALLY_EXECUTED` with `retentionApplies = true` because **payroll and
   audit records carry statutory retention and are never erased**. The
   decision and legal basis are stored on the row.
3. **Reject** (`POST .../[id]/reject`, SUPER_ADMIN only) — requires a decision
   reason (≥ 10 chars) **and** a legal basis (≥ 5 chars); both recorded.

Every decision writes a hash-chained audit event
(`ERASURE_REQUEST_EXECUTED` / `ERASURE_REQUEST_REJECTED`). The decider is
recorded (`decidedByUserId`); requesters cannot self-serve decisions because
only `hr.settings.manage` holders reach the decision endpoints.

### Exports audit logged

The P10 CSV/JSON export writes `P10_EXPORTED` (DATA_EXPORT) with year, format,
and scope. Report reads are permission-gated; list payloads stay aggregate-only.

## Security headers and rate limits

Inherited platform controls (documented, unchanged this phase): the security
header set is applied by the proxy layer (`src/proxy.ts` — CSP, HSTS,
X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP/CORP), and login
plus other sensitive endpoints run rate limiting (`x-ratelimit-*` headers, see
`/api/auth/login`). The HR APIs additionally compose fail-closed guards with
deny logging on every denied attempt.
