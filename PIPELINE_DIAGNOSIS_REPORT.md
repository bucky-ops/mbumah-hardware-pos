# Pipeline Diagnosis Report — Mbumah Hardware POS

**Role:** Principal DevOps Engineer
**Date:** Cycle E (Phase 5)
**Objective:** Diagnose and resolve the Vercel deployment hanging on "Loading…" with intermittent 500 errors.
**Deployment:** `mbumah-hardware-pos-one.vercel.app`
**Source:** `github.com/bucky-ops/mbumah-hardware-pos` (branch `main`)
**Database:** Neon PostgreSQL (`ep-winter-waterfall-a25wj37w-pooler.eu-central-1.aws.neon.tech`)

---

## Executive Summary

The "Loading…" hang is a **frontend symptom** of a **backend 500** on the login or session-validation API. When the frontend's `fetch()` to `/api/auth/*` returns a 500 (or hangs), the React state never transitions out of the loading skeleton, and the user sees an infinite spinner.

After Cycle E Phases 1–4, the build pipeline is now correctly configured (`SKIP_ENV_VALIDATION`, `force-dynamic`, PgBouncer-pooled singleton, idempotent seed, SpeedInsights, health-check endpoints). The **remaining root causes are operational, not code**:

| # | Likely root cause | Probability | Diagnosed by |
|---|---|---|---|
| 1 | Neon DB not seeded (0 users → login 500) | **HIGH** | `/api/health/db` |
| 2 | `DATABASE_URL` is the DIRECT (non-pooler) Neon URL | MEDIUM | `/api/health/env` |
| 3 | Neon DB schema not pushed (tables missing) | MEDIUM | `/api/health/db` |
| 4 | `NEXTAUTH_SECRET` / `JWT_SECRET` not set in Vercel | LOW | `/api/health/env` |
| 5 | Neon database suspended (free-tier auto-suspend) | LOW | `/api/health/db` |

Follow the 5-stage checklist below **in order**. Each stage has a ✅ pass condition and a ❌ fix action.

---

## Stage 1 — GitHub Source Verification

**Goal:** Confirm the deployed code matches `main` and contains the Cycle E fixes.

### Steps
1. Open `https://github.com/bucky-ops/mbumah-hardware-pos` → branch `main`.
2. Confirm the latest commit includes Cycle E changes:
   - `prisma/seed.ts` — has `seedBody()` function + `stage()` helper + `upsert` for org/store/super-admin.
   - `src/app/layout.tsx` — imports `SpeedInsights` from `@vercel/speed-insights/next` and renders `<SpeedInsights />`.
   - `src/app/api/health/db/route.ts` — exists.
   - `src/app/api/health/env/route.ts` — exists.
   - `src/lib/env.ts` — has `console.log('ENV VALIDATION: ', …)` debug line.
   - `package.json` — `vercel-build` = `"node scripts/setup-prisma-provider.mjs && SKIP_ENV_VALIDATION=1 prisma generate && SKIP_ENV_VALIDATION=1 next build"` and `@vercel/speed-insights` in `dependencies`.
3. Confirm `prisma/schema.prisma` line 20 reads `provider = "sqlite"` (correct — auto-switched to `postgresql` by `setup-prisma-provider.mjs` during Vercel build).

### ✅ Pass condition
All 6 files present and match the descriptions above.

### ❌ Fix action
```bash
git add -A && git commit -m "Cycle E: pipeline diagnosis fixes (seed hardening, SpeedInsights, health routes)" && git push origin main
```
Then wait ~2 min for Vercel to auto-deploy.

---

## Stage 2 — Vercel Build & Environment Verification

**Goal:** Confirm the Vercel build succeeds and all required env vars are set.

### 2a. Build log
1. Vercel dashboard → `mbumah-hardware-pos-one` → Deployments → latest (Production).
2. Click **Building** / **Ready** → scroll the **Build Log**.
3. Confirm these lines appear:
   - `[setup-prisma-provider] Switched provider: "sqlite" → "postgresql"` (or `Provider already "postgresql"`)
   - `ENV VALIDATION: SKIPPED (build phase — process.env cast without Zod)` ← from `src/lib/env.ts`
   - `prisma:generate` completed
   - `Next.js (Build)` → `✓ Compiled successfully` / `✓ Building pages` / `✓ Collecting page data`
