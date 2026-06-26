# Vercel Deploy Fixes — MBUMAH Hardware POS

> **Purpose:** Step-by-step guide to fix the production `/api/auth/login` 500 error
> on Vercel. The root cause is **NOT a code bug** — it is a Vercel environment-variable
> misconfiguration pointing to a dead Neon database endpoint.
>
> **Production URL:** https://mbumah-hardware-pos-one.vercel.app
> **GitHub repo:** bucky-ops/mbumah-hardware-pos
> **Database:** Neon PostgreSQL (`ep-calm-butterfly-aivj6kzm-pooler`)

---

## Current Diagnosis (as of Phase 1 investigation)

The code in `src/app/api/auth/login/route.ts`, `src/lib/db.ts`, and `src/lib/env.ts`
is already fully production-grade (robust try/catch, full stack logging, `force-dynamic`,
lazy env validation, serverless-optimized Prisma singleton). **No code changes are
required to fix the 500.**

The 500 is caused **solely** by 4 broken Vercel env vars, confirmed via the live
`/api/health/env` and `/api/health/db` endpoints:

| Env Var | Current (BROKEN) | Required |
|---------|------------------|----------|
| `DATABASE_URL` | `ep-winter-waterfall-a25wj37w-pooler` (DEAD) + missing `pgbouncer=true` | `ep-calm-butterfly-aivj6kzm-pooler` + `?pgbouncer=true&connect_timeout=15` |
| `DIRECT_URL` | `ep-winter-waterfall-a25wj37w` (DEAD, non-pooler) | `ep-calm-butterfly-aivj6kzm-pooler` + `?pgbouncer=true&connect_timeout=30` |
| `NEXTAUTH_URL` | `Gt5mW8xK2pR7vN4bQ9fL6jY1cZ3aH0dS` (random string!) | `https://mbumah-hardware-pos-one.vercel.app` |
| `EXPOSE_ERRORS` | not set | `true` (for diagnostics) |

**`/api/health/db` confirms:** `reachable: false` → "Can't reach database server at
`ep-winter-waterfall-a25wj37w-pooler:5432`"

---

## The 5-Step Fix

### Step 1: Verify / Set Vercel Environment Variables

You need to update 4 env vars in the Vercel dashboard. There are two ways to do this:

#### Option A — Automated (requires a Vercel API token from the project-owning account)

```bash
# The token MUST belong to the SAME Vercel account that owns the
# `mbumah-hardware-pos-one` project (likely the bucky-ops account).
# Tokens from other accounts (e.g. muchiricollins98@gmail.com) will get 404.
VERCEL_TOKEN=<your-token-from-project-owning-account> bash scripts/set-vercel-env.sh
```

This script:
1. Finds the project by name
2. Deletes any existing env vars with the same keys (idempotent)
3. Creates fresh env vars for: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`,
   `JWT_SECRET`, `NEXTAUTH_URL`, `EXPOSE_ERRORS` — all targeting the **Production** environment
4. Triggers a production redeploy

#### Option B — Manual (via Vercel dashboard)

1. Go to **Vercel Dashboard** → **mbumah-hardware-pos-one** project →
   **Settings** → **Environment Variables**
2. For each of the 4 env vars below, either edit the existing value or delete +
   re-create it. Set the **Environment** to **Production** (and Preview if desired).

**The exact values to set:**

```
DATABASE_URL = postgresql://neondb_owner:npg_aRfWJIn8Neq9@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15

DIRECT_URL = postgresql://neondb_owner:npg_aRfWJIn8Neq9@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=30

NEXTAUTH_URL = https://mbumah-hardware-pos-one.vercel.app

