# Mbumah POS v2.0.0 — Development Plan

> **Status:** Planning / Phase 1–2 complete.
> **Base branch:** `v2.0.0-dev` (branched from `main`).
> **Target release:** v2.0.0 → `main` (Vercel production).

---

## 1. Overview

Mbumah Hardware POS v2.0.0 is the next major release of the multi-branch
hardware retail ERP. It builds on the stable v1.x foundation (51 Prisma
models, 102 API routes, 22 UI tabs) by adding **KRA eTIMS compliance**,
**enhanced debt management with automated reminders**, a richer **messaging
module**, **responsive UI with a resizable sidebar**, **colored email
receipts**, and **MPESA B2B enhancements** — while hardening every existing
module to production-grade quality.

### Development Workflow

All v2.0.0 work follows the PR workflow defined in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). Feature branches target `v2.0.0-dev`;
only the final stable cut merges to `main`.

---

## 2. Feature Overview

### ✅ Existing Features (Verified on `main`)

| # | Module                     | Status | Notes                                                     |
|---|----------------------------|--------|-----------------------------------------------------------|
| 1 | Multi-Branch POS           | ✅     | 5 stores seeded; store-scoped queries throughout          |
| 2 | Role-Based Access Control  | ✅     | 5 roles; middleware + API `requireAuth` + UI tab filtering|
| 3 | Product & Inventory        | ✅     | `reorderLevel`, low-stock alerts, stock movements, photos |
| 4 | Sales & POS                | ✅     | MPESA STK Push, split payments, debt, thermal receipts    |
| 5 | Customer CRM               | ✅     | Loyalty points, credits, debt aging, WhatsApp statements  |
| 6 | Equipment Rentals          | ✅     | Rental/return, deposits, late fees, overdue auto-sync     |
| 7 | Gift Cards                 | ✅     | Full CRUD, redemption, hard-delete (SUPER_ADMIN)          |
| 8 | Financial Management       | ✅     | Double-entry (JournalEntry/Account), expense tracking     |
| 9 | Shift Management           | ✅     | Start/end, cash drawer reconciliation                     |
| 10| Supplier Management        | ✅     | Suppliers + Purchase Orders + GRN                         |
| 11| Expense Tracking           | ✅     | 7 categories (RENT/SALARIES/UTILITIES/…), void + journal  |
| 12| Reports & Analytics        | ✅     | CSV + branded PDF export; 7-day sales forecast            |
| 13| Payroll & HR (Kenya)       | ✅     | PAYE/NSSF/SHIF/Housing Levy; 5 seeded employees           |
| 14| Messaging                  | ✅     | `Message` model + `messaging-tab.tsx` (WhatsApp/SMS/email)|
| 15| Vouchers & Promotions      | ✅     | Campaign types, redemption tracking                       |
| 16| Delivery Notes             | ✅     | `DeliveryNote` model + tab                                |
| 17| Customer Credits           | ✅     | `CustomerCredit` model, refund/store credit               |
| 18| Banking                    | ✅     | Bank accounts, reconciliations                            |
| 19| Security Audit Log         | ✅     | `security-tab.tsx`, system logs                           |
| 20| Admin & User Management    | ✅     | User CRUD, store assignment, role management              |

### 🔴 Planned for v2.0.0

| #  | Feature                              | Priority | PR Target         |
|----|--------------------------------------|----------|-------------------|
| A  | eTIMS / TIMS KRA Integration         | High     | `feat/etims-integration`   |
| B  | Enhanced Debt Management & Reminders | High     | `feat/debt-reminders`      |
| C  | Messaging Module Enhancement         | Medium   | `feat/messaging-v2`        |
| D  | Responsive UI & Resizable Sidebar    | High     | `feat/responsive-sidebar`  |
| E  | Colored Receipts & Email Delivery    | Medium   | `feat/colored-receipts`    |
| F  | MPESA B2B & Reconciliation           | Medium   | `feat/mpesa-b2b`           |
| G  | Catalog Scalability (pagination)     | Low      | `feat/catalog-pagination`  |
| H  | Real-time Notifications (WebSocket)  | Low      | `feat/realtime-notifications` |

