# MBUMAH HARDWARE POS - Worklog

## Project Status
- App is live at https://mbumah-hardware-pos-one.vercel.app
- Local dev running on port 3000 with Neon PostgreSQL
- Login: admin@mbumahhardware.co.ke / Admin@2024

## Completed Tasks

### Task 1: Prisma Schema Update
- Added SubCategory model (sub-categories within product categories)
- Added GiftCard model (code generation, loyalty tracking, expiry)
- Added DeliveryNote + DeliveryNoteItem models (delivery tracking)
- Added Invoice + InvoiceItem models (invoices, quotations, proformas, credit/debit notes)
- Added CustomerCredit model (credit/debit tracking with running balance)
- Updated Customer model: added totalPurchases, totalSpent, purchaseCount, giftCards, customerCredits relations
- Updated Product model: added subCategoryId, subCategory relation, invoiceItems relation
- Updated SalesTransaction model: added customerPhone, deliveryNote relation
- Updated Store model: added giftCards, deliveryNotes, invoices, customerCredits relations
- Updated ProductCategory model: added subCategories relation
- Schema pushed successfully to Neon PostgreSQL

### Task 2: Backend API Routes
Created 9 new API route files:
1. `/api/subcategories/route.ts` - GET/POST sub-categories
2. `/api/gift-cards/route.ts` - GET/POST gift cards (auto-generate MH-GC-XXXXXX codes)
3. `/api/delivery-notes/route.ts` - GET/POST delivery notes
4. `/api/delivery-notes/[id]/route.ts` - GET/PUT delivery note details
5. `/api/invoices/route.ts` - GET/POST invoices/quotations (type-based numbering)
6. `/api/invoices/[id]/route.ts` - GET/PUT invoice details
7. `/api/customer-credits/route.ts` - GET/POST credit/debit entries
8. `/api/reports/fast-moving/route.ts` - GET fast-moving products report
9. `/api/whatsapp/send/route.ts` - POST generate wa.me links

### Task 2-b: API Client & Types Updated
- Added 7 new TypeScript types in `src/lib/types.ts`
- Added 7 new API client objects in `src/lib/api.ts`
- Updated AppTab type in stores.ts with 4 new tabs: gift-cards, invoices, delivery-notes, credits

### Task 3: Frontend Updates
- Cashier POS redirect: When CASHIER role logs in, automatically switches to POS tab
- Mbumah logo added to receipt header
- Customer phone field added to checkout (both desktop and mobile views)
- Auto-fill phone when customer is selected
- customerPhone field sent in checkout payload
- Updated transaction creation API to include customerPhone

### Task 5: Gift Cards Tab (`src/app/tabs/gift-cards-tab.tsx`)
- Stats cards: Active Cards, Total Balance, Active Clients, Issued This Month
- Gift Cards table with status badges, balance progress bars, expiry tracking
- Top Active Clients sidebar ranked by totalPurchases
- Loyalty tier badges (Bronze/Silver/Gold)
- Create Gift Card dialog with customer selection, amount, reason, expiry

### Task 6: Delivery Notes Tab (`src/app/tabs/delivery-notes-tab.tsx`)
- Stats cards: Pending, In Transit, Delivered Today, Total Notes
- Table with delivery #, customer, phone, address, driver, status
- Create dialog with customer info, items, driver, vehicle, scheduled date
- View dialog with delivery timeline and status transitions
- Print support

### Task 7: Invoices Tab (`src/app/tabs/invoices-tab.tsx`)
- Type filter tabs: All | Invoices | Quotations | Proformas | Credit Notes | Debit Notes
- Stats cards: Total Invoices, Pending Quotations, Total Revenue, Outstanding
- Table with type/status badges
- Create dialog with type selector, customer, line items editor, auto-calculation
- View dialog with full document preview and print
- Convert Quotation → Invoice functionality

### Task 8: Fast Moving Products (in Reports tab)
- Added 'fast_moving' report type
- Stats cards: Fast Moving Items, Total Units Sold, Revenue from Fast Movers
- Ranked product list with progress bars, sales count, revenue, stock level
- Low stock warning indicator

### Task 9: WhatsApp Messaging
- Added WhatsApp button in Customers tab
- Generates wa.me links with pre-filled messages
- Auto-includes debt reminders for customers with outstanding balances
- Normalizes Kenyan phone numbers (0 → 254)

