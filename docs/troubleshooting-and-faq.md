# Troubleshooting and FAQ

Common issues and their fixes. If your problem is not listed here, [open a bug report](https://github.com/bucky-ops/mbumah-hardware-pos/issues/new?template=bug_report.yml).

## M-Pesa Daraja callback issues (ngrok for local testing)

**Symptom:** You trigger STK Push locally, the prompt appears on your phone, you enter your PIN, and M-Pesa deducts the money, but the sale status stays `PENDING` forever and the cashier screen never advances.

**Root cause:** Safaricom's Daraja API needs to call your server over the public internet to deliver the payment result. `http://localhost:3000` (or `127.0.0.1`) is not reachable from Safaricom's servers. They fire the callback, get a connection refused or timeout, and never retry, so your local server never sees the result.

**Fix: expose your local dev server with ngrok.**

```bash
# 1. Install ngrok (one-time): https://ngrok.com/download
#    Or via Homebrew: brew install ngrok

# 2. Expose your local Next.js dev server (must already be running on :3000)
ngrok http 3000

# 3. ngrok prints a forwarding URL like:
#       Forwarding  https://abc123.ngrok.app -> http://localhost:3000
#    Copy the HTTPS URL (not the http:// one, and not localhost).

# 4. Set the callback URL env var to the ngrok HTTPS URL + Daraja callback path
export MPESA_CALLBACK_URL="https://abc123.ngrok.app/api/payments/mpesa/callback"

# 5. Restart the dev server so the new env var takes effect
#    (Next.js does not hot-reload .env on most shells)
bun run dev

# 6. In the Safaricom Daraja developer portal (https://developer.safaricom.co.ke)
#    open My Apps, select your app, and confirm the "Confirmation URL" and
#    "Validation URL" point to the ngrok HTTPS URL (or rely on the per-request
#    callback URL passed in the STK Push payload, which is what this codebase does).
```

**Why HTTPS?** Daraja requires TLS on callback URLs in production. ngrok's free HTTPS endpoints satisfy this for sandbox testing.

**Why ngrok and not localhost?** Safaricom's servers initiate the HTTP POST to your URL; they cannot reach a process bound to your laptop's loopback interface. ngrok tunnels a public hostname down to your local port.

**Production note:** On Vercel, your callback URL is `https://your-domain.vercel.app/api/payments/mpesa/callback`; no ngrok needed. Register it once in the Daraja developer portal for your Production app (separate from Sandbox credentials).

**Still not working?** Check, in order:

1. **ngrok is still running.** If the ngrok process was stopped, the tunnel is dead and callbacks return 502.
2. **The callback URL is registered and confirmed on the Daraja portal.** Safaricom sends a one-time validation request to your confirmation and validation URLs; if that returns 404, your app is rejected.
3. **`MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` are for the correct app.** Sandbox credentials do not work against the Production endpoint, and vice versa.
4. **`MPESA_ENVIRONMENT` matches your credentials** (`sandbox` vs `production`).
5. **Daraja sandbox latency.** The sandbox sometimes has 30 to 60 seconds of lag before the callback fires. Do not assume failure before then.
6. **Check the ngrok inspector** at `http://localhost:4040`. It shows every request Safaricom made to your tunnel, including the raw POST body and your server's response code. This is the fastest way to debug a missing callback.

## Vercel 500 Internal Server Error on login or API calls

**Symptom:** Deployed to Vercel, the homepage loads, but `/api/auth/login` (or any other endpoint that touches the database) returns `500 Internal Server Error`. The Vercel function logs show one of:

```text
Error: prepared statement "s0" already exists
Error: Can't reach database server at <host>:5432
Error: Timed out fetching a new connection from the connection pool
Error: PrismaClientInitializationError: Database connection error
Error: ENV_VALIDATION_FAILED: Missing: DATABASE_URL, NEXTAUTH_SECRET
```

This is the most common deployment failure mode for this project. There are four common causes, in order of likelihood. (Setup-oriented steps are also collected in [Deployment](deployment.md).)

### Cause 1: serverless Postgres pooling parameters missing (most common)

Neon, Supabase, Render, and other serverless Postgres providers put a pooled connection string behind a PgBouncer proxy running in transaction mode. Prisma's default connection settings conflict with transaction-mode pooling and throw errors like `prepared statement "s0" already exists` or `Timed out fetching a new connection from the connection pool`.

**Fix: append the PgBouncer parameters to your `DATABASE_URL`.**

```bash
# Neon: use the "-pooler" hostname (not the direct hostname)
DATABASE_URL="postgresql://user:pass@ep-cool-name-pooler.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true&connect_timeout=15"

# Supabase: use the transaction-mode pooler (port 6543, not 5432)
DATABASE_URL="postgresql://user:pass@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true&connect_timeout=15"
```

Two parameters are mandatory on Vercel serverless:

| Parameter | Why |
|-----------|-----|
| `pgbouncer=true` | Tells Prisma to disable prepared statements, which break under PgBouncer transaction mode. Without it you will see `prepared statement "s0" already exists` after the first warm invocation. |
| `connect_timeout=15` | Vercel serverless functions time out at 10s on the Hobby tier (60s on Pro). Prisma's default `connect_timeout=5` is too aggressive; a cold Neon compute can take 8 to 10 seconds to wake from suspend. 15 seconds gives enough headroom. |

**Also set `directUrl` in `prisma/schema.prisma`** for migrations, which cannot run through PgBouncer:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")          // pooled, used at runtime by Prisma Client
  directUrl = env("DIRECT_DATABASE_URL")   // unpooled, used by prisma migrate / db push
}
```

```bash
# In Vercel env vars, set DIRECT_DATABASE_URL to the non-pooled Neon hostname
# (the one WITHOUT "-pooler" in it). Migrations use a single long-lived
# connection and will fail under PgBouncer transaction mode.
DIRECT_DATABASE_URL="postgresql://user:pass@ep-cool-name.region.aws.neon.tech/dbname?sslmode=require"
```

> **`relationMode` note:** If you see errors about foreign key constraints during `prisma db push` on Neon (for example "Foreign key constraint failed during table creation"), you may need to set `relationMode = "prisma"` in the datasource block. This is not required for this project as currently structured (the project uses `cuid()` IDs and explicit joins, not deferred foreign keys), but cross-store foreign keys may require it.

### Cause 2: tables do not exist (Vercel does not auto-run migrations)

Vercel runs `npm run vercel-build` (which is `prisma generate && next build`); it does not run `prisma migrate deploy` or `prisma db push`. A new Neon database starts empty after the first deploy, and every API route that touches a table returns 500 with `relation "User" does not exist`.

**Fix: push the schema and seed manually after the first successful deploy.**

```bash
# 1. Make sure your local .env has the SAME DATABASE_URL as Vercel
#    (the pooled Neon connection string from Cause 1)
#    AND DIRECT_DATABASE_URL pointing to the non-pooled hostname.