---

## 3. Phase 2 — Current State Audit Checklist

> Verified against `main` branch (commit `1b58d35`) and `v2.0.0-dev`.

### Infrastructure

- [x] **Next.js 16** App Router — confirmed (`next-server v16.1.3`)
- [x] **TypeScript 5** strict mode — confirmed
- [x] **Prisma ORM** — 51 models, SQLite (dev) / Neon Postgres (prod)
- [x] **102 API routes** under `src/app/api/`
- [x] **22 UI tabs** under `src/app/tabs/`
- [x] **Global auth middleware** — `src/middleware.ts` enforces Bearer token
- [x] **JWT auth** — token in `localStorage.mbt_token`, CSRF cookie
- [x] **Vercel deployment** — auto-deploys on push to `main`
- [x] **Analytics** — `@vercel/analytics` + SpeedInsights installed

### Module Verification

- [x] **Multi-Branch POS** — ✅ Verified. 5 stores seeded
      (`store_juja_main`, `store_thika_rd`, etc.); all queries store-scoped;
      store switcher in TopBar; `requireStoreAccess` on API.
- [x] **RBAC** — ✅ Verified. 5 roles (SUPER_ADMIN / STORE_OWNER /
      BRANCH_MANAGER / CASHIER / ACCOUNTANT). `requireAuth({roles})` on API;
      `filterTabsByRole()` on UI; CASHIER sees only 5 tabs, SUPER_ADMIN all.
- [x] **Product & Inventory** — ✅ Verified. `Product` model with
      `quantityInStock`, `reorderLevel`, `isRental`, `imageUrl`. Low-stock
      banner, stock-status filters, stock movements, photo upload component.
- [x] **Sales & POS** — ✅ Verified. `SalesTransaction` with items,
      MPESA STK Push, split payments (CASH/MPESA/DEBT), thermal + on-screen
      receipts with logo + dynamic store info.
- [x] **Customer CRM** — ✅ Verified. `Customer` with loyalty points,
      `CustomerCredit`, debt aging (0/30/60/90+ buckets), account history
      dialog, WhatsApp statement send (bug fixed this round: `customerId`
      field added).
- [x] **Equipment Rentals** — ✅ Verified. `EquipmentRental` with
      ratePerDay/Week/Month, security deposits, late fees, overdue auto-sync
      (made non-blocking this round to prevent 500s).
- [x] **Gift Cards** — ✅ Verified. Full CRUD, redemption, balance adjust,
      hard-delete (SUPER_ADMIN), visibility toggle.
- [x] **Financial Management** — ✅ Verified. Double-entry via
      `JournalEntry` + `JournalEntryLine` + `Account` (chart of accounts).
      Revenue trend with expenses + gross profit + margin.
- [x] **Shift Management** — ✅ Verified. `Shift` model, start/end,
      cash drawer logs (`CashDrawerLog`), reconciliation.
- [x] **Supplier Management** — ✅ Verified. `Supplier` + `PurchaseOrder`
      + goods-received notes.
- [x] **Expense Tracking** — ✅ Verified. `Expense` model with 7 categories
      (RENT, SALARIES, UTILITIES, TRANSPORT, MAINTENANCE, SUPPLIES, OTHER),
      void + journal posting.
- [x] **Reports & Analytics** — ✅ Verified. `reports-tab.tsx` (2694 lines),
      CSV + branded PDF export, 7-day sales forecast (linear regression with
      confidence bands — implemented this round).
- [x] **Payroll & HR** — ✅ Verified. 8 models (Employee, LeaveType, Leave,
      PayrollPeriod, PayrollRun, PayrollDetail, Attendance). Kenya statutory
      calc in `payroll-helpers.ts` (PAYE/NSSF/SHIF/Housing Levy). 5 seeded
      employees.
