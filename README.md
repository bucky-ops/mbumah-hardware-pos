<div align="center">

# 🔧 MBUMAH HARDWARE POS & ERP

**Modern Point of Sale & Enterprise Resource Planning System for Kenyan Hardware Stores**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[🌐 Live Demo](#-quick-start) · [📖 Documentation](#-table-of-contents) · [🐛 Report Bug](../../issues) · [✨ Request Feature](../../issues)

</div>

---

## 📑 Table of Contents

- [📋 Description](#-description)
- [🏗️ Architecture Overview](#️-architecture-overview)
- [✨ Features](#-features)
- [🛠️ Tech Stack](#️-tech-stack)
- [🚀 Quick Start](#-quick-start)
- [🔑 Demo Accounts](#-demo-accounts)
- [📡 API Endpoints](#-api-endpoints)
- [🗄️ Database Schema](#️-database-schema)
- [🔐 RBAC Permission Matrix](#-rbac-permission-matrix)
- [🛡️ Error Handling](#️-error-handling)
- [🏪 Branch Architecture](#-branch-architecture)
- [📸 Screenshots](#-screenshots)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## 📋 Description

**MBUMAH HARDWARE POS & ERP** is a full-featured, multi-tenant business management system built from the ground up for Kenyan hardware stores. Developed for **MBUMAH HARDWARE** — a multi-branch hardware retailer operating across five locations in Kenya — the system handles everything from point-of-sale checkout with M-Pesa integration to double-entry bookkeeping, inventory management, customer CRM, equipment rentals, and comprehensive financial reporting.

### Key Highlights

- 🏪 **Multi-tenant architecture** — Complete data isolation per branch via `storeId` discriminator
- 🇰🇪 **Kenya-first design** — KES currency, M-Pesa STK Push payments, KRA PIN tracking, 16% VAT
- ⚡ **Real-time POS** — Fast checkout with Cash, M-Pesa, and credit/debt payment methods
- 📊 **Double-entry accounting** — Every transaction auto-generates journal entries for audit-ready books
- 🎫 **Gift Card & Voucher system** — Create, redeem, adjust, and auto-manage gift cards with balance tracking
- 🔐 **Granular RBAC** — Role-based access control with per-resource, per-action permissions
- 🏗️ **Equipment rentals** — Full rental lifecycle with late fees, damage assessment, and revenue tracking
- 📱 **Responsive design** — Mobile-first UI with dark mode support across all tabs

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Next.js App Router)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ POS Tab  │ │Inventory │ │Customers │ │Financial │ │  Admin   │ │
│  │          │ │   Tab    │ │   Tab    │ │   Tab    │ │   Tab    │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │             │             │             │       │
│  ┌────┴─────────────┴─────────────┴─────────────┴─────────────┴──┐  │
│  │              Zustand Stores + TanStack Query                   │  │
│  │    (Auth Store │ Cart Store │ App Store + Query Cache)        │  │
│  └────────────────────────┬───────────────────────────────────────┘  │
│                           │ API Calls (fetch)                        │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                    API LAYER (Next.js API Routes)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  /auth   │ │/products │ │/transact.│ │/financial│ │ /rentals │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │             │             │             │       │
│  ┌────┴─────────────┴─────────────┴─────────────┴─────────────┴──┐  │
│  │              API Error Boundary + Validation                   │  │
│  │    (withErrorBoundary wrapper │ Zod schemas │ JWT auth)       │  │
│  └────────────────────────┬───────────────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                    DATA LAYER (Prisma ORM)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │Organization│ │  Store   │ │  User    │ │ Product  │ │Customer  │ │
│  │  Model    │ │  Model   │ │  Model   │ │  Model   │ │  Model   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │GiftCard  │ │  Debt    │ │ Rental   │ │ Account  │ │  Shift   │ │
│  │  Model   │ │  Ledger  │ │  Model   │ │  Model   │ │  Model   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                              │                                      │
│              storeId discriminator on ALL tenant-scoped tables       │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │         SQLite (dev)            │
              │      PostgreSQL (prod)          │
              └─────────────────────────────────┘
```

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Multi-tenancy** | `storeId` discriminator column on all tenant-scoped tables |
| **API-first** | All business logic behind REST API routes; frontend is a pure consumer |
| **Double-entry bookkeeping** | Every financial transaction auto-generates balanced journal entries |
| **Branch isolation** | Each branch sees only its own data; SUPER_ADMIN sees all |
| **Error resilience** | Global ErrorBoundary with auto-recovery + API error boundary wrapper |

---

## ✨ Features

### 💰 Point of Sale (POS)
- Fast product search with category filter chips and image thumbnails
- Cart management with quantity presets (+1, +2, +5, +10)
- Multi-payment checkout: **Cash**, **M-Pesa STK Push**, **Credit/Debt**
- Discount codes (SAVE10, SAVE20, MBUMAH, HARDWARE)
- Hold & recall cart functionality
- Auto receipt generation with print support (80mm thermal printers)
- VAT calculation (16% Kenya standard rate)
- Live dashboard stats with animated counters and sparklines

### 🏬 Multi-Branch Management
- **Juja Main** (Headquarters), **Thika**, **Ruiru**, **Nairobi CBD**, **Nakuru**
- Complete data isolation per branch via `storeId`
- Cross-branch visibility for SUPER_ADMIN role
- Branch-specific products, customers, and transactions
- Branch-based login redirects

### 📦 Inventory Management
- Product catalog with categories, SKU/barcode, and fractional quantities (kg, meters)
- Product bundles (e.g., Construction Starter Kit)
- Stock level tracking with reorder alerts
- Low stock notification panel with color-coded urgency
- Stock adjustment with ADD/SUBTRACT and reason tracking
- AI-generated category images for visual browsing

### 👥 Customer CRM
- Customer profiles with loyalty tiers (Bronze, Silver, Gold)
- Debt/credit management with payment recording
- Debt aging analysis with visual bars
- Quick-amount payment buttons (Full, Half, KES 5K, KES 10K)
- Transaction history per customer
- Outstanding debt notifications (>KES 50,000 alerts)

### 🎫 Gift Card & Voucher System
- Create gift cards with auto-generated codes (GC-XXXX-XXXX-XXXX)
- 8 reason types: Customer Loyalty, Promotion, Refund Credit, Store Credit, Gift, Employee Award, Complaint Resolution, Other
- Redeem with balance validation and remaining balance preview
- Balance adjustment (increase/decrease) with reason logging
- Auto-adjust visibility: cards automatically hide when fully redeemed
- Expiry date tracking and status management (Active, Partially Redeemed, Redeemed, Expired, Cancelled)

### 🔨 Equipment Rental Management
- Full rental lifecycle: Create → Active → Returned
- Visual dot-and-line timeline (Start → Expected → Actual return)
- Late fee calculation with automatic overdue detection
- Damage assessment form (None/Minor/Moderate/Severe)
- Rental revenue tracking with per-day metrics
- Overdue highlighting with animated status badges

### 📊 Double-Entry Accounting & Financial Reports
- Chart of accounts with 18 pre-configured accounts
- Auto-generated journal entries for every sale (Dr Cash/M-Pesa, Cr Revenue, Cr VAT)
- Revenue trend visualization with CSS bar charts
- Profit & Loss summary
- Debt aging analysis with stacked horizontal bars
- Account balance tree with color-coded groups
- Expandable journal entries with Dr/Cr color coding
- Date range presets (Today, This Week, This Month, This Quarter, This Year)

### 🔐 Role-Based Access Control (RBAC)
- 7 role types with granular per-resource, per-action permissions
- Permission resources: products, transactions, customers, financials, rentals, admin, reports, debt
- Permission actions: create, read, update, delete, approve, refund, export, void, manage_users, manage_stores, system_config, write_off, remind, adjust

### ⏱️ Shift Management
- Start/end shift with cash counting
- Live duration timer during active shift
- Cash difference calculation (expected vs. actual)
- Shift history with sales summary

### 📈 Reporting & Analytics
- Sales reports with period comparison (↑ 12.5% vs last period)
- Inventory valuation with category breakdown
- Top 5 products by revenue with rank indicators
- Payment method breakdown with visual bars
- CSV export with file size estimation
- Conic-gradient pie charts and SVG ring indicators
- Mini sparkline trend charts

### 🛡️ Error Boundary & State Persistence
- React ErrorBoundary with overlay UI, auto-recovery (3s), and action buttons
- API error boundary wrapper (`withErrorBoundary`) on all routes
- Custom error classes: `AppError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`
- `use-state-persistence` hook for crash recovery via localStorage
- 30-minute idle timeout with configurable duration

### 🔔 Real-Time Notifications
- Notification center (Sheet panel) with severity-based styling
- Low stock alerts (out-of-stock: red, low-stock: amber)
- Overdue rental alerts
- Large outstanding debt alerts (>KES 50,000)
- Unread badge counter with mark-all-read

### 🔍 Global Search
- Keyboard shortcut **Ctrl+K** / **⌘K** to open search
- Real-time search across products and customers
- Click results navigate to relevant tabs

---

## 🛠️ Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| [Next.js](https://nextjs.org/) | 16 | Full-stack React framework (App Router) |
| [TypeScript](https://www.typescriptlang.org/) | 5 | Type-safe JavaScript |
| [Prisma](https://www.prisma.io/) | 6 | ORM & database migrations |
| [Tailwind CSS](https://tailwindcss.com/) | 4 | Utility-first CSS framework |
| [shadcn/ui](https://ui.shadcn.com/) | Latest | 50+ reusable UI components (New York style) |
| [React](https://react.dev/) | 19 | UI library |
| [Zustand](https://zustand-demo.pmnd.rs/) | 5 | Client state management |
| [TanStack Query](https://tanstack.com/query/) | 5 | Server state & caching |
| [TanStack Table](https://tanstack.com/table) | 8 | Advanced data tables |
| [Recharts](https://recharts.org/) | 2 | Data visualization & charts |
| [Zod](https://zod.dev/) | 4 | Schema validation |
| [Lucide](https://lucide.dev/) | Latest | Icon library |
| [Framer Motion](https://www.framer.com/motion/) | 12 | Animations & transitions |
| [next-themes](https://github.com/pacocoursey/next-themes) | 0.4 | Dark mode support |
| [date-fns](https://date-fns.org/) | 4 | Date manipulation |
| [SQLite](https://www.sqlite.org/) | 3 | Local development database |
| [PostgreSQL](https://www.postgresql.org/) | 15+ | Production database (Supabase) |
| [Docker](https://www.docker.com/) | — | Containerization (Postgres, Redis, M-Pesa mock) |
| [Redis](https://redis.io/) | 7 | Caching & session storage (production) |
| [Bun](https://bun.sh/) | Latest | JavaScript runtime & package manager |
| Custom JWT | — | Session-based authentication |
| M-Pesa Daraja API | v2 | Payments (mock for dev) |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18 or **Bun** ≥ 1.0
- **Git** for version control
- **Docker** (optional, for PostgreSQL + Redis + M-Pesa mock)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos

# 2. Install dependencies
bun install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your configuration (see below)

# 4. Push database schema
bun run db:push

# 5. Generate Prisma client
bun run db:generate

# 6. Start the development server
bun run dev
```

The app will be available at `http://localhost:3000`.

### Environment Variables

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Key variables:

```env
# Database (SQLite for dev, PostgreSQL for prod)
DATABASE_URL="file:./db/custom.db"

# Authentication
NEXTAUTH_SECRET="change-this-to-a-secure-random-string"
NEXTAUTH_URL="http://localhost:3000"
JWT_SECRET="change-this-in-production"

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_CURRENCY="KES"

# M-Pesa Daraja API (Safaricom)
MPESA_CONSUMER_KEY=""
MPESA_CONSUMER_SECRET=""
MPESA_PASSKEY=""
MPESA_SHORTCODE="174379"
MPESA_ENVIRONMENT="sandbox"
MPESA_CALLBACK_URL="https://your-app.vercel.app/api/mpesa/callback"
```

### Database Setup

```bash
# Push schema changes to the database
bun run db:push

# Generate Prisma client
bun run db:generate

# Seed the database (auto-runs on first boot if no users exist)
bun run db:seed

# Reset the database (destructive!)
bun run db:reset
```

### Docker Setup (Optional)

For PostgreSQL, Redis, and the Mock M-Pesa service:

```bash
docker-compose up -d
```

This starts:

| Service | Port | Purpose |
|---------|------|---------|
| **PostgreSQL 15** | `5432` | Production-grade database with pg_trgm extension |
| **Redis 7** | `6379` | Caching & session storage |
| **Mock M-Pesa API** | `9000` | Simulates Safaricom Daraja API for local dev |

---

## 🔑 Demo Accounts

The seed script creates demo accounts for testing different roles and branches. All accounts use the password `password123`.

| Email | Password | Role | Branch |
|-------|----------|------|--------|
| `admin@mbumahhardware.co.ke` | `password123` | Super Admin | Juja Main |
| `owner@mbumahhardware.co.ke` | `password123` | Store Owner | Juja Main |
| `cashier@mbumahhardware.co.ke` | `password123` | Cashier | Juja Main |
| `accountant@mbumahhardware.co.ke` | `password123` | Accountant | Juja Main |
| `thika.manager@mbumahhardware.co.ke` | `password123` | Branch Manager | Thika |
| `thika.cashier@mbumahhardware.co.ke` | `password123` | Cashier | Thika |
| `ruiru.manager@mbumahhardware.co.ke` | `password123` | Branch Manager | Ruiru |
| `nairobi.manager@mbumahhardware.co.ke` | `password123` | Branch Manager | Nairobi CBD |
| `nakuru.manager@mbumahhardware.co.ke` | `password123` | Branch Manager | Nakuru |

> ⚠️ **Important**: Change these passwords immediately in production environments.

---

## 📡 API Endpoints

All API endpoints are prefixed with `/api/`. Authentication is via JWT token in the `Authorization: Bearer <token>` header.

### 🔐 Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | User login, returns JWT token + session |
| `GET` | `/api/auth/me` | Get current authenticated user |
| `POST` | `/api/auth/logout` | Logout and invalidate session |

### 📦 Products & Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List products (search, filter by category/store) |
| `POST` | `/api/products` | Create a new product |
| `GET` | `/api/products/[id]` | Get product by ID |
| `PUT` | `/api/products/[id]` | Update product |
| `DELETE` | `/api/products/[id]` | Delete product |
| `GET` | `/api/products/bundles` | List product bundles |
| `POST` | `/api/products/bundles` | Create product bundle |
| `GET` | `/api/categories` | List all categories |
| `POST` | `/api/categories` | Create category |
| `GET` | `/api/stock-movements` | Stock movement history |
| `POST` | `/api/stock-movements` | Record stock movement |

### 👥 Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/customers` | List customers (search, filter) |
| `POST` | `/api/customers` | Create customer |
| `GET` | `/api/customers/[id]` | Get customer details |
| `PUT` | `/api/customers/[id]` | Update customer |

### 💳 Transactions & Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/transactions` | List all transactions |
| `POST` | `/api/transactions` | Create a new sale / checkout |
| `GET` | `/api/transactions/[id]` | Get transaction details |
| `PUT` | `/api/transactions/[id]` | Update transaction |
| `POST` | `/api/payments/mpesa/stkpush` | Initiate M-Pesa STK Push |
| `POST` | `/api/payments/mpesa/callback` | M-Pesa callback handler |

### 🎫 Gift Cards

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gift-cards` | List gift cards (filter by status, reason, search) |
| `POST` | `/api/gift-cards` | Create gift card (auto-generates code) |
| `GET` | `/api/gift-cards/[id]` | Get gift card details with redemptions |
| `PUT` | `/api/gift-cards/[id]` | Update gift card fields |
| `DELETE` | `/api/gift-cards/[id]` | Cancel gift card |
| `POST` | `/api/gift-cards/[id]/redeem` | Redeem gift card with balance validation |
| `POST` | `/api/gift-cards/[id]/adjust` | Adjust gift card balance (increase/decrease) |

### 💰 Debt & Credit

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/debt` | List debt/credit records |
| `POST` | `/api/debt` | Record a debt payment |

### 🔨 Equipment Rentals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rentals` | List equipment rentals |
| `POST` | `/api/rentals` | Create rental record |
| `POST` | `/api/rentals/[id]/return` | Process rental return (with late fees) |

### 📊 Financial & Accounting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/financial/accounts` | Chart of accounts |
| `GET` | `/api/financial/journal` | Journal entries |
| `POST` | `/api/financial/journal` | Create journal entry |
| `GET` | `/api/financial/revenue-trend` | Revenue trend data |

### 📈 Reports & Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard` | Dashboard summary stats |
| `GET` | `/api/reports/sales` | Sales reports |
| `GET` | `/api/reports/inventory` | Inventory reports |
| `GET` | `/api/reports/export` | Export reports (CSV) |

### ⏱️ Shifts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/shifts` | List shifts |
| `POST` | `/api/shifts` | Start a new shift |
| `GET` | `/api/shifts/current` | Get current active shift |
| `POST` | `/api/shifts/[id]/end` | End a shift (with cash counting) |

### 🏪 Suppliers & Purchase Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/suppliers` | List suppliers (search, filter) |
| `POST` | `/api/suppliers` | Create supplier |
| `GET` | `/api/suppliers/[id]` | Get supplier details with PO stats |
| `PUT` | `/api/suppliers/[id]` | Update supplier |
| `DELETE` | `/api/suppliers/[id]` | Soft-delete supplier |
| `GET` | `/api/purchase-orders` | List purchase orders |
| `POST` | `/api/purchase-orders` | Create purchase order (auto PO number) |
| `GET` | `/api/purchase-orders/[id]` | Get PO details |
| `PUT` | `/api/purchase-orders/[id]` | Update PO status / receive items |

### 🏦 Expenses & Cash Drawer

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/expenses` | List expenses |
| `POST` | `/api/expenses` | Record expense |
| `GET` | `/api/cash-drawer` | Cash drawer status & logs |
| `GET` | `/api/receipts` | List receipts |
| `POST` | `/api/receipts` | Generate receipt |
| `GET` | `/api/receipts/[id]` | Get receipt by ID |

### 🏬 Stores & System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stores` | List organization stores |
| `GET` | `/api/system-logs` | Application logs |
| `GET` | `/api/audit-logs` | Audit trail |
| `GET` | `/api/system-config` | System configuration |
| `POST` | `/api/system-config` | Update configuration |
| `GET` | `/api/users` | List users |
| `GET` | `/api/notifications` | User notifications |

---

## 🗄️ Database Schema

The system uses **25+ Prisma models** organized into logical domains. All tenant-scoped tables include a `storeId` discriminator for multi-tenancy.

### Multi-Tenancy

| Model | Description |
|-------|-------------|
| **Organization** | Top-level entity (MBUMAH HARDWARE) with KRA PIN |
| **Store** | Branch/store with location, phone, email, tax PIN |

### Authentication & Authorization

| Model | Description |
|-------|-------------|
| **User** | User accounts with role, branch assignment, phone, KRA PIN |
| **Session** | JWT session management with 24-hour expiry |
| **RolePermission** | Granular per-resource, per-action permissions per role |

### Inventory

| Model | Description |
|-------|-------------|
| **ProductCategory** | Categories with color coding and icons |
| **Product** | Products with SKU, unit type (PIECE/KILOGRAM/METER/etc.), cost/sell prices, rental flag |
| **ProductBundle** | Bundle composition linking products to parent bundles |
| **WarehouseStock** | Per-warehouse stock levels |
| **StockMovement** | Stock movement audit trail (IN/OUT/ADJUSTMENT/TRANSFER) |

### Customer CRM

| Model | Description |
|-------|-------------|
| **Customer** | Customer profiles with phone, email, loyalty tier, credit limit, KRA PIN |

### Sales

| Model | Description |
|-------|-------------|
| **SalesTransaction** | Sales with receipt number, payment method, VAT, discount, totals |
| **SaleItem** | Line items linking products to transactions |
| **Payment** | Payment records with method (CASH/MPESA/CREDIT_CARD/MIXED), reference |
| **MpesaTransaction** | M-Pesa STK Push tracking with phone, amount, status |

### Gift Cards & Vouchers

| Model | Description |
|-------|-------------|
| **GiftCard** | Gift cards with code, balance, reason, auto-adjust, expiry, visibility |
| **GiftCardRedemption** | Redemption history with amounts, transaction links |

### Debt & Credit

| Model | Description |
|-------|-------------|
| **DebtLedger** | Outstanding debts with 30-day payment terms |
| **DebtPayment** | Payment records against debts |

### Equipment Rentals

| Model | Description |
|-------|-------------|
| **EquipmentRental** | Rental records with daily rate, deposit, expected/actual return, damage assessment |

### Accounting

| Model | Description |
|-------|-------------|
| **Account** | Chart of accounts (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE) with code, type, balance |
| **JournalEntry** | Journal entries with date, description, reference type |
| **JournalEntryLine** | Debit/credit lines linked to accounts and journal entries |

### Cash Management

| Model | Description |
|-------|-------------|
| **Shift** | Cashier shifts with start/end time, opening/closing cash, sales summary |
| **CashDrawerLog** | Cash drawer activity log (OPENING/CLOSING/CASH_IN/CASH_OUT) |

### Supporting Models

| Model | Description |
|-------|-------------|
| **Receipt** | Transaction receipts with receipt number |
| **SystemLog** | Application-level logging (INFO/WARN/ERROR) |
| **SystemConfig** | Key-value configuration store |
| **InitializationLog** | First-boot detection and seed tracking |
| **Supplier** | Supplier profiles with contact, rating, KRA PIN |
| **PurchaseOrder** | Purchase orders with auto-generated PO numbers |
| **PurchaseOrderItem** | Line items for purchase orders |

---

## 🔐 RBAC Permission Matrix

### Roles Overview

| Role | Scope | Description |
|------|-------|-------------|
| **SUPER_ADMIN** | Organization-wide | Full system access across all branches |
| **STORE_OWNER** | Single store | Full access within assigned store |
| **BRANCH_MANAGER** | Single branch | Manage operations within their branch |
| **CASHIER** | Single branch | POS operations and basic transactions |
| **ACCOUNTANT** | Single branch | Financial reports, debt management, exports |
| **STORE_KEEPER** | Single branch | Inventory management and stock movements |
| **SALES_REP** | Single branch | Sales and customer interactions |

### Permission Matrix

| Permission | SUPER_ADMIN | STORE_OWNER | BRANCH_MANAGER | CASHIER | ACCOUNTANT | STORE_KEEPER | SALES_REP |
|------------|:-----------:|:-----------:|:--------------:|:-------:|:----------:|:------------:|:---------:|
| **Products** |
| `products.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `products.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `products.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `products.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Transactions** |
| `transactions.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `transactions.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `transactions.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `transactions.void` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `transactions.refund` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Customers** |
| `customers.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `customers.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `customers.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Financials** |
| `financials.read` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `financials.export` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Rentals** |
| `rentals.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `rentals.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `rentals.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Debt** |
| `debt.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `debt.update` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `debt.write_off` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `debt.remind` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Reports** |
| `reports.read` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `reports.export` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Admin** |
| `admin.manage_users` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `admin.manage_stores` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `admin.system_config` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Gift Cards** |
| `gift_cards.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `gift_cards.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `gift_cards.redeem` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `gift_cards.adjust` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |

---

## 🛡️ Error Handling

The system implements a comprehensive, multi-layer error handling strategy:

### Global ErrorBoundary

```
┌─────────────────────────────────────────┐
│           React ErrorBoundary           │
│  ┌─────────────────────────────────────┐│
│  │  • Catches render errors            ││
│  │  • Auto-navigate back after 3s      ││
│  │  • Action buttons:                  ││
│  │    - Dismiss  - Retry               ││
│  │    - Go Back  - Dashboard           ││
│  │  • Dev mode: shows error stack      ││
│  │  • Persists error state to          ││
│  │    localStorage for recovery        ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### API Error Boundary

All API routes are wrapped with `withErrorBoundary` from `@/lib/logger`:

- Catches unhandled exceptions in route handlers
- Returns structured error responses with appropriate HTTP status codes
- Logs errors to the SystemLog model for audit trail

### Custom Error Classes

| Error Class | HTTP Status | Usage |
|-------------|:-----------:|-------|
| `AppError` | 500 | Base application error |
| `ValidationError` | 400 | Invalid input data |
| `NotFoundError` | 404 | Resource not found |
| `UnauthorizedError` | 401 | Missing or invalid authentication |
| `ForbiddenError` | 403 | Insufficient permissions |
| `ConflictError` | 409 | Duplicate or conflicting state |

### State Persistence

- `use-state-persistence` hook saves critical state to localStorage with timestamps
- `saveBeforeError()` captures state before crash for recovery
- `recoverState()` restores previous state on remount
- Automatic corruption handling for invalid localStorage data

### Idle Timeout

- `use-idle-timeout` hook with 30-minute configurable duration
- Activity detection on `mousedown`, `keydown`, `scroll`, `touchstart`, `click`
- localStorage persistence of last activity and session state
- Automatic session state recovery on remount

---

## 🏪 Branch Architecture

The system uses a **discriminator-column multi-tenancy** pattern where every tenant-scoped table includes a `storeId` column. This provides complete data isolation between branches while keeping the schema simple and performant.

### Branch Isolation Model

```
┌──────────────────────────────────────────────────────────┐
│                  MBUMAH HARDWARE (Organization)           │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Juja Main   │  │   Thika     │  │   Ruiru     │     │
│  │ (HQ)        │  │   Branch    │  │   Branch    │     │
│  │             │  │             │  │             │     │
│  │ • Products  │  │ • Products  │  │ • Products  │     │
│  │ • Customers │  │ • Customers │  │ • Customers │     │
│  │ • Transact. │  │ • Transact. │  │ • Transact. │     │
│  │ • Accounts  │  │ • Accounts  │  │ • Accounts  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐                       │
│  │ Nairobi CBD │  │   Nakuru    │                       │
│  │   Branch    │  │   Branch    │                       │
│  │             │  │             │                       │
│  │ • Products  │  │ • Products  │                       │
│  │ • Customers │  │ • Customers │                       │
│  │ • Transact. │  │ • Transact. │                       │
│  │ • Accounts  │  │ • Accounts  │                       │
│  └─────────────┘  └─────────────┘                       │
│                                                          │
│  SUPER_ADMIN sees all branches; others see only their own│
└──────────────────────────────────────────────────────────┘
```

### How It Works

| Aspect | Implementation |
|--------|---------------|
| **Data isolation** | Every query includes `where: { storeId }` — enforced at API layer |
| **Branch-specific products** | Each branch has its own product catalog with local pricing |
| **Branch-specific customers** | Customers belong to the branch where they registered |
| **Cross-branch visibility** | SUPER_ADMIN role can query across all branches |
| **Login redirect** | Users are redirected to their assigned branch dashboard |
| **Receipt numbering** | Branch prefix on receipts (JJA-RCPT, THK-RCPT, RUR-RCPT, NBI-RCPT, NKR-RCPT) |
| **Financial isolation** | Each branch has its own chart of accounts and journal entries |

### Branch Details

| Branch | Code | Location | Specialty Categories |
|--------|------|----------|---------------------|
| **Juja Main** | JJA | Salama M-Store, Juja | Full catalog (29 products, 10 categories) |
| **Thika** | THK | Thika Town, Kiambu County | Timber & Wood |
| **Ruiru** | RUR | Ruiru Town, Kiambu County | Electrical |
| **Nairobi CBD** | NBI | Kenyatta Avenue, Nairobi | Safety Equipment |
| **Nakuru** | NKR | Nakuru Town, Nakuru County | Water Tanks |

---

## 📸 Screenshots

> 🖼️ Screenshots coming soon! The system features a polished dark/light mode UI with:

| View | Description |
|------|-------------|
| 🏠 **Login** | Animated gradient background, frosted glass card, Kenyan flag accent, role-colored demo buttons |
| 💰 **POS** | Product grid with category images, animated cart, checkout with receipt preview |
| 📦 **Inventory** | Product management with search/filter, profit margin indicators, stock progress bars |
| 👥 **Customers** | Customer list with debt status, loyalty tier badges, payment recording |
| 🎫 **Gift Cards** | Card grid with balance progress, create/redeem/adjust dialogs |
| 🔨 **Rentals** | Rental timeline visualization, damage assessment, overdue alerts |
| 📊 **Financial** | Revenue trend charts, P&L summary, expandable journal entries |
| 📈 **Reports** | Sales comparison, top products, inventory valuation, CSV export |
| ⚙️ **Admin** | System health dashboard, user management, stock adjustments, activity feed |
| 🔍 **Global Search** | Ctrl+K search across products and customers |

---

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/mbumah-hardware-pos.git`
3. **Create a branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes** and commit: `git commit -m "feat: add your feature"`
5. **Push** to your fork: `git push origin feature/your-feature-name`
6. **Open a Pull Request** against the `main` branch

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add gift card bulk import
fix: resolve M-Pesa callback race condition
docs: update API reference for rentals
chore: upgrade Next.js to 16.1
refactor: extract checkout logic to service layer
```

### Guidelines

- Follow the existing **TypeScript** code style and ESLint configuration
- Write **clear, descriptive** commit messages
- Add **types** for all new interfaces and API payloads
- Update **documentation** for any changed behavior
- Keep PRs **focused** — one feature or fix per PR
- Ensure `bun run lint` passes before submitting
- Test across **light and dark** modes
- Verify **mobile responsiveness** for new UI components

### Code Style

- TypeScript throughout with strict typing
- ES6+ import/export syntax
- shadcn/ui components preferred over custom implementations
- Use `'use client'` for client components, `'use server'` for server code
- Prisma schema primitive types only (no lists)
- Business logic in API routes, not in client components

### Reporting Issues

- Use the **Bug Report** template for bugs
- Use the **Feature Request** template for new features
- Search existing issues before creating a new one
- Include steps to reproduce, expected behavior, and actual behavior

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024-2025 MBUMAH HARDWARE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<div align="center">

**Built with ❤️ for Kenyan hardware stores**

🇰🇪 *Asante sana!*

</div>
