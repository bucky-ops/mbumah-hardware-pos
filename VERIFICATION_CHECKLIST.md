# MBUMAH HARDWARE POS — Verification Checklist

> **Purpose**: Comprehensive system validation checklist for pre-release,
> post-deployment, and regression testing. Every item must be verified
> before a production release is cut.
>
> **Last updated**: 2025-07-01 (Post Phase 1 Vercel crash fixes)
> **Version**: v0.2.0

---

## 1. Core POS & Sales

### 1.1 Point of Sale (POS Tab)

- [ ] POS screen renders without crashes on first load
- [ ] Product search returns results by name, SKU, and barcode
- [ ] Adding items to cart updates line totals, subtotal, tax, and grand total
- [ ] Cart discount (flat KES amount) is applied and capped at subtotal + tax
- [ ] Per-item discount percentage is applied correctly
- [ ] Removing an item from cart recalculates totals
- [ ] Quantity adjustment updates line total in real time
- [ ] Checkout completes for CASH payment method
- [ ] Checkout completes for M-Pesa payment (STK Push initiated)
- [ ] Checkout completes for DEBT payment (creates debt ledger entry)
- [ ] Checkout completes for SPLIT payment (cash + M-Pesa split)
- [ ] Receipt is generated after successful checkout with correct KES formatting
- [ ] Receipt number is sequential and unique
- [ ] Cart clears after successful checkout
- [ ] Held carts can be saved and recalled
- [ ] Keyboard shortcuts work (F2-F5 tab switching, F9 checkout, F10 hold cart)

### 1.2 Transactions

- [ ] Transaction list loads with pagination
- [ ] Transaction detail view shows all items, payments, and timestamps
- [ ] Transaction receipt can be reprinted
- [ ] Receipt distribution via WhatsApp works (document send)
- [ ] Receipt distribution via email works (Resend integration)
- [ ] Refund/void transaction creates appropriate audit log entries
- [ ] Payment status transitions (PENDING → COMPLETED, PARTIAL → COMPLETED)

---

## 2. Inventory & Catalog

### 2.1 Product Catalog

- [ ] Product list loads with search and filter
- [ ] New product can be created with all required fields
- [ ] Product edit updates name, SKU, price, cost, quantity, reorder level
- [ ] Product delete (soft deactivate) works
- [ ] Product image upload works
- [ ] Product bundles can be created with component products
- [ ] Product variants are listed under parent product
- [ ] Category and subcategory assignment works

### 2.2 Inventory Management

- [ ] Stock levels display correctly per store
- [ ] Stock adjustment (add/remove) creates a StockMovement record
- [ ] Low stock alerts appear when quantity ≤ reorder level
- [ ] Out-of-stock products are flagged
- [ ] Inter-store transfers can be initiated
- [ ] Transfer receipt confirms at destination store
- [ ] Warehouse stock and bin locations display
- [ ] Serial number tracking works for serialized products
- [ ] Batch tracking displays for batch-managed products

---

## 3. Customers & CRM

### 3.1 Customer Management

- [ ] Customer list loads with search
- [ ] New customer can be created (name, phone, email, address)
- [ ] Customer edit updates all fields
- [ ] Customer purchase history shows linked transactions
- [ ] Customer credits are displayed and can be applied
- [ ] Customer interactions (calls, visits) can be logged
- [ ] Customer loyalty points accrue on purchases
- [ ] Customer loyalty tier is displayed

### 3.2 Debt Management

- [ ] Outstanding debts are listed with aging breakdown
- [ ] Debt payment can be recorded (partial or full)
- [ ] Debt reminders can be scheduled and sent (WhatsApp/SMS)
- [ ] Overdue debts are flagged with visual indicator
- [ ] Debt aging buckets (Current, 30, 60, 90+) calculate correctly

### 3.3 Gift Cards & Vouchers

- [ ] Gift card can be created with initial balance and optional expiry
- [ ] Gift card can be redeemed at checkout
- [ ] Gift card balance can be adjusted (increase/decrease)
- [ ] Gift card can be cancelled (soft delete)
- [ ] Gift card can be hard-deleted by SUPER_ADMIN
- [ ] Voucher can be created with discount rules
- [ ] Voucher can be redeemed at checkout
- [ ] Voucher campaigns can be created and managed

---

## 4. Rentals & Services

### 4.1 Equipment Rentals

- [ ] New rental can be created (equipment, customer, dates, rate)
- [ ] Active rentals are displayed with return date countdown
- [ ] Overdue rentals are flagged
- [ ] Rental return processes correctly (calculates charges, creates transaction)
- [ ] Rental history shows completed rentals