# 2. Install dependencies locally (if you haven't)
bun install

# 3. Push the schema; creates all 25+ tables on Neon.
#    db push is used rather than migrate deploy because this project
#    iterates schema-first; db push is idempotent.
bun run db:push

# 4. Seed the demo data (5 stores, demo users, sample products, gift cards, etc.)
bun run db:seed

# 5. Verify in the Neon SQL editor:
#    SELECT COUNT(*) FROM "Store";    -- should be 5
#    SELECT COUNT(*) FROM "User";     -- demo users
#    SELECT COUNT(*) FROM "Product";  -- sample products
```

> **Why not `prisma migrate deploy` in the build script?** Running migrations during `next build` is fragile: a failed migration fails the deploy, and migrations need the direct (non-pooled) connection string, which should not be present in the build environment. The standard Prisma plus Vercel pattern is to run migrations as a separate manual step (or via a CI job with `DIRECT_DATABASE_URL` injected).

> **Re-running after schema changes:** Any time `prisma/schema.prisma` changes, re-run `bun run db:push` locally (with the Vercel-matching `DATABASE_URL`) to apply the schema delta to Neon.

### Cause 3: Prisma Client not generated during the build

If the `vercel-build` script was customized and `prisma generate` was dropped, every database call fails with `PrismaClientInitializationError: Cannot read property 'user' of undefined`.

**Fix: keep `prisma generate` in the build script.**

```json
{
  "scripts": {
    "vercel-build": "node scripts/setup-prisma-provider.mjs && SKIP_ENV_VALIDATION=1 prisma generate && SKIP_ENV_VALIDATION=1 next build"
  }
}
```

The `SKIP_ENV_VALIDATION=1` prefix is required: without it, `next build` tries to collect page data for `/api/*` routes, which transitively imports `@/lib/env`, which eagerly Zod-validates runtime secrets that are not injected at build time. The build then fails with `Failed to collect page data for /api/auth/login`.

### Cause 4: missing or mis-scoped environment variables in Vercel

Vercel will silently boot your API route with `undefined` for `DATABASE_URL` if the variable was never added, was added only to "Development" while deploying to "Production", or was added with a trailing space.

**Fix:**

1. Go to Vercel, open the project, then Settings, then Environment Variables.
2. Confirm each variable exists and is checked for Production, Preview, and Development (unless deliberately scoped).
3. Confirm there are no trailing spaces in the value; a stray space at the end of `DATABASE_URL` corrupts the connection string.
4. Redeploy after adding or changing environment variables (Vercel does not redeploy on env-only changes).
5. Required runtime variables: `DATABASE_URL` (pooled), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `JWT_SECRET`. See [Configuration](configuration.md).

## Ghost shifts (orphaned or unclosed shift)

A "ghost shift" is a `Shift` record that was opened but never closed: `status` still reads `OPEN` and `endTime` is `NULL`, but the cashier is no longer operating it. Typical origins:

- **Browser crash:** the cashier's tab died mid-shift and the close-shift request never fired.
- **Power outage:** the POS terminal lost power; on reboot the cashier cannot open a new shift because the old one is still `OPEN`.
- **Network blip during close:** the close-shift request reached the server but the response was lost; the UI rolled back optimistically, leaving the shift `OPEN` server-side.
- **Cashier forgot to close:** the cashier locked the screen at the end of day without running the close-shift flow.

**Symptom:** A cashier tries to start a new shift and the system rejects it with "You already have an open shift", but the previous shift does not appear in the active-shifts list (the list filters by today's date and the orphan is from yesterday), or it appears but the cashier cannot reconcile cash they do not have.

**Fix A: close it via the Shifts tab (preferred).**

1. Log in as `BRANCH_MANAGER`, `STORE_OWNER`, or `SUPER_ADMIN`.
2. Open Shift Management. The system auto-detects unclosed shifts for the selected store and user and shows an "X unclosed shifts detected" banner.
3. Find the orphaned `OPEN` shift (filter by cashier name or date range if needed).
4. Select Force Close (available to manager-level roles; cashiers cannot force-close their own orphaned shifts, which prevents self-reconciliation fraud).
5. Enter the actual cash drawer count. The system records any discrepancy between expected and actual cash as a `CashDiscrepancy` audit entry, attributed to the closing manager with a mandatory reconciliation note.

**Fix B: database-level cleanup (last resort, for DBAs only).**

If the UI flow is unavailable (for example the shift belongs to a deleted user, or the store was archived), run the SQL directly against your Neon or PostgreSQL database:

```sql
-- 1. Find all ghost shifts across all stores
SELECT id, "userId", "storeId", status, "openedAt", "endedAt", "openingCash"
FROM "Shift"
WHERE status = 'OPEN' AND "endedAt" IS NULL;

-- 2. For a specific user
SELECT id, "userId", "storeId", status, "openedAt", "openingCash"
FROM "Shift"
WHERE status = 'OPEN' AND "userId" = '<user-id>';

-- 3. Close a single ghost shift (replace <shift-id> with the actual id)
--    Set closingCash = openingCash to record a zero-discrepancy close,
--    or set it to the counted amount if the drawer was counted.
UPDATE "Shift"
SET status     = 'CLOSED',
    "endedAt"  = NOW(),
    "closingCash" = "openingCash",
    "updatedAt"   = NOW(),
    note       = 'Force-closed by DBA after ghost-shift detection (browser crash / power outage)'
WHERE id = '<shift-id>';

-- 4. Record the manual close in the audit trail (recommended)
INSERT INTO "AuditLog" ("actorUserId", action, entity, "entityId", metadata, "createdAt")
VALUES ('<dba-user-id>', 'SHIFT_FORCE_CLOSE', 'Shift', '<shift-id>',
        '{"reason":"ghost shift","method":"sql"}'::jsonb, NOW());
```

> **Schema note:** Column names are quoted (`"userId"`, `"openedAt"`, `"endedAt"`) because Prisma generates them in PascalCase under PostgreSQL by default. On SQLite they are unquoted.

**Prevention (already implemented in this codebase):**

- The close-shift flow is idempotent: if the API call fails, retrying will not double-close. The endpoint checks the current `status` before mutating.
- The Shift Management UI surfaces unclosed shifts older than 24 hours with a "STALE SHIFT" badge so managers can intervene.
- A nightly cron (`SHIFT_RECONCILIATION`, scheduled via the system-config `cronJobs` registry) auto-flags shifts open for more than 24 hours for manager review and notifies the store's `BRANCH_MANAGER`.
- On shift start, the API checks for a pre-existing `OPEN` shift for the user and store and offers a one-tap "Resume Previous Shift" action instead of forcing a manual cleanup.

## "D.map is not a function" production crash

**Symptom:** Page loads but crashes with `D.map is not a function` in the browser console.

**Cause:** An API endpoint returned a non-array (for example `null`, an empty object, or an error object) where the frontend expected an array, and `.map()` was called on it.

**Fix:** Resolved in a prior patch; all API data extractions now use `Array.isArray()` guards. If it recurs, confirm you are on the latest `main` and that the affected tab uses the `safeArray()` / `safeData()` helpers from `@/lib/api`.

## Prisma migration errors on Vercel

**Symptom:** `vercel-build` fails with `Prisma schema validation error` or `relation does not exist`.

**Cause:** The schema was changed locally (`db:push`) but the migration was not committed, so the Vercel database is out of sync.

**Fix:**

```bash
# Locally, create and apply the migration
bun run db:migrate --name your_change_description

# Commit the migration files
git add prisma/migrations/
git commit -m "db: add your_change_description migration"

# On Vercel, the build runs prisma migrate deploy automatically
```

> For rapid prototyping, `db:push` is fine locally, but always create a proper migration before deploying to production.

## Still stuck?

- Read [Deployment](deployment.md) for setup-oriented guidance, and the archived [Vercel recovery guide](archive/VERCEL_RECOVERY.md) for the historical incident notes.
- [Open a bug report](https://github.com/bucky-ops/mbumah-hardware-pos/issues/new?template=bug_report.yml) with your Node version, browser, and reproduction steps.
- For security-sensitive issues, see [SECURITY.md](../SECURITY.md); do not open a public issue.
