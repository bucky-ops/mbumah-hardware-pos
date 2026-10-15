# EMS Risk Register

Likelihood: L (low), M (medium), H (high). Impact: 1 (minor) to 5 (severe). Exposure = likelihood times impact.

| ID | Risk | Likelihood | Impact | Exposure | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Employee PII leaks through exports or logs | H | 5 | 15 | P0-1 correction: mask by default, role-gated unmask, audit every unmask and export; sanitizeForLog default in systemLog | Release engineer | Open, corrected in 2.18.4.0 |
| R2 | Payroll journal imbalance or double posting | M | 5 | 10 | P0-2 correction: liability accounts, JournalEntry.idempotencyKey, balance assertion before post, maker-checker | Payroll engineer | Open, corrected in 2.18.4.0 |
| R3 | Account code 2300 ambiguity corrupts gift card or payroll postings | M | 4 | 8 | Align helper constants with seed (gift card liability 2400), upsert-based account seeding, verify script | Database engineer | Open, corrected in 2.18.4.0 |
| R4 | Statutory rate defaults are wrong or outdated | M | 4 | 8 | Versioned RateTable rows with instrument reference, effectiveFrom and effectiveTo, verifyWithCounsel true, human review checklist | Compliance owner | Open, human decision required |
| R5 | Attendance punches replayed or fabricated | M | 3 | 6 | Server-authoritative time, idempotencyKey on punch, Shift reconciliation, approval before payroll | Backend engineer | Planned in 2.18.7 |
| R6 | Cross-branch data access in new EMS routes | M | 5 | 10 | Reuse requireStoreAccess plus injectTenant; new verify-hr-isolation script; deny-by-default branch scoping | Backend engineer | Planned, every EMS phase |
| R7 | Payroll hard gate failure blocks release | M | 3 | 6 | Golden fixtures and property tests before any UI; if the gate fails, payroll UI is not shipped and the release reports failure | Release engineer | Planned in 2.18.8 |
| R8 | Maker-checker bypass on payroll approval | L | 5 | 5 | Server-side actor comparison, preparedBy differs from approvedBy, audit log every step | Payroll engineer | Planned in 2.18.8 |
| R9 | Sensitive payroll data cached in localStorage | M | 4 | 8 | Self-service caches masked summaries only; reuse offline outbox only for non-sensitive queues | Frontend engineer | Planned in 2.18.9 |
| R10 | Role string typos create silent privilege drift | L | 4 | 4 | Typed role constants in src/lib/hr/roles.ts, single source of truth, verify script asserts known roles | Backend engineer | Planned in 2.18.5 |
| R11 | In-memory abuse counters reset across serverless instances | M | 3 | 6 | Documented limitation; EMS routes keep rate limits at the proxy tier; persistence deferred | Infrastructure engineer | Accepted, documented |
| R12 | Migration adds heavy indexes and slows deploys | L | 3 | 3 | Additive nullable columns and targeted indexes only; preflight on DB copy before activation | Database engineer | Standing rule |
| R13 | Seed non-idempotency breaks partial databases | M | 3 | 6 | Convert account and demo user seeding to upserts in the correction | Database engineer | Open, corrected in 2.18.4.0 |
| R14 | Historical payslips change after rate edits | L | 5 | 5 | Rate tables are insert-only; payslips store resolved rateTableId and remain reproducible; immutability enforced after PAID or LOCKED | Payroll engineer | Planned in 2.18.8 |

## Review cadence

The register is revisited at each EMS release gate. Any risk that graduates to a blocker stops the release per the spec stop conditions.