EXPOSE_ERRORS = true
```

> **IMPORTANT — PgBouncer query params are mandatory:**
> The `?pgbouncer=true&connect_timeout=15` suffix on `DATABASE_URL` is what tells
> Prisma to use PgBouncer-compatible (transaction-mode) pooling. Without it, each
> serverless function invocation opens a direct Postgres connection, and you will
> exhaust Neon's connection limit (typically 20 on free tier) within minutes.
> `connect_timeout=15` prevents cold-start hangs when the pool is saturated.
>
> `DIRECT_URL` uses `connect_timeout=30` (longer) because it's used for migrations
> which may take longer to establish.

> **NOTE on `NEXTAUTH_SECRET` and `JWT_SECRET`:**
> These are already set correctly (42 chars and 32 chars respectively, both strong).
> Do NOT regenerate them — regenerating would invalidate all existing user sessions.
> The `set-vercel-env.sh` script generates new secrets only if the env vars
> `NEXTAUTH_SECRET` / `JWT_SECRET` are not already set in your shell environment.

#### Verify Step 1

After setting the env vars, verify they're correct by hitting the health endpoint
(this works even before redeploying, because env vars are read at runtime):

```bash
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/env | jq
```

**Expected output:**
```json
{
  "status": "ok",
  "missing": [],
  "variables": {
    "DATABASE_URL": {
      "set": true,
      "preview": "postgresql://neondb_owner:***@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require",
      "pooled": true,
      "pgbouncer": true,
      "ssl": true,
      "notes": ["Pooled Neon URL ✓", "pgbouncer=true ✓", "sslmode=require ✓"]
    },
    ...
  },
  "hints": []
}
```

The `status` should be `"ok"` (not `"warning"`), and `hints` should be `[]` (empty).

---

### Step 2: Sync DB Schema + Seed Data

The Neon database at `ep-calm-butterfly-aivj6kzm-pooler` already has the full schema
(43 tables) and seed data (12 users, 236 RBAC permissions, 51 products, 15 customers,
30 transactions) from Cycle F. **This step is only needed if you're pointing to a fresh
Neon database.**

#### Check if the database already has data

```bash
# After Step 1 env vars are set and a redeploy has happened:
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/db | jq
```

**Expected output (database already seeded):**
```json
{
  "status": "ok",
  "reachable": true,
  "counts": {
    "users": 12,
    "products": 51,
    "stores": 5,
    "salesTransactions": 30,
    ...
  },
  "missingTables": [],
  "responseTime": "847ms"
}
```

If `reachable: true` and `counts` show data → **skip to Step 3**.

#### If the database is empty or missing tables

Run these commands **locally** with the production `DATABASE_URL` set in your shell
(this pushes the schema and seeds the database directly — Vercel does NOT run
`prisma db push` or `prisma db seed` during builds):

```bash
# 1. Set the production DATABASE_URL in your shell (temporarily)
export DATABASE_URL="postgresql://neondb_owner:npg_aRfWJIn8Neq9@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15"
export DIRECT_URL="postgresql://neondb_owner:npg_aRfWJIn8Neq9@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=30"

# 2. Push the Prisma schema (creates all 43 tables)
bun run db:push

# 3. Seed the database (creates the SUPER_ADMIN user, demo data, RBAC permissions)
#    NOTE: This takes ~3-5 minutes over Neon+PgBouncer due to the number of
#    records. The seed script uses createMany for bulk inserts to minimize
#    round-trips.
bun run db:seed
```

**Seed credentials (for testing):**
- **Email:** `admin@mbumahhardware.co.ke`
- **Password:** `password123`
- **Role:** `SUPER_ADMIN`

---

### Step 3: Redeploy Without Build Cache

After updating env vars (Step 1) and confirming the database is seeded (Step 2),
trigger a fresh production deployment. **"Without build cache"** is important — it
ensures the new env vars are picked up and the Prisma Client is regenerated with
the correct `postgresql` provider.

#### Via Vercel Dashboard (recommended)

1. Go to **Vercel Dashboard** → **mbumah-hardware-pos-one** → **Deployments**
2. Click the **"..."** menu on the most recent production deployment
3. Select **"Redeploy"**
4. **UN-check** "Use existing Build Cache" (this is critical!)
5. Click **"Redeploy"**
6. Wait ~2-3 minutes for the build to complete

#### Via Vercel CLI

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Trigger a production redeploy without build cache
vercel --prod --force
```