- [x] **Messaging** — ✅ Verified (exists). `Message` model +
      `messaging-tab.tsx` (2351 lines). WhatsApp deep-links, SMS, email.
      **Enhancement planned for v2.0.0** (see §4.C).
- [x] **Vouchers & Promotions** — ✅ Verified. `Voucher` model,
      campaign types, redemption tracking.
- [x] **Delivery Notes** — ✅ Verified. `DeliveryNote` model + tab.
- [x] **Customer Credits** — ✅ Verified. `CustomerCredit` model,
      refund/store-credit/gift reasons.
- [x] **Banking** — ✅ Verified. Bank accounts, reconciliations
      (`banking-tab.tsx` 1374 lines).
- [x] **Security Audit** — ✅ Verified. `security-tab.tsx` (785 lines),
      system logs, login history.
- [x] **Admin** — ✅ Verified. `admin-tab.tsx` (1907 lines), user CRUD,
      store assignment, role management, health checks.

### Bugs Fixed This Round (v2.0.0-dev)

- [x] **401 on `/api/trends/analysis`** — `fetchDashboardTrends` used raw
      `fetch()` without `Authorization` header. Fixed with `authedFetch`
      helper in `dashboard-tab.tsx`.
- [x] **401 on `/api/products?limit=1`** — admin-tab health-check pings used
      raw `fetch()` without auth. Fixed with `authedFetch` in `admin-tab.tsx`.
- [x] **401 on `/api/expenses` & `/api/cash-drawer`** — same root cause in
      `dashboard-tab.tsx`. Fixed by applying `authedFetch` to all raw fetches.
- [x] **500 on `/api/rentals`** — overdue-status write inside read handler
      could throw on concurrent update. Made non-blocking (best-effort
      background sync with `.catch()`).
- [x] **"Mark all read" no-op stub** — bell dropdown button did nothing.
      Wired to fetch + persist all IDs to localStorage + invalidate query.
- [x] **WhatsApp statement always 400** — `sendDocument` call sent
      `documentId` but API required `customerId`. Added `customerId` field.
- [x] **Dashboard forecast always empty** — `/api/trends/analysis` never
      returned a `forecast` array. Implemented 7-day linear regression with
      confidence bands (lights up dashboard + reports widgets).

### Not Yet Implemented (v2.0.0 targets)

- [ ] **eTIMS / TIMS** — ❌ No `KraSubmission`, `InvoiceForKRA`, or
      `KraBusinessProfile` models. No KRA API integration. **Planned: §4.A.**
- [ ] **Automated debt reminders** — ❌ No `PaymentReminder` model or
      scheduler. Reminders are manual (WhatsApp statement button only).
      **Planned: §4.B.**
- [ ] **Real-time notifications** — ❌ 60-second polling; no WebSocket push.
      Read state is localStorage-only (per-browser). **Planned: §4.H.**
- [ ] **Server-side notification read state** — ❌ No `Notification` Prisma
      model; `isRead` hardcoded `false` in the computed API. **Planned: §4.H.**
- [ ] **Resizable sidebar** — ❌ Fixed width; no drag-to-resize.
      **Planned: §4.D.**
- [ ] **Email receipt delivery** — ❌ Receipts print only; no email send.
      **Planned: §4.E.**
- [ ] **MPESA B2B payouts** — ❌ Only STK Push (C2B) implemented.
      **Planned: §4.F.**
- [ ] **Catalog pagination** — ❌ Products fetched in one query (fine for
      current catalog size; needed for scale). **Planned: §4.G.**

---

## 4. Feature Breakdown (v2.0.0)

### A. eTIMS / TIMS KRA Integration

**Goal:** Comply with Kenya Revenue Authority's electronic Tax Invoice
Management System. Every sales invoice must be submitted to KRA in real time
and a CU (Communication Unit) / QR code returned.

**Database (`prisma/schema.prisma`):**
- `KraBusinessProfile` — org-level: KRA PIN, tax type, ID/secret, CU PIN,
  sandbox vs production flag.