4. Confirm deployment status = **Ready** (not Error).

### 2b. Environment variables
1. Vercel dashboard → Settings → Environment Variables.
2. Confirm the following exist for **Production** (and **Preview** if you use preview deploys):

| Variable | Required | Value hint |
|---|---|---|
| `DATABASE_URL` | ✅ YES | `postgresql://…-pooler…?pgbouncer=true&connect_timeout=15` (must contain `-pooler`) |
| `DIRECT_URL` | recommended | `postgresql://…` (NON-pooler, for migrations) |
| `NEXTAUTH_SECRET` | ✅ YES | ≥ 32 chars (generate: `openssl rand -base64 32`) |
| `JWT_SECRET` | ✅ YES | ≥ 32 chars |
| `NEXTAUTH_URL` | optional | `https://mbumah-hardware-pos-one.vercel.app` |
| `EXPOSE_ERRORS` | optional | `true` for debugging ONLY — **remove for production** |
| `ALLOW_DEV_BYPASS` | optional | `true` enables `/api/auth/dev-bypass` — **remove for production** |

3. **Critical:** `DATABASE_URL` MUST contain `-pooler` in the hostname. If it does not, you are using the direct connection, which will exhaust Neon's ~20-connection limit under serverless load → intermittent 500s.

### ✅ Pass condition
Build status = Ready AND all ✅-required vars are set AND `DATABASE_URL` contains `-pooler`.

### ❌ Fix action
- Missing vars: add them in Vercel → Settings → Environment Variables, then **Redeploy**.
- Wrong `DATABASE_URL` (no `-pooler`): copy the **Pooled connection** string from the Neon dashboard (`ep-winter-waterfall-a25wj37w-pooler.eu-central-1.aws.neon.tech`), set it as `DATABASE_URL`, keep the non-pooled as `DIRECT_URL`.
- Build error: download the build log, search for `ENV VALIDATION:` and `Error:`.

---

## Stage 3 — Neon Database Verification

**Goal:** Confirm the Neon database is reachable, the schema is pushed, and the seed data exists.

### 3a. Neon dashboard
1. Neon dashboard → your project → check the database is **Active** (not suspended). Free-tier Neons auto-suspend after inactivity; the first query wakes them (adds ~3s latency).
2. Confirm the connection string in Neon matches Vercel's `DATABASE_URL` (pooled) and `DIRECT_URL` (non-pooled).

