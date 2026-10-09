# API reference

All endpoints live under `/api` and return JSON. Authentication and role checks are enforced per [Authentication and RBAC](authentication-and-rbac.md); every query is scoped to the caller's store as described in [Multi-tenant architecture](multi-tenant-architecture.md). Financial mutations additionally go through the double-entry engine described in [Architecture](architecture.md).

## Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Authenticate user and create session |
| `POST` | `/api/auth/logout` | End user session |
| `GET` | `/api/auth/me` | Get current authenticated user |
| `POST` | `/api/auth/manager-authorize` | Manager step-up authorization for gated actions (discounts above 5%, high-risk debt) |

## Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List all products (filtered by store) |
| `POST` | `/api/products` | Create a new product |
| `GET` | `/api/products/[id]` | Get product by ID |
| `PUT` | `/api/products/[id]` | Update product |
| `DELETE` | `/api/products/[id]` | Delete product |
| `GET` | `/api/products/bundles` | List product bundles |

## Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/categories` | List all categories |
| `POST` | `/api/categories` | Create a new category |

## Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/customers` | List customers (with debt and loyalty info) |
| `POST` | `/api/customers` | Create a new customer |
| `GET` | `/api/customers/[id]` | Get customer details |
| `PUT` | `/api/customers/[id]` | Update customer |
| `DELETE` | `/api/customers/[id]` | Delete customer |

## Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/transactions` | List transactions (filtered by store and date) |
| `POST` | `/api/transactions` | Create a new sale transaction |
| `GET` | `/api/transactions/[id]` | Get transaction details |

## M-Pesa payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/payments/mpesa/stkpush` | Initiate M-Pesa STK Push |
| `POST` | `/api/payments/mpesa/callback` | M-Pesa Daraja callback webhook |

## Gift cards

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gift-cards` | List gift cards |
| `POST` | `/api/gift-cards` | Create a gift card |
| `GET` | `/api/gift-cards/[id]` | Get gift card details |
| `PUT` | `/api/gift-cards/[id]` | Update gift card |
| `DELETE` | `/api/gift-cards/[id]` | Delete gift card |
| `POST` | `/api/gift-cards/[id]/redeem` | Redeem a gift card |
| `POST` | `/api/gift-cards/[id]/adjust` | Adjust gift card balance |

## Dashboard and reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard` | Dashboard summary metrics |
| `GET` | `/api/reports/sales` | Sales report data |
| `GET` | `/api/reports/inventory` | Inventory report data |
| `GET` | `/api/reports/export` | Export reports (CSV or PDF) |

## Financial

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/financial/accounts` | List chart of accounts |
| `POST` | `/api/financial/accounts` | Create an account |
| `GET` | `/api/financial/journal` | List journal entries |
| `POST` | `/api/financial/journal` | Create a journal entry |
| `GET` | `/api/financial/revenue-trend` | Revenue trend data |

## Shifts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/shifts` | List shifts |
| `POST` | `/api/shifts` | Start a new shift |
| `GET` | `/api/shifts/current` | Get current active shift |
| `PUT` | `/api/shifts/[id]/end` | End a shift |

## Debt management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/debt` | List customer debts |
| `POST` | `/api/debt` | Record a debt or payment |

## Equipment rentals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rentals` | List rentals |
| `POST` | `/api/rentals` | Create a rental |
| `POST` | `/api/rentals/[id]/return` | Process equipment return |

## Suppliers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/suppliers` | List suppliers |
| `POST` | `/api/suppliers` | Create a supplier |
| `GET` | `/api/suppliers/[id]` | Get supplier details |
| `PUT` | `/api/suppliers/[id]` | Update supplier |
| `DELETE` | `/api/suppliers/[id]` | Delete supplier |

## Expenses

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/expenses` | List expenses |
| `POST` | `/api/expenses` | Record an expense |

## Users and stores

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Create a user |
| `GET` | `/api/stores` | List stores |
| `POST` | `/api/stores` | Create a store |

## System and admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/system-config` | Get system configuration |
| `PUT` | `/api/system-config` | Update system configuration |
| `GET` | `/api/system-logs` | List system logs |
| `GET` | `/api/audit-logs` | List audit trail entries |
| `GET` | `/api/notifications` | List notifications |
| `POST` | `/api/notifications` | Create a notification |
| `GET` | `/api/stock-movements` | List stock movements |
| `POST` | `/api/stock-movements` | Record a stock movement |
| `GET` | `/api/purchase-orders` | List purchase orders |
| `POST` | `/api/purchase-orders` | Create a purchase order |
| `GET` | `/api/purchase-orders/[id]` | Get purchase order details |
| `PUT` | `/api/purchase-orders/[id]` | Update purchase order |
| `GET` | `/api/cash-drawer` | Get cash drawer status |
| `POST` | `/api/cash-drawer` | Record cash drawer action |
| `GET` | `/api/receipts` | List receipts |
| `POST` | `/api/receipts` | Generate a receipt |
| `GET` | `/api/receipts/[id]` | Get receipt details |

## Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health probe returning the app version and status (used by the release process, see [Release process](release-process.md)) |