### Task 10: Mbumah Logo
- Generated professional logo via AI image generation
- Added to /public/logo.png
- Logo appears in: login screen, sidebar, receipt header

### Task 11: More Database Items
- Updated seed file with additional product definitions
- API-based product addition ready (server connectivity issues in sandbox)

### Task 12: Credits Tab (`src/app/tabs/credits-tab.tsx`)
- Stats cards: Total Credits, Total Debits, Net Balance, Active Accounts
- Credit ledger table with running balance
- Customer balance cards sidebar
- Add Credit/Debit dialog with live preview
- Color-coded amounts and type badges

### Task 7: Users API RBAC Enforcement
- Updated `/api/users/route.ts` `createUserHandler` to enforce admin-only user creation
- Added Bearer token authentication (same pattern as `/api/auth/me`)
- Session lookup with expiry and deactivation checks
- Gate 1: Only SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER can create users (CASHIER/ACCOUNTANT → 403)
- Gate 2: Role-based creation permissions enforced:
  - SUPER_ADMIN → can create any role
  - STORE_OWNER → can create any role except SUPER_ADMIN
  - BRANCH_MANAGER → can only create CASHIER and ACCOUNTANT
  - CASHIER / ACCOUNTANT → cannot create users at all
- System logging for both denied attempts (USER_CREATE_DENIED / WARN) and successful creations (USER_CREATED / INFO)
- Denied logs include requesting role and target role metadata
- Successful logs include creator info in the message

## Unresolved Issues
- Server sometimes dies in sandbox due to memory constraints (large monolithic page.tsx)
- Products need to be added via UI since API scripting was unreliable in sandbox
- Need to git commit and push changes for PR

### Task 5: Types Update — New Model Types, Permission Matrix, AppTabs, canCreateUsers
- Added 18 new TypeScript interface definitions in `src/lib/types.ts` matching new Prisma models:
  - **Vouchers**: VoucherItem, VoucherCampaignItem, VoucherRedemptionItem
  - **Banking**: BankAccountItem, BankTransactionItem, BankReconciliationItem, MpesaReconciliationItem
  - **Loyalty**: LoyaltyTierItem, CustomerLoyaltyItem, LoyaltyTransactionItem, LoyaltyCampaignItem
  - **Tax**: TaxCategoryItem, TaxRateItem, TaxFilingItem
  - **Transfers**: StoreTransferItem (header), StoreTransferItemDetail (line)
  - **Expenses**: ExpenseBudgetItem, ExpenseApprovalItem
  - **CRM**: CustomerInteractionItem
- Updated PERMISSION_MATRIX with 7 new resources:
  - `users`: SUPER_ADMIN/STORE_OWNER have create+manage; BRANCH_MANAGER has create; CASHIER/ACCOUNTANT have none
  - `vouchers`: Full CRUD for admin roles, read-only for CASHIER/ACCOUNTANT
  - `banking`: Full CRUD+reconcile+approve for admin; read+reconcile for BRANCH_MANAGER/ACCOUNTANT; none for CASHIER
  - `loyalty`: Full CRUD for SUPER_ADMIN; create/read/update for STORE_OWNER/BRANCH_MANAGER; read for CASHIER/ACCOUNTANT
  - `tax`: Full CRUD+file+approve for SUPER_ADMIN; read+file for ACCOUNTANT; read-only for BRANCH_MANAGER; none for CASHIER
  - `transfers`: Full+approve+receive for admin; create/read/receive for BRANCH_MANAGER; read for ACCOUNTANT; none for CASHIER
  - `crm`: Full CRUD for admin; create/read/update for BRANCH_MANAGER; create/read for CASHIER; read for ACCOUNTANT
- Added 5 new AppTab types in `src/lib/stores.ts`: 'vouchers', 'banking', 'loyalty', 'tax', 'transfers'
- Added `canCreateUsers(role: UserRole): boolean` helper function — returns true only for SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER
- Lint passes cleanly with no errors

### Task 6: API Routes — Vouchers, Banking, Loyalty, Tax, Transfers, CRM
Created 14 new API route files following the existing pattern (withErrorBoundary, systemLog, pagination, search/filter):