#### Via Git Push (if you made code changes)

```bash
git add -A
git commit -m "fix: trigger Vercel redeploy with corrected env vars"
git push origin main
# Vercel auto-deploys on push to main
```

#### Verify Step 3

Monitor the build at **Vercel Dashboard** → **mbumah-hardware-pos-one** →
**Deployments**. The build should complete in ~2-3 minutes with status **"Ready"**.

---

### Step 4: Monitor Vercel Function Logs

Once the deployment is "Ready", monitor the function logs for any runtime errors.

#### Via Vercel Dashboard

1. Go to **Vercel Dashboard** → **mbumah-hardware-pos-one** → **Logs**
2. Filter by **"Production"** environment
3. Look for any errors in the first few minutes after deployment

#### Via Vercel CLI

```bash
# Stream production logs in real-time
vercel logs https://mbumah-hardware-pos-one.vercel.app --follow
```

#### What to look for

| Log Pattern | Meaning | Action |
|-------------|---------|--------|
| `POST /api/auth/login 200` | ✅ Login working | None — proceed to Step 5 |
| `POST /api/auth/login 500` | ❌ Still failing | Check the `[AUTH_LOGIN_FATAL_ERROR]` log entry for details |
| `[AUTH_LOGIN_DB_ERROR]` | DB connection issue | Verify `DATABASE_URL` is the pooled Neon URL with `pgbouncer=true` |
| `Can't reach database server at` | DB unreachable | Verify the Neon endpoint is correct and Neon project is active |
| `ENV_VALIDATION_FAILED` | Env var missing/malformed | Check `/api/health/env` for which vars are broken |
| `URL must start with protocol file:` | Prisma provider mismatch | Verify `prisma/schema.prisma` has `provider = "postgresql"` (it does — committed in git) |
| `IMMUTABILITY_VIOLATION` | Financial immutability guard fired | This is expected for direct `update`/`delete` on `JournalEntry` — use `withImmutabilityBypass()` |

---

### Step 5: Test Login (End-to-End Verification)

#### Automated check via curl

```bash
# Test the login endpoint directly
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mbumahhardware.co.ke","password":"password123"}' \
  https://mbumah-hardware-pos-one.vercel.app/api/auth/login | jq
```

**Expected response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "email": "admin@mbumahhardware.co.ke",
      "name": "System Administrator",
      "role": "SUPER_ADMIN",
      "organizationId": "...",
      "storeId": null,
      "isActive": true,
      "organization": { "id": "...", "name": "MBUMAH HARDWARE LTD", "taxPin": "P051XXXXX" },
      "store": null
    },
    "token": "...",
    "expiresAt": "..."
  }
}
```

#### Manual check via browser

1. Open **https://mbumah-hardware-pos-one.vercel.app** in your browser
2. The login page should render (no "Loading..." hang)
3. Enter credentials:
   - **Email:** `admin@mbumahhardware.co.ke`
   - **Password:** `password123`
4. Click **"Sign In"**
5. You should be redirected to the **Dashboard** within ~1 second
6. The dashboard should show:
   - "Karibu, System 👋" greeting
   - KPI cards with live data (Today's Revenue, Transactions, Low Stock, Debt)
   - No "Loading..." spinners that never resolve
   - No error toasts

#### Full smoke test (optional but recommended)

Use **Agent Browser** to verify the golden path:

```bash
agent-browser navigate https://mbumah-hardware-pos-one.vercel.app
agent-browser snapshot
# Verify login page renders
agent-browser click 'input[type="email"]'
agent-browser type 'admin@mbumahhardware.co.ke'
agent-browser click 'input[type="password"]'
agent-browser type 'password123'
agent-browser click 'button[type="submit"]'
agent-browser snapshot
# Verify dashboard renders with data
```

---

## Verification Checklist

After completing all 5 steps, verify:

- [ ] `/api/health/env` returns `status: "ok"` with `hints: []`
- [ ] `/api/health/db` returns `reachable: true` with table counts
- [ ] `/api/health` returns comprehensive health (DB, env, system)
- [ ] `POST /api/auth/login` returns `200` with `success: true`
- [ ] Login page at `https://mbumah-hardware-pos-one.vercel.app` renders without "Loading..." hang
- [ ] Dashboard loads with live KPI data after login
- [ ] No `[AUTH_LOGIN_FATAL_ERROR]` or `[AUTH_LOGIN_DB_ERROR]` in Vercel logs
- [ ] No `Can't reach database server` errors in Vercel logs

