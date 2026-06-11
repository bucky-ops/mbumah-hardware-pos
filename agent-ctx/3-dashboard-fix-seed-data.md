# Task 3: Dashboard Fix & Seed Data Agent

## Summary
Fixed dashboard data consistency, made dialogs functional, and added comprehensive seed data.

## Changes Made

### 1. Dashboard Data Consistency Fix (`src/app/tabs/dashboard-tab.tsx`)
- Updated `revenueChartData` useMemo to return `{ revenueChartData, isDemoData }` object
- Priority order for data source:
  1. Dashboard's `salesByHour` (when non-zero values exist)
  2. Revenue trend API data (when not disproportionately large vs real data)
  3. Proportional demo data based on `todayRevenue`
- Added "Demo Data" badge on Revenue Trend chart when using fallback data
- Fallback demo data scales to actual revenue values instead of hardcoded 20k-40k range

### 2. Functional Expense Dialog (`src/app/tabs/dashboard-tab.tsx`)
- Added state: `expenseDesc`, `expenseAmount`, `expenseCategory`, `expensePaymentMethod`, `expenseSubmitting`
- POSTs to `/api/expenses` with proper payload (storeId, description, amount, category, paidBy, paymentMethod)
- Shows success toast via `sonner` on completion
- Resets form after successful submission
- Added all valid categories matching API: TRANSPORT, UTILITIES, MAINTENANCE, SALARIES, RENT, SUPPLIES, BAD_DEBT, OTHER
- Added payment method selector (CASH, MPESA)

### 3. Functional Cash Drawer Dialog (`src/app/tabs/dashboard-tab.tsx`)
- Fetches from `/api/cash-drawer?storeId=store_juja_main` on dialog open
- Displays: Cash In, Cash Out, Current Balance from API summary
- Shows loading spinner while fetching
- Shows empty state when no records found

### 4. Comprehensive Seed Data (`prisma/seed.ts`)
- 18 sales transactions over past 7 days (KES 1,392-53,464)
- 8 customers (3 new with various debt states)
- 6 debt records with aging buckets (CURRENT, DAYS_30, DAYS_60, DAYS_90_PLUS)
- 3 equipment rentals (active, overdue, returned)
- 19 stock movements (SALE, PURCHASE, RENTAL_OUT, RENTAL_RETURN)
- 13 cash drawer log entries with running balances
- 5 expense records
- 8 system log entries for activity feed

## Files Modified
- `src/app/tabs/dashboard-tab.tsx` - Dashboard data consistency + functional dialogs
- `prisma/seed.ts` - Comprehensive seed data

## Verification
- `bun run lint` passes (no new errors)
- All APIs returning real data from seed
- Dashboard API: todayRevenue=58,900, activeRentals=2, outstandingDebt=200,340
- Cash drawer API: currentBalance=23,700, totalCashIn=105,014, totalCashOut=55,000
- Revenue trend API: returning real daily data across 7 days
- Dev server running on port 3000
