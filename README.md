<div align="center">

<img src="public/logo.png" alt="Mbumah Hardware Logo" width="140" height="140" />

# 🔧 MBUMAH HARDWARE — POS & ERP

### Modern Point-of-Sale & Enterprise Resource Planning System for Kenyan Hardware Stores

<!-- TODO: Insert UI Screenshots here — recommended tool: shots.so for clean browser mockups -->
<!-- Suggested shots: POS checkout, Dashboard KPIs, Rentals board, Financial double-entry journal, Mobile responsive view -->

[![Vercel Deployment](https://img.shields.io/badge/Vercel-Live-000000?logo=vercel&logoColor=white)](https://mbumah-hardware-pos-one.vercel.app)
[![CI Status](https://github.com/bucky-ops/mbumah-hardware-pos/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/bucky-ops/mbumah-hardware-pos/actions/workflows/node.js.yml)
[![License: MIT](https://img.shields.io/github/license/bucky-ops/mbumah-hardware-pos?color=green)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Code Style: Conventional Commits](https://img.shields.io/badge/Commits-Conventional-fe7d37?logo=semantic-release&logoColor=white)](https://www.conventionalcommits.org/)

**🔗 Links:** [🚀 Live Vercel Demo](https://mbumah-hardware-pos-one.vercel.app) · [📄 GitHub Pages Landing](https://bucky-ops.github.io/mbumah-hardware-pos/) · [🐛 Report Bug](https://github.com/bucky-ops/mbumah-hardware-pos/issues/new?template=bug_report.yml) · [✨ Request Feature](https://github.com/bucky-ops/mbumah-hardware-pos/issues/new?template=feature_request.yml)

</div>

---

## 📑 Table of Contents

- [🇰🇪 Built for the Kenyan Market](#-built-for-the-kenyan-market)
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
- [🛠️ Troubleshooting & FAQ](#️-troubleshooting--faq)
- [📄 License](#-license)

---

## 🇰🇪 Built for the Kenyan Market

Mbumah Hardware POS isn't a generic POS reskinned for Africa — it was designed **from day one** for the realities of running a hardware shop in Kenya. Every core module maps to a pain point that Kenyan *hardware traders* (not just retailers) face daily:

### 💸 M-Pesa Daraja Integration (STK Push)
- **STK Push** checkout via Safaricom's Daraja API — the customer gets a prompt on their phone, enters their PIN, and the sale is settled.
- **Callback URL** handling for production (with ngrok for local dev — see [Troubleshooting](#-troubleshooting--faq)).
- **C2B / B2C** ready architecture — the schema and service layer already model `MpesaTransaction`, so onboarding new Daraja payment types is a config change, not a refactor.
- **Auto-reconciliation** — STK Push callbacks update the sale status and post to the cash/M-Pesa ledger accounts automatically via the double-entry engine.

### 🏛️ eTIMS / KRA Tax Compliance
- Tax categories (`VAT 16%`, `Zero-Rated`, `Exempt`) are first-class citizens on every `Product` and `SalesTransaction`.
- The **Tax tab** produces filings-ready summaries grouped by KRA tax type, so end-of-month VAT returns are a CSV export, not a spreadsheet nightmare.
- Designed for the **eTIMS (Electronic Tax Invoice Management System)** rollout — invoice data is structured to map cleanly to KRA's required fields.

### 🔌 Offline-Resilient by Design
- Hardware shops in peri-urban Kenya (Juja, Thika, Ruiru, Nakuru) frequently lose connectivity — Safaricom outages, KPLC power rationing, or last-mile fibre cuts are weekly realities. The POS:
  - **Persists cart & form state** to `localStorage` so a cashier never loses a half-rung sale during a blackout. On reload, the in-progress sale is restored and the cashier can resume or void it.
  - **Queues M-Pesa STK requests** and polls the Daraja query API on a backoff schedule — when the network returns, the queued request is confirmed and the sale is posted automatically.
  - **Optimistic UI with rollback** — sales, debt payments, and rental checkouts render instantly and only rollback if the server explicitly rejects them, so a 2-second latency spike doesn't feel like a freeze.
  - **30-minute idle timeout** with auto-lock — protects against unattended till walk-aways common in busy yards where a cashier may step out to load a customer's truck.
  - **Serverless-friendly schema** — every monetary write is idempotent on a client-supplied idempotency key, so a retried request after a network blip never double-posts.

### 🔧 Hardware-Store-Specific Logic (Not Just Retail)
These features exist because **hardware shops do things general retailers don't**:

| Feature | Why It Matters for Hardware |
|---------|------------------------------|
| **🔧 Equipment Rentals** | Hardware shops rent out generators, ladders, scaffolding, compacters, plate compactors, and breakers. Full rental lifecycle: checkout → overdue alerts (with daily-rate accrual) → return with damage assessment → security-deposit refund or forfeiture. The `Rental` model tracks `dailyRate`, `securityDeposit`, `damageFee`, and `status` (`ACTIVE` / `RETURNED` / `OVERDUE` / `LOST`) so the daily rentals board is a real operational tool, not an afterthought. |
| **💰 B2B Customer Debt (Mkopo)** | Contractors and *fundis* (masons, plumbers, electricians) buy on credit and settle weekly or monthly — this is how the Kenyan hardware trade actually works. Aging buckets (30/60/90 days), per-contractor credit limits, statement exports, and a debt-collection dashboard are built-in — not bolted on. The `Debt` model carries `dueDate`, `status` (`OUTSTANDING` / `PARTIALLY_PAID` / `SETTLED` / `WRITTEN_OFF`), and `agingBucket`, and the Accounts Receivable report rolls it up by contractor. |
| **📦 Bulk & Bundle Pricing** | Cement by the bag, nails by the kg, paint by the drum, mesh by the metre. Unit-of-measure conversions and bundle SKUs (e.g. "Tiling Kit" = 1× trowel + 1× level + 5× spacers) are native. |
| **🚚 Supplier Purchase Orders** | Track POs to local distributors (Bamburi Cement, Crown Paints, Safaricom for airtime stock, Rhinox Plumbing) with line-item fulfillment, backorder tracking, and landed-cost calculation (so the unit cost reflects transport from Industrial Area, not just the invoice price). |
| **⏱️ Shift Cash Reconciliation** | Cash drawer counts at shift open/close — critical because Kenyan shops run on cash + M-Pesa mixed tills. Discrepancies are flagged for the manager and logged to the audit trail. The system supports both "blind close" (cashier declares count without seeing expected) and "revealed close" (manager mode). |
| **🎁 Gift Cards** | Increasingly popular for corporate buyers (a contractor pre-loading a card for a foreman) and holidays. Full CRUD with reasons, auto-hiding exhausted cards, and redemption history. |
| **🧾 KRA eTIMS-Ready Invoices** | Every `Transaction` carries `taxBreakdown` (VAT 16% / Zero-Rated / Exempt) and a sequential invoice number, ready to feed into KRA's eTIMS API when the rollout reaches your county. |

> **Bottom line:** If you've ever tried to run a Kenyan hardware shop on a generic POS, you know they fall down on rentals, contractor debt, and M-Pesa reconciliation. This one doesn't.

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

## 🛠️ Troubleshooting & FAQ

Common issues and their fixes. If your problem isn't listed here, [open a bug report](https://github.com/bucky-ops/mbumah-hardware-pos/issues/new?template=bug_report.yml).

### 💸 M-Pesa Daraja Callback Issues (ngrok for Local Testing)

**Symptom:** You trigger STK Push locally, the prompt appears on your phone, you enter your PIN, and M-Pesa deducts the money — but the sale status stays `PENDING` forever and the cashier screen never advances.

**Root cause:** Safaricom's Daraja API needs to **call back your server over the public internet** to deliver the payment result. `http://localhost:3000` (or `127.0.0.1`) is *not* reachable from Safaricom's servers — they have no way to dial into your laptop on your home/office network. So Safaricom fires the callback, gets a connection refused / timeout, and never retries. Your local server simply never sees the result.

**Fix — expose your local dev server with ngrok:**

```bash
# 1. Install ngrok (one-time):  https://ngrok.com/download
#    Or via Homebrew:  brew install ngrok

# 2. Expose your local Next.js dev server (must already be running on :3000)
ngrok http 3000

# 3. ngrok prints a forwarding URL like:
#       Forwarding  https://abc123.ngrok.app -> http://localhost:3000
#    Copy the HTTPS URL (NOT the http:// one, and NOT localhost).

# 4. Set the callback URL env var to the ngrok HTTPS URL + Daraja callback path
export MPESA_CALLBACK_URL="https://abc123.ngrok.app/api/payments/mpesa/callback"

# 5. Restart the dev server so the new env var takes effect (Next.js doesn't
#    hot-reload .env on most shells)
bun run dev

# 6. In the Safaricom Daraja developer portal (https://developer.safaricom.co.ke)
#    → My Apps → your app → confirm the "Confirmation URL" and "Validation URL"
#    point to the ngrok HTTPS URL (or rely on the per-request callback URL
#    passed in the STK Push payload, which is what this codebase does).
```

> **Why HTTPS?** Daraja requires TLS on callback URLs in production. ngrok's free HTTPS endpoints satisfy this for sandbox testing.

> **Why ngrok and not localhost?** Because Safaricom's servers initiate the HTTP POST to *your* URL — there's no way for them to reach a process bound to your laptop's loopback interface. ngrok tunnels a public hostname down to your local port.

**Production note:** On Vercel, your callback URL is simply `https://your-domain.vercel.app/api/payments/mpesa/callback` — no ngrok needed. Register it once in the Daraja developer portal for your Production app (separate from Sandbox credentials).

**Still not working?** Check, in order:
1. **ngrok is still running** — if you Ctrl-C'd the ngrok process, the tunnel is dead and callbacks will 502.
2. **The callback URL is registered & confirmed on the Daraja portal** — Safaricom sends a one-time validation request to your confirmation/validation URLs; if that 404s, your app is rejected.
3. **`MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` are for the correct app** — Sandbox credentials do NOT work against the Production endpoint, and vice versa.
4. **`MPESA_ENVIRONMENT` matches your credentials** — `sandbox` vs `production`.
5. **Daraja sandbox latency** — the sandbox sometimes has 30–60s lag before the callback fires. Don't assume failure before then.
6. **Check the ngrok inspector** at `http://localhost:4040` — it shows every request Safaricom made to your tunnel, including the raw POST body and your server's response code. This is the single fastest way to debug a missing callback.

---

### 💥 Vercel 500 Internal Server Error on Login / API Calls

**Symptom:** Deployed to Vercel, the homepage loads, but `/api/auth/login` (or any other DB-touching endpoint) returns `500 Internal Server Error`. The Vercel function logs show one of:

```
Error: prepared statement "s0" already exists
Error: Can't reach database server at <host>:5432
Error: Timed out fetching a new connection from the connection pool
Error: PrismaClientInitializationError: Database connection error
Error: ENV_VALIDATION_FAILED: Missing: DATABASE_URL, NEXTAUTH_SECRET
```

This is the **#1 deployment failure mode** for this project. There are four common causes, in order of likelihood.

---

#### Cause 1 — Neon PgBouncer pooling params missing (most common)

Neon, Supabase, Render, and other serverless Postgres providers put a **pooled connection string** behind a PgBouncer proxy running in **transaction mode**. Prisma's default connection settings conflict with transaction-mode pooling and throw errors like `prepared statement "s0" already exists` or `Timed out fetching a new connection from the connection pool`.

**Fix — append the PgBouncer params to your `DATABASE_URL`:**

```bash
# Neon:  use the "-pooler" hostname (NOT the direct hostname)
DATABASE_URL="postgresql://user:pass@ep-cool-name-pooler.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true&connect_timeout=15"

# Supabase:  use the transaction-mode pooler (port 6543, NOT 5432)
DATABASE_URL="postgresql://user:pass@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true&connect_timeout=15"
```

Two params are mandatory on Vercel serverless:

| Param | Why |
|-------|-----|
| `pgbouncer=true` | Tells Prisma to disable prepared statements (which break under PgBouncer transaction mode). Without this you'll see `prepared statement "s0" already exists` after the first warm invocation. |
| `connect_timeout=15` | Vercel serverless functions time out at 10s on the Hobby tier (60s on Pro). Prisma's default `connect_timeout=5` is too aggressive — a cold Neon compute (which can take 8–10s to wake from suspend) will trip it. 15s gives enough headroom. |

**Also set `directUrl` in `prisma/schema.prisma`** for migrations (which cannot run through PgBouncer):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")          // pooled — used at runtime by Prisma Client
  directUrl = env("DIRECT_DATABASE_URL")   // unpooled — used by prisma migrate / db push
}
```

```bash
# In Vercel env vars, set DIRECT_DATABASE_URL to the NON-pooled Neon hostname
# (the one WITHOUT "-pooler" in it). Migrations use a single long-lived
# connection and will fail under PgBouncer transaction mode.
DIRECT_DATABASE_URL="postgresql://user:pass@ep-cool-name.region.aws.neon.tech/dbname?sslmode=require"
```

> **`relationMode` note:** If you see errors about foreign key constraints during `prisma db push` on Neon — e.g. "Foreign key constraint failed during table creation" — you may need to set `relationMode = "prisma"` in the datasource block. This is **not** required for this project as currently structured (we use `cuid()` IDs and explicit joins, not deferred FKs), but if you add cross-store foreign keys you may need it.

---

#### Cause 2 — Tables don't exist (Vercel does NOT auto-run migrations)

**Vercel runs `npm run vercel-build` (which is `prisma generate && next build`)** — it does NOT run `prisma migrate deploy` or `prisma db push`. So your Neon database starts **completely empty** after the first deploy. Every API route that touches a table returns 500 with `relation "User" does not exist`.

**Fix — push the schema and seed, manually, after the first successful deploy:**

```bash
# 1. Make sure your local .env has the SAME DATABASE_URL as Vercel
#    (the pooled Neon connection string from Cause 1)
#    AND DIRECT_DATABASE_URL pointing to the non-pooled hostname.

# 2. Install dependencies locally (if you haven't)
bun install

# 3. Push the schema — creates all 25+ tables on Neon
#    (We use `db push` rather than `migrate deploy` because this project
#    uses schema-first iteration. `db push` is idempotent and safe.)
bun run db:push
#    ↑ runs:  node scripts/setup-prisma-provider.mjs && prisma db push

# 4. Seed the demo data (5 stores, demo users, sample products, gift cards, etc.)
bun run db:seed
#    ↑ runs:  prisma db seed

# 5. Verify in the Neon SQL editor:
#    SELECT COUNT(*) FROM "Store";    -- should be 5
#    SELECT COUNT(*) FROM "User";     -- should be 5 demo users
#    SELECT COUNT(*) FROM "Product";  -- should be ~50 sample products
```

> **Why not `prisma migrate deploy` in the build script?** Running migrations during `next build` is fragile: a failed migration fails the deploy, and migrations need the *direct* (non-pooled) connection string which we don't want in the build environment. The standard Prisma + Vercel pattern is to run migrations as a separate manual step (or via a CI job with `DIRECT_DATABASE_URL` injected). For this project, `db:push` against your pooled Neon URL is the simplest correct path.

> **Re-running after schema changes:** Any time `prisma/schema.prisma` changes, re-run `bun run db:push` locally (with the Vercel-matching `DATABASE_URL`) to apply the schema delta to Neon. Commit the schema change but do NOT commit migrations — this project does not use a `prisma/migrations/` folder.

---

#### Cause 3 — Prisma Client not generated during the build

If you customized the `vercel-build` script and dropped `prisma generate`, every DB call crashes with `PrismaClientInitializationError: Cannot read property 'user' of undefined`.

**Fix — keep `prisma generate` in the build script:**

```json
{
  "scripts": {
    "vercel-build": "node scripts/setup-prisma-provider.mjs && SKIP_ENV_VALIDATION=1 prisma generate && SKIP_ENV_VALIDATION=1 next build"
  }
}
```

The `SKIP_ENV_VALIDATION=1` prefix is critical — without it, `next build` tries to collect page data for `/api/*` routes, which transitively imports `@/lib/env`, which eagerly Zod-validates runtime secrets (which aren't injected at build time). The build crashes with `Failed to collect page data for /api/auth/login`. This was the root cause fixed in Phase 1 of the deployment hardening work; the pattern is the same one used by [create-t3-app](https://create.t3.gg/) and most production Vercel + Next.js + Prisma stacks.

---

#### Cause 4 — Missing or mis-scoped env vars in Vercel

Vercel will silently let your API route boot with `undefined` for `DATABASE_URL` if you forgot to add it, added it only to "Development" but deployed to "Production", or added it with a trailing space.

**Fix:**

1. Go to **Vercel → Project → Settings → Environment Variables**.
2. Confirm each variable exists and is checked for **Production**, **Preview**, AND **Development** (unless you deliberately want to scope it).
3. Confirm there are **no trailing spaces** in the value (Vercel's UI preserves them — a stray space at the end of `DATABASE_URL` corrupts the connection string).
4. **Redeploy** after adding/changing env vars (Vercel does not auto-redeploy on env-only changes).
5. Required env vars at runtime: `DATABASE_URL` (pooled), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `JWT_SECRET`. See the [⚙️ Configuration](#️-configuration) section.

---

### 👻 Ghost Shifts (Orphaned / Unclosed Shift)

**What is a ghost shift?** A "ghost shift" is a `Shift` record that was **opened but never closed** — the `status` column still reads `OPEN` and `endTime` is `NULL`, but the cashier is no longer actively operating it. Ghost shifts typically arise from:

- **Browser crash** — the cashier's tab died mid-shift and the close-shift API call never fired.
- **Power outage** — the POS terminal lost power; on reboot the cashier can't open a new shift because the old one is still `OPEN`.
- **Network blip during close** — the close-shift request hit the server but the response was lost (e.g. M-Pesa callback raced the close call); the UI optimistically rolled back, leaving the shift `OPEN` server-side.
- **Cashier forgot to close** — end of day, cashier locked the screen and went home without running the close-shift flow.

**Symptom:** A cashier tries to start a new shift and the system rejects it with *"You already have an open shift"* — but the previous shift doesn't appear in the active-shifts list (because the list filters by today's date and the orphan is from yesterday), OR it appears but the cashier can't reconcile cash they don't have on hand.

**Fix A — Close it via the Shifts tab (preferred):**

1. Log in as `BRANCH_MANAGER`, `STORE_OWNER`, or `SUPER_ADMIN`.
2. Navigate to **Shift Management** → the system auto-detects unclosed shifts for the selected store/user and surfaces a *"X unclosed shifts detected"* banner.
3. Find the orphaned `OPEN` shift (filter by cashier name or date range if needed).
4. Click **Force Close** (available to manager+ roles; cashiers cannot force-close their own orphaned shifts to prevent self-reconciliation fraud).
5. Enter the actual cash drawer count. The system records any discrepancy between expected and actual cash as a `CashDiscrepancy` audit entry, attributed to the closing manager with a mandatory reconciliation note.

**Fix B — Database-level cleanup (last resort, for DBAs only):**

If the UI flow is unavailable (e.g. the shift belongs to a deleted user, or the store was archived), run the SQL directly against your Neon/Postgres database:

```sql
-- 1. Find all ghost shifts across all stores
SELECT id, "userId", "storeId", status, "openedAt", "endedAt", "openingCash"
FROM "Shift"
WHERE status = 'OPEN' AND "endedAt" IS NULL;

-- 2. For a specific user
SELECT id, "userId", "storeId", status, "openedAt", "openingCash"
FROM "Shift"
WHERE status = 'OPEN' AND "userId" = '<user-id>';

-- 3. Close a single ghost shift (replace <shift-id> with the actual id)
--    Set closingCash = openingCash to record a zero-discrepancy close,
--    OR set it to the counted amount if the drawer was actually counted.
UPDATE "Shift"
SET status     = 'CLOSED',
    "endedAt"  = NOW(),
    "closingCash" = "openingCash",
    "updatedAt"   = NOW(),
    note       = 'Force-closed by DBA after ghost-shift detection (browser crash / power outage)'
WHERE id = '<shift-id>';

-- 4. Audit-trail the manual close (recommended)
INSERT INTO "AuditLog" ("actorUserId", action, entity, "entityId", metadata, "createdAt")
VALUES ('<dba-user-id>', 'SHIFT_FORCE_CLOSE', 'Shift', '<shift-id>',
        '{"reason":"ghost shift","method":"sql"}'::jsonb, NOW());
```

> **Schema note:** column names are quoted (`"userId"`, `"openedAt"`, `"endedAt"`) because Prisma generates them in PascalCase under PostgreSQL by default. On SQLite they're unquoted.

**Prevention (already implemented in this codebase):**

- The close-shift flow is **idempotent** — if the API call fails, retrying won't double-close. The endpoint checks the current `status` before mutating.
- The **Shift Management** UI surfaces unclosed shifts older than 24 hours with a red *"STALE SHIFT"* badge so managers can intervene before the next morning.
- A nightly cron (`SHIFT_RECONCILIATION`, scheduled via the system-config `cronJobs` registry) auto-flags shifts open >24h for manager review and sends a notification to the store's `BRANCH_MANAGER`.
- On shift-start, the API checks for any pre-existing `OPEN` shift for the user+store and offers a one-tap "Resume Previous Shift" affordance instead of forcing a manual cleanup.

---

### 🔄 "D.map is not a function" Production Crash

**Symptom:** Page loads but crashes with `D.map is not a function` in the browser console.

**Cause:** An API endpoint returned a non-array (e.g., `null`, `{}`, or an error object) where the frontend expected an array, and `.map()` was called on it.

**Fix:** This was resolved in a prior patch — all API data extractions now use `Array.isArray()` guards. If you see it again, ensure you're on the latest `main` and that the offending tab uses the `safeArray()` / `safeData()` helpers from `@/lib/api`.

---

### 🏗️ Prisma Migration Errors on Vercel

**Symptom:** `vercel-build` fails with `Prisma schema validation error` or `relation does not exist`.

**Cause:** The schema was changed locally (`db:push`) but the migration wasn't committed, so Vercel's DB is out of sync.

**Fix:**
```bash
# Locally, create & apply the migration
bun run db:migrate --name your_change_description

# Commit the migration files
git add prisma/migrations/
git commit -m "db: add your_change_description migration"

# On Vercel, the build runs prisma migrate deploy automatically
```

> For rapid prototyping, `db:push` is fine locally — but **always** create a proper migration before deploying to production.

---

### ❓ Still Stuck?

- 📖 Read the full **[Vercel Deployment Guide](docs/VERCEL_DEPLOYMENT_GUIDE.md)** and **[Vercel Recovery Guide](VERCEL_RECOVERY.md)**
- 🐛 [Open a bug report](https://github.com/bucky-ops/mbumah-hardware-pos/issues/new?template=bug_report.yml) with your Node version, browser, and reproduction steps
- 🔒 For security-sensitive issues, see [SECURITY.md](SECURITY.md) — **do not** open a public issue

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