### 3b. Schema presence
1. Neon dashboard → SQL Editor → run:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
   ```
2. Confirm tables exist: `organizations`, `stores`, `users`, `products`, `sales_transactions`, `sessions`, etc. (40+ tables).

### 3c. Seed data presence
1. In Neon SQL Editor, run:
   ```sql
   SELECT COUNT(*) AS users FROM users;
   SELECT COUNT(*) AS orgs FROM organizations;
   SELECT email, role FROM users WHERE role = 'SUPER_ADMIN';
   ```
2. Confirm: `users` ≥ 10, `orgs` = 1, and a SUPER_ADMIN row exists with `email = 'admin@mbumahhardware.co.ke'`.

### ✅ Pass condition
Database is Active, 40+ tables exist, `users` ≥ 10, SUPER_ADMIN row exists.

### ❌ Fix action

**If tables are missing (schema not pushed):**
```bash
# Locally, set DATABASE_URL to the Neon NON-pooled URL (DIRECT_URL) for migrations:
export DATABASE_URL="postgresql://...NON-POOLER...?sslmode=require"
bun run db:push
# This runs: node scripts/setup-prisma-provider.mjs && prisma db push
```
Or, on Vercel: add a `postbuild` script `prisma db push` (uses `DIRECT_URL`), or run `prisma db push` via the Vercel CLI:
```bash
vercel env pull .env.production.local
npx prisma db push --schema prisma/schema.prisma
```

**If tables exist but are empty (seed not run):**
```bash
# Locally, set DATABASE_URL to the Neon POOLED URL:
export DATABASE_URL="postgresql://...-pooler...?pgbouncer=true&connect_timeout=15"
bun run db:seed
```
The hardened seed (Cycle E Phase 2) is now idempotent — re-running it on a partially-seeded DB will upsert the foundation records and continue. If it fails mid-way, it logs the error and exits 0 (the DB retains whatever was seeded).

**If the database is suspended:**
- Make any query to wake it (the health endpoint will do this). Or upgrade to a Neon tier that doesn't auto-suspend.

---

## Stage 4 — Runtime Health Check Verification

**Goal:** Use the new health endpoints to pinpoint the exact failure mode.

### 4a. Environment health
```bash
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/env | python3 -m json.tool
```
**Expected on a healthy deploy:**
```json
{
  "status": "ok",
  "missing": [],
  "variables": {
    "DATABASE_URL": { "set": true, "length": 92, "preview": "postgresql…-pool", "notes": ["Pooled Neon PostgreSQL URL ✓"] },
    "NEXTAUTH_SECRET": { "set": true, "length": 44 },
    "JWT_SECRET": { "set": true, "length": 44 },
    ...
  },
  "hints": []
}
```
**If `status` is `error`:** the `missing[]` array lists exactly which required vars are absent. Fix in Vercel → Settings → Environment Variables → Redeploy.
**If `hints[]` contains `⚠️`:** non-fatal warnings (e.g. `EXPOSE_ERRORS` is on). Address before production launch.

### 4b. Database health
```bash
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/db | python3 -m json.tool
```
**Expected on a healthy deploy:**
```json
{
  "status": "ok",
  "reachable": true,
  "counts": { "organizations": 1, "stores": 5, "users": 10, "products": 150, "salesTransactions": 80 },
  "detail": "Database healthy: 1 org(s), 10 user(s).",
  "responseTime": 45
}
```
**If `status` is `error` with `reachable: false`:** `DATABASE_URL` is wrong, Neon is suspended, or the pool is exhausted. See Stage 3.
**If `status` is `error` with `counts[X] = { error: ... }`:** the schema was not pushed (table missing). See Stage 3 ❌ fix.
**If `status` is `degraded` with `users: 0`:** the DB is reachable but not seeded. See Stage 3 ❌ fix (run `db:seed`).

### 4c. Comprehensive health
```bash
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health | python3 -m json.tool
```
This returns the full picture (env + DB + DB stats + security + account security). Use this as the "all-in-one" smoke test.

### ✅ Pass condition
All three endpoints return HTTP 200 with `status: "ok"` (or `healthy`).

### ❌ Fix action
Follow the `detail` / `hints` fields in the JSON response — they are written to be self-diagnosing.

---

## Stage 5 — Functional Verification (End-to-End)

**Goal:** Confirm the user can actually log in and use the POS.

### 5a. Login flow
1. Open `https://mbumah-hardware-pos-one.vercel.app` in a private window.
2. **Expected:** Login page renders within 2s (no "Loading…" spinner that never resolves).
3. Enter credentials:
   - Email: `admin@mbumahhardware.co.ke`
   - Password: `password123`
4. Click **Sign In**.
5. **Expected:** Dashboard renders with "Karibu, System 👋" and the 10-item sidebar.

### 5b. Dev bypass (Preview deployments only)
If `ALLOW_DEV_BYPASS=true` or `VERCEL_ENV=preview`:
1. On the login page, an amber **"Dev Bypass (Super Admin)"** button should appear.
2. Click it → dashboard renders as SUPER_ADMIN.
3. If the button does NOT appear: `curl https://…/api/auth/dev-bypass?probe=1` → confirm `{"enabled": true}`.

### 5c. Core API smoke test
```bash
TOKEN=$(curl -s -X POST https://mbumah-hardware-pos-one.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@mbumahhardware.co.ke","password":"password123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s https://mbumah-hardware-pos-one.vercel.app/api/dashboard \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20
```
**Expected:** `{"success": true, "data": {...}}` with dashboard metrics.

### 5d. Vercel function logs
If any of the above 500s:
1. Vercel dashboard → project → **Logs** (or Runtime Logs).
2. Filter by `Status = 5xx` or search for `ENV VALIDATION:`.
3. The `ENV VALIDATION:` log line tells you whether Zod validation ran at runtime (should say `RUNNING`).
4. The error stack will show the exact Prisma query or env access that failed.

### ✅ Pass condition
Login succeeds, dashboard renders, `/api/dashboard` returns 200 with data, zero 5xx in Vercel logs.