- `InvoiceForKRA` — links to `SalesTransaction`; fields: `invoiceNumber`
  (KRA format `UUI`), `cuPin`, `qrCode`, `submissionStatus` (PENDING /
  SUBMITTED / ACCEPTED / REJECTED), `kraResponse` (JSON), `submittedAt`,
  `retryCount`.
- `KraSubmission` — audit log of every API call (request, response, latency,
  status).

**Backend (`src/lib/kra-helpers.ts`):**
- `submitInvoiceToKra(transaction)` — maps `SalesTransaction` + items to the
  eTIMS invoice JSON (item codes, HS codes, VAT 16%, totals, discounts),
  signs the request, calls the KRA endpoint.
- `getSubmissionStatus(cuPin)` — polls KRA for acceptance/rejection.
- `refreshBusinessProfile()` — fetches/refreshes the OAuth token.
- Robust error handling: network timeouts, KRA 5xx retries (exponential
  backoff, max 3), validation-error surfacing.

**API (`src/app/api/kra/`):**
- `POST /api/kra/submission` — submit an invoice (called after sale completes
  or via a batch backfill job).
- `GET /api/kra/submission/[id]` — query submission status.
- `GET /api/kra/business-profile` — read KRA config (admin only).
- `POST /api/kra/business-profile` — upsert KRA credentials (SUPER_ADMIN only).

**UI:**
- New "KRA / eTIMS" sub-section in the Admin tab (or a dedicated tab for
  ACCOUNTANT role).
- Shows submission queue, success/failure rate, retry button.
- Per-transaction KRA status badge in the Transactions tab.

**Edge cases:** offline mode (queue + retry when back online), KRA sandbox
for testing, partial refunds (credit notes must also be submitted).

---

### B. Enhanced Debt Management & Customer Reminders

**Goal:** Reduce outstanding debt through automated, multi-channel reminders
with aging-based escalation.

**Backend (`src/lib/debt-helpers.ts` — extend):**
- `calculateAging(debt)` — returns bucket: `CURRENT` (0–30d), `30_DAYS`
  (31–60d), `60_DAYS` (61–90d), `90_PLUS` (90d+).
- `getOverdueCustomers(storeId, { minDays })` — returns customers with debts
  past due, grouped by aging bucket.
- `shouldSendReminder(debt, lastReminderAt)` — escalation rules:
  - 0–30d: no auto-reminder (grace period).
  - 31–60d: weekly reminder (SMS + WhatsApp).
  - 61–90d: every 3 days (SMS + WhatsApp + email).
  - 90d+: daily (all channels + manager alert).

**Database:**
- `PaymentReminder` model — `customerId`, `debtId`, `channel` (SMS/WhatsApp/
  EMAIL), `sentAt`, `message`, `status` (SENT/FAILED/DELIVERED), `response`.

**API (`src/app/api/reminders/`):**
- `POST /api/reminders/debt` — trigger a reminder run (called by scheduler or
  admin button). Fetches overdue customers, sends reminders via the messaging
  module, logs to `PaymentReminder`.
- `GET /api/reminders/history?customerId=…` — reminder history per customer.

**Scheduler:** a cron job (Vercel Cron or the existing `webDevReview` cron)
runs the reminder logic daily at 09:00 Africa/Nairobi.

**UI:** "Reminders" panel in the Customers tab showing aging summary, next
reminder date, and a "Send reminder now" button per customer.

---

### C. Messaging Module Enhancement

**Goal:** Unify internal staff chat, customer notifications, and system
alerts into one coherent module with real-time delivery.

**Scope decision:** **Both** internal staff chat AND customer notifications.

**Database (`prisma/schema.prisma`):**
- `Conversation` — group or 1:1; `type` (STAFF / CUSTOMER / SYSTEM);
  participants (JSON or relation table).
- `Message` — already exists; extend with `conversationId`, `deliveryStatus`
  (SENT / DELIVERED / READ), `readBy` (JSON array of user IDs).