---

## Phase 2: Vercel Build & Runtime Compatibility (verified)

All build & runtime compatibility checks pass:

| Component | Status | Details |
|-----------|--------|---------|
| `package.json` `vercel-build` script | ✅ | `"SKIP_ENV_VALIDATION=1 prisma generate && next build"` |
| `vercel.json` `buildCommand` | ✅ FIXED | Changed from `"npm run build"` → `"npm run vercel-build"` to actually invoke the vercel-build script (was being bypassed!) |
| `@vercel/analytics` dependency | ✅ | `^2.0.1` in dependencies |
| `@vercel/speed-insights` dependency | ✅ | `^1.3.1` in dependencies |
| `layout.tsx` `<Analytics />` | ✅ | Imported from `@vercel/analytics/next`, rendered inside `<Providers>` |
| `layout.tsx` `<SpeedInsights />` | ✅ | Imported from `@vercel/speed-insights/next`, rendered inside `<Providers>` |
| Font `preload: false` | ✅ | Both Geist Sans and Geist Mono set to `preload: false` (eliminates Chrome console warning) |
| `force-dynamic` on API routes | ✅ | All **93** API route.ts files have `export const dynamic = 'force-dynamic'` |
| `next.config.ts` `serverExternalPackages` | ✅ | `["@prisma/client"]` — ensures Prisma Client is bundled correctly for serverless |
| `next.config.ts` `typescript.ignoreBuildErrors` | ✅ | `true` — prevents build failure on pre-existing type issues |
| `next.config.ts` `eslint.ignoreDuringBuilds` | ✅ | `true` — prevents build failure on pre-existing lint issues |
| `prisma/schema.prisma` provider | ✅ | `provider = "postgresql"` (committed permanently) |
| `prisma/schema.prisma` directUrl | ✅ | `directUrl = env("DIRECT_URL")` |
| `postinstall` script | ✅ | `bash scripts/setup-prisma-provider.sh && prisma generate` — runs on Vercel install phase |
| `scripts/setup-prisma-provider.sh` default | ✅ | Defaults to `postgresql` when `DATABASE_URL` is unset (critical for Vercel install phase) |

---

## Troubleshooting

### "The token provided is not valid" or "Project not found" (404)

**Cause:** The Vercel API token belongs to a different account than the one that
owns the `mbumah-hardware-pos-one` project.

**Fix:** Create a token from the **project-owning account** (likely the `bucky-ops`
account, matching the GitHub repo owner). Go to
https://vercel.com/account/tokens → create a token with full account access →
use it with `scripts/set-vercel-env.sh`.

You can verify which account a token belongs to:
```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" https://api.vercel.com/v2/user | jq '.user.email'
```

### "Can't reach database server at ep-..."

**Cause:** `DATABASE_URL` points to a dead/unreachable Neon endpoint.

**Fix:** See Step 1 — update `DATABASE_URL` to the `ep-calm-butterfly-aivj6kzm-pooler`
endpoint with `?pgbouncer=true&connect_timeout=15`.

### "URL must start with protocol `file:`"

**Cause:** `prisma/schema.prisma` has `provider = "sqlite"` but `DATABASE_URL` is a
PostgreSQL URL. This was the Cycle G root cause — now permanently fixed (the committed
schema has `provider = "postgresql"` and the setup script defaults to postgresql).