1. `/api/vouchers/route.ts` - GET (list with search/filter by status/type/campaign) + POST (create voucher with auto-generated MH-VC-XXXXXXXX codes)
2. `/api/vouchers/[id]/route.ts` - GET (detail with redemptions) + PUT (update status/fields) + DELETE (only if no redemptions)
3. `/api/voucher-campaigns/route.ts` - GET (list with filter) + POST (create campaign: PROMOTION/SEASONAL/LOYALTY/REFERRAL/FLASH_SALE)
4. `/api/banking/accounts/route.ts` - GET (list with type/active filter, balance summary) + POST (create CHECKING/SAVINGS/MPESA/PETTY_CASH)
5. `/api/banking/transactions/route.ts` - GET (list with date/type/reconciled filter, amount summary) + POST (create with auto-balance update in transaction)
6. `/api/banking/reconciliations/route.ts` - GET (list with status/date filter) + POST (create with auto difference calculation)
7. `/api/loyalty/tiers/route.ts` - GET (list sorted by sortOrder, with customer count) + POST (create tier with validation)
8. `/api/loyalty/transactions/route.ts` - GET (list with type/date filter, earn/redeem summary) + POST (EARN/REDEEM/BONUS/EXPIRE/ADJUST with auto CustomerLoyalty update)
9. `/api/loyalty/campaigns/route.ts` - GET (list with status/type filter) + POST (create BONUS_POINTS/DOUBLE_POINTS/TIER_UPGRADE/SPECIAL_EVENT)
10. `/api/tax/categories/route.ts` - GET (list with tax rates, eTIMS code search) + POST (create with 0-100 rate validation)
11. `/api/tax/filings/route.ts` - GET (list with period/type/status filter, totals summary) + POST (create VAT/WHT/INCOME_TAX/TURNOVER_TAX filing)
12. `/api/store-transfers/route.ts` - GET (list across from/to stores) + POST (create with XFR-YYYYMMDD-XXXXX numbering, items array)
13. `/api/store-transfers/[id]/route.ts` - GET (detail with items/products) + PUT (approve/ship/receive/cancel actions with stock movement logic)
14. `/api/customer-interactions/route.ts` - GET (list with type/status/priority filter, open/high-priority summary) + POST (NOTE/CALL/EMAIL/VISIT/WHATSAPP/COMPLAINT/FEEDBACK)

All routes:
- Support search/filter via query params
- Support pagination (page, limit)
- Use withErrorBoundary wrapper
- Log important actions with systemLog
- Follow the same pattern as existing routes
- Lint passes cleanly with no errors

### Task 9: API Client — New Endpoint Functions in api.ts
Updated `src/lib/api.ts` with 6 new API client sections for all Task 6 backend routes:

1. **Vouchers API** (`vouchersApi`) — list (with search/filter by status/type/campaign), create, get, update, delete
2. **Voucher Campaigns API** (`voucherCampaignsApi`) — list (with filter by type/status), create
3. **Banking API** (`bankingApi`) — nested structure:
   - `bankingApi.accounts` — list (with type/active filter), create
   - `bankingApi.transactions` — list (with type/date/reconciled filter), create
   - `bankingApi.reconciliations` — list (with status/date filter), create
4. **Loyalty API** (`loyaltyApi`) — nested structure:
   - `loyaltyApi.tiers` — list (with active filter), create
   - `loyaltyApi.transactions` — list (with type/date filter), create
   - `loyaltyApi.campaigns` — list (with type/status filter), create
5. **Tax API** (`taxApi`) — nested structure:
   - `taxApi.categories` — list (with active/search filter), create
   - `taxApi.filings` — list (with type/status/period filter), create
6. **Store Transfers API** (`storeTransfersApi`) — list (with from/to store filter), get, create, update
7. **Customer Interactions API** (`customerInteractionsApi`) — list (with type/status/priority filter), create

Type imports added at top:
- VoucherItem, VoucherCampaignItem
- BankAccountItem, BankTransactionItem, BankReconciliationItem
- LoyaltyTierItem, LoyaltyTransactionItem, LoyaltyCampaignItem
- TaxCategoryItem, TaxFilingItem
- StoreTransferItem (imported and re-exported as StoreTransferHeaderItem)
- CustomerInteractionItem
- canCreateUsers (re-exported)

