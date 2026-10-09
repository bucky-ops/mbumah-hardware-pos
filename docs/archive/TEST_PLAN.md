# 🧪 TEST_PLAN.md — Post-Deployment Verification Checklist

**MBUMAH HARDWARE — POS & ERP System**

This document defines the **mandatory verification procedure** to run after
every deployment to Vercel (production or preview). The goal is to catch
runtime regressions that `bun run lint` and `next build` passing cannot detect
— broken DB connections, missing env vars, CSRF/rate-limit misfires, RBAC
gaps, and financial-data corruption.

> **Use this after every `git push` to `main`, every Vercel preview deploy,
> and after any change to Prisma schema, env vars, or middleware.**

---

## 📋 How to Use This Plan

1. **Run the sections in order** — they're sequenced so cheaper checks
   (health, env) run before expensive ones (E2E flows).
2. **Tick every box.** If a step fails, STOP and fix it before continuing —
   later steps depend on earlier ones passing.
3. **Record results** in the deployment ticket / release notes:
   `✅ pass` / `⚠️ degraded` / `❌ fail` with the observed value.
4. **Production deployments** require ALL sections green. Preview deployments
   may tolerate `⚠️ degraded` on non-critical paths.
5. The expected values below assume the seed data (`bun run db:seed`) has been
   applied to the target database.

---

## 0. Pre-flight (before opening the browser)

