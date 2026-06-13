# MBUMAH HARDWARE POS & ERP System

[![Node.js CI](https://github.com/bucky-ops/mbumah-hardware-pos/actions/workflows/node.js.yml/badge.svg)](https://github.com/bucky-ops/mbumah-hardware-pos/actions/workflows/node.js.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6-indigo)](https://www.prisma.io/)

A full-featured, multi-tenant Point of Sale & Enterprise Resource Planning system built specifically for Kenyan hardware stores. Developed for **MBUMAH HARDWARE** with branches across Kenya.

## Screenshots

| Login Screen | Dashboard |
|:---:|:---:|
| ![Login](/public/logo.png) | ![Dashboard](/public/categories/cat_cement.png) |

| Product Catalog | Inventory Management |
|:---:|:---:|
| ![Catalog](/public/categories/cat_tools.png) | ![Inventory](/public/categories/cat_rebar.png) |

Screenshots above are placeholders. Run the app locally to see the full interface.

## About

**MBUMAH HARDWARE POS & ERP** is a modern, web-based business management system designed from the ground up for the unique needs of Kenyan hardware stores. Built with Next.js 16, TypeScript, and Prisma, it provides a comprehensive suite of 13 integrated modules covering everything from point-of-sale operations to financial accounting, all with deep integration into Kenya-specific systems like M-Pesa and KRA eTIMS.

### Key Highlights

- **Multi-tenant architecture** -- One system, multiple stores, complete data isolation
- **Kenya-first design** -- KES currency, M-Pesa payments, KRA PIN tracking, eTIMS compliance
- **Real-time POS** -- Fast, offline-capable point of sale with barcode support
- **Complete ERP** -- Inventory, accounting, HR, and business intelligence in one platform
- **Role-based access control** -- Granular permissions for every role in your organization

## Modules

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

## Hardware Store Branches

MBUMAH HARDWARE operates across multiple locations in Kenya:

| Branch | Location | Status |
|--------|----------|--------|
| **Juja Main Branch** | Salama M-Store, Juja | HEADQUARTERS |
| **Thika Branch** | Thika Town, Kiambu County | Active |
| **Ruiru Branch** | Ruiru Town, Kiambu County | Active |
| **Nairobi CBD Branch** | Kenyatta Avenue, Nairobi | Active |
| **Nakuru Branch** | Nakuru Town, Nakuru County | Active |

## Tech Stack

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
| [Docker](https://www.docker.com/) | -- | Containerization & local services |
| [Redis](https://redis.io/) | 7 | Caching & session storage |
| [Bun](https://bun.sh/) | Latest | JavaScript runtime & package manager |

## Getting Started

### Prerequisites

The following software is required regardless of your operating system:

- **Node.js** 18 or later (LTS recommended)
- **Bun** 1.0 or later (optional, but recommended for faster installs)
- **Git** 2.30 or later
- **Docker** (optional, for PostgreSQL + Redis + M-Pesa mock services)

### Setup on Windows

#### Option A: Native Windows (PowerShell)

1. **Install prerequisites**

   Install Node.js 18+ from [nodejs.org](https://nodejs.org/) or via [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/):

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

   Install Git:

   ```powershell
   winget install Git.Git
   ```

   Install Bun (optional but recommended):

   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Install Docker Desktop from [docker.com](https://www.docker.com/products/docker-desktop/) if you need PostgreSQL, Redis, or the mock M-Pesa service.

2. **Clone the repository**

   ```powershell
   git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
   cd mbumah-hardware-pos
   ```

3. **Install dependencies**

   With Bun:
   ```powershell
   bun install
   ```

   With npm:
   ```powershell
   npm install
   ```

4. **Set up environment variables**

   ```powershell
   copy .env.example .env
   ```

   Edit `.env` with your configuration. At minimum, set the `DATABASE_URL` and `NEXTAUTH_SECRET` values. See the [Environment Variables](#environment-variables) section below for details.

5. **Set up the database**

   With Bun:
   ```powershell
   bun run db:push
   bun run db:generate
   ```

   With npm:
   ```powershell
   npx prisma db push
   npx prisma generate
   ```

6. **Seed the database**

   With Bun:
   ```powershell
   npx tsx prisma/seed.ts
   ```

   With npm:
   ```powershell
   npx tsx prisma/seed.ts
   ```

   If `npx tsx` is not found, install it first:
   ```powershell
   npm install -g tsx
   ```

7. **Start the development server**

   With Bun:
   ```powershell
   bun run dev
   ```

   With npm:
   ```powershell
   npm run dev
   ```

   The app will be available at [http://localhost:3000](http://localhost:3000).

#### Option B: Windows Subsystem for Linux (WSL2)

WSL2 provides a full Linux environment on Windows and avoids most Windows-specific compatibility issues.

1. **Install WSL2**

   ```powershell
   wsl --install
   ```

   Restart your computer, then open a WSL terminal (Ubuntu by default).

2. **Install prerequisites inside WSL2**

   ```bash
   # Update packages
   sudo apt update && sudo apt upgrade -y

   # Install Node.js 18+ via NodeSource
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs

   # Install Bun
   curl -fsSL https://bun.sh/install | bash

   # Install Git (usually pre-installed on WSL Ubuntu)
   sudo apt install -y git
   ```

3. **Follow the Linux/macOS instructions below** from the "Clone the repository" step onward.

   Note: If you want Docker services, install Docker Desktop on Windows and enable WSL integration in Docker Desktop settings. The WSL2 environment will then have access to Docker.

#### Common Windows Issues

- **Long path names**: Windows has a 260-character path limit by default. If you encounter errors during `npm install`, enable long paths:
  ```powershell
  # Run PowerShell as Administrator
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
  ```
  Then restart your terminal.

- **Line ending issues**: Git may convert LF to CRLF on Windows, which can cause issues with shell scripts. Configure Git to keep LF:
  ```powershell
  git config --global core.autocrlf input
  ```

- **PowerShell execution policy**: If scripts are blocked, run PowerShell as Administrator and execute:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

- **Bun not found after install**: Restart your terminal or run `refreshenv` (if using Chocolatey) to reload the PATH.

- **SQLite native module errors**: If Prisma throws native module errors on Windows, ensure you have the latest Visual C++ Redistributable installed. Download it from [Microsoft](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist).

- **Port 3000 already in use**: Find and kill the process using port 3000:
  ```powershell
  netstat -ano | findstr :3000
  taskkill /PID <PID> /F
  ```

### Setup on macOS

1. **Install prerequisites**

   The recommended approach on macOS is to use [Homebrew](https://brew.sh/). If you don't have Homebrew installed, install it first:

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

   After Homebrew is installed, add it to your PATH (Apple Silicon Macs only):

   ```bash
   # For Apple Silicon (M1/M2/M3/M4) Macs
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```

   Now install the prerequisites:

   ```bash
   # Install Node.js 18+ (LTS)
   brew install node@20
   brew link node@20

   # Install Git
   brew install git

   # Install Bun
   curl -fsSL https://bun.sh/install | bash

   # Install Docker Desktop (optional, for PostgreSQL/Redis/M-Pesa mock)
   brew install --cask docker
   ```

   Alternatively, if you use [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions:

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   nvm install 20
   nvm use 20
   ```

2. **Clone the repository**

   ```bash
   git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
   cd mbumah-hardware-pos
   ```

3. **Install dependencies**

   With Bun:
   ```bash
   bun install
   ```

   With npm:
   ```bash
   npm install
   ```

4. **Set up environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your configuration. At minimum, set the `DATABASE_URL` and `NEXTAUTH_SECRET` values. See the [Environment Variables](#environment-variables) section below for details.

5. **Set up the database**

   With Bun:
   ```bash
   bun run db:push
   bun run db:generate
   ```

   With npm:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

6. **Seed the database**

   ```bash
   npx tsx prisma/seed.ts
   ```

7. **Start the development server**

   With Bun:
   ```bash
   bun run dev
   ```

   With npm:
   ```bash
   npm run dev
   ```

   The app will be available at [http://localhost:3000](http://localhost:3000).

#### Common macOS Issues

- **`bun: command not found` after install**: The Bun installer adds itself to `~/.bashrc` or `~/.zshrc`. Restart your terminal or run `source ~/.zshrc` (or `source ~/.bashrc` if using Bash).

- **`node@20` not linked after Homebrew install**: If `node` is not found after `brew install node@20`, run:
  ```bash
  brew link --overwrite node@20
  ```

- **Permission denied on `node_modules`**: If you previously ran installs with `sudo`, you may need to fix ownership:
  ```bash
  sudo chown -R $(whoami) ~/.npm
  sudo chown -R $(whoami) /usr/local/lib/node_modules
  ```

- **Xcode Command Line Tools required**: Some native modules require the Xcode CLT. Install them with:
  ```bash
  xcode-select --install
  ```

- **Rosetta required on Apple Silicon**: If you encounter architecture mismatch errors with native modules, some packages may need Rosetta:
  ```bash
  softwareupdate --install-rosetta --agree-to-license
  ```

- **Port 3000 already in use**: Find and kill the process using port 3000:
  ```bash
   lsof -ti:3000 | xargs kill -9
  ```

### Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Database connection string. Use `file:./dev.db` for SQLite or a PostgreSQL URL for production |
| `NEXTAUTH_SECRET` | Yes | Secret key for NextAuth.js session encryption. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | Base URL of the application (e.g., `http://localhost:3000`) |
| `MPESA_CONSUMER_KEY` | No | Safaricom Daraja API consumer key (for M-Pesa payments) |
| `MPESA_CONSUMER_SECRET` | No | Safaricom Daraja API consumer secret |
| `MPESA_PASSKEY` | No | Lipa Na M-Pesa online passkey |
| `MPESA_SHORTCODE` | No | Business shortcode (use `174379` for sandbox) |
| `MPESA_ENVIRONMENT` | No | `sandbox` or `production` (default: `sandbox`) |
| `REDIS_URL` | No | Redis connection URL (default: `redis://localhost:6379`) |

### Docker Setup (Optional)

For PostgreSQL, Redis, and the Mock M-Pesa service:

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL 15** on port `5432` (with pg_trgm extension)
- **Redis 7** on port `6379`
- **Mock M-Pesa Daraja API** on port `9000`

If you are using Docker with the PostgreSQL container instead of SQLite, update your `DATABASE_URL` in `.env`:

```env
DATABASE_URL="postgresql://mbumah:mbumah_secret@localhost:5432/mbumah_pos?schema=public"
```

## Demo Accounts

The seed script creates demo accounts for testing different roles:

| Role | Email | Password | Access Level |
|------|-------|----------|-------------|
| **Super Admin** | `admin@mbumahhardware.co.ke` | `Admin@2024` | Full system access -- all modules, settings, user management |
| **Cashier** | `cashier@mbumahhardware.co.ke` | `Cashier@2024` | POS operations, product lookup, basic transactions |
| **Accountant** | `accountant@mbumahhardware.co.ke` | `Accountant@2024` | Financial reports, debt management, journal entries, exports |
| **Branch Manager** | `thika.manager@mbumahhardware.co.ke` | `Manager@2024` | Store-level management for Thika branch |
| **Branch Manager** | `ruiru.manager@mbumahhardware.co.ke` | `Manager@2024` | Store-level management for Ruiru branch |
| **Branch Manager** | `nairobi.manager@mbumahhardware.co.ke` | `Manager@2024` | Store-level management for Nairobi CBD branch |
| **Branch Manager** | `nakuru.manager@mbumahhardware.co.ke` | `Manager@2024` | Store-level management for Nakuru branch |

**Important**: Change these passwords immediately in production environments.

## API Reference

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

## Project Structure

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

## M-Pesa Integration

The system integrates with **Safaricom's Daraja API** for M-Pesa payments, supporting both sandbox (development) and production environments.

### Features

- **STK Push (Lipa Na M-Pesa Online)** -- Initiate payment from the POS; customer receives a prompt on their phone
- **C2B (Customer to Business)** -- Receive payments directly to your paybill/till number
- **Callback Handling** -- Automatic payment confirmation and reconciliation
- **Transaction Matching** -- Match M-Pesa receipts with system transactions

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

## RBAC Roles

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

## Kenya-Specific Features

This system is purpose-built for the Kenyan business environment:

| Feature | Description |
|---------|-------------|
| **KES Currency** | All transactions in Kenyan Shillings (KES) with proper formatting |
| **M-Pesa Integration** | STK Push payments, C2B callbacks, and automatic reconciliation via Safaricom Daraja API |
| **eTIMS/TIMS Compliance** | Electronic Tax Invoice Management System integration for KRA-compliant invoicing |
| **KRA PIN Tracking** | Organization and store-level KRA PIN management for tax reporting |
| **Debt/Credit Management** | Comprehensive credit sales tracking, debt ledger, payment reminders, and write-off capabilities -- essential for Kenyan hardware store operations |
| **Kenyan Product Catalog** | Pre-configured categories for cement (Bamburi, Simba, Savanna), mabati, rebar, and other local products |
| **Local Phone Numbers** | Support for Kenyan phone number formats (07xx, 01xx, +254) |
| **Multi-Branch Support** | Designed for hardware stores operating across multiple counties in Kenya |

## Deployment

### One-Click Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/bucky-ops/mbumah-hardware-pos&env=DATABASE_URL,DIRECT_URL,NEXTAUTH_SECRET,NEXTAUTH_URL,JWT_SECRET,NEXT_PUBLIC_APP_URL,NEXT_PUBLIC_CURRENCY&envDescription=Required%20environment%20variables%20for%20MBUMAH%20HARDWARE%20POS&envLink=https://github.com/bucky-ops/mbumah-hardware-pos/blob/main/.env.example&project-name=mbumah-hardware-pos&repository-name=mbumah-hardware-pos)

Click the button above to deploy your own instance of MBUMAH HARDWARE POS to Vercel. You will need:

1. A [Vercel account](https://vercel.com/signup) (free)
2. A [Neon PostgreSQL database](https://console.neon.tech) (free tier works)

During deployment, you will be prompted to set these environment variables:

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `DATABASE_URL` | `postgresql://neondb_owner:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require` | Neon pooled connection string |
| `DIRECT_URL` | `postgresql://neondb_owner:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require` | Neon direct connection string (for migrations) |
| `NEXTAUTH_SECRET` | (auto-generated) | Session encryption key |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` | Your app's public URL |
| `JWT_SECRET` | (auto-generated) | JWT signing key |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Public app URL for client-side |
| `NEXT_PUBLIC_CURRENCY` | `KES` | Currency code (KES for Kenya) |

### Step-by-Step Vercel Deployment

If you prefer manual deployment:

1. **Create a Neon PostgreSQL database**
   - Go to [console.neon.tech](https://console.neon.tech) and create a free project
   - Name it `mbumah-hardware-pos`
   - Choose the region closest to your users
   - Copy both the pooled and direct connection strings

2. **Import the project on Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import the `bucky-ops/mbumah-hardware-pos` repository
   - The framework will be auto-detected as Next.js

3. **Configure environment variables**
   - Add all the variables from the table above
   - Use the Neon pooled connection string for `DATABASE_URL`
   - Use the Neon direct connection string for `DIRECT_URL`

4. **Deploy**
   - Click "Deploy" and wait for the build to complete
   - The build script will automatically:
     - Switch Prisma from SQLite to PostgreSQL
     - Run database migrations
     - Build the Next.js application

5. **Seed the database** (after first deploy)
   - Run this command locally with your Neon connection string:
     ```bash
     DATABASE_URL="postgresql://..." DIRECT_URL="postgresql://..." npx prisma db seed
     ```
   - Or use the Vercel CLI:
     ```bash
     vercel env pull .env.production
     npx prisma db seed
     ```

### Automated Deployment with GitHub Actions

The repository includes GitHub Actions workflows for automatic deployments:

- **Production**: Deploys on push to `main` branch
- **Preview**: Deploys on pull requests and other branches

To set up:
1. Add these secrets to your GitHub repository settings:
   - `VERCEL_TOKEN` - Your Vercel API token
   - `VERCEL_ORG_ID` - Your Vercel organization ID
   - `VERCEL_PROJECT_ID` - Your Vercel project ID

2. Find your org and project IDs:
   ```bash
   vercel link  # Creates .vercel/project.json with both IDs
   cat .vercel/project.json
   ```

### Production Checklist

Before deploying to production:

1. Change all demo account passwords
2. Set a strong `NEXTAUTH_SECRET` (minimum 32 characters)
3. Switch `DATABASE_URL` from SQLite to PostgreSQL
4. Set `MPESA_ENVIRONMENT=production` and configure real Daraja API credentials
5. Configure `REDIS_URL` for session storage and caching
6. Enable HTTPS (use a reverse proxy like Caddy or Nginx)
7. Review and restrict CORS origins

### Deploying with Docker

```bash
# Build the Docker image
docker build -t mbumah-pos .

# Run with Docker Compose (includes PostgreSQL, Redis)
docker-compose -f docker-compose.prod.yml up -d
```

### Deploying with Caddy

A `Caddyfile` is included for deployment with [Caddy](https://caddyserver.com/) as a reverse proxy:

```bash
# Build the Next.js application
npm run build

# Start the production server
./start-server.sh
```

Caddy will automatically provision TLS certificates via Let's Encrypt.

### Production Database

For production, use PostgreSQL instead of SQLite. The recommended providers:

| Provider | Free Tier | Region | Notes |
|----------|-----------|--------|-------|
| [Neon](https://neon.tech) | 0.5 GB, 100 compute hours/month | Multiple | Best for Vercel; serverless, auto-suspend |
| [Supabase](https://supabase.com) | 500 MB, 2 projects | Multiple | Includes auth and storage |
| [Railway](https://railway.app) | $5 credit/month | Multiple | Simple setup, good for small projects |

Update your `DATABASE_URL`:

```env
DATABASE_URL="postgresql://user:password@host:5432/mbumah_pos?schema=public"
```

Run migrations against the production database:

```bash
npx prisma migrate deploy
```

## Contributing

We welcome contributions from the community. Here is how you can help:

### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/mbumah-hardware-pos.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Make your changes and commit: `git commit -m "Add your feature"`
5. Push to your fork: `git push origin feature/your-feature-name`
6. Open a Pull Request against the `main` branch

### Guidelines

- Follow the existing code style (TypeScript, ESLint config)
- Write clear, descriptive commit messages
- Add tests for new features when applicable
- Update documentation for any changed behavior
- Keep PRs focused -- one feature or fix per PR
- Ensure all existing tests pass before submitting

### Reporting Issues

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template for bugs
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template for new features
- Search existing issues before creating a new one

## License

This project is licensed under the **MIT License** -- see the [LICENSE](LICENSE) file for details.

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