All new types are re-exported for consumer convenience. Lint passes cleanly.

## Priority for Next Phase
1. Test all new features via agent-browser
2. Fix any runtime errors
3. Add product images via image generation
4. Git commit and create PR
5. Performance optimization (split page.tsx into smaller components)

### Task 10: Frontend Updates — New Tabs, CASHIER Redirect, User Creation RBAC
- **CASHIER login redirect**: Already existed in page.tsx (lines 323-326) — CASHIER role auto-redirects to 'pos' tab after login
- **Added 5 new tabs to TAB_CONFIG** in page.tsx:
  - { id: 'vouchers', label: 'Vouchers', icon: Tag } (after gift-cards)
  - { id: 'loyalty', label: 'Loyalty', icon: Sparkles } (after credits)
  - { id: 'banking', label: 'Banking', icon: Wallet } (after financial)
  - { id: 'tax', label: 'Tax/eTIMS', icon: FileText } (after financial/banking)
  - { id: 'transfers', label: 'Transfers', icon: ArrowUpDown } (after inventory)
- **Added lazy-loaded tab imports**: LazyVouchersTab, LazyLoyaltyTab, LazyBankingTab, LazyTaxTab, LazyTransfersTab
- **Added tab content rendering** in renderTab() switch statement for all 5 new tabs
- **Restricted "Add User" button** in admin-tab.tsx: Only visible when canCreateUsers() returns true (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER)
- **Created 5 stub tab components** with placeholder UI matching existing design:
  - `src/app/tabs/vouchers-tab.tsx` — Vouchers placeholder with stats cards
  - `src/app/tabs/loyalty-tab.tsx` — Loyalty program placeholder
  - `src/app/tabs/banking-tab.tsx` — Banking/accounts placeholder
  - `src/app/tabs/tax-tab.tsx` — Tax/eTIMS placeholder
  - `src/app/tabs/transfers-tab.tsx` — Store transfers placeholder
- Lint passes cleanly with no errors

### Task 11a: Full Vouchers Tab Component (`src/app/tabs/vouchers-tab.tsx`)
- Replaced placeholder stub with complete feature-rich Vouchers tab component
- **Stats cards**: Active Vouchers, Total Redemptions, Total Discount Value, Active Campaigns (with border-l colors, icons, sub-labels)
- **Inner tabs** (using shadcn Tabs): Vouchers, Campaigns, Redemptions
- **Vouchers sub-tab**:
  - Search by code, name, type, description
  - Status filter (All/Active/Paused/Expired/Cancelled) and Type filter (All/Fixed/Percentage/Free Product/Bundle) with collapsible filter row
  - Table with columns: Code (with copy button), Name, Type (colored badges), Value, Min Purchase, Uses (with progress bar), Status (animated badges), Start/End Dates, Actions
  - Actions: Toggle pause/activate, Edit, Delete (with tooltip)
  - Create Voucher dialog: Name, auto-generated code notice (MH-VC-XXXXXXXX), Type selector (FIXED/PERCENTAGE/FREE_PRODUCT/BUNDLE with icons), Value (KES/% prefix), Min Purchase, Max Discount, Max Total Uses, Max Uses Per User, Start/End dates, Campaign selector, Description
  - Edit Voucher dialog: Pre-populated form with same fields
  - Delete Voucher dialog: Confirmation with warning for vouchers with existing redemptions
  - Pause/activate toggle via update mutation
- **Campaigns sub-tab**:
  - Status and Type filter dropdowns
  - Campaign cards (2-column grid) with: Name, Type+Status badges, description, Budget progress bar (spent/budget), 3-column stats (Redemptions, Revenue, Spent), Start/End dates, Target Audience, Voucher count
  - Create Campaign dialog: Name, Type (PROMOTION/SEASONAL/LOYALTY/REFERRAL/FLASH_SALE), Budget, Start/End dates, Target Audience, Description
- **Redemptions sub-tab**:
  - Table listing all redemptions aggregated from vouchers: Voucher Code, Voucher Name, Type, Customer (redeemedBy), Original Total, Discount (red -KES), Final Total, Date
- All CRUD operations use vouchersApi and voucherCampaignsApi from @/lib/api
- Full mutation handling with loading spinners, success/error toasts via sonner
- Consistent UI patterns matching gift-cards-tab.tsx and invoices-tab.tsx
- Lint passes cleanly with no errors