- `UserNotificationPreference` — per-user: which channels (in-app / SMS /
  email) for which alert types (low-stock, overdue rental, large debt, new
  sale, shift start).

**API:**
- `GET/POST /api/messages` — fetch conversation / send message.
- `POST /api/messages/[id]/read` — mark as read.
- `GET/PUT /api/notifications/preferences` — user notification prefs.

**Real-time:** WebSocket mini-service (port 3003) per the project's
socket.io convention; frontend connects via `io("/?XTransformPort=3003")`.

**UI (`src/app/tabs/messaging-tab.tsx` — enhance):**
- Conversation list (left) + thread view (right) layout.
- Internal staff chat with typing indicators + presence.
- Customer notification log (SMS/WhatsApp/email sent history).
- Notification preferences settings dialog.

---

### D. Responsive UI & Resizable Sidebar

**Goal:** Make the app fully usable on tablets (768px+) and large phones
(375px+), with a sidebar that can be resized on desktop.

**Sidebar behavior:**
| Breakpoint | Default width | Behavior                          |
|------------|---------------|-----------------------------------|
| < 768px    | 0 (hidden)    | Slide-over drawer with overlay    |
| 768–1024px | 64px          | Collapsed (icons only)            |
| 1024–1280px| 240px         | Expanded, draggable to 200–320px  |
| > 1280px   | 280px         | Expanded, draggable to 240–360px  |

**Implementation:**
- `src/components/layout/sidebar.tsx` — drag-to-resize via a `mousedown` /
  `mousemove` / `mouseup` listener on a 4px drag handle. Width persisted to
  Zustand (`sidebarWidth`) + localStorage.
- `src/app/globals.css` — CSS variables `--sidebar-width` consumed by the
  main content `margin-left` / `pl-[var(--sidebar-width)]`.
- `src/app/layout.tsx` — sidebar open/collapsed state in Zustand.
- Mobile: `Sheet` (shadcn) for the slide-over drawer; hamburger button in
  TopBar.

**Testing:** verify at 375 / 768 / 1024 / 1280 / 1920px; ensure all 22 tabs
remain usable (tables scroll horizontally, forms stack, dialogs go
full-screen on mobile).

---

### E. Colored Receipts & Email Delivery

**Goal:** Professional branded receipts with color accents, delivered by
email automatically after each sale (opt-in per customer).

**Receipt layout standard:**
- **Header:** logo (left) + branch name + location + phone + KRA PIN (right),
  colored divider (brand green `#10b981`).
- **Body:** transaction number, date, cashier, line items (zebra-striped),
  quantities, prices, VAT breakdown (16%), totals.
- **Footer:** "Thank you" message, return policy (7 days), website, social
  handles, QR code (links to digital receipt).
- **Color scheme:** green header bar, amber MPESA badge, red debt badge.

**Email delivery:**
- `src/lib/email-helpers.ts` — `sendReceiptEmail(transaction, customer)`
  using Resend (preferred) or SMTP fallback.
- HTML email template (responsive, inline CSS) embedding the receipt.
- PDF attachment generated via the existing `export-pdf` route logic.
- `POST /api/notifications/email` — triggered after a successful sale if
  customer has email + opted in.

**UI:** "Email receipt" checkbox in the POS checkout dialog; customer opt-in
field in the Customers tab.

---

### F. MPESA Enhancements

**Goal:** Add B2B payouts and robust reconciliation.

**B2B payouts (`src/lib/mpesa-helpers.ts` — extend):**
- `sendB2BPayout({ amount, phone, occasion })` — Daraja B2C API for paying
  suppliers / refunding customers directly to M-Pesa.
- Status polling via the B2C result URL callback.

**Reconciliation:**
- `POST /api/mpesa/reconcile` — matches M-Pesa callback records to
  `SalesTransaction` records; flags mismatches.
- Reconciliation dashboard in the Financial tab showing matched / unmatched /
  disputed transactions.

**Callback robustness:** idempotency key on callback handlers (prevent
double-processing), retry queue for failed callbacks.

