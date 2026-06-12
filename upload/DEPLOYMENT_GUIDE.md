# HSMS - Hardware Store Management System

## Complete Full-Stack System for Hardware Store Retail Management

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Technology Stack](#technology-stack)
3. [Features Overview](#features-overview)
4. [Quick Start (Development)](#quick-start-development)
5. [Production Deployment](#production-deployment)
6. [API Reference](#api-reference)
7. [Database Schema](#database-schema)
8. [Configuration Reference](#configuration-reference)
9. [Security Considerations](#security-considerations)
10. [Troubleshooting](#troubleshooting)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    HSMS Architecture                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Frontend (React PWA)                │   │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────────────┐ │   │
│  │  │POS/Cart │ │Admin     │ │Reports & Analytics│ │   │
│  │  │Checkout │ │Dashboard │ │(Recharts)         │ │   │
│  │  └─────────┘ └──────────┘ └───────────────────┘ │   │
│  └────────────────────┬─────────────────────────────┘   │
│                       │ REST API                         │
│  ┌────────────────────┴─────────────────────────────┐   │
│  │              Next.js API Routes                   │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐ │   │
│  │  │Auth  │ │Sales │ │Invnt │ │CRM   │ │Reports│ │   │
│  │  │JWT   │ │&Pay  │ │&Cat  │ │Bills │ │FastSlw│ │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └───────┘ │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐ │   │
│  │  │GiftC │ │PO/GRN│ │Deliv │ │Sync  │ │Webhook│ │   │
│  │  │Loylty│ │Purch │ │Notes │ │Engine│ │Events │ │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └───────┘ │   │
│  └────────────────────┬─────────────────────────────┘   │
│                       │ Prisma ORM                       │
│  ┌────────────────────┴─────────────────────────────┐   │
│  │              Database Layer                       │   │
│  │  ┌──────────────────┐  ┌────────────────────┐    │   │
│  │  │ SQLite (Dev/Local)│  │ PostgreSQL (Prod)  │    │   │
│  │  │ SQLCipher Ready   │  │ With Migrations    │    │   │
│  │  └──────────────────┘  └────────────────────┘    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Infrastructure                       │   │
│  │  Docker / Kubernetes / GitHub Actions CI/CD      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19 + TypeScript | UI with 12 tab modules |
| **UI Framework** | shadcn/ui + Tailwind CSS 4 | Component library + styling |
| **Charts** | Recharts | Data visualization (line, bar, pie charts) |
| **Backend** | Next.js 16 App Router | API routes with server-side logic |
| **Database** | Prisma ORM + SQLite (dev) | Type-safe database access |
| **Auth** | JWT (jose) | Token-based authentication |
| **Validation** | Zod | Runtime input validation |
| **State** | React useState + useCallback | Client-side state management |
| **Notifications** | Sonner | Toast notifications |

---

## Features Overview

### 12 Functional Modules

1. **Dashboard** - KPI cards, revenue charts, payment distribution, inventory status, alerts
2. **POS / Checkout** - Product search, cart management, 5 payment methods, VAT calculation, receipt preview
3. **Inventory** - Full catalog, stock levels, add SKU dialog, stock adjustments with audit trail
4. **Customers** - CRM with phone-primary identification, account types (RETAIL/TRADE), credit limits, loyalty
5. **Bills Board** - Outstanding invoices, aging buckets (Current/1-30/31-60/61-90/90+), bulk actions, payment application
6. **Purchase Orders** - PO lifecycle (DRAFT→RECEIVED), GRN with variance tracking, inventory auto-update
7. **Sales History** - Complete order history with line items, payments, and invoice details
8. **Gift Cards** - Issue/redeem, balance tracking with progress bars, transaction history
9. **Delivery** - Status progression (PENDING→DELIVERED), proof of delivery, driver assignment
10. **Reports** - Fast/Slow mover analysis, deadstock detection, ABC classification, velocity metrics
11. **Sync Engine** - Offline-first sync, conflict resolution rules, pending queue management
12. **Settings** - Authentication, user management, location info, system status

### Key Business Rules

- **Images are preview-only** — cannot be added as purchasable receipt line items
- **Phone number is primary customer identifier** — unique constraint enforced
- **Store Credit/Pay Later** creates invoice with 30-day due date
- **Trade pricing** automatically applied for TRADE account type customers
- **VAT 16%** applied to STANDARD tax class items (REDUCED=8%, ZERO/EXEMPT=0%)
- **Loyalty points** earned at 1 point per 10 KES spent
- **Offline sales** tracked via SyncLog with idempotent device UUIDs
- **Conflict resolution**: Local-wins for payments, Server-wins for catalog, Version-vectors for inventory

---

## Quick Start (Development)

### Prerequisites

- **Node.js** 18+ or **Bun** runtime
- **npm**, **yarn**, or **bun** package manager

### Step-by-Step Setup

```bash
# 1. Clone the repository
git clone <repository-url>
cd hsms

# 2. Install dependencies
bun install
# or: npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# 4. Initialize the database
bun run db:push
# or: npx prisma db push

# 5. Start the development server
bun run dev
# or: npm run dev

# 6. Open the application
# Navigate to http://localhost:3000
# The system will auto-seed demo data on first load
```

### Demo Accounts

| Email | Role | Password |
|-------|------|----------|
| owner@hsms.test | OWNER | any (demo mode) |
| manager@hsms.test | MANAGER | any (demo mode) |
| cashier@hsms.test | CASHIER | any (demo mode) |
| clerk@hsms.test | STOCK_CLERK | any (demo mode) |

### Demo Data Included

- 12 hardware SKUs (nails, cement, paint, pipes, tools, etc.)
- 4 customers (2 TRADE, 2 RETAIL)
- 2 gift cards (KES 5,000 and KES 2,000)
- 3 sales orders (1 paid, 2 credit/overdue)
- 1 supplier with SKU pricing
- 4 user accounts with RBAC roles
- 1 location (Main Store, Nairobi)

---

## Production Deployment

### Option 1: Docker Deployment

```bash
# Build the Docker image
docker build -t hsms:latest .

# Run with Docker Compose
docker-compose up -d
```

### Option 2: Standalone Server

```bash
# Build for production
bun run build

# Start the production server
NODE_ENV=production PORT=3000 node .next/standalone/server.js
```

### Option 3: Vercel Deployment

```bash
# Deploy to Vercel
npx vercel --prod
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./db/custom.db` | SQLite path or PostgreSQL URL |
| `JWT_SECRET` | `hsms-dev-secret-key-change-in-production` | JWT signing key |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Public app URL |
| `NEXT_PUBLIC_CURRENCY` | `KES` | Currency code |

### Switching to PostgreSQL (Production)

1. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. Update `.env`:
   ```
   DATABASE_URL="postgresql://user:password@localhost:5432/hsms"
   ```

3. Run migrations:
   ```bash
   npx prisma migrate dev --name init
   npx prisma migrate deploy
   ```

---

## API Reference

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth` | POST | Login (email+password) or verify token |

### Core Modules

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/skus` | GET, POST | Product catalog |
| `/api/inventory` | GET, PATCH | Inventory balances & adjustments |
| `/api/customers` | GET, POST | Customer management |
| `/api/sales` | GET, POST | Sales orders with checkout |
| `/api/invoices` | GET, PATCH, PUT | Invoice & billing management |
| `/api/gift-cards` | GET, POST | Gift card management |
| `/api/purchase-orders` | GET, POST, PATCH | PO & GRN management |
| `/api/delivery-notes` | GET, POST, PATCH | Delivery tracking |
| `/api/sync` | GET, POST | Sync engine & conflict resolution |

### Reports

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reports/dashboard` | GET | Dashboard KPIs & summaries |
| `/api/reports/fast-slow` | GET | Fast/Slow/Deadstock analysis |

### System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/seed` | GET | Seed demo data |
| `/api` | GET | Health check |

### Query Parameters

Most GET endpoints support:
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50)
- `search` - Text search
- Module-specific filters (e.g., `status`, `overdue`, `customerId`)

---

## Database Schema

### 18 Core Entities

| Entity | Purpose | Key Fields |
|--------|---------|-----------|
| `Role` | RBAC roles | name, permissions (JSON) |
| `User` | Staff accounts | email, name, passwordHash, roleId |
| `Location` | Store/warehouse | name, type, address |
| `SKU` | Product catalog | sku, barcode, name, prices, taxClass |
| `ImageAsset` | Product images | url, fingerprint (preview-only) |
| `InventoryBalance` | Stock levels | qtyAvailable, version (for conflict detection) |
| `Customer` | CRM | phonePrimary (unique), accountType, creditLimit |
| `LoyaltyAccount` | Points tracking | pointsBalance, tier (BRONZE/SILVER/GOLD/PLATINUM) |
| `GiftCard` | Prepaid cards | code (unique), balance, status |
| `SalesOrder` | Transactions | orderNumber, totalAmount, isOffline, syncStatus |
| `Invoice` | Billing | outstandingBalance, agingBucket, overdueFlag |
| `Payment` | Payment records | method, amount, token (PCI-safe) |
| `Supplier` | Vendor management | code, leadTimeDays, paymentTerms |
| `PurchaseOrder` | Procurement | poNumber, status lifecycle |
| `DeliveryNote` | Fulfillment | dnNumber, status, signatureUrl |
| `SyncLog` | Offline sync | entityType, status, conflictResolution |
| `AuditLog` | Compliance trail | entityType, action, delta (JSON) |
| `WebhookSubscription` | Integrations | event, targetUrl, secret |

---

## Configuration Reference

### RBAC Permissions

| Role | Permissions |
|------|------------|
| OWNER | `*` (all) |
| MANAGER | `pos:*`, `inventory:*`, `crm:*`, `reports:*`, `purchasing:*`, `delivery:*` |
| CASHIER | `pos:sale`, `pos:return`, `pos:receipt` |
| STOCK_CLERK | `inventory:read`, `inventory:count`, `receiving:*` |
| ACCOUNTANT | `reports:*`, `crm:read`, `billing:read` |
| ADMIN | `admin:*`, `sync:*`, `config:*` |

### Tax Classes

| Class | Rate | Use Case |
|-------|------|----------|
| STANDARD | 16% | General goods (VAT) |
| REDUCED | 8% | Essential items |
| ZERO | 0% | Zero-rated exports |
| EXEMPT | 0% | Exempt items |

### Conflict Resolution Rules

| Data Type | Rule | Fallback |
|-----------|------|----------|
| Payments & Sales | Local Wins | Flagged for reconciliation |
| Catalog / SKU | Server Wins | Review queue |
| Inventory Counts | Version Vector | Manual adjustment queue |
| Configuration | Server Wins (always) | Local cache refresh |

---

## Security Considerations

1. **Authentication**: JWT-based with 24-hour expiry. Change `JWT_SECRET` in production.
2. **Password Hashing**: Demo uses placeholder hashes. Production must use bcrypt/argon2.
3. **PCI Compliance**: No PAN storage. Card tokens only via payment provider.
4. **SQLCipher**: Ready for encrypted local storage on POS terminals.
5. **TLS 1.3**: Required in production. Use reverse proxy (Caddy/Nginx).
6. **SMS Consent**: `consentSMS`/`consentEmail` flags must be respected.
7. **Seed Endpoint**: Disable `/api/seed` in production or require admin auth.
8. **Input Validation**: All endpoints use Zod schemas for validation.
9. **Error Handling**: No internal error details exposed to clients (500 responses).
10. **Audit Logging**: All mutations create audit trail entries.

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|---------|
| Database locked | Stop dev server, delete `db/custom.db`, run `db:push` |
| Turbopack cache errors | Delete `.next` directory and restart |
| Seed fails with unique constraint | Database already has data; safe to ignore |
| Port 3000 in use | Kill process: `fuser -k 3000/tcp` |
| Prisma client out of sync | Run `npx prisma generate` |

### Performance Tips

- Enable Prisma query logging only in development
- Add database indexes for frequently queried fields
- Use pagination (page/limit) for large datasets
- Consider Redis caching for dashboard aggregations in production
- Switch to PostgreSQL for multi-user production deployments

---

## Project Structure

```
hsms/
├── prisma/
│   └── schema.prisma          # Database schema (18 entities)
├── db/
│   └── custom.db              # SQLite database
├── src/
│   ├── app/
│   │   ├── page.tsx           # Main application (12 tabs)
│   │   ├── layout.tsx         # Root layout
│   │   └── api/
│   │       ├── auth/route.ts          # JWT authentication
│   │       ├── seed/route.ts          # Demo data seeding
│   │       ├── skus/route.ts          # Product catalog CRUD
│   │       ├── inventory/route.ts     # Stock management
│   │       ├── customers/route.ts     # CRM
│   │       ├── sales/route.ts         # POS/checkout
│   │       ├── invoices/route.ts      # Billing
│   │       ├── gift-cards/route.ts    # Gift cards & loyalty
│   │       ├── purchase-orders/route.ts # Procurement
│   │       ├── delivery-notes/route.ts # Fulfillment
│   │       ├── sync/route.ts          # Sync engine
│   │       └── reports/
│   │           ├── dashboard/route.ts  # Dashboard KPIs
│   │           └── fast-slow/route.ts  # Inventory analysis
│   ├── lib/
│   │   ├── db.ts              # Prisma client singleton
│   │   ├── seed.ts            # Seed data (idempotent)
│   │   ├── validators.ts      # Zod schemas & tax rates
│   │   └── utils.ts           # Utility functions
│   ├── components/ui/         # shadcn/ui components
│   └── hooks/                 # React hooks
├── public/                    # Static assets
├── .env                       # Environment variables
├── package.json               # Dependencies & scripts
├── tailwind.config.ts         # Tailwind configuration
├── tsconfig.json              # TypeScript configuration
└── next.config.ts             # Next.js configuration
```

---

## Scripts Reference

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev -p 3000` | Start development server |
| `build` | `next build` | Create production build |
| `start` | `node .next/standalone/server.js` | Start production server |
| `lint` | `eslint .` | Run code quality checks |
| `db:push` | `prisma db push` | Push schema to database |
| `db:generate` | `prisma generate` | Generate Prisma client |
| `db:migrate` | `prisma migrate dev` | Run migrations |
| `db:reset` | `prisma migrate reset` | Reset database |

---

*HSMS v1.0.0 - Hardware Store Management System*
*Built with Next.js 16, React 19, Prisma, TypeScript, Tailwind CSS 4, shadcn/ui*
