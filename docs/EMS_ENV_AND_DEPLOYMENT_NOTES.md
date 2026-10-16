# EMS Environment and Deployment Notes

## Environment variables

No new required environment variables are introduced by EMS through 2.19.0. The feature flag is data-driven:

1. HR_MODULE_ENABLED: SystemConfig or HrSetting key, default off until 2.18.5 UI lands. Operators enable it per organization after the first HR_MANAGER is created.
2. Existing relevant variables (from .env.example): DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, JWT_SECRET, ALLOWED_HOSTS, NEXT_PUBLIC_ROOT_DOMAIN, NEXT_PUBLIC_USE_SUBDOMAINS, NEXT_PUBLIC_STORE_WORKSPACE_MODE, MPESA_* set, TRUST_X_FORWARDED_HOST.
3. Gap noted: UPDATE_ON_START is documented in deployment docs and start scripts but not in .env.example. Added to the P2 hygiene list.

## Deployment model

1. Local desktop (Windows and Linux): SQLite. EMS schema ships through the staged updater which preflights on a DB copy, backs up, activates, and rolls back on failure. BUILD_STANDALONE stays opt-in and off on Windows.
2. LAN and self-hosted: same updater path behind Caddy or the LAN server. Host allowlist must include the LAN hostnames for HR workspace access.
3. Vercel production: PostgreSQL (Neon). Additive migrations via migrate deploy. RLS file gains EMS table coverage per the migration plan.

## HR workspace access

1. Path mode: /stores/{slug}/hr/... works on every host including localhost.
2. Subdomain mode: {slug}.{root}/hr/... on configured root domains with allowed hosts.
3. The HR workspace lives under the existing store workspace layout; the org console gains HR tiles in 2.19.0.

## Operational notes

1. Rate table changes are data insertions through the HR settings surface, not code deployments. The rate change runbook lives in docs/hr/payroll-rate-tables.md (written with 2.18.8).
2. Payroll disbursement via M-Pesa B2C (v2.21.0): the run-level `POST /api/payroll/runs/[id]/disburse-mpesa` action reuses `MpesaTransaction` through an additive nullable `payrollDetailId` column. Configuration:
   - Reused Daraja credentials: `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_CALLBACK_URL` (the B2C `ResultURL`/`QueueTimeOutURL` are derived by replacing the C2B callback path with `/api/payments/mpesa/b2c/result` and `/api/payments/mpesa/b2c/queue-timeout`).
   - New B2C-specific variables: `MPESA_INITIATOR_NAME`, and the initiator secret as `MPESA_INITIATOR_PASSWORD` plus the Safaricom X.509 cert (`MPESA_CERT` PEM inline or `MPESA_CERT_PATH`), or a precomputed `MPESA_SECURITY_CREDENTIAL`.
   - Webhook auth reuses the C2B contract: `MPESA_CALLBACK_USERNAME` / `MPESA_CALLBACK_PASSWORD` (HTTP Basic, constant-time) and optional `MPESA_CALLBACK_IPS` allowlist. Register the result URL with these credentials upstream.
   - When the B2C credentials are absent the action runs in MOCK mode (SIM receipts, payslips marked PAID immediately) in development; a production build may opt in explicitly for staging/hermetic QA with `MPESA_B2C_ALLOW_MOCK=true` (recorded in the audit event). Otherwise production refuses with `B2C_NOT_CONFIGURED` — money movement is never silently simulated.
3. Backups: the nightly backup and the pre-update backup both cover EMS tables automatically because they copy the whole database.
4. Retention: the existing retention cron route is extended in 2.19.0 for EMS record classes.

## Known limitations

1. In-memory abuse and denial counters do not persist across serverless instances (pre-existing, documented in auth code). EMS relies on proxy-tier rate limits for HR routes.
2. Windows local builds are never standalone; HR workspace behaves identically in non-standalone mode.
3. The operator desktop database could not be inspected during the audit; chart-of-accounts verification on live data is part of the correction verify script run.
