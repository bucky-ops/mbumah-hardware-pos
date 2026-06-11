# Task 6-a: Backend API Routes for Frontend

## Task Summary
Created and updated 6 API routes for the MBUMAH HARDWARE POS & ERP system.

## Files Created

### 1. `/api/receipts/route.ts` - GET receipts list
- Accepts `storeId`, `transactionId`, `limit`, `page` query params
- Returns paginated list of receipts with transaction details
- Includes sale items, payment info, customer info, and store details

### 2. `/api/receipts/[id]/route.ts` - GET single receipt
- Returns full receipt with all details for printing
- Includes store info (with organization/tax PIN), line items, computed totals, taxes
- Resolves M-Pesa receipt number from Payment reference or MpesaTransaction table
- Includes payment method details and debt ledger info

### 3. `/api/expenses/route.ts` - GET/POST expenses
- **GET**: List expenses with filters (storeId, dateFrom, dateTo, category, limit, page)
- **POST**: Create expense with journal entry
  - Validates: storeId, description, amount, category, paidBy
  - Categories: RENT, SALARIES, UTILITIES, TRANSPORT, MAINTENANCE, SUPPLIES, BAD_DEBT, OTHER
  - Creates double-entry journal (debit expense account, credit cash/mpesa account)
  - For CASH payments, also records CASH_OUT in cash drawer log
  - Returns created expense with journal entry reference

### 4. `/api/cash-drawer/route.ts` - GET/POST cash drawer logs
- **GET**: List cash drawer events with filters (storeId, userId, dateFrom, dateTo, action, page, limit)
  - Returns current balance, total cash in/out summary
- **POST**: Record cash drawer event (OPEN, CLOSE, CASH_IN, CASH_OUT)
  - Validates: storeId, userId, eventType, amount
  - Calculates running balance, prevents negative balance on CASH_OUT
  - Creates journal entries for CASH_IN (DR Cash, CR Owner Equity) and CASH_OUT (DR Owner Equity, CR Cash)

### 5. `/api/products/bundles/route.ts` - Updated POST handler
- Enhanced POST to support new `componentProducts` + `discountPercent` interface
  - Accepts: name, description, componentProducts (array of productId + quantity), discountPercent, storeId
  - Auto-calculates bundle price from component products minus discount
  - Also supports legacy interface with explicit pricePerUnit, costPrice, items[]
- Enhanced GET to include computed discount and component pricing for each bundle

### 6. `/api/dashboard/route.ts` - Enhanced with new data
- `hourlySalesBreakdown` - Sales grouped by hour for today, including transaction count per hour
- `topSellingCategories` - Revenue by category (last 30 days) with category metadata
- `inventoryValue` - Total inventory value (costValue = qty × costPrice, retailValue = qty × pricePerUnit, totalItems, totalQuantity)
- `recentActivities` - Last 10 system log entries across all modules with user info and parsed metadata

## Schema Change
Added `Expense` model to `prisma/schema.prisma`:
- Fields: id, storeId, description, amount, category, paidBy, paymentMethod, journalEntryId, notes, createdAt, updatedAt
- Added `expenses Expense[]` relation on Store model
- Successfully pushed to SQLite database

## Testing Results
All API endpoints tested and working:
- `GET /api/receipts?storeId=store_juja_main` ✅
- `GET /api/receipts/[id]` ✅
- `GET /api/expenses?storeId=store_juja_main` ✅
- `POST /api/expenses` ✅ (created expense with journal entry and cash drawer log)
- `GET /api/cash-drawer?storeId=store_juja_main` ✅
- `POST /api/cash-drawer` ✅ (created CASH_IN event with journal entry)
- `POST /api/products/bundles` ✅ (created bundle with componentProducts + discountPercent)
- `GET /api/dashboard?storeId=store_juja_main` ✅ (all new fields present)
- ESLint passes with no errors ✅
