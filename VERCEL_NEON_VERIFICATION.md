# Verifying Vercel-Neon Connection for Mbumah POS

This document walks you through verifying that your Vercel deployment is correctly connected to the Neon PostgreSQL database, and that the application will load successfully (no more "Loading..." hang).

---

## Step 1: Check Vercel Environment Variables

Go to **Vercel Dashboard** → Your Project (`mbumah-hardware-pos-one`) → **Settings** → **Environment Variables**.

Verify the following variables are set for the **Production** environment:

| Variable | Required | Expected Value |
|---|---|---|
| `DATABASE_URL` | ✅ YES | `postgresql://neondb_owner:npg_aRfWJIn8Neq9@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15` |
| `DIRECT_URL` | ✅ YES | `postgresql://neondb_owner:npg_aRfWJIn8Neq9@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=30` |
| `NEXTAUTH_SECRET` | ✅ YES | A random string ≥ 32 characters (generate with `openssl rand -base64 32`) |
| `JWT_SECRET` | ✅ YES | A random string ≥ 32 characters (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Optional | `https://mbumah-hardware-pos-one.vercel.app` |

**Critical checks for `DATABASE_URL`:**
- The hostname MUST contain `-pooler` (this routes through Neon's PgBouncer connection pooler).
- The query string MUST contain `pgbouncer=true` (tells Prisma to use PgBouncer-compatible mode).
- The query string SHOULD contain `connect_timeout=15` (handles Neon cold-start latency).

> ⚠️ **If `DATABASE_URL` does NOT contain `-pooler`:** You are using the direct connection, which will exhaust Neon's ~20-connection limit under serverless load. Copy the **Pooled connection** string from the Neon dashboard instead.

**Other Neon variables** (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`): These are set automatically by the Neon Vercel integration. They are NOT used by the application directly — `DATABASE_URL` is sufficient. Do not delete them, but they don't need manual verification.

---

## Step 2: Identify Neon Production Branch

The Neon GitHub integration creates branches for Pull Requests automatically. The `main` branch deployment on Vercel uses the **main/primary branch** in Neon.

1. Log into your **Neon Console** → select your project.
2. Go to **Branches** → identify the branch named `main` (or `primary`).
3. Confirm the hostname in the connection string matches `ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech`.
4. This is your **production branch** — all schema changes and seeds should target this branch.

> **Note:** The `DATABASE_URL` in Vercel points to this branch's pooled connection endpoint. Any changes you make to the Vercel env vars will affect this branch.

---

## Step 3: Push Schema & Seed Locally

Open your local terminal in the project directory. Ensure your local `.env` file has the **exact same `DATABASE_URL`** as set in Vercel (pointing to the production branch identified in Step 2).

```bash
# Verify your .env has the Neon pooled URL:
cat .env | grep DATABASE_URL
# Expected output:
# DATABASE_URL="postgresql://neondb_owner:npg_aRfWJIn8Neq9@ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15"

# Push the Prisma schema (creates all 43 tables in your Neon PRODUCTION branch)
# This has ALREADY been done — 43 tables exist on Neon.
npx prisma db push

# Seed the database with demo data (users, products, customers, etc.) on the PRODUCTION branch
# This has ALREADY been done — 12 users, 236 permissions, 26 categories, 51 products, 15 customers exist.
npx prisma db seed
```

> **Note:** The seed script uses `createMany` for bulk inserts (permissions, products, customers) for Neon+PgBouncer compatibility. It also uses `upsert` for foundation records (org, stores, super admin) so re-running is idempotent. The entire seed is wrapped in a try/catch with stage-by-stage progress logging.

**Seed credentials:**
- Email: `admin@mbumahhardware.co.ke`
- Password: `password123`
- Role: `SUPER_ADMIN`

---

## Step 4: Redeploy Vercel

Go back to the **Vercel Dashboard**:

1. Navigate to your project → **Deployments**.
2. Find the latest deployment on the `main` branch.
3. Click the **⋯** menu → **Redeploy**.
4. Ensure "Use existing Build Cache" is **unchecked** (to pick up the code fixes).
5. Click **Redeploy**.

**What the build will do** (per the updated `vercel-build` script):
```bash
SKIP_ENV_VALIDATION=1 prisma generate && next build
```
- `SKIP_ENV_VALIDATION=1 prisma generate` — generates the Prisma Client for PostgreSQL (schema.prisma has `provider = "postgresql"`).
- `next build` — builds the Next.js app. The `SKIP_ENV_VALIDATION` pattern + `NEXT_PHASE` detection in `src/lib/env.ts` ensures the build doesn't crash on missing runtime secrets.

**Expected build log lines:**
```
[setup-prisma-provider] Provider already "postgresql". No change needed.  (if postinstall runs)
ENV VALIDATION: SKIPPED (build phase — process.env cast without Zod)
✔ Generated Prisma Client (v6.19.2)
✓ Compiled successfully
✓ Building pages
✓ Collecting page data
```

---

## Step 5: Verify Application Load

Visit **`https://mbumah-hardware-pos-one.vercel.app`**.

**Expected behavior:**
1. The login page renders within 2-3 seconds (no infinite "Loading..." spinner).
2. Enter credentials:
   - Email: `admin@mbumahhardware.co.ke`
   - Password: `password123`
3. Click **Sign In to Dashboard**.
4. The dashboard renders with:
   - "Karibu, System 👋" greeting
   - 10-item sidebar (POS, Catalog, Inventory, Customers, Transactions, Rentals, Financial, Reports, Suppliers, Gift Cards, Admin)
   - Dashboard metrics cards (may show 0 for transactions if demo sales data wasn't fully seeded)

**Check browser DevTools Console:**
- No red errors (hydration mismatches, API 500s, etc.)
- Network tab: all `/api/*` requests return 200 (no 500s)

**If the app still hangs on "Loading...":**
1. Open DevTools → Network tab → look for the failing request (likely `/api/auth/session` or `/api/dashboard` returning 500).
2. Run the health check endpoints (Step 6) to diagnose.
3. Check Vercel function logs (Vercel Dashboard → Logs) for the error stack trace.

---

## Step 6: Verify Database Connection (Neon Console)

### 6a. Check Neon Activity Logs
1. In the **Neon Console**, navigate to the production branch (identified in Step 2).
2. Go to the **Activity** tab.
3. Look for connection logs from Vercel (timestamped near the redeployment time).
4. You should see active connections from Vercel's serverless functions.

### 6b. Verify Seed Data via SQL Editor
1. In the Neon Console, go to the **SQL Editor** tab.
2. Run these queries to verify the seed data:

```sql
-- Count key tables
SELECT COUNT(*) AS users FROM "User";
SELECT COUNT(*) AS stores FROM "Store";
SELECT COUNT(*) AS products FROM "Product";
SELECT COUNT(*) AS categories FROM "ProductCategory";
SELECT COUNT(*) AS customers FROM "Customer";
SELECT COUNT(*) AS permissions FROM "RolePermission";

-- Verify the Super Admin exists
SELECT email, name, role FROM "User" WHERE role = 'SUPER_ADMIN';
```

**Expected results:**
| Query | Count |
|---|---|
| users | 12 |
| stores | 5 |
| products | 51 |
| categories | 26 |
| customers | 15 |
| permissions | 236 |

**Super Admin row:**
| email | name | role |
|---|---|---|
| admin@mbumahhardware.co.ke | System Administrator | SUPER_ADMIN |

### 6c. Verify via Health Endpoints

Run these `curl` commands against your Vercel deployment:

```bash
# Check environment variables are set correctly
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/env | python3 -m json.tool

# Check database connectivity and data
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/db | python3 -m json.tool
```

**Expected `/api/health/env` response:**
```json
{
  "status": "ok",
  "missing": [],
  "variables": {
    "DATABASE_URL": {
      "set": true,
      "preview": "postgresql:/…t=15",
      "notes": ["Pooled Neon PostgreSQL URL ✓"]
    },
    "NEXTAUTH_SECRET": { "set": true, "length": 44 },
    "JWT_SECRET": { "set": true, "length": 44 }
  },
  "hints": []
}
```

**Expected `/api/health/db` response:**
```json
{
  "status": "ok",
  "reachable": true,
  "counts": {
    "organizations": 1,
    "stores": 5,
    "users": 12,
    "products": 51,
    "salesTransactions": 0
  },
  "detail": "Database healthy: 1 org(s), 12 user(s)."
}
```

---

## Step 7: Verify Vercel Analytics

1. Open `https://mbumah-hardware-pos-one.vercel.app` in your browser.
2. Open **DevTools** → **Network** tab.
3. Reload the page.
4. Search for `/_vercel/insights/view` in the Network tab.
5. You should see a POST request to `/_vercel/insights/view` returning HTTP 202 (Accepted).

**Also verify Vercel SpeedInsights:**
- Search for `/_vercel/speed-insights` in the Network tab.
- You should see a script request and a subsequent POST to `/_vercel/speed-insights` with performance metrics.

**If Analytics/SpeedInsights requests are missing:**
- Verify `<Analytics />` and `<SpeedInsights />` are in `src/app/layout.tsx` (they are, as of this commit).
- Verify `@vercel/analytics` and `@vercel/speed-insights` are in `package.json` dependencies (they are).
- Check that the build didn't tree-shake them (they should appear in the production bundle).

---

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| "Loading..." hang on page load | DB not seeded (0 users → login 500) | Run `npx prisma db seed` with the Neon `DATABASE_URL` |
| Login returns 500 | `DATABASE_URL` not set in Vercel env | Add `DATABASE_URL` to Vercel → Settings → Environment Variables |
| Build crashes on `prisma generate` | `SKIP_ENV_VALIDATION` not propagating | Verify `vercel-build` script in `package.json` |
| Build crashes on `next build` | Missing `NEXT_PHASE` detection | Verify `src/lib/env.ts` has the two-layer build-time detection |
| Intermittent 500s under load | `DATABASE_URL` is non-pooled (no `-pooler`) | Use the pooled Neon URL with `?pgbouncer=true` |
| "no such table" errors | Schema not pushed to Neon | Run `npx prisma db push` with the Neon `DATABASE_URL` |
| Seed fails at RBAC permissions | Using individual upserts (slow) | Already fixed — seed uses `createMany` with `skipDuplicates` |
| Login 401 (not 500) | DB seeded but wrong password | Verify seed credentials: `admin@mbumahhardware.co.ke` / `password123` |

---

## Verification Checklist Summary

- [ ] **Step 1:** `DATABASE_URL` in Vercel contains `-pooler` and `pgbouncer=true`
- [ ] **Step 1:** `NEXTAUTH_SECRET` and `JWT_SECRET` set in Vercel (≥ 32 chars)
- [ ] **Step 2:** Neon production branch identified (`ep-calm-butterfly-aivj6kzm`)
- [ ] **Step 3:** Schema pushed (43 tables) — ✅ already done
- [ ] **Step 3:** Database seeded (12 users, 51 products, 15 customers) — ✅ already done
- [ ] **Step 4:** Vercel redeployed successfully (build status = Ready)
- [ ] **Step 5:** App loads at `https://mbumah-hardware-pos-one.vercel.app` (no "Loading..." hang)
- [ ] **Step 5:** Login succeeds with `admin@mbumahhardware.co.ke` / `password123`
- [ ] **Step 6:** Neon SQL Editor confirms seed data counts
- [ ] **Step 6:** `/api/health/env` returns `status: "ok"` with no missing vars
- [ ] **Step 6:** `/api/health/db` returns `status: "ok"` with non-zero counts
- [ ] **Step 7:** `/_vercel/insights/view` request visible in DevTools Network tab
