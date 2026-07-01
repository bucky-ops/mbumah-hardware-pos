# Release Verification Checklist

**Version:** v2.2.0
**Date:** 2026-06-30
**Verifier:** _______________

---

## 1. Deployment Verification

- [ ] Vercel deployment succeeds (check Vercel dashboard for build status)
- [ ] No build errors or warnings in Vercel build logs
- [ ] Deployment completes within 3 minutes
- [ ] Environment variables are set correctly on Vercel:
  - [ ] `DATABASE_URL` (Neon PostgreSQL with `-pooler` suffix)
  - [ ] `NEXTAUTH_SECRET`
  - [ ] `NEXTAUTH_URL`

## 2. Critical Crash Fix — "Loading..." State

- [ ] App loads at `https://mbumah-hardware-pos-one.vercel.app` without hanging
- [ ] No `TypeError: eL.map is not a function` in browser console
- [ ] Login page renders within 5 seconds
- [ ] After login, dashboard loads without crash
- [ ] No `ErrorBoundary` fallback shown on initial load
- [ ] Page title is "MBUMAH HARDWARE - POS & ERP System"

## 3. Defensive Coding Verification

- [ ] Dashboard tab renders with API data (or demo fallback)
- [ ] Switching between tabs does not cause crashes
- [ ] Inventory tab shows products (not empty "No products found" when DB has data)
- [ ] Inventory tab shows error state with retry button when API fails
- [ ] Reports tab loads without `.map()` crashes on trend data
- [ ] Financial tab renders charts without crash
- [ ] eTIMS tab VAT breakdown renders without crash

## 4. Product Display & Store Filtering

- [ ] Products are listed in the Inventory tab
- [ ] Products shown belong to the current store only
- [ ] Switching stores updates the product list
- [ ] Product search works correctly
- [ ] Category filter works correctly
- [ ] Low stock / out-of-stock filters work
- [ ] Product details can be viewed
- [ ] New products can be created with correct storeId

## 5. Purchase Orders Module

- [ ] Purchase Orders tab is accessible from the sidebar
- [ ] PO list view loads and shows existing purchase orders
- [ ] Summary cards display correct counts (Total, Pending, In Transit, etc.)
- [ ] "New Purchase Order" button opens create dialog
- [ ] Create PO form allows:
  - [ ] Supplier selection from dropdown
  - [ ] Adding products via typeahead search
  - [ ] Setting quantity and unit cost per line item
  - [ ] Subtotal, tax (16% VAT), and total auto-calculated
- [ ] PO detail view shows:
  - [ ] Full item list with ordered/received quantities
  - [ ] Status timeline
  - [ ] Action buttons (Submit, Approve, Send, Confirm, Cancel)
- [ ] Receive stock (GRN) flow works:
  - [ ] Receive quantities can be entered per item
  - [ ] Over-receiving is prevented (red border validation)
  - [ ] Receiving increments product stock quantity
- [ ] Status transitions follow the state machine:
  - [ ] DRAFT → PENDING_APPROVAL → APPROVED → SENT → CONFIRMED → RECEIVED
  - [ ] Any status → CANCELLED (where applicable)

## 6. Seed Data Verification (Fresh Install)

- [ ] `bun run db:seed` completes without errors
- [ ] 5 stores are created (Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru)
- [ ] Products exist for each store with correct storeId
- [ ] Suppliers exist for each store
- [ ] Purchase Orders exist in various statuses:
  - [ ] RECEIVED (fully received)
  - [ ] APPROVED (pending dispatch)
  - [ ] PARTIALLY_RECEIVED (partially delivered)
  - [ ] DRAFT (pending review)
  - [ ] CANCELLED

## 7. Error Boundary & Crash Isolation

- [ ] Individual tab crash shows amber retry fallback (not full-page crash)
- [ ] ErrorBoundary dismissed state shows safe "An error occurred" with Retry button
- [ ] ErrorBoundary does NOT cause infinite crash loop
- [ ] SectionErrorBoundary isolates tab crashes from the main app
- [ ] Clicking "Retry" in error fallback reloads the tab correctly
- [ ] Non-admin users auto-navigate back after 3 seconds