**Fix:** This should not recur. If it does, verify `prisma/schema.prisma` has
`provider = "postgresql"` (not `sqlite`) and that `scripts/setup-prisma-provider.sh`
is running during `postinstall`.

### Login page hangs on "Loading..."

**Cause:** The frontend JavaScript is trying to call `/api/auth/me` or
`/api/dashboard` and the request is hanging (DB unreachable → 500 → frontend
retry loop).

**Fix:** Follow all 5 steps above. The "Loading..." hang resolves once the DB
is reachable and login returns 200.

### "Too many connections" or intermittent 429/502

**Cause:** `DATABASE_URL` is missing the `pgbouncer=true` query param. Without
PgBouncer, each serverless function opens a direct Postgres connection, exhausting
Neon's connection limit.

**Fix:** Append `?pgbouncer=true&connect_timeout=15` to `DATABASE_URL` (and
`?pgbouncer=true&connect_timeout=30` to `DIRECT_URL`). See Step 1.

### Build succeeds but runtime crashes with `PrismaClientInitializationError`

**Cause:** The Prisma Client was generated with the wrong provider (sqlite instead
of postgresql), or `prisma generate` didn't run before `next build`.

**Fix:** This is fixed by the `vercel.json` change in Phase 2 — `buildCommand` is now
`"npm run vercel-build"` which explicitly runs `SKIP_ENV_VALIDATION=1 prisma generate
&& next build`. If it still happens, trigger a redeploy **without build cache** (Step 3).

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel Serverless                         │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Next.js 16  │    │  /api/auth/  │    │  /api/health │  │
│  │  App Router  │───▶│   login      │───▶│   /env /db   │  │
│  │  (force-     │    │  (force-     │    │  (force-     │  │
│  │   dynamic)   │    │   dynamic)   │    │   dynamic)   │  │
│  └──────────────┘    └──────┬───────┘    └──────────────┘  │
│                             │                               │
│                    ┌────────▼────────┐                      │
│                    │  src/lib/env.ts │                      │
│                    │  (lazy Zod      │                      │
│                    │   validation)   │                      │
│                    └────────┬────────┘                      │
│                             │                               │
│                    ┌────────▼────────┐                      │
│                    │  src/lib/db.ts  │                      │
│                    │  (Prisma Client │                      │
│                    │   singleton +   │                      │
│                    │   multi-tenant  │                      │
│                    │   extension)    │                      │
│                    └────────┬────────┘                      │
│                             │                               │
└─────────────────────────────┼───────────────────────────────┘
                              │
                              │  PgBouncer (transaction-mode)
                              │  ?pgbouncer=true&connect_timeout=15
                              │
                    ┌────────▼────────┐
                    │   Neon Postgres │
                    │  ep-calm-       │
                    │  butterfly-     │
                    │  aivj6kzm-      │
                    │  pooler         │
                    └─────────────────┘
```

---

## Quick Reference

| Item | Value |
|------|-------|
| **Production URL** | https://mbumah-hardware-pos-one.vercel.app |
| **GitHub repo** | bucky-ops/mbumah-hardware-pos |
| **Neon endpoint (NEW, working)** | `ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech` |
| **Neon endpoint (OLD, dead)** | `ep-winter-waterfall-a25wj37w-pooler.eu-central-1.aws.neon.tech` |
| **Neon database** | `neondb` |
| **Neon user** | `neondb_owner` |
| **Admin email** | `admin@mbumahhardware.co.ke` |
| **Admin password** | `password123` |
| **Admin role** | `SUPER_ADMIN` |
| **Health: env** | `GET /api/health/env` |
| **Health: db** | `GET /api/health/db` |
| **Health: full** | `GET /api/health` |
| **Env setup script** | `VERCEL_TOKEN=<token> bash scripts/set-vercel-env.sh` |