### Task 11b: Full Banking Tab Component
- Replaced placeholder `src/app/tabs/banking-tab.tsx` with full-featured component
- **Stats cards**: Total Bank Balance, Total Accounts, Pending Reconciliations, M-Pesa Pending
- **Balance summary by account type** with progress bars (CHECKING/SAVINGS/MPESA/PETTY_CASH)
- **Inner tabs** (using shadcn Tabs): Bank Accounts, Transactions, Reconciliations, M-Pesa
- **Bank Accounts sub-tab**:
  - Table with bank name, account name, account number, type badge, currency, balance, active status
  - Empty state with create prompt
  - Create Account dialog: bank name, account name, account number, type (CHECKING/SAVINGS/MPESA/PETTY_CASH), branch, SWIFT code, currency (KES/USD/EUR/GBP), opening balance
- **Transactions sub-tab**:
  - Full filter bar: search, account, type, reconciled status, date range
  - Paginated table (15 per page) with date, account, type icon+label, amount (color-coded +/-), reference, balance after, reconciled badge
  - Create Transaction dialog with running balance preview
  - Supports DEPOSIT/WITHDRAWAL/TRANSFER/FEE/INTEREST types
- **Reconciliations sub-tab**:
  - Card-based list with statement/book/difference comparison, status badge
  - Create Reconciliation dialog with auto-populated book balance and live difference preview
  - Approve workflow dialog with warning for non-zero differences
  - View details dialog with full reconciliation info
  - Status flow: DRAFT → IN_PROGRESS → COMPLETED → APPROVED
- **M-Pesa sub-tab**:
  - Table of M-Pesa account transactions
  - Filter by status (PENDING/MATCHED/UNMATCHED/DISPUTED)
  - Empty state prompting M-Pesa account creation
- Uses same UI patterns: formatKES, formatDate/formatDateTime, shadcn/ui, toast from sonner, useQuery/useMutation
- All CRUD via bankingApi from @/lib/api
- Lint passes cleanly with no errors

### Task 12: Seed Data Update — New Models
Updated `prisma/seed.ts` with comprehensive seed data for all new Prisma models. Each section checks the respective model count before seeding to avoid duplicate data:

1. **Expanded Product Catalog (68 new products)** — Added across all categories with realistic Kenyan hardware store pricing (KES):
   - More cement: Dangote 50kg, Ndovu 50kg, Bamburi 25kg, Simba 25kg
   - More iron sheets: 32-gauge, 10ft lengths, coloured mabati (Blue, Red)
   - More paints: Sadolin Superdec (20L, 4L), Dulux 1L, Crown (4L, 1L), Undercoat 20L, Primer 20L
   - Plumbing: PVC pipes (1", 3"), fittings (elbow, tee), taps (basin, garden), GI pipe, water tanks (1000L, 2300L, 5000L)
   - Electrical: cables (1.5mm, 4mm), switches (1-gang, 2-gang), sockets, DB box, MCB
   - Tools: club hammer, ball pein hammer, hacksaw, handsaw, impact drill, measuring tapes (5m, 30m), spirit level, trowel, masonry hammer
   - Nails/screws: 6-inch, 1-inch panel pins, concrete nails, drywall screws, bolts & nuts, washers
   - Safety: helmets (white, yellow), gloves (leather, rubber), goggles, N95 masks, safety boots, reflector jackets, harness
   - Roofing: gutters, downpipes, ridge caps, flashing rolls, valley gutters, brackets
   - Timber/boards: timber (2x6, 2x2, 1x6), plywood (9mm, 12mm), hardboard, gypsum board
   - Additional rebar: 16mm, 20mm, deformed 12mm
   - New categories: Safety Equipment, Roofing Materials, Timber & Boards

