# EMS Security and Privacy Notes

## Data protection posture (Kenya Data Protection Act alignment)

1. ConsentRecord model stores purpose, scope, policy version, grantedAt, withdrawnAt, lawfulBasis for employees and applicants.
2. Retention windows are defined per record class in 2.19.0 with a retention job; legal hold blocks archival; erasure requests are honored except where statutory retention applies, and the decision plus legal basis are recorded.
3. Sensitive fields (nationalId, kraPin, nssfNumber, nhifNumber, bank details, M-Pesa numbers, next of kin, health notes, disciplinary content, performance ratings) are masked by default in every list, export, and log surface.
4. Unmask requires hr.employee.unmask.pii, is role-gated server-side, and writes an audit event containing the field name and reason, never the value.
5. Exports require a report permission and are audit logged. After P0-1, exports mask PII unless the unmask permission is held and logged.

## P0-1 correction detail

src/lib/data-export-utils.ts currently writes nationalId, kraPin, nssfNumber, nhifNumber, and bankAccountName in clear text into the employee CSV export, with salary fields, without role gating or audit logging. The correction:

1. Introduces a shared mask-PII helper for employee records.
2. Applies masking in the export rows for every role without hr.employee.unmask.pii.
3. Writes an audit event on every employee export with the requesting user, row count, and whether unmasked data was included.
4. Adds scripts/verify-hr-privacy.mjs to keep the guarantee testable.

## Logging and error handling

1. P0-1 and P1 hardening: systemLog will apply sanitizeForLog by default so metadata containing credential-like keys is redacted without per-call diligence.
2. Stack traces remain suppressed unless EXPOSE_ERRORS is set; existing withErrorBoundary behavior is unchanged.
3. No PII in logs: HR service functions log entity ids and action names only.

## Platform security reuse

1. Host allowlist, CSRF fail-closed, body cap, and tiered rate limits apply to HR routes through the existing proxy pipeline.
2. Denied access attempts raise SecurityEvents through assertStoreScope, recordPermissionDenied, and auditRecordMiss.
3. Maker-checker on payroll is enforced server-side by comparing actor identities; the preparer cannot approve, post, or disburse.
4. Session hardening (bcrypt cost 12, constant-random tokens, abuse lockout) is reused unchanged for HR and self-service.

## Threat notes specific to EMS

| Threat | Control |
| --- | --- |
| Employee browses another employee's payslip | Self-service routes resolve the employee from the session user, never from client input |
| Branch manager reads another branch's payroll | Branch-scoped permission plus store resolver plus isolation tests |
| Payroll double posting on retry | JournalEntry.idempotencyKey plus PayrollRun.idempotencyKey with replay returning the existing record |
| Rate table tampering | Rate tables are insert-only; edits are new rows; every payslip stores resolved rateTableIds for reproducibility |
| PII in client bundle | Sensitive fields are excluded from list payloads server-side; masked in exports; never persisted to localStorage |