---

## 5. Financial & Accounting

### 5.1 Chart of Accounts

- [ ] Accounts list loads with hierarchy
- [ ] New account can be created (Asset, Liability, Equity, Revenue, Expense)
- [ ] Account edit updates name, code, type
- [ ] Account cannot be deleted if it has journal entries

### 5.2 Journal Entries

- [ ] Manual journal entry can be created with debit/credit lines
- [ ] Journal entry must balance (total debits = total credits)
- [ ] Posted journal entries are immutable (immutability guard)
- [ ] Journal entry voiding works through `withImmutabilityBypass()`
- [ ] Journal entry list can be filtered by date, account, status

### 5.3 Financial Periods

- [ ] Financial period can be created (start/end dates)
- [ ] Period closing locks all entries within the period
- [ ] Closed period prevents new journal entries
- [ ] Period can be reopened by SUPER_ADMIN

### 5.4 Trial Balance

- [ ] Trial balance snapshot can be generated for a period
- [ ] Trial balance totals balance (debits = credits)
- [ ] Trial balance snapshot is immutable once captured

### 5.5 Budgets

- [ ] Budget can be created for a financial period
- [ ] Budget vs. actual comparison displays correctly
- [ ] Budget recalculation updates spent amounts

### 5.6 Banking

- [ ] Bank accounts can be created (name, account number, balance)
- [ ] Bank transactions are listed with deposit/withdrawal types
- [ ] Bank reconciliation can be performed
- [ ] Reconciliation matches bank statement to internal records

### 5.7 Expenses

- [ ] Expense can be recorded (amount, category, description)
- [ ] Expense creates corresponding journal entry
- [ ] Expense voiding works (reverses journal entry)
- [ ] Expense list can be filtered by date, category, status

---

## 6. Supplier & Procurement

### 6.1 Supplier Management

- [ ] Supplier list loads with search
- [ ] New supplier can be created (name, contact, email, phone)
- [ ] Supplier edit updates all fields
- [ ] Supplier purchase order can be sent via email

### 6.2 Purchase Orders

- [ ] New purchase order can be created with line items
- [ ] PO status transitions: DRAFT → PENDING → APPROVED → ORDERED → RECEIVED → CANCELLED
- [ ] PO can be approved (requires appropriate RBAC permission)
- [ ] PO receipt updates inventory quantities
- [ ] PO can be cancelled with reason
- [ ] PO list can be filtered by status, supplier, date
- [ ] PO RBAC permissions enforced: `purchase_orders.read`, `purchase_orders.create`, `purchase_orders.update`, `purchase_orders.delete`, `purchase_orders.approve`

---

## 7. Payroll & HR

### 7.1 Employee Management

- [ ] Employee list loads with search
- [ ] New employee can be created with all required fields
- [ ] Employee edit updates salary, department, position

### 7.2 Payroll

- [ ] Payroll period can be created
- [ ] Payroll run can be initiated for a period
- [ ] Payroll run calculates gross pay, deductions (NSSF, NHIF, PAYE), net pay
- [ ] Payroll details (payslips) are generated per employee
- [ ] Completed payroll details are immutable
- [ ] Leave requests can be submitted and approved
- [ ] Attendance records can be logged

---

## 8. Invoicing & Delivery

### 8.1 Invoices

- [ ] Invoice can be created from a sales transaction
- [ ] Invoice displays line items, tax breakdown, and total
- [ ] Invoice status transitions: DRAFT → SENT → PAID → CANCELLED
- [ ] Invoice PDF can be generated

### 8.2 Delivery Notes

- [ ] Delivery note can be created for an invoice
- [ ] Delivery note items match invoice items
- [ ] Delivery note status tracking works

---

## 9. Reports & Analytics

### 9.1 Reports

- [ ] Sales report generates with date range filter
- [ ] Inventory report shows stock levels and valuation
- [ ] Fast-moving products report identifies top sellers
- [ ] Reports can be exported as CSV
- [ ] Reports can be exported as PDF

### 9.2 Dashboard

- [ ] Dashboard loads without `eL.map is not a function` crash
- [ ] KPI cards display: Today's Revenue, Transactions, Low Stock, Outstanding Debt
- [ ] Sales by hour chart renders
- [ ] Payment method breakdown (pie chart) renders
- [ ] Revenue trend bar chart renders
- [ ] Recent transactions feed displays
- [ ] Recent activities feed displays
- [ ] Low stock alerts panel displays
- [ ] Debt aging summary displays with aging bars
- [ ] Shift status (active/inactive) displays
- [ ] Dashboard auto-refreshes every 30 seconds