---

### G. Catalog Scalability

**Goal:** Support catalogs with 10,000+ products efficiently.

**Backend (`src/app/api/products/route.ts`):**
- Pagination: `?page=1&limit=50` (cursor-based for infinite scroll).
- Filtering: `?categoryId=`, `?supplierId=`, `?lowStockOnly=true`,
  `?search=`, `?minPrice=`, `?maxPrice=`.
- Sorting: `?sortBy=name|price|stock|createdAt&sortOrder=asc|desc`.

**Frontend (`src/app/tabs/inventory-tab.tsx` + `catalog-tab.tsx`):**
- Virtualized product list (`@tanstack/react-virtual` if needed).
- Debounced search (300ms).
- Infinite scroll or "Load more" button.

---

### H. Real-time Notifications (WebSocket)

**Goal:** Push critical alerts (out-of-stock, overdue rental, large debt) to
all connected clients instantly instead of 60-second polling.

**Backend (mini-service, port 3003):**
- `mini-services/notify-service/index.ts` — socket.io server.
- Emits `notification:new` on: product stock hitting 0, rental going overdue,
  debt exceeding KES 50,000, new large sale.
- REST endpoint `POST /notify` (internal) for the Next.js API to trigger
  pushes.

**Frontend:**
- `src/lib/realtime.ts` — socket.io client connecting via
  `io("/?XTransformPort=3003")`.
- `useRealtimeNotifications()` hook replacing the 60s polling.
- Toast popups on new critical alerts.

**Server-side read state:**
- `Notification` Prisma model (persisted) replacing the computed API.
- `POST /api/notifications/[id]/read`, `POST /api/notifications/mark-all-read`.
- Syncs across devices/sessions.

---

## 5. Milestone Tracking

Create GitHub Milestones under the repository:

| Milestone               | Features included | Target |
|-------------------------|-------------------|--------|
| **v2.0.0-alpha**        | D (responsive), E (receipts) | +2 weeks |
| **v2.0.0-beta**         | A (eTIMS), B (debt reminders) | +5 weeks |
| **v2.0.0-rc**           | C (messaging), F (MPESA B2B), H (realtime) | +8 weeks |
| **v2.0.0**              | G (catalog scale), polish, docs | +10 weeks |

Each feature gets a GitHub Issue labeled `v2.0.0` with the breakdown above as
the issue body. Sub-tasks become checkboxes.

---

## 6. Risk Register

| Risk                              | Likelihood | Impact | Mitigation                                      |
|-----------------------------------|------------|--------|-------------------------------------------------|
| KRA eTIMS API changes/sandbox instability | High | High | Build against sandbox first; abstract behind `kra-helpers.ts`; queue + retry |
| WebSocket service reliability     | Medium     | Medium | Auto-reconnect with backoff; fallback to polling |
| Resizable sidebar regressions     | Low        | Medium | Test all 22 tabs at every breakpoint            |
| Email deliverability (spam)       | Medium     | Low    | Use Resend with verified domain; SPF/DKIM       |
| MPESA B2B compliance              | Medium     | High   | Verify with Daraja API docs; test in sandbox    |

---

## 7. Definition of Done (v2.0.0)

- [ ] All features A–H implemented, reviewed, and merged to `v2.0.0-dev`
- [ ] `bun run lint` passes clean on `v2.0.0-dev`
- [ ] agent-browser E2E passes for every tab on `v2.0.0-dev`
- [ ] No 401/500 errors in browser console or `dev.log`
- [ ] Responsive verified at 375 / 768 / 1024 / 1280 / 1920px
- [ ] KRA eTIMS sandbox submission successful end-to-end
- [ ] `v2.0.0-dev` merged to `main` via final PR
- [ ] Vercel production deployment healthy (`/api/health/db` + `/api/health/env` 200)
- [ ] `worklog.md` updated with v2.0.0 release notes
- [ ] Version bumped to `2.0.0` in `package.json` and footer
