# MBUMAH HARDWARE POS & ERP System

[![Node.js CI](https://github.com/bucky-ops/mbumah-hardware-pos/actions/workflows/node.js.yml/badge.svg)](https://github.com/bucky-ops/mbumah-hardware-pos/actions/workflows/node.js.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-indigo)](https://www.prisma.io/)

> A full-featured, multi-tenant Point of Sale & Enterprise Resource Planning system built specifically for Kenyan hardware stores. Developed for **MBUMAH HARDWARE** with branches across Kenya.

---

## 📋 About

**MBUMAH HARDWARE POS & ERP** is a modern, web-based business management system designed from the ground up for the unique needs of Kenyan hardware stores. Built with Next.js 16, TypeScript, and Prisma, it provides a comprehensive suite of 13 integrated modules covering everything from point-of-sale operations to financial accounting, all with deep integration into Kenya-specific systems like M-Pesa and KRA eTIMS.

### Key Highlights

- **Multi-tenant architecture** — One system, multiple stores, complete data isolation
- **Kenya-first design** — KES currency, M-Pesa payments, KRA PIN tracking, eTIMS compliance
- **Real-time POS** — Fast, offline-capable point of sale with barcode support
- **Complete ERP** — Inventory, accounting, HR, and business intelligence in one platform
- **Role-based access control** — Granular permissions for every role in your organization

---

## 🏗️ Modules

The system is organized into 13 integrated modules covering every aspect of hardware store operations:

| # | Module | Description |
|---|--------|-------------|
| 1 | **Product & Inventory Management** | Product catalog, categories, SKU tracking, stock levels, reorder alerts, batch/bundle management, stock movements |
| 2 | **Sales & Point of Sale** | Real-time POS terminal, cart management, multi-payment (cash, M-Pesa, credit), receipt generation, shift management |
| 3 | **Purchase Management** | Purchase orders, supplier ordering, goods received notes, purchase tracking, cost price management |
| 4 | **Supplier Management** | Supplier profiles, contact management, order history, performance tracking, supplier-ledger integration |
| 5 | **Customer Loyalty Program** | Customer profiles, loyalty points, purchase history, tiered rewards, debt tracking |
| 6 | **Multi-Store Management** | Branch management, inter-store transfers, consolidated reporting, store-level configuration |
| 7 | **Quotes & Invoices** | Quotation generation, invoice management, proforma invoices, quote-to-sale conversion |
| 8 | **Tax Management (eTIMS/TIMS)** | KRA-compliant tax calculations, eTIMS integration, VAT tracking, tax reports, KRA PIN management |
| 9 | **Expense Management** | Operational expense tracking, expense categories, approval workflows, receipt attachments |
| 10 | **Voucher Management** | Gift vouchers, discount coupons, promotional vouchers, redemption tracking |
| 11 | **Accounts & Accounting** | Double-entry bookkeeping, chart of accounts, journal entries, financial statements, general ledger |
| 12 | **Banking & Reconciliation** | Bank account management, transaction matching, M-Pesa reconciliation, cash drawer management |
| 13 | **User Management & Security** | Role-based access control (RBAC), user profiles, audit logging, session management, activity tracking |

---

## 🏪 Hardware Store Branches

MBUMAH HARDWARE operates across multiple locations in Kenya:

| Branch | Location | Status |
|--------|----------|--------|
| **Juja Main Branch** | Salama M-Store, Juja | 🏢 **HEADQUARTERS** |
| **Thika Branch** | Thika Town, Kiambu County | 🟢 Active |
| **Ruiru Branch** | Ruiru Town, Kiambu County | 🟢 Active |
| **Nairobi CBD Branch** | Kenyatta Avenue, Nairobi | 🟢 Active |
| **Nakuru Branch** | Nakuru Town, Nakuru County | 🟢 Active |

---

## 🛠️ Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| [Next.js](https://nextjs.org/) | 16 | Full-stack React framework (App Router) |
| [TypeScript](https://www.typescriptlang.org/) | 5 | Type-safe JavaScript |
| [Prisma](https://www.prisma.io/) | 6 | ORM & database migrations |
| [Tailwind CSS](https://tailwindcss.com/) | 4 | Utility-first CSS framework |
| [shadcn/ui](https://ui.shadcn.com/) | Latest | Reusable UI components |
| [React](https://react.dev/) | 19 | UI library |
| [Recharts](https://recharts.org/) | 2 | Data visualization & charts |
| [Zustand](https://zustand-demo.pmnd.rs/) | 5 | State management |
| [TanStack Table](https://tanstack.com/table) | 8 | Advanced data tables |
| [Zod](https://zod.dev/) | 4 | Schema validation |
| [React Hook Form](https://react-hook-form.com/) | 7 | Form management |
| [SQLite](https://www.sqlite.org/) | 3 | Local development database |
| [PostgreSQL](https://www.postgresql.org/) | 15+ | Production database (Supabase) |
| [Docker](https://www.docker.com/) | — | Containerization & local services |
| [Redis](https://redis.io/) | 7 | Caching & session storage |
| [Bun](https://bun.sh/) | Latest | JavaScript runtime & package manager |

---

## 🚀 Getting Started

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
# Edit .env with your configuration

# 4. Push database schema
bun run db:push

# 5. Seed the database (auto-runs on first boot if no users exist)
bun run db:generate

# 6. Start the development server
bun run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Docker Setup (Optional)

For PostgreSQL, Redis, and the Mock M-Pesa service:

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL 15** on port `5432` (with pg_trgm extension)
- **Redis 7** on port `6379`
- **Mock M-Pesa Daraja API** on port `9000`

---

## 🔑 Demo Accounts

The seed script creates demo accounts for testing different roles:

| Role | Email | Password | Access Level |
|------|-------|----------|-------------|
| **Super Admin** | `admin@mbumahhardware.co.ke` | `Admin@2024` | Full system access — all modules, settings, user management |
| **Cashier** | `cashier@mbumahhardware.co.ke` | `Cashier@2024` | POS operations, product lookup, basic transactions |
| **Accountant** | `accountant@mbumahhardware.co.ke` | `Accountant@2024` | Financial reports, debt management, journal entries, exports |

> ⚠️ **Important**: Change these passwords immediately in production environments.

---

## 📡 API Reference

All API endpoints are prefixed with `/api/`. Authentication is handled via JWT tokens in the `Authorization` header.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | User login, returns JWT token |
| `GET` | `/api/auth/me` | Get current authenticated user |
| `POST` | `/api/auth/logout` | Logout and invalidate session |

### Products & Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List all products (with filters) |
| `POST` | `/api/products` | Create a new product |
| `GET` | `/api/products/[id]` | Get product by ID |
| `PUT` | `/api/products/[id]` | Update product |
| `DELETE` | `/api/products/[id]` | Delete product |
| `GET` | `/api/products/bundles` | List product bundles |
| `POST` | `/api/products/bundles` | Create product bundle |
| `GET` | `/api/categories` | List all categories |
| `POST` | `/api/categories` | Create category |
| `GET` | `/api/stock-movements` | Stock movement history |

### Sales & Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/transactions` | List all transactions |
| `POST` | `/api/transactions` | Create a new sale |
| `GET` | `/api/transactions/[id]` | Get transaction details |
| `PUT` | `/api/transactions/[id]` | Update transaction |
| `GET` | `/api/receipts` | List receipts |
| `POST` | `/api/receipts` | Generate receipt |
| `GET` | `/api/receipts/[id]` | Get receipt by ID |
| `GET` | `/api/cash-drawer` | Cash drawer status & logs |

### Shift Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/shifts` | List shifts |
| `POST` | `/api/shifts` | Start a new shift |
| `GET` | `/api/shifts/current` | Get current active shift |
| `POST` | `/api/shifts/[id]/end` | End a shift |

### Customers & Debt

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/customers` | List customers |
| `POST` | `/api/customers` | Create customer |
| `GET` | `/api/customers/[id]` | Get customer details |
| `PUT` | `/api/customers/[id]` | Update customer |
| `GET` | `/api/debt` | List debt/credit records |
| `POST` | `/api/debt` | Record a debt payment |

### Suppliers & Purchasing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/suppliers` | List suppliers |
| `POST` | `/api/suppliers` | Create supplier |
| `GET` | `/api/suppliers/[id]` | Get supplier details |
| `PUT` | `/api/suppliers/[id]` | Update supplier |
| `GET` | `/api/purchase-orders` | List purchase orders |
| `POST` | `/api/purchase-orders` | Create purchase order |
| `GET` | `/api/purchase-orders/[id]` | Get PO details |
| `PUT` | `/api/purchase-orders/[id]` | Update purchase order |

### Financial & Accounting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/financial/accounts` | Chart of accounts |
| `POST` | `/api/financial/accounts` | Create account |
| `GET` | `/api/financial/journal` | Journal entries |
| `POST` | `/api/financial/journal` | Create journal entry |
| `GET` | `/api/financial/revenue-trend` | Revenue trend data |
| `GET` | `/api/expenses` | List expenses |
| `POST` | `/api/expenses` | Record expense |

### M-Pesa Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/payments/mpesa/stkpush` | Initiate M-Pesa STK Push |
| `POST` | `/api/payments/mpesa/callback` | M-Pesa callback handler |

### Rentals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rentals` | List equipment rentals |
| `POST` | `/api/rentals` | Create rental record |
| `POST` | `/api/rentals/[id]/return` | Process rental return |

### Reports & Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard` | Dashboard summary stats |
| `GET` | `/api/reports/sales` | Sales reports |
| `GET` | `/api/reports/inventory` | Inventory reports |
| `GET` | `/api/reports/export` | Export reports (CSV/PDF) |

### System Administration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Create user |
| `GET` | `/api/audit-logs` | System audit logs |
| `GET` | `/api/system-logs` | Application logs |
| `GET` | `/api/system-config` | System configuration |
| `POST` | `/api/system-config` | Update configuration |
| `GET` | `/api/notifications` | User notifications |

---

## 📁 Project Structure

```
mbumah-hardware-pos/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── docker/
│   ├── mpesa-mock/
│   │   └── server.js            # Mock Safaricom Daraja API
│   └── postgres-init.sql         # PostgreSQL init script
├── prisma/
│   ├── schema.prisma             # Database schema (20+ models)
│   └── seed.ts                   # Auto-seed script with demo data
├── public/
│   ├── logo.svg
│   ├── logo.png
│   └── categories/               # Product category images
├── src/
│   ├── app/
│   │   ├── api/                  # API route handlers
│   │   │   ├── auth/             # Authentication endpoints
│   │   │   ├── products/         # Product CRUD + bundles
│   │   │   ├── transactions/     # Sales transactions
│   │   │   ├── customers/        # Customer management
│   │   │   ├── suppliers/        # Supplier management
│   │   │   ├── purchase-orders/  # Purchase order management
│   │   │   ├── financial/        # Accounting & journal entries
│   │   │   ├── payments/         # M-Pesa STK Push & callback
│   │   │   ├── rentals/          # Equipment rental management
│   │   │   ├── reports/          # Sales & inventory reports
│   │   │   ├── shifts/           # Shift management
│   │   │   ├── receipts/         # Receipt generation
│   │   │   ├── cash-drawer/      # Cash drawer tracking
│   │   │   ├── debt/             # Debt/credit management
│   │   │   ├── expenses/         # Expense tracking
│   │   │   ├── stock-movements/  # Inventory movements
│   │   │   ├── categories/       # Product categories
│   │   │   ├── dashboard/        # Dashboard analytics
│   │   │   ├── notifications/    # User notifications
│   │   │   ├── audit-logs/       # Audit trail
│   │   │   ├── system-logs/      # System logs
│   │   │   ├── system-config/    # System configuration
│   │   │   └── users/            # User management
│   │   ├── tabs/                 # Main UI tab components
│   │   │   ├── dashboard-tab.tsx
│   │   │   ├── catalog-tab.tsx
│   │   │   ├── inventory-tab.tsx
│   │   │   ├── transactions-tab.tsx
│   │   │   ├── customers-tab.tsx
│   │   │   ├── suppliers-tab.tsx
│   │   │   ├── financial-tab.tsx
│   │   │   ├── rentals-tab.tsx
│   │   │   ├── reports-tab.tsx
│   │   │   └── admin-tab.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   └── ui/                   # shadcn/ui components (40+)
│   ├── hooks/
│   │   ├── use-mobile.ts
│   │   └── use-toast.ts
│   └── lib/
│       ├── account-helper.ts     # Accounting helpers
│       ├── api.ts                # API client utilities
│       ├── db.ts                 # Prisma client singleton
│       ├── helpers.ts            # General helpers
│       ├── logger.ts             # Logging utility
│       ├── providers.tsx         # React context providers
│       ├── stores.ts             # Zustand stores
│       ├── types.ts              # TypeScript type definitions
│       └── utils.ts              # Utility functions
├── .env.example                  # Environment variable template
├── .gitignore
├── Caddyfile                     # Caddy reverse proxy config
├── docker-compose.yml            # Docker services (Postgres, Redis, M-Pesa mock)
├── LICENSE                       # MIT License
├── package.json
├── README.md                     # This file
├── start-server.sh               # Production startup script
└── tsconfig.json
```

---

## 💳 M-Pesa Integration

The system integrates with **Safaricom's Daraja API** for M-Pesa payments, supporting both sandbox (development) and production environments.

### Features

- **STK Push (Lipa Na M-Pesa Online)** — Initiate payment from the POS; customer receives a prompt on their phone
- **C2B (Customer to Business)** — Receive payments directly to your paybill/till number
- **Callback Handling** — Automatic payment confirmation and reconciliation
- **Transaction Matching** — Match M-Pesa receipts with system transactions

### Configuration

Set these environment variables to enable M-Pesa:

```env
MPESA_CONSUMER_KEY="your-daraja-consumer-key"
MPESA_CONSUMER_SECRET="your-daraja-consumer-secret"
MPESA_PASSKEY="your-lipa-na-mpesa-passkey"
MPESA_SHORTCODE="174379"           # Sandbox shortcode; replace for production
MPESA_ENVIRONMENT="sandbox"        # "sandbox" or "production"
```

### Mock M-Pesa Service

For local development, a mock M-Pesa service is included via Docker Compose. It simulates the Daraja API endpoints:

- **Base URL**: `http://localhost:9000`
- **STK Push Simulation**: `POST /mpesa/stkpush/v1/processrequest`
- **Callback Handler**: Configurable callback URL
- **Debug Endpoint**: `GET /mpesa/debug/transactions`

---

## 🔐 RBAC Roles

The system uses Role-Based Access Control with granular permissions:

| Role | Description | Permissions |
|------|-------------|-------------|
| **SUPER_ADMIN** | Full system administrator | All CRUD on all resources, user management, store management, system configuration, approve/refund/void/export |
| **ADMIN** | Store administrator | Most CRUD operations, limited system config |
| **MANAGER** | Store manager | Products, transactions, customers, reports, debt management |
| **CASHIER** | Point of sale operator | Read products, create/read transactions, read customers |
| **ACCOUNTANT** | Financial officer | Read financials, export reports, read/update debt |
| **STORE_KEEPER** | Inventory manager | Read/update products, stock movements, purchase orders |
| **SALES_REP** | Sales representative | Read products, create transactions, read customers |

### Permission Resources

Permissions can be granted per resource and action:

- **Resources**: `products`, `transactions`, `customers`, `financials`, `rentals`, `admin`, `reports`, `debt`
- **Actions**: `create`, `read`, `update`, `delete`, `approve`, `refund`, `export`, `void`, `manage_users`, `manage_stores`, `system_config`, `write_off`, `remind`, `adjust`

---

## 🇰🇪 Kenya-Specific Features

This system is purpose-built for the Kenyan business environment:

| Feature | Description |
|---------|-------------|
| **KES Currency** | All transactions in Kenyan Shillings (KES) with proper formatting |
| **M-Pesa Integration** | STK Push payments, C2B callbacks, and automatic reconciliation via Safaricom Daraja API |
| **eTIMS/TIMS Compliance** | Electronic Tax Invoice Management System integration for KRA-compliant invoicing |
| **KRA PIN Tracking** | Organization and store-level KRA PIN management for tax reporting |
| **Debt/Credit Management** | Comprehensive credit sales tracking, debt ledger, payment reminders, and write-off capabilities — essential for Kenyan hardware store operations |
| **Kenyan Product Catalog** | Pre-configured categories for cement (Bamburi, Simba, Savanna), mabati, rebar, and other local products |
| **Local Phone Numbers** | Support for Kenyan phone number formats (07xx, 01xx, +254) |
| **Multi-Branch Support** | Designed for hardware stores operating across multiple counties in Kenya |

---

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/mbumah-hardware-pos.git`
3. **Create a branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes** and commit: `git commit -m "Add your feature"`
5. **Push** to your fork: `git push origin feature/your-feature-name`
6. **Open a Pull Request** against the `main` branch

### Guidelines

- Follow the existing code style (TypeScript, ESLint config)
- Write clear, descriptive commit messages
- Add tests for new features when applicable
- Update documentation for any changed behavior
- Keep PRs focused — one feature or fix per PR
- Ensure all existing tests pass before submitting

### Reporting Issues

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template for bugs
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template for new features
- Search existing issues before creating a new one

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024 MBUMAH HARDWARE

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

<p align="center">
  Built with ❤️ for Kenyan hardware stores
</p>