2. **Loyalty Tiers** — 4 tiers with progressive benefits:
   - Bronze (0-499 pts, 0% discount, #CD7F32)
   - Silver (500-1499 pts, 5% discount, #C0C0C0)
   - Gold (1500-4999 pts, 10% discount, #FFD700)
   - Platinum (5000+ pts, 15% discount, #E5E4E2)

3. **Tax Categories** — 4 categories with eTIMS codes + 8 tax rates:
   - VAT 16% (eTIMS "01") — Standard 16%, Zero Rate, Exempt
   - WHT 5% (eTIMS "02") — Standard 5%, Contractor 3%
   - Service Charge 2% (eTIMS "03") — Standard 2%
   - Excise Duty 15% (eTIMS "04") — Standard 15%, Reduced 10%

4. **Bank Accounts** — 3 accounts with opening/current balances:
   - KCB Business Account (CHECKING, KES 485,000)
   - Equity Savings Account (SAVINGS, KES 218,500)
   - M-Pesa Paybill (MPESA, KES 34,500)

5. **Voucher Campaigns** — 2 campaigns:
   - "New Year Sale 2025" (SEASONAL, 87 redemptions, KES 1.25M revenue)
   - "Loyalty Rewards" (LOYALTY, 34 redemptions, KES 680K revenue)

6. **Vouchers** — 5 vouchers across different types:
   - MH-VC-NY2025OFF (PERCENTAGE, 10% off cement)
   - MH-VC-FLAT2K (FIXED, KES 2,000 off iron sheets)
   - MH-VC-LOYAL15 (PERCENTAGE, 15% loyalty discount)
   - MH-VC-FREETAPE (FREE_PRODUCT, free measuring tape)
   - MH-VC-BUNDLE01 (BUNDLE, KES 3,500 off bundle)

7. **Customer Interactions** — 5 sample interactions:
   - COMPLAINT (late delivery), CALL (debt follow-up), VISIT (project inquiry), WHATSAPP (availability), FEEDBACK (service praise)

8. **Expense Budgets** — 3 budgets for January 2025:
   - RENT (KES 25,000 budget, fully spent)
   - SALARIES (KES 120,000 budget, KES 18,000 spent)
   - UTILITIES (KES 15,000 budget, KES 4,500 spent)

All data references valid storeId, organizationId, customerIds, and userIds from existing seed data. Lint passes cleanly.

### Task 11c: Loyalty Tab — Full Implementation
Replaced the stub `src/app/tabs/loyalty-tab.tsx` with a comprehensive loyalty program management component:

- **Stats Cards**: Total Members, Points Issued, Points Redeemed, Active Campaigns
- **Sub-tabs** (using shadcn Tabs): Tiers, Members, Transactions, Campaigns
- **Tiers sub-tab**:
  - Visual tier cards with colored accent bars, tier icon, name, min points, discount %, multiplier, active members count, benefits
  - Create/Edit tier dialog with all fields (name, min/max points, discount %, multiplier, sort order, active status, benefits)
  - Color picker with 10 preset colors (Bronze, Silver, Gold, Platinum, Emerald, Sapphire, Ruby, Amethyst, Rose, Obsidian) plus custom hex input
  - Edit button per tier card opens pre-filled dialog
  - Empty state with CTA to create first tier
- **Members sub-tab**:
  - Customer list with loyalty profile: avatar, name, phone, tier badge (color-coded), points balance, lifetime points, next tier progress bar
  - Search by name/phone, filter by tier dropdown
  - Quick actions: Adjust Points (opens dialog with type selector: Adjust/Bonus/Redeem, points input, description), View History (opens dialog showing member's loyalty transaction timeline)
  - Sorted by loyalty points descending
- **Transactions sub-tab**:
  - Points history table: date, customer, type (EARN/REDEEM/BONUS/EXPIRE/ADJUST), points (color-coded: green for earn/bonus, blue for redeem, gray for expire, amber for adjust), reference, description
  - Type badge with icon and color per transaction type
  - Filter by type dropdown, date range (from/to inputs)
  - Manual Points Adjustment dialog: customer selector, type, points, reference, description
- **Campaigns sub-tab**:
  - Campaign cards: name, type badge (BONUS_POINTS/DOUBLE_POINTS/TIER_UPGRADE/SPECIAL_EVENT), status badge (DRAFT/ACTIVE/COMPLETED/CANCELLED), description, date range, bonus points, multiplier, participants, total points awarded
  - Filter by status dropdown
  - Create Campaign dialog: name, description, type selector, target tier (all or specific), bonus points, multiplier, start/end dates
- Uses existing API clients: `loyaltyApi.tiers`, `loyaltyApi.transactions`, `loyaltyApi.campaigns`, `customersApi`
- Uses `useQuery`/`useMutation` from TanStack Query, `toast` from sonner
- Uses `formatKES`, `formatDate`, `formatDateTime` from `@/lib/api`
- Consistent with project UI patterns (shadcn/ui components, Card, Badge, Dialog, Table, etc.)
- Lint passes cleanly with no errors

### Task 11d: Tax/eTIMS Tab — Full Implementation
Replaced the stub `src/app/tabs/tax-tab.tsx` with a comprehensive tax management and KRA eTIMS compliance component:

- **Stats Cards**: Total VAT Collected, WHT Withheld, Filings Due, eTIMS Status
- **Sub-tabs** (using shadcn Tabs): Tax Categories, Tax Filings, eTIMS Settings
- **Tax Categories sub-tab**:
  - Search by name/eTIMS code
  - Collapsible category cards showing: name, rate %, eTIMS code, active status
  - Expanded view with detailed info grid and nested Tax Rate History table (name, rate, effective from/to, status)
  - Create/Edit Category dialog: name, rate % (0–100 validated), eTIMS code, description, active toggle
  - Edit button inside expanded view
  - Empty state with CTA to create first category
- **Tax Filings sub-tab**:
  - Filter by status (DRAFT/FILED/APPROVED/PAID/LATE) and type (VAT/WHT/INCOME_TAX/TURNOVER_TAX)
  - Table: period, type badge, total sales, total tax (red), status badge, filing date, eTIMS reference, view button
  - Click row or eye icon to open Filing Detail dialog with full info grid
  - Create Filing dialog: period (YYYY-MM), type selector, total sales, total tax, WHT amount, due date, notes
  - Status workflow legend card: Draft → Filed → Approved → Paid (with Late branch)
- **eTIMS Settings sub-tab**:
  - Configuration panel: API URL, API Key (password), Device Serial Number, PIN (password)
  - Test Connection button with loading spinner and connected/disconnected badge
  - Save Settings button with success toast
  - Sync Status card: last sync, mapped categories count, pending filings, device registration status
- Uses `taxApi.categories` and `taxApi.filings` from `@/lib/api`
- Uses `useQuery`/`useMutation` from TanStack Query, `toast` from sonner
- Consistent with project UI patterns (shadcn/ui, formatKES, formatDate, Badge variants)
- Lint passes cleanly with no errors

### Task 11e: Store Transfers Tab — Full Implementation
Replaced the stub `src/app/tabs/transfers-tab.tsx` with a comprehensive inter-store stock transfer management component:

- **Stats Cards**: Pending Transfers, In Transit, Completed This Month, Total Items Transferred
- **Sub-tabs** (using shadcn Tabs): All Transfers, Create Transfer
- **All Transfers sub-tab**:
  - Filter by status (PENDING/IN_TRANSIT/RECEIVED/CANCELLED/PARTIAL), from store, to store
  - Table: transfer number (monospace), from store (with icon), to store (with arrow icon), items count badge, status badge, requested by, date, view button
  - Click row to open Transfer Detail dialog
  - Transfer Detail dialog:
    - Route visualization (from → to with MapPin icons)
    - Info grid: status, items count, requested by, created/shipped/received dates
    - Transfer Items table: product name, SKU, qty, received qty, unit type
    - Notes display
    - Contextual action buttons based on status:
      - PENDING: Approve & Ship (blue), Cancel (destructive)
      - IN_TRANSIT: Mark Received (green)
  - Empty state with CTA to create first transfer
- **Create Transfer sub-tab**:
  - From/To store selectors (auto-excludes same store)
  - Product search with autocomplete dropdown (searches by name/SKU, shows stock level and price)
  - Added items list with quantity controls (-/+/input), unit type, remove button
  - Duplicate product prevention
  - Notes textarea
  - Submit button with validation (stores must differ, at least 1 item, qty ≥ 1)
  - Auto-switches to All Transfers tab on success
- Fetches stores list from `/api/stores` for store selectors
- Uses `storeTransfersApi` from `@/lib/api` and `productsApi.search`
- Uses `useQuery`/`useMutation` from TanStack Query, `toast` from sonner
- Consistent with project UI patterns (shadcn/ui, formatKES, formatDate, formatDateTime)
- Lint passes cleanly with no errors