---

## 10. Tax & KRA eTIMS

### 10.1 Tax Management

- [ ] Tax categories can be created (VAT 16%, Zero-Rated, Exempt)
- [ ] Tax filings can be recorded
- [ ] KES currency formatting is consistent throughout

### 10.2 KRA eTIMS Integration

- [ ] KRA business profile can be saved
- [ ] Invoice data maps to KRA eTIMS format
- [ ] KRA submission status can be checked
- [ ] Submission history is displayed

---

## 11. Messaging & Communication

### 11.1 Messaging

- [ ] Conversations list loads
- [ ] WhatsApp message can be sent
- [ ] WhatsApp document (receipt) can be sent
- [ ] Bulk messaging can be initiated
- [ ] SMS fallback works when WhatsApp unavailable

### 11.2 Notifications

- [ ] Notifications are generated for key events
- [ ] Notification bell shows unread count
- [ ] Notifications can be marked as read
- [ ] Notification preferences can be configured

---

## 12. Security & Admin

### 12.1 Authentication

- [ ] Login works with valid credentials (all 5 roles)
- [ ] Login fails with invalid credentials (401 response)
- [ ] Brute-force lockout activates after 5 failed attempts
- [ ] Rate limiting applies on auth endpoints (429 response)
- [ ] Session expires after 24 hours
- [ ] Logout clears session and localStorage

### 12.2 RBAC (Role-Based Access Control)

- [ ] 5 roles exist: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, ACCOUNTANT
- [ ] Role permissions are enforced on all API routes
- [ ] SUPER_ADMIN can access all features
- [ ] CASHIER cannot access admin/financial settings
- [ ] ACCOUNTANT cannot modify products/inventory
- [ ] Purchase order permissions (35 entries) are seeded correctly

### 12.3 Security Dashboard

- [ ] Security events are logged and displayed
- [ ] IP blocking works
- [ ] CSRF token is generated and validated
- [ ] Security headers are present (HSTS, X-Frame-Options, CSP)

### 12.4 Admin Panel

- [ ] System configuration can be viewed
- [ ] User management (list, create, edit, deactivate)
- [ ] Store/branch management
- [ ] Audit log viewer

---

## 13. Shift Management

- [ ] New shift can be started (opening cash balance)
- [ ] Current shift displays active status
- [ ] Shift can be ended (closing cash balance + notes)
- [ ] Cash drawer logs are recorded
- [ ] Shift summary shows transaction count and revenue

---

## 14. Offline & Resilience

### 14.1 Offline Sync

- [ ] Transactions can be saved offline (IndexedDB)
- [ ] Offline transaction queue displays pending count
- [ ] Offline transactions sync when connection restored
- [ ] Offline receipt can be generated locally
- [ ] Offline count badge displays in sidebar

### 14.2 Error Handling

- [ ] API errors show user-friendly toast notifications
- [ ] ErrorBoundary catches component crashes (shows fallback, not white screen)
- [ ] ErrorBoundary dismissed state shows safe retry UI (not crash loop)
- [ ] Global error handler catches unhandled promise rejections
- [ ] Client errors are logged to `/api/logs/client-error`
- [ ] `useLoadingWatchdog` surfaces retry UI if app stuck on "Loading..." for >10s

---

## 15. Database & Schema

### 15.1 Prisma Schema

- [ ] Schema validates without errors (`bunx prisma validate`)
- [ ] All 82 models are correctly defined
- [ ] Multi-tenancy enforced via `storeId` on store-scoped models
- [ ] Financial immutability guard on JournalEntry, JournalEntryLine, SystemLog, AuditLog, TrialBalanceSnapshot, PayrollDetail
- [ ] `setup-prisma-provider.mjs` correctly switches provider between SQLite and PostgreSQL

### 15.2 Database Seeding

- [ ] `bun run db:seed` completes without errors
- [ ] 5 stores are seeded
- [ ] 12 users are seeded (2 per role across stores)
- [ ] 42 categories are seeded
- [ ] 73 products are seeded
- [ ] Role permissions are seeded (35 purchase_orders permissions + all others)
- [ ] No `skipDuplicates` error on SQLite (removed from seed.ts)

### 15.3 Connection Pooling

- [ ] Vercel `DATABASE_URL` uses Neon pooled connection string (hostname ends in `-pooler`)
- [ ] `?pgbouncer=true&connection_limit=1` appended to pooled connection
- [ ] Local dev `DATABASE_URL` uses `file:./prisma/dev.db` (SQLite)

