# Vercel Deployment Recovery Guide — Mbumah Hardware POS

This guide walks you through diagnosing and recovering from production 500
errors on Vercel, with specific focus on the `POST /api/auth/login` and
`GET /api/dashboard` routes that previously crashed with a 51ms 500.

---

## Table of Contents

1. [Quick Triage Checklist](#1-quick-triage-checklist)
2. [The 51ms 500 — Root Cause & Fix](#2-the-51ms-500--root-cause--fix)
3. [Environment Variables — Required Set](#3-environment-variables--required-set)
4. [Database Connection Pooling (Neon / Supabase)](#4-database-connection-pooling-neon--supabase)
5. [Step-by-Step Recovery Procedure](#5-step-by-step-recovery-procedure)
6. [Post-Deployment Smoke Test](#6-post-deployment-smoke-test)
7. [Common Failure Modes & Fixes](#7-common-failure-modes--fixes)
8. [Rollback Procedure](#8-rollback-procedure)

---

## 1. Quick Triage Checklist

When a 500 appears in production, run through this checklist in order —
each step takes < 30 seconds and narrows the blast radius:

- [ ] **Check Vercel function logs** — Project → Functions → filter by
      `500` status. Look for the error message in the first 5 lines.
- [ ] **Check `DATABASE_URL`** — Project → Settings → Environment
      Variables → confirm `DATABASE_URL` is set for **Production** and
      points to the **pooled** connection string (ends in `-pooler` on
      Neon, port `6543` on Supabase).
- [ ] **Check function region** — Settings → Functions → must match the
      database region (Neon: `sin1`/`iad1`; Supabase: `ap-southeast-1`).
- [ ] **Check recent deploys** — did the 500 start after a specific
      commit? Click "Deployments" → compare the failing deploy with the
      last known-good one.
- [ ] **Check `.env` parity** — run `diff <(sort .env.local) <(sort .env.production)`
      locally to spot any key that exists locally but not in Vercel.

---

## 2. The 51ms 500 — Root Cause & Fix

### Symptom

```
POST /api/auth/login  500  51ms
GET  /api/dashboard   500  51ms
```

A 51ms response time is the signature of a **module-load crash** — the
serverless function never reached the handler; it threw during `import`
evaluation. The two most common causes:

### Root Cause A: Missing / malformed `DATABASE_URL`

The Prisma Client instantiates at module load. If `DATABASE_URL` is
missing, empty, or not a `postgresql:` / `file:` URL, Prisma throws an
opaque error that Vercel surfaces as a 500 before the handler runs.

**Fix (already shipped):** `src/lib/db.ts` now validates `DATABASE_URL`
**eagerly** at module load with a descriptive boxed error:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 FATAL: DATABASE_URL is not set.

 The Prisma Client cannot connect to the database.

 • Local dev:   create a `.env` file with DATABASE_URL="file:./prisma/dev.db"
 • Vercel prod: Project Settings → Environment Variables → add DATABASE_URL
               using the POOLED / PgBouncer connection string
               (append ?pgbouncer=true&connection_limit=1).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Additionally, `src/lib/env.ts` (Zod validator) cross-checks `DATABASE_URL`
and the auth secrets (`NEXTAUTH_SECRET`, `JWT_SECRET`, `NEXTAUTH_URL`) and
throws an `EnvValidationError` listing every missing key in one shot.

### Root Cause B: Font preload warning (`unused preloaded font`)

**Not a crash** — a Chrome console warning caused by `Geist_Mono` being
preloaded but not used on the login screen. Fixed in `src/app/layout.tsx`
by setting `Geist_Mono` to `preload: false` (the mono font is only used in
receipts / serial numbers, not on the first-screen surface).

### Root Cause C: Missing `<Analytics/>` / `<SpeedInsights/>` scripts

`@vercel/analytics` and `@vercel/speed-insights` inject scripts that
resolve to `/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js`.
On Vercel these are served by the edge; locally they 404 (harmless). Both
are now imported in `src/app/layout.tsx` inside `<body>`.

---

## 3. Environment Variables — Required Set

| Key | Required | Example | Notes |
|-----|----------|---------|-------|
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?pgbouncer=true&connection_limit=1` | **Must be the pooled URL.** See [§4](#4). |
| `NEXTAUTH_SECRET` | Yes (auth) | `openssl rand -base64 32` | Signs NextAuth session JWTs. |
| `NEXTAUTH_URL` | Yes (auth) | `https://mbumah-hardware-pos-one.vercel.app` | Canonical production URL. |
| `JWT_SECRET` | Yes (auth) | `openssl rand -base64 32` | Signs the custom token from `/api/auth/login`. |
| `NODE_ENV` | Auto | `production` | Set automatically by Vercel. |

### Setting them on Vercel

1. Project → **Settings** → **Environment Variables**.
2. Add each key for **Production**, **Preview**, and **Development**
   (or just Production if Preview/Dev use different values).
3. **Redeploy** — environment variables are baked at build time; a
   redeploy is required after adding/changing them.

> **Security:** Never commit `.env` to git. The `.env.example` file lists
> the required keys with placeholder values.

---

## 4. Database Connection Pooling (Neon / Supabase)

Serverless functions open a new connection per invocation. Without
PgBouncer pooling, you will exhaust the Postgres connection limit
(typically 20 on Neon free tier) and see intermittent `429` / `502` /
"too many connections" errors.

### Neon (recommended)

1. Neon Dashboard → your project → **Connection Details**.
2. Select **Pooled connection** (the URL ends in `-pooler`).
3. Append `?pgbouncer=true&connection_limit=1` to the URL.
4. Paste into Vercel as `DATABASE_URL`.

```
postgresql://user:pass@ep-cool-name-pooler.us-east-2.aws.neon.tech/neondb?pgbouncer=true&connection_limit=1
```

### Supabase

1. Supabase Dashboard → Project → **Settings** → **Database**.
2. Under **Connection string**, select **Transaction** pooler (port `6543`).
3. Append `?pgbouncer=true&connection_limit=1`.
4. Paste into Vercel as `DATABASE_URL`.

```
postgresql://postgres.[project]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

### Why `connection_limit=1`?

Each serverless function instance holds **at most one** connection.
PgBouncer multiplexes it across many concurrent invocations. Setting
`connection_limit=1` per function + PgBouncer's own pool gives you the
best concurrency-to-connection ratio.

---

## 5. Step-by-Step Recovery Procedure

Follow this exact sequence to recover from a production 500:

### Step 1 — Confirm the root cause

```bash
# Clone the latest main and reproduce locally
git clone https://github.com/<org>/mbumah-hardware-pos.git
cd mbumah-hardware-pos
bun install
cp .env.example .env
# Fill in DATABASE_URL (use the POOLED string from your provider)
bun run dev
```

If the app boots locally, the issue is **environment-specific to Vercel**
(go to Step 2). If it crashes locally, fix the local `.env` first.

### Step 2 — Verify Vercel env vars

```bash
# Install the Vercel CLI
npm i -g vercel

# Link the project (one-time)
vercel link

# Pull the current production env vars into .vercel/.env.development.local
vercel env pull .vercel/.env.development.local --environment=production

# Inspect — is DATABASE_URL the POOLED string?
grep DATABASE_URL .vercel/.env.development.local
```

If `DATABASE_URL` is missing or not the pooled URL:

```bash
# Remove the bad value
vercel env rm DATABASE_URL production
vercel env rm DATABASE_URL preview
vercel env rm DATABASE_URL development

# Add the correct pooled URL
echo -n "postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?pgbouncer=true&connection_limit=1" | vercel env add DATABASE_URL production
echo -n "..." | vercel env add DATABASE_URL preview
echo -n "..." | vercel env add DATABASE_URL development
```

### Step 3 — Redeploy

```bash
# Trigger a production deploy from the CLI
vercel --prod

# OR push to main (if auto-deploy is on)
git push origin main
```

### Step 4 — Monitor the deploy

```bash
# Stream the build + deployment logs
vercel logs [deployment-url] --follow
```

Watch for:
- `✓ Compiled` (build success)
- `✓ Deployed` (functions uploaded)
- Any `Error:` or `FATAL:` in the first 10 seconds of warm-up

### Step 5 — Hit the smoke endpoints

```bash
# Health check (no DB required)
curl https://mbumah-hardware-pos-one.vercel.app/api/health

# Login (exercises DATABASE_URL + bcrypt + JWT)
curl -X POST https://mbumah-hardware-pos-one.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mbumahhardware.co.ke","password":"YOUR_PASSWORD"}'

# Dashboard (exercises tenant-scoped Prisma queries)
curl -H "Authorization: Bearer <TOKEN>" \
  "https://mbumah-hardware-pos-one.vercel.app/api/dashboard?storeId=store_juja_main"
```

All three should return `200` with JSON. If any returns `500`, go to
[§7](#7-common-failure-modes--fixes).

---

## 6. Post-Deployment Smoke Test

After a successful deploy, run this checklist manually (or via
`agent-browser`):

1. **Login** — Super Admin can log in at `/`.
2. **Dashboard** — Today's Revenue KPI loads (not `Ksh0` / `NaN`).
3. **POS** — Products appear in the catalog grid.
4. **Checkout** — A cash sale completes and a receipt is generated.
5. **Journal Entry** — The sale created a balanced JE (check the
   Financial tab → Journal Entries).
6. **Offline mode** — Toggle `navigator.onLine` to `false` in DevTools;
   the badge should switch to "Offline Mode". A checkout should save
   locally and show "pending sync(s)".
7. **Analytics** — View page source; confirm `/_vercel/insights/script.js`
   and `/_vercel/speed-insights/script.js` are injected (they'll 200 on
   Vercel, 404 locally — both are fine).

---

## 7. Common Failure Modes & Fixes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `500` in 51ms on every route | `DATABASE_URL` missing/malformed | Set the **pooled** URL in Vercel env vars (see [§4](#4)). |
| `500` after 5-10s on login | Prisma connection timeout | Add `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`. |
| `429 Too Many Requests` | Connection pool exhausted | Same as above — pooling is required for serverless. |
| `PrismaClientInitializationError` | Schema drift (DB ≠ `schema.prisma`) | Run `bun run db:push` locally against the prod DB, or trigger a migration. |
| `IMMUTABILITY_VIOLATION` | App code tried to `update`/`delete` a JE/JEL/SystemLog | Wrap the sanctioned mutation in `withImmutabilityBypass(fn, reason)` — see `src/lib/db.ts`. |
| `ENV_VALIDATION_FAILED` | Missing `NEXTAUTH_SECRET` / `JWT_SECRET` | Generate with `openssl rand -base64 32` and add to Vercel. |
| Hydration mismatch in console | Server/client render divergence | Check `suppressHydrationWarning` on `<html>`; ensure `next-themes` is wrapped in `<Providers>`. |
| `unused preloaded font` warning | `Geist_Mono` preloaded but unused | Already fixed — `preload: false` in `layout.tsx`. |

---

## 8. Rollback Procedure

If a deploy is broken and you need to revert immediately:

### Via Vercel Dashboard

1. Project → **Deployments**.
2. Find the last known-good deploy (green checkmark).
3. Click the `⋯` menu → **Promote to Production**.

The rollback is instant — Vercel switches the production alias to the
previous deployment's functions. No rebuild needed.

### Via Vercel CLI

```bash
# List recent deployments
vercel ls

# Promote a specific deployment URL to production
vercel promote <deployment-url>
```

### Via Git

```bash
# Revert the offending commit and force-push
git revert <bad-commit-sha>
git push origin main

# Vercel auto-deploys the revert
```

> **Note:** Rollback reverts the **code** but not the **database**. If the
> bad deploy ran a Prisma migration, you'll need to manually roll back the
> schema with `prisma migrate resolve --rolled-back`.

---

## Appendix — Architecture Diagram (text)

```
┌─────────────────────────────────────────────────────────────┐
│                      Vercel (Edge + Serverless)              │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │ Next.js App  │   │ /api/auth/*  │   │ /api/*       │    │
│  │ (SSR/RSC)    │   │ (login)      │   │ (dashboard,  │    │
│  │              │   │              │   │  POS, etc.)  │    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘    │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                            │                                 │
│                   ┌────────▼────────┐                        │
│                   │ src/lib/env.ts  │ ← Zod eager validation │
│                   │ src/lib/db.ts   │ ← Prisma + multi-tenant│
│                   │                 │   + immutability guard │
│                   └────────┬────────┘                        │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │
                             │  (pooled, ?pgbouncer=true&connection_limit=1)
                             │
                   ┌────────▼────────┐
                   │  Neon / Supabase│
                   │  Postgres       │
                   │  (PgBouncer)    │
                   └─────────────────┘
```

---

*Last updated: 2026-06-25 — reflects the Step 2 (Phase 3/4/5) enterprise
upgrade. For questions, contact the system administrator.*