| # | Check | Command / Where | Expected |
|---|-------|-----------------|----------|
| 0.1 | Build passed on Vercel | Vercel dashboard → Deployments | ✅ "Ready" status, no build errors |
| 0.2 | `SKIP_ENV_VALIDATION=1` was set during build | Vercel build logs | `prisma generate` + `next build` both ran without `EnvValidationError` |
| 0.3 | Prisma Client generated for the right provider | Vercel build logs | `scripts/setup-prisma-provider.mjs` logged `Switched provider: sqlite → postgresql` (because `DATABASE_URL` is a Neon URL) |
| 0.4 | All env vars set in Vercel | Vercel → Project → Settings → Environment Variables | See [§1 Env Var Matrix](#1-environment-variable-matrix) below |

---

## 1. Environment Variable Matrix

Confirm each variable is present in the correct Vercel environment
(Production / Preview / Development). Values are redacted in Vercel UI — just
confirm presence and that the Neon URL is the **pooled** one.

| Variable | Prod | Preview | Dev | Notes |
|----------|:----:|:-------:|:---:|-------|
| `DATABASE_URL` | ✅ | ✅ | ✅ | **Must be the Neon `-pooler` URL** with `?pgbouncer=true&connect_timeout=15` |
| `DIRECT_URL` | ✅ | ✅ | — | Non-pooler Neon URL, for migrations only |
| `NEXTAUTH_SECRET` | ✅ | ✅ | ✅ | ≥ 16 chars, random |
| `JWT_SECRET` | ✅ | ✅ | ✅ | ≥ 16 chars, random (used by custom token auth) |
| `NEXTAUTH_URL` | ✅ | ✅ | — | Canonical production URL |
| `ALLOW_DEV_BYPASS` | ❌ (unset) | optional | optional | Set `true` ONLY on previews where you want the bypass button |
| `EXPOSE_ERRORS` | ❌ (unset) | optional | optional | Set `true` temporarily when debugging 500s, then **remove** |

> ⚠️ **Never** set `ALLOW_DEV_BYPASS=true` or `EXPOSE_ERRORS=true` in the
> Production environment. The dev-bypass route returns 403 in production
> regardless, but defense-in-depth says don't tempt it.

---

## 2. Health Endpoint (smoke test)

```
GET https://<your-deployment>/api/health
```

Expected JSON (HTTP **200**):

```json
{
  "status": "healthy",          // or "degraded" / "unhealthy"
  "nodeEnv": "production",       // or "development" on preview
  "responseTime": "<500ms",
  "checks": {
    "env_DATABASE_URL": { "status": "ok" },
    "env_NEXTAUTH_SECRET": { "status": "ok" },
    "env_JWT_SECRET": { "status": "ok" },
    "env_DIRECT_URL": { "status": "ok" },
    "database": { "status": "ok", "responseTime": "<200ms" },
    "database_stats": { "status": "ok", "detail": "<N> users, <N> products, <N> transactions, <N> active sessions" },
    "security": { "status": "ok" },
    "account_security": { "status": "ok" }
  }
}
```

| # | Check | Expected |
|---|-------|----------|
| 2.1 | HTTP status | `200` (not `503`) |
| 2.2 | `status` | `healthy` (preview may be `degraded` if `DIRECT_URL` is unset) |
| 2.3 | `checks.env_DATABASE_URL.status` | `ok` |
| 2.4 | `checks.env_NEXTAUTH_SECRET.status` | `ok` |
| 2.5 | `checks.env_JWT_SECRET.status` | `ok` |
| 2.6 | `checks.database.status` | `ok` AND `responseTime < 1000ms` |
| 2.7 | `checks.database_stats.status` | `ok` with non-zero user/product counts (confirms seed ran) |

> If `checks.database.status === 'error'`, the DATABASE_URL is wrong (direct
> vs pooled) or the Neon branch is suspended. Check the `detail` field.

---

## 3. Authentication Flows

### 3.1 Login (happy path)

| # | Step | Expected |
|---|------|----------|
| 3.1.1 | Open the deployment URL in a private window | Login screen renders with logo, "MBUMAH HARDWARE" title, demo-account chips |
| 3.1.2 | Enter `admin@mbumahhardware.co.ke` / `password123` → click **Sign In to Dashboard** | `POST /api/auth/login` → `200`. Toast "Welcome to MBUMAH HARDWARE POS!". Dashboard renders. |
| 3.1.3 | Check `localStorage` | `mbt_token` = 64-char hex, `mbt_user` = JSON with `role: "SUPER_ADMIN"` |
| 3.1.4 | Refresh the page | Stays logged in (token persisted) |

### 3.2 Login (bad password)

| # | Step | Expected |
|---|------|----------|
| 3.2.1 | Log out, enter valid email + wrong password | `POST /api/auth/login` → `401`. Toast "Invalid email or password." |
| 3.2.2 | Repeat 5 times rapidly | 6th attempt → `423` (account locked) with `Retry-After` header |

### 3.3 Dev Bypass (preview / dev only)

> Only run this section on preview deployments or local dev — **never** in
> production. In production the button must NOT appear and the route must
> return `403`.

| # | Step | Expected |
|---|------|----------|
| 3.3.1 | On a **preview** deployment, open the login page in a private window | Amber "Developer Tools" section + "Dev Bypass (Super Admin)" button visible (probe returned `enabled: true`) |
| 3.3.2 | Click **Dev Bypass (Super Admin)** | `GET /api/auth/dev-bypass` → `200`. Toast "Dev bypass active — signing in as Super Admin…". Page reloads. |
| 3.3.3 | Post-reload | Logged in as "System Administrator" / `SUPER_ADMIN`. Dashboard renders. |
| 3.3.4 | In **production**, open login page | Dev Bypass button **absent** (probe returned `enabled: false`) |
| 3.3.5 | In **production**, `curl https://<prod>/api/auth/dev-bypass` | `403` with "Dev bypass is disabled in this environment." |

### 3.4 Session expiry

| # | Step | Expected |
|---|------|----------|
| 3.4.1 | Manually shorten a session's `expiresAt` in the DB to the past | Next API call → `401` "Session expired". Client clears `mbt_token` + `mbt_user`, reloads to login. |

---

## 4. Core POS Flows (the golden path)

> Run these as the `SUPER_ADMIN` (or `CASHIER`) user.

### 4.1 Product catalog & search

| # | Step | Expected |
|---|------|----------|
| 4.1.1 | Navigate to POS tab (F2) | Product grid loads, categories filter works |
| 4.1.2 | Type in the search bar | `GET /api/products/search?...` → `200`, results filter live |
| 4.1.3 | Scan a barcode (or type a known SKU) | Matching product highlights / adds to cart |

### 4.2 Cart & checkout (cash)

| # | Step | Expected |
|---|------|----------|
| 4.2.1 | Click 2-3 products to add to cart | Cart panel updates with line totals, subtotal, VAT (16%), total |
| 4.2.2 | Press **F9** (or click Checkout) | Checkout dialog opens |
| 4.2.3 | Select "Cash", enter amount ≥ total | Change due calculated |
| 4.2.4 | Confirm sale | `POST /api/transactions` → `201`. Receipt dialog opens with receipt number `MBM-RCPT-XXX`. Inventory decremented. |
| 4.2.5 | Click "Print Receipt" | Browser print dialog opens (or receipt PDF downloads) |

### 4.3 Cart & checkout (M-Pesa)

| # | Step | Expected |
|---|------|----------|
| 4.3.1 | Add products, open checkout, select "M-Pesa" | Phone-number field appears |
| 4.3.2 | Enter `2547XXXXXXXX`, confirm | STK push triggered (or simulated in dev). Transaction recorded as `PENDING` → `COMPLETED`. |

> On preview without M-Pesa Daraja credentials, the STK push will fail — that's
> expected. Verify the error is surfaced gracefully (toast, no crash).

### 4.4 Refund / void

| # | Step | Expected |
|---|------|----------|
| 4.4.1 | Open Transactions tab → find the sale from 4.2 | Transaction detail opens |
| 4.4.2 | Click "Refund" (requires `SUPER_ADMIN`/`STORE_OWNER`) | Refund recorded, original transaction marked refunded, inventory restored. Financial immutability: original row NOT deleted. |

---

## 5. Inventory Management

| # | Step | Expected |
|---|------|----------|
| 5.1 | Inventory tab (F3) → list loads | `GET /api/products?...` → `200`, table paginated |
| 5.2 | Edit a product's price/stock | `PUT /api/products/:id` → `200`, grid updates |
| 5.3 | Add a new product with SKU + barcode | `POST /api/products` → `201`, appears in grid + POS |
| 5.4 | Set stock below reorder level | Product shows "low stock" badge in dashboard notifications |
| 5.5 | Stock movement recorded | `GET /api/inventory/movements?productId=...` shows the movement with correct type (SALE/PURCHASE/ADJUSTMENT) |

---

## 6. Customers & Debt

| # | Step | Expected |
|---|------|----------|
| 6.1 | Customers tab (F4) → list loads | `GET /api/customers` → `200` |
| 6.2 | Add a customer with phone + debt limit | `POST /api/customers` → `201` |
| 6.3 | Create a sale on credit for that customer | Debt ledger entry created, customer's outstanding balance increases |
| 6.4 | Record a debt repayment | Balance decreases, ledger shows payment entry |
| 6.5 | Debt tab → overdue list | Overdue debts appear with days-overdue + interest |

---

## 7. Financial & Reports

| # | Step | Expected |
|---|------|----------|
| 7.1 | Financial tab (F5) → dashboard | Revenue, expenses, net profit cards populate |
| 7.2 | Revenue trend chart (7/30/90 days) | `GET /api/financial/revenue-trend?days=7` → `200`, chart renders |
| 7.3 | Double-entry integrity | Total debits === total credits for the period (run the "Trial Balance" report) |
| 7.4 | Reports tab → export to CSV/PDF | File downloads, opens in Excel/PDF reader, data matches on-screen |

---

## 8. Rentals & Equipment

| # | Step | Expected |
|---|------|----------|
| 8.1 | Rentals tab → list loads | Active, overdue, returned rentals segmented |
| 8.2 | Check out a rental item (e.g., concrete mixer) | `POST /api/rentals` → `201`, item marked rented, inventory decremented |
| 8.3 | Return the rental | `PUT /api/rentals/:id` with return date → rental fee calculated, item back in stock |
| 8.4 | Overdue rental | Appears in dashboard "Overdue Rentals" widget + sends notification |

---

## 9. Security & RBAC

### 9.1 Role isolation

| # | Step | Expected |
|---|------|----------|
| 9.1.1 | Log in as `CASHIER` (`cashier@mbumahhardware.co.ke`) | Dashboard renders but sidebar lacks Admin/Financial/Reports |
| 9.1.2 | Manually `curl /api/financial/revenue-trend` with cashier's token | `403` (RBAC blocks at route layer) |
| 9.1.3 | Manually `curl /api/users` with cashier's token | `403` |
| 9.1.4 | Log in as `BRANCH_MANAGER` | Can see their branch's data, NOT other branches |
| 9.1.5 | As cashier, attempt to fetch another store's transactions | `403` or empty result (multi-tenant `storeId` scoping) |

### 9.2 Middleware layers

| # | Step | Expected |
|---|------|----------|
| 9.2.1 | `POST /api/transactions` with no `Authorization` header | `401` "Authentication required." |
| 9.2.2 | `POST /api/transactions` with valid token but no `X-CSRF-Token` header and no matching Origin | `403` "CSRF validation failed." |
| 9.2.3 | `GET /api/transactions` 101 times in 1 min from same IP | 101st → `429` with `Retry-After` header |
| 9.2.4 | `POST /api/transactions` with > 1 MB body | `413` "Request payload too large." |
| 9.2.5 | `POST /api/transactions` with `Content-Type: text/plain` | `415` "Content-Type must be application/json." |

### 9.3 Financial immutability

| # | Step | Expected |
|---|------|----------|
| 9.3.1 | Directly attempt `DELETE /api/transactions/:id` on a settled sale | `403` or `405` — settled transactions cannot be hard-deleted (Prisma Client Extension blocks it) |
| 9.3.2 | Attempt to mutate a settled transaction's `total` field via `PUT` | `403` — financial fields are immutable post-settlement |

---

## 10. PWA & Static Assets

| # | Step | Expected |
|---|------|----------|
| 10.1 | `GET /manifest.json` | `200`, `Content-Type: application/json`, valid manifest with `name`, `icons[]`, `display: standalone` |
| 10.2 | View page source → `<link rel="manifest" href="/manifest.json">` present | ✅ |
| 10.3 | `<link rel="icon">` entries present | logo.svg + logo.png |
| 10.4 | `<link rel="apple-touch-icon">` present | logo.png |
| 10.5 | `<meta name="theme-color">` present (light + dark variants) | ✅ (rendered from `viewport` export) |
| 10.6 | Install the PWA (Chrome → address bar install icon) | Installs as standalone app with MBUMAH icon |

---

## 11. Analytics & Observability

| # | Step | Expected |
|---|------|----------|
| 11.1 | Open the production deployment, browse a few pages | Vercel Analytics dashboard shows page views within ~5 min |
| 11.2 | Check browser Network tab for `va.vercel-scripts.com` | Script loads `200` (production). On preview/dev it may 404 — benign. |
| 11.3 | Trigger an error (e.g., visit a non-existent API path) | Error boundary toast appears; `systemLog` entry created in DB |

---

## 12. Performance Budget

| # | Metric | Target | Tool |
|---|--------|--------|------|
| 12.1 | LCP (Largest Contentful Paint) — login page | < 2.5s | `agent-browser vitals <url>` or Chrome DevTools |
| 12.2 | TTFB (Time to First Byte) | < 600ms | Same |
| 12.3 | Dashboard initial load (cold) | < 3s | Manual stopwatch / Network tab |
| 12.4 | `GET /api/dashboard` response | < 200ms | `curl -w '%{time_total}'` |
| 12.5 | `GET /api/health` response | < 500ms | `curl -w '%{time_total}'` |

---

## 13. Regression Smoke (quick re-run after hotfixes)

When you've already done a full pass and just shipped a small hotfix, run this
abbreviated subset (≈ 5 minutes):

1. [ ] `GET /api/health` → `200`, `status: healthy`
2. [ ] Login as SUPER_ADMIN → dashboard renders
3. [ ] Add 1 product to cart → cash checkout → `201` + receipt
4. [ ] Log out → login page renders
5. [ ] `curl /api/auth/dev-bypass` in production → `403`
6. [ ] Browser console: zero red errors

---

## 14. Rollback Criteria

If ANY of the following occur in the first 30 minutes post-deploy, **roll back
to the previous Vercel deployment immediately**:

- ❌ `GET /api/health` returns `503` or `status: unhealthy`
- ❌ Login returns `500` for valid credentials
- ❌ Checkout (`POST /api/transactions`) returns `500` for a valid payload
- ❌ Any data-loss symptom (missing transactions, zeroed balances)
- ❌ RBAC bypass (a cashier can call an admin endpoint successfully)
- ❌ Dev bypass works in production (`GET /api/auth/dev-bypass` → `200`)

**Rollback procedure:** Vercel dashboard → Deployments → previous "Ready"
deployment → "⋯" → **Promote to Production**.

---

## 15. Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Deploying engineer | | | ✅ All green / ⚠️ Degraded / ❌ Rolled back |
| QA reviewer (if applicable) | | | |
| Product owner (prod releases) | | | |

---

## 📞 Escalation

- **Build/Deploy failures:** check Vercel build logs → `SKIP_ENV_VALIDATION`
  is set → `DATABASE_URL` is the pooled Neon URL.
- **Runtime 500s:** temporarily set `EXPOSE_ERRORS=true` in Vercel, redeploy,
  reproduce, read the full error from the response body + `systemLog` table,
  then **remove `EXPOSE_ERRORS`**.
- **DB connection exhaustion:** confirm `DATABASE_URL` hostname ends in
  `-pooler` and has `?pgbouncer=true`. Direct (non-pooler) URLs exhaust Neon's
  ~20-connection limit under serverless load.
- **Contact:** info@mbumahhardware.co.ke · +254 795 191 909

---

*This plan is a living document. Update it when new features ship or when a
post-deploy incident reveals a gap in coverage.*