---

## 16. API Standardization

- [ ] All API routes export `dynamic = 'force-dynamic'`
- [ ] All API routes use `withErrorBoundary()` wrapper
- [ ] All API routes return `{ success: boolean, data?: T, error?: string }` shape
- [ ] Protected routes use `requireAuth()` or Bearer token middleware
- [ ] Array fields in responses are defensively checked with `Array.isArray()` on client
- [ ] `api.ts` returns `null` for undefined data (not `[]` for object types)
- [ ] Rate limiting applies on auth and checkout endpoints
- [ ] Input validation via Zod schemas (`validateInput()`)
- [ ] CSRF token included on state-changing requests (POST/PUT/DELETE)

---

## 17. Frontend & Responsive Design

- [ ] App renders on mobile viewport (375×667)
- [ ] App renders on tablet viewport (768×1024)
- [ ] App renders on desktop viewport (1280×800+)
- [ ] Sidebar collapses on mobile, expands on desktop
- [ ] Touch targets are minimum 44px
- [ ] Sticky footer works (no floating gap on short pages)
- [ ] Dark mode toggle works and persists
- [ ] Theme respects system preference on first load
- [ ] Loading skeletons display during data fetching
- [ ] No hydration mismatch warnings in console
- [ ] No `eL.map is not a function` errors on dashboard

---

## 18. Receipt PDF Generation & Distribution

- [ ] Receipt PDF generates with correct formatting (KES, tax breakdown)
- [ ] Receipt includes: store name, KRA PIN, receipt number, date, line items, totals
- [ ] Receipt can be sent via WhatsApp (`/api/whatsapp/send-document`)
- [ ] Receipt can be sent via email (Resend integration)
- [ ] Receipt distribution status is tracked on transaction

---

## 19. Observability & Logging

- [ ] Sentry integration captures runtime errors
- [ ] System logs are written to `SystemLog` table
- [ ] Audit logs capture all financial mutations
- [ ] Request ID propagation works across API calls
- [ ] Vercel Analytics tracks page views
- [ ] Vercel Speed Insights tracks performance
- [ ] `console.error` calls include structured context (not just message strings)

---

## 20. Vercel Deployment

### 20.1 Build & Deploy

- [ ] `bun run vercel-build` completes without errors
- [ ] Vercel deployment succeeds (green build)
- [ ] Production URL returns 200 on `/api/health`
- [ ] `/api/health/db` returns database connectivity status
- [ ] `/api/health/env` returns environment variable validation status

### 20.2 Runtime

- [ ] App loads without permanent "Loading..." screen
- [ ] Login page renders correctly
- [ ] Dashboard renders without `.map()` crashes
- [ ] All API routes return JSON (not 500 HTML pages)
- [ ] Environment variables are injected correctly
- [ ] Prisma provider is set to `postgresql` (not `sqlite`) in production

---

## Verification Procedure

### Pre-Release (Local)

```bash
# 1. Lint
bun run lint                    # must pass with 0 errors

# 2. Type check
bunx tsc --noEmit --strict      # must pass (or be intentional skip)

# 3. Start dev server
bun run dev                     # must start without errors

# 4. Verify with agent-browser
agent-browser open http://localhost:3000
agent-browser snapshot          # page renders, no blank screen

# 5. Test key flows manually
#    - Login → Dashboard → POS → Checkout → Receipt
#    - Products → Create → Edit → Delete
#    - Customers → Create → View History
#    - Financial → Journal Entry → Trial Balance
#    - Purchase Orders → Create → Approve → Receive

# 6. Check database
bunx prisma validate            # schema is valid
bun run db:seed                 # seed data loads without errors
```

### Post-Deploy (Vercel)

```bash
# 1. Health check
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health
# Expected: { "success": true, "data": { "status": "healthy" } }

# 2. DB connectivity
curl -s https://mbumah-hardware-pos-one.vercel.app/api/health/db
# Expected: { "success": true }

# 3. Smoke test (browser)
#    - Open the URL in browser
#    - Verify login page renders
#    - Login and verify dashboard loads
#    - Click through 3-4 tabs to confirm no crashes
```

---

## Sign-Off

| Role | Name | Date | Result |
|------|------|------|--------|
| Developer | | | ☐ Pass ☐ Fail |
| QA | | | ☐ Pass ☐ Fail |
| Product Owner | | | ☐ Pass ☐ Fail |
| DevOps | | | ☐ Pass ☐ Fail |

**Release blocked until all 4 roles sign off.**