## 8. Cross-Tab Stability

Verify all tabs load without crashes:

- [ ] Dashboard
- [ ] POS / Sales
- [ ] Transactions
- [ ] Inventory
- [ ] Customers
- [ ] Suppliers
- [ ] Purchase Orders
- [ ] Transfers
- [ ] Delivery Notes
- [ ] Financial
- [ ] Banking
- [ ] Invoices
- [ ] Vouchers
- [ ] Gift Cards
- [ ] Credits
- [ ] Loyalty
- [ ] Debt Management
- [ ] Rentals
- [ ] Payroll
- [ ] Reports
- [ ] Messaging / Conversations
- [ ] Tax
- [ ] eTIMS
- [ ] Admin
- [ ] Security

## 9. CI/CD Pipeline

- [ ] `.github/workflows/ci-cd.yml` exists
- [ ] Pipeline triggers on push to `main` and PRs
- [ ] All stages pass:
  - [ ] Stage 2: Lint
  - [ ] Stage 3: Type-check
  - [ ] Stage 4: Security scan
  - [ ] Stage 5: Test
  - [ ] Stage 6: Build
  - [ ] Stage 7: Deploy to Vercel (main only)
  - [ ] Stage 8: Preview deployment (PRs only)
  - [ ] Stage 9: CI gate

## 10. Git & Release

- [ ] All changes committed to `main` branch
- [ ] Tag `v2.1.0` exists on GitHub
- [ ] GitHub Release created for `v2.1.0`
- [ ] Release notes document the crash fix and new features
- [ ] Release marked as "latest"

## 11. Performance

- [ ] Initial page load < 5 seconds (First Contentful Paint)
- [ ] Dashboard renders < 3 seconds after login
- [ ] Tab switching is smooth (< 1 second)
- [ ] No memory leaks (verify via browser DevTools after 10+ tab switches)

## 12. Browser Console Check

- [ ] No `TypeError` entries in console
- [ ] No `Uncaught RangeError` entries
- [ ] No React hydration warnings
- [ ] No `Failed to fetch` errors on critical APIs
- [ ] No `Warning: Each child in a list should have a unique "key"` warnings

## 13. Backend API Health

- [ ] `/api/health` returns 200 with `env_DATABASE_URL: "SET"`
- [ ] `/api/products?storeId=XXX` returns 200 (not 500)
- [ ] `/api/purchase-orders?storeId=XXX` returns 200 (not 500)
- [ ] `/api/financial/accounts?storeId=XXX` returns 200 (not 500)
- [ ] `/api/kra/invoices?storeId=XXX` returns 200 (not 500)
- [ ] Financial routes return structured JSON errors (not HTML 500) when DB is unavailable
- [ ] Products and Purchase Orders routes require store access authentication
- [ ] PrismaClient uses `connect_timeout=15` for Neon cold starts

## 14. Backend Error Handling

- [ ] `withErrorBoundary` wraps `withFinancialAuth` (not vice versa) in all financial routes
- [ ] API errors return structured JSON `{ success: false, error: "..." }` with proper status codes
- [ ] 500 errors are reported to Sentry (check Sentry dashboard)
- [ ] `APIError` class is used for structured error responses
- [ ] `apiHandler` wrapper is available for new routes

## 15. Frontend Error Resilience

- [ ] Debt Management tab does not crash when `summary.byBucket` is undefined
- [ ] Catalog tab does not crash when API returns non-array data
- [ ] Inventory tab shows error state with Retry button on API failure
- [ ] All tabs wrapped in `SectionErrorBoundary` — single tab crash doesn't take down the app

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| QA | | | |
| Release Manager | | | |

---

**Result:** PASS / FAIL / CONDITIONAL PASS

**Notes:**
