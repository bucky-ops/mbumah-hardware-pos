<div align="center">

<img src="public/logo.svg" alt="Mbumah Hardware Logo" width="120" height="120" />

# 🔧 MBUMAH HARDWARE — POS & ERP

### Modern Point-of-Sale & Enterprise Resource Planning System for Kenyan Hardware Stores

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](https://opensource.org/licenses/MIT)
[![Vercel](https://img.shields.io/badge/Vercel-Ready-black?logo=vercel&logoColor=white)](https://vercel.com/)

[🌐 Live Demo](#-getting-started) · [📖 Documentation](#-table-of-contents) · [🐛 Report Bug](https://github.com/bucky-ops/mbumah-hardware-pos/issues) · [✨ Request Feature](https://github.com/bucky-ops/mbumah-hardware-pos/issues)

</div>

---

## 📑 Table of Contents

- [✨ Feature Highlights](#-feature-highlights)
- [🏗️ Architecture Overview](#️-architecture-overview)
- [🛠️ Tech Stack](#️-tech-stack)
- [🚀 Getting Started](#-getting-started)
- [📁 Project Structure](#-project-structure)
- [📡 API Endpoints](#-api-endpoints)
- [🔐 Authentication & RBAC](#-authentication--rbac)
- [🗄️ Database Schema](#️-database-schema)
- [🏪 Multi-Tenant Architecture](#-multi-tenant-architecture)
- [⚙️ Configuration](#️-configuration)
- [🚢 Deployment](#-deployment)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Feature Highlights

| # | Module | Description |
|---|--------|-------------|
| 🏪 | **Multi-Branch POS** | 5 stores — Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru |
| 🔐 | **Role-Based Access Control** | 5 roles: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, ACCOUNTANT |
| 📦 | **Product & Inventory** | Categories, bundles, stock movements, low-stock alerts |
| 💰 | **Sales & POS** | Fast checkout with M-Pesa integration via Daraja API (STK Push) |
| 👥 | **Customer CRM** | Debt management, loyalty points, aging buckets, statements |
| 🔧 | **Equipment Rentals** | Rent-out tracking, return processing, overdue alerts |
| 🎁 | **Gift Cards** | Full CRUD, reasons, auto-adjusting visibility, redemptions |
| 📊 | **Financial Management** | Double-entry bookkeeping, journal entries, chart of accounts |
| ⏱️ | **Shift Management** | Start/end shifts, cash drawer reconciliation |
| 🚚 | **Supplier Management** | Supplier profiles, purchase orders, fulfillment tracking |
| 💸 | **Expense Tracking** | Categorised expenses with approval workflows |
| 📈 | **Reports & Analytics** | Sales, inventory, and financial reports with CSV/PDF export |
| 🏛️ | **eTIMS/TIMS Ready** | Kenya Revenue Authority tax compliance integration |

> **Plus:** Multi-tenant data isolation · Error boundary with SUPER_ADMIN overlay · State persistence (localStorage) · 30-min idle timeout · Vercel Analytics · Dark/Light theme

---

## 🏗️ Architecture Overview

```mermaid
graph TB
    subgraph Client ["🖥️ Frontend (React)"]
        UI[shadcn/ui Components]
        ZS[Zustand Store]
        RQ[React Query]
        PM[Persistence Manager]
    end

    subgraph Server ["⚙️ Next.js 16 App Router"]
        API[REST API Routes]
        MW[Auth Middleware]
        EB[Error Boundary]
    end

    subgraph Services ["🔌 External Services"]
        MP[M-Pesa Daraja API]
        EM[Email / SMS]
        VA[Vercel Analytics]
    end

    subgraph Data ["💾 Data Layer"]
        PC[Prisma Client]
        DB[(SQLite / PostgreSQL)]
    end

    UI --> ZS
    UI --> RQ
    ZS --> PM
    RQ --> API
    API --> MW
    MW --> PC
    PC --> DB
    API --> MP
    API --> EM
    UI --> VA
    API --> EB
```

---

## 🛠️ Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| **Framework** | [Next.js](https://nextjs.org/) (App Router) | 16 |
| **Language** | [TypeScript](https://www.typescriptlang.org/) | 5 |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) | 4 |
| **Database** | [Prisma ORM](https://www.prisma.io/) — SQLite (dev) / PostgreSQL (prod) | 6 |
| **State Management** | [Zustand](https://zustand.docs.pmnd.rs/) (client) + [TanStack Query](https://tanstack.com/query) (server) | 5 |
| **Forms** | [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/) | 7 / 4 |
| **Authentication** | [NextAuth.js](https://next-auth.js.org/) | 4 |
| **Payments** | [M-Pesa Daraja API](https://developer.safaricom.co.ke/) | — |
| **Charts** | [Recharts](https://recharts.org/) | 2 |
| **Animations** | [Framer Motion](https://motion.dev/) | 12 |
| **Icons** | [Lucide React](https://lucide.dev/) | — |
| **Analytics** | [Vercel Analytics](https://vercel.com/analytics) | 2 |
| **Theming** | [next-themes](https://github.com/pacocoursey/next-themes) | — |
| **Tables** | [TanStack Table](https://tanstack.com/table) | 8 |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18 · **Bun** ≥ 1.0 (or npm/pnpm)
- **Git** for version control
- M-Pesa Daraja credentials _(optional — mock mode available)_

### Installation

```bash
# Clone the repository
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration (see ⚙️ Configuration section)
```

### Database Setup

```bash
# Generate Prisma client
bun run db:generate

# Push schema to the database (creates tables)
bun run db:push

# Seed with demo data (5 stores, sample products, users)
bun run db:seed
```

### Run the Development Server

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with a demo account:

| Role | Email | Password |
|------|-------|----------|
| SUPER_ADMIN | admin@mbumah.co.ke | admin123 |
| STORE_OWNER | owner@mbumah.co.ke | owner123 |
| BRANCH_MANAGER | manager@mbumah.co.ke | manager123 |
| CASHIER | cashier@mbumah.co.ke | cashier123 |
| ACCOUNTANT | accountant@mbumah.co.ke | accountant123 |

---

## 📁 Project Structure

```
mbumah-hardware-pos/
├── 📂 prisma/
│   ├── schema.prisma          # Database schema (25+ models)
│   └── seed.ts                # Demo data seeder
├── 📂 public/
│   ├── logo.svg               # Brand logo
│   └── categories/            # Category images
├── 📂 src/
│   ├── 📂 app/
│   │   ├── layout.tsx         # Root layout with providers
│   │   ├── page.tsx           # Main SPA entry
│   │   ├── globals.css        # Global styles & theme
│   │   ├── 📂 tabs/           # Feature tab components
│   │   │   ├── dashboard-tab.tsx
│   │   │   ├── inventory-tab.tsx
│   │   │   ├── transactions-tab.tsx
│   │   │   ├── customers-tab.tsx
│   │   │   ├── suppliers-tab.tsx
│   │   │   ├── rentals-tab.tsx
│   │   │   ├── reports-tab.tsx
│   │   │   ├── financial-tab.tsx
│   │   │   ├── catalog-tab.tsx
│   │   │   ├── gift-cards-tab.tsx
│   │   │   └── admin-tab.tsx
│   │   └── 📂 api/            # REST API routes
│   │       ├── 📂 auth/       # Authentication
│   │       ├── 📂 products/   # Products & bundles
│   │       ├── 📂 categories/ # Categories
│   │       ├── 📂 customers/  # Customer CRM
│   │       ├── 📂 transactions/ # Sales transactions
│   │       ├── 📂 payments/   # M-Pesa payments
│   │       ├── 📂 gift-cards/ # Gift card management
│   │       ├── 📂 financial/  # Accounts & journal
│   │       ├── 📂 shifts/     # Shift management
│   │       ├── 📂 debt/       # Debt tracking
│   │       ├── 📂 rentals/    # Equipment rentals
│   │       ├── 📂 suppliers/  # Supplier management
│   │       ├── 📂 expenses/   # Expense tracking
│   │       ├── 📂 reports/    # Reports & analytics
│   │       ├── 📂 dashboard/  # Dashboard data
│   │       ├── 📂 users/      # User management
│   │       ├── 📂 stores/     # Store management
│   │       ├── 📂 purchase-orders/ # Purchase orders
│   │       ├── 📂 stock-movements/ # Stock movements
│   │       ├── 📂 cash-drawer/ # Cash drawer
│   │       ├── 📂 receipts/   # Receipts
│   │       ├── 📂 notifications/ # Notifications
│   │       ├── 📂 audit-logs/ # Audit trail
│   │       ├── 📂 system-logs/ # System logs
│   │       └── 📂 system-config/ # System configuration
│   ├── 📂 components/
│   │   ├── 📂 ui/             # shadcn/ui components (40+)
│   │   └── error-boundary.tsx # Error boundary with admin overlay
│   ├── 📂 hooks/
│   │   ├── use-idle-timeout.ts    # 30-min idle timeout
│   │   ├── use-state-persistence.ts # LocalStorage persistence
│   │   └── use-mobile.ts         # Mobile detection
│   └── 📂 lib/
│       ├── db.ts              # Prisma client singleton
│       ├── api.ts             # API helper utilities
│       ├── stores.ts          # Zustand store definitions
│       ├── types.ts           # TypeScript type definitions
│       ├── utils.ts           # Utility functions
│       ├── helpers.ts         # Business logic helpers
│       ├── account-helper.ts  # Double-entry accounting helper
│       ├── logger.ts          # Structured logging
│       └── providers.tsx      # App providers (QueryClient, Theme, etc.)
├── 📂 docker/
│   ├── postgres-init.sql      # PostgreSQL init script
│   └── 📂 mpesa-mock/        # M-Pesa mock server
├── 📂 docs/                   # Documentation
├── .env.example               # Environment template
├── docker-compose.yml         # Docker Compose for prod
├── vercel.json                # Vercel deployment config
├── Caddyfile                  # Reverse proxy config
└── package.json               # Dependencies & scripts
```

---

## 📡 API Endpoints

### 🔑 Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Authenticate user & create session |
| `POST` | `/api/auth/logout` | End user session |
| `GET` | `/api/auth/me` | Get current authenticated user |

### 📦 Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List all products (filtered by store) |
| `POST` | `/api/products` | Create a new product |
| `GET` | `/api/products/[id]` | Get product by ID |
| `PUT` | `/api/products/[id]` | Update product |
| `DELETE` | `/api/products/[id]` | Delete product |
| `GET` | `/api/products/bundles` | List product bundles |

### 🏷️ Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/categories` | List all categories |
| `POST` | `/api/categories` | Create a new category |

### 👥 Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/customers` | List customers (with debt & loyalty info) |
| `POST` | `/api/customers` | Create a new customer |
| `GET` | `/api/customers/[id]` | Get customer details |
| `PUT` | `/api/customers/[id]` | Update customer |
| `DELETE` | `/api/customers/[id]` | Delete customer |

### 💳 Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/transactions` | List transactions (filtered by store/date) |
| `POST` | `/api/transactions` | Create a new sale transaction |
| `GET` | `/api/transactions/[id]` | Get transaction details |

### 📱 M-Pesa Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/payments/mpesa/stkpush` | Initiate M-Pesa STK Push |
| `POST` | `/api/payments/mpesa/callback` | M-Pesa Daraja callback webhook |

### 🎁 Gift Cards

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gift-cards` | List gift cards |
| `POST` | `/api/gift-cards` | Create a gift card |
| `GET` | `/api/gift-cards/[id]` | Get gift card details |
| `PUT` | `/api/gift-cards/[id]` | Update gift card |
| `DELETE` | `/api/gift-cards/[id]` | Delete gift card |
| `POST` | `/api/gift-cards/[id]/redeem` | Redeem a gift card |
| `POST` | `/api/gift-cards/[id]/adjust` | Adjust gift card balance |

### 📊 Dashboard & Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard` | Dashboard summary metrics |
| `GET` | `/api/reports/sales` | Sales report data |
| `GET` | `/api/reports/inventory` | Inventory report data |
| `GET` | `/api/reports/export` | Export reports (CSV/PDF) |

### 🏦 Financial

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/financial/accounts` | List chart of accounts |
| `POST` | `/api/financial/accounts` | Create an account |
| `GET` | `/api/financial/journal` | List journal entries |
| `POST` | `/api/financial/journal` | Create a journal entry |
| `GET` | `/api/financial/revenue-trend` | Revenue trend data |

### ⏱️ Shifts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/shifts` | List shifts |
| `POST` | `/api/shifts` | Start a new shift |
| `GET` | `/api/shifts/current` | Get current active shift |
| `PUT` | `/api/shifts/[id]/end` | End a shift |

### 💰 Debt Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/debt` | List customer debts |
| `POST` | `/api/debt` | Record a debt / payment |

### 🔧 Equipment Rentals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rentals` | List rentals |
| `POST` | `/api/rentals` | Create a rental |
| `POST` | `/api/rentals/[id]/return` | Process equipment return |

### 🚚 Suppliers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/suppliers` | List suppliers |
| `POST` | `/api/suppliers` | Create a supplier |
| `GET` | `/api/suppliers/[id]` | Get supplier details |
| `PUT` | `/api/suppliers/[id]` | Update supplier |
| `DELETE` | `/api/suppliers/[id]` | Delete supplier |

### 💸 Expenses

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/expenses` | List expenses |
| `POST` | `/api/expenses` | Record an expense |

### 👤 Users & Stores

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Create a user |
| `GET` | `/api/stores` | List stores |
| `POST` | `/api/stores` | Create a store |

### 📋 System & Admin

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

---

## 🔐 Authentication & RBAC

The system enforces strict **Role-Based Access Control** across all endpoints and UI components.

### Roles

| Role | Scope | Description |
|------|-------|-------------|
| 🔴 `SUPER_ADMIN` | Organization-wide | Full system access, all stores, user management, system config |
| 🟠 `STORE_OWNER` | Organization-wide | Multi-store access, financial reports, supplier management |
| 🟡 `BRANCH_MANAGER` | Single store | Store operations, inventory, staff shifts, reports |
| 🟢 `CASHIER` | Single store | POS transactions, customer lookup, shift start/end |
| 🔵 `ACCOUNTANT` | Organization-wide | Financial reports, journal entries, expense approval |

### Permission Matrix

| Feature | SUPER_ADMIN | STORE_OWNER | BRANCH_MANAGER | CASHIER | ACCOUNTANT |
|---------|:-----------:|:-----------:|:--------------:|:-------:|:----------:|
| Dashboard | ✅ All stores | ✅ All stores | ✅ Own store | ✅ Own store | ✅ All stores |
| POS / Transactions | ✅ | ✅ | ✅ | ✅ | ❌ |
| Product Management | ✅ | ✅ | ✅ | 🔍 Read-only | ❌ |
| Inventory / Stock | ✅ | ✅ | ✅ | 🔍 Read-only | ❌ |
| Customer CRM | ✅ | ✅ | ✅ | ✅ | 🔍 Read-only |
| Gift Cards | ✅ | ✅ | ✅ | 🔍 Read-only | 🔍 Read-only |
| Equipment Rentals | ✅ | ✅ | ✅ | ✅ | ❌ |
| Financial Reports | ✅ | ✅ | ❌ | ❌ | ✅ |
| Journal Entries | ✅ | ✅ | ❌ | ❌ | ✅ |
| Expense Approval | ✅ | ✅ | ❌ | ❌ | ✅ |
| Shift Management | ✅ | ✅ | ✅ | ✅ | ❌ |
| Supplier Management | ✅ | ✅ | 🔍 Read-only | ❌ | 🔍 Read-only |
| Purchase Orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| User Management | ✅ | ✅ | ❌ | ❌ | ❌ |
| Store Management | ✅ | ✅ | ❌ | ❌ | ❌ |
| System Configuration | ✅ | ❌ | ❌ | ❌ | ❌ |
| Audit Logs | ✅ | ✅ | ❌ | ❌ | ❌ |
| Error Details | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 🗄️ Database Schema

The system uses **25+ Prisma models** with full relational integrity. Below are the key models:

```mermaid
erDiagram
    Organization ||--o{ Store : "has many"
    Organization ||--o{ User : "has many"
    Organization ||--o{ Account : "has many"
    Store ||--o{ User : "employs"
    Store ||--o{ Product : "stocks"
    Store ||--o{ Transaction : "processes"
    Store ||--o{ Customer : "serves"
    Store ||--o{ Shift : "opens"
    Store ||--o{ GiftCard : "issues"
    Store ||--o{ Rental : "rents"
    Store ||--o{ Expense : "incurs"
    Product }o--|| Category : "belongs to"
    Transaction ||--o{ TransactionItem : "contains"
    Transaction }o--|| Customer : "made by"
    Transaction }o--|| User : "processed by"
    Transaction }o--|| Shift : "during"
    Customer ||--o{ Debt : "owes"
    Customer ||--o{ GiftCard : "holds"
    Supplier ||--o{ PurchaseOrder : "receives"
    PurchaseOrder ||--o{ PurchaseOrderItem : "contains"
    Account ||--o{ JournalEntry : "posted to"
    JournalEntry ||--o{ JournalEntryLine : "has lines"
    GiftCard ||--o{ GiftCardAdjustment : "adjusted by"
    GiftCard ||--o{ GiftCardRedemption : "redeemed in"
    Rental }o--|| Customer : "rented by"
    Rental }o--|| Product : "for product"
    Shift }o--|| User : "operated by"
```

### Key Models at a Glance

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `Organization` | Top-level tenant | name, taxPin, status |
| `Store` | Branch / location | name, location, address, phone, taxPin |
| `User` | System user | email, name, role, storeId |
| `Product` | Inventory item | name, sku, price, costPrice, quantity, categoryId |
| `Category` | Product grouping | name, description, imageUrl |
| `Transaction` | Sale record | total, subtotal, tax, paymentMethod, status |
| `TransactionItem` | Line item | productId, quantity, unitPrice, totalPrice |
| `Customer` | CRM profile | name, phone, email, loyaltyPoints, creditLimit |
| `Debt` | Customer debt | amount, dueDate, status, agingBucket |
| `GiftCard` | Prepaid card | code, balance, initialBalance, status, reason |
| `Shift` | Cashier shift | startedAt, endedAt, openingCash, closingCash |
| `Account` | Chart of accounts | code, name, type, balance |
| `JournalEntry` | Double-entry record | date, description, status |
| `JournalEntryLine` | Journal line | accountId, debit, credit |
| `Supplier` | Vendor profile | name, phone, email, paymentTerms |
| `PurchaseOrder` | PO to supplier | status, totalAmount, expectedDate |
| `Rental` | Equipment rental | startDate, endDate, dailyRate, status |
| `Expense` | Cost record | amount, category, status, approvedBy |

---

## 🏪 Multi-Tenant Architecture

All data is isolated per store using a **`storeId` discriminator column** on every tenant-scoped model.

```mermaid
graph LR
    subgraph Organization ["🏢 Mbumah Hardware"]
        S1["🏪 Juja Main"]
        S2["🏪 Thika"]
        S3["🏪 Ruiru"]
        S4["🏪 Nairobi CBD"]
        S5["🏪 Nakuru"]
    end

    subgraph Shared ["🔒 Shared Services"]
        Auth["🔐 Auth Service"]
        MP["📱 M-Pesa"]
        FIN["🏦 Financial Engine"]
    end

    S1 & S2 & S3 & S4 & S5 --> Auth
    S1 & S2 & S3 & S4 & S5 --> MP
    S1 & S2 & S3 & S4 & S5 --> FIN
```

### How It Works

1. **Every request** includes the authenticated user's `storeId`
2. **All queries** are scoped with `where: { storeId }` — no cross-store data leakage
3. **SUPER_ADMIN** and **STORE_OWNER** can optionally query across stores
4. **Organization-level** entities (accounts, suppliers) are shared; **store-level** entities (products, transactions, customers) are isolated
5. **API middleware** validates the user's role + storeId before executing any operation

### Store Seeding

The seed script creates **5 pre-configured stores**:

```typescript
const stores = [
  { name: "Juja Main",    location: "Juja, Kiambu" },
  { name: "Thika",        location: "Thika, Kiambu" },
  { name: "Ruiru",        location: "Ruiru, Kiambu" },
  { name: "Nairobi CBD",  location: "Nairobi" },
  { name: "Nakuru",       location: "Nakuru" },
];
```

---

## ⚙️ Configuration

All configuration is managed through environment variables. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### Core Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `DATABASE_URL` | ✅ | `file:./db/custom.db` | Prisma connection string (SQLite or PostgreSQL) |
| `NEXTAUTH_SECRET` | ✅ | — | NextAuth.js secret (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3000` | Full URL of your deployed app |
| `JWT_SECRET` | ✅ | — | Legacy JWT secret |
| `NEXT_PUBLIC_APP_URL` | ✅ | `http://localhost:3000` | Public app URL |
| `NEXT_PUBLIC_CURRENCY` | ❌ | `KES` | Currency code for display |

### M-Pesa Daraja API

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MPESA_CONSUMER_KEY` | ✅ | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | ✅ | Daraja app consumer secret |
| `MPESA_PASSKEY` | ✅ | Lipa Na M-Pesa passkey |
| `MPESA_SHORTCODE` | ❌ | Business shortcode (default: `174379`) |
| `MPESA_ENVIRONMENT` | ❌ | `sandbox` or `production` |
| `MPESA_CALLBACK_URL` | ✅ | Public callback URL for STK Push |

### Optional Services

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend email API key |
| `TWILIO_ACCOUNT_SID` | Twilio SMS account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |
| `REDIS_URL` | Redis URL for production caching |

---

## 🚢 Deployment

### ▲ Vercel (Recommended)

The project is optimized for Vercel deployment:

1. **Fork** the repository to your GitHub account
2. **Import** the project on [Vercel](https://vercel.com/new)
3. **Configure** environment variables in the Vercel dashboard
4. **Set** `DATABASE_URL` to a PostgreSQL connection string (e.g., [Supabase](https://supabase.com/), [Neon](https://neon.tech/))
5. **Update** `prisma/schema.prisma` — change `provider` from `"sqlite"` to `"postgresql"`
6. **Deploy!** Vercel will run `prisma generate && next build` automatically

> **Note:** The `vercel-build` script in `package.json` handles Prisma generation automatically.

### 🐳 Docker Compose

For self-hosted production deployment:

```bash
# Build and start all services
docker-compose up -d

# Run database migrations
docker-compose exec app npx prisma migrate deploy

# Seed the database
docker-compose exec app npx prisma db seed
```

The `docker-compose.yml` includes:
- **App** — Next.js production server
- **PostgreSQL** — Production database
- **M-Pesa Mock** — Local development payment simulator

---

## 🤝 Contributing

We love contributions! Here's how you can help:

### Getting Started

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m 'feat: add amazing feature'`
4. **Push** to your branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat:     New feature
fix:      Bug fix
docs:     Documentation changes
style:    Code style (formatting, semicolons, etc.)
refactor: Code refactoring
test:     Adding or updating tests
chore:    Build process, tooling, etc.
```

### Code Style

- **TypeScript** strict mode — no `any` types
- **ESLint** — run `bun run lint` before committing
- **Prettier** — consistent formatting
- **shadcn/ui** — use existing components, don't reinvent the wheel

### Areas We Need Help

- 🌍 Internationalization (Swahili, French)
- 🧪 Test coverage (unit + integration)
- 📱 PWA / offline support
- 🏛️ eTIMS full integration
- 📊 More report types

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2025 Mbumah Hardware

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

**Built with ❤️ for Kenyan Hardware Stores**

[⬆ Back to Top](#-mbumah-hardware--pos--erp)

</div>