### ❌ Fix action
- **Login 500 with "no active SUPER_ADMIN user found":** DB not seeded → Stage 3 ❌ fix.
- **Login 500 with Prisma error "no such table" or "relation does not exist":** schema not pushed → Stage 3 ❌ fix.
- **Login 500 with "Can't reach database server":** `DATABASE_URL` wrong or Neon suspended → Stage 2b/3.
- **Login hangs (no response):** connection pool exhausted → confirm `DATABASE_URL` has `-pooler` → Stage 2b.
- **Env validation error:** `SKIP_ENV_VALIDATION` not propagating → confirm `package.json` `vercel-build` script → Stage 1.

---

## Appendix A — The "Loading…" Hang Root Cause Chain

```
User opens https://mbumah-hardware-pos-one.vercel.app
  ↓
Frontend JS loads, renders <LoginScreen /> or <DashboardSkeleton />
  ↓
Frontend calls fetch('/api/auth/session', { headers: { Authorization: 'Bearer ...' } })
  ↓
/api/auth/session handler calls db.user.findUnique(...)
  ↓
┌─ If DB unreachable ──────────────────────────────────────┐
│  Prisma throws → 500 → frontend stays on "Loading…"      │
│  Fix: /api/health/db → reachable:false → Stage 3         │
└──────────────────────────────────────────────────────────┘
┌─ If DB reachable but empty ──────────────────────────────┐
│  Token validation fails → 401 → frontend shows login     │
│  User logs in → /api/auth/login → user not found → 500   │
│  OR user found but passwordHash mismatch → 423           │
│  Fix: /api/health/db → users:0 → Stage 3 (seed)          │
└──────────────────────────────────────────────────────────┘
┌─ If NEXTAUTH_SECRET missing ─────────────────────────────┐
│  env.ts validateOrThrow throws at module load → 500      │
│  Every API route 500s → frontend stays on "Loading…"     │
│  Fix: /api/health/env → missing:['NEXTAUTH_SECRET']      │
└──────────────────────────────────────────────────────────┘
┌─ If DATABASE_URL is non-pooled ──────────────────────────┐
│  First few requests OK, then pool exhausted → 500s       │
│  Intermittent "Loading…" that works on refresh           │
│  Fix: /api/health/env → notes:['NOT pooled'] → Stage 2b  │
└──────────────────────────────────────────────────────────┘
```

## Appendix B — Cycle E Change Manifest

| Phase | File | Change |
|---|---|---|
| 1 | `src/lib/env.ts` | Added `console.log('ENV VALIDATION: …')` debug line (server-only). |
| 1 | `package.json` | Verified `vercel-build` script intact (kept `setup-prisma-provider.mjs` prefix — critical for provider switch). |
| 1 | `src/lib/db.ts` | Verified globalThis singleton + PgBouncer comments intact. |
| 1 | All 92 API routes | Verified `export const dynamic = 'force-dynamic'` (0 missing). |
| 2 | `prisma/schema.prisma` | Verified `provider = "sqlite"` (auto-switched to `postgresql` on Vercel). |
| 2 | `prisma/seed.ts` | Hardened: `stage()` progress helper, foundation records (org/stores/super-admin) use `upsert`, entire body wrapped in try/catch with graceful exit + stage summary. |
| 3 | `src/app/layout.tsx` | Added `<SpeedInsights />` import + render (Analytics was already wired). |
| 3 | `package.json` | Added `@vercel/speed-insights` dependency. |
| 4 | `src/app/api/health/db/route.ts` | **NEW** — DB connectivity + foundation-data presence check. |
| 4 | `src/app/api/health/env/route.ts` | **NEW** — env var presence + validity check (pooled URL detection, secret strength). |
| 4 | `src/middleware.ts` | Added `pathname.startsWith('/api/health/')` to public-path whitelist (was exact-match only). |
| 5 | `PIPELINE_DIAGNOSIS_REPORT.md` | **NEW** — this document. |

## Appendix C — Quick Triage Command

Run this single block to get the full diagnosis in ~5 seconds:

```bash
echo "=== ENV ===" && \
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/env | python3 -m json.tool && \
echo "=== DB ===" && \
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/db | python3 -m json.tool && \
echo "=== FULL ===" && \
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health | python3 -m json.tool
```

The `status` field on each response tells you immediately which stage of this report to follow.
