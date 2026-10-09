# Project structure

The repository is organized around a Next.js App Router application. The main entry points are `src/app/page.tsx` (the single-page application shell) and the REST API routes under `src/app/api/`.

```text
mbumah-hardware-pos/
├── prisma/
│   ├── schema.prisma          # Database schema (25+ models)
│   └── seed.ts                # Demo data seeder
├── public/
│   ├── logo.svg               # Brand logo
│   └── categories/            # Category images
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout with providers
│   │   ├── page.tsx           # Main SPA entry
│   │   ├── globals.css        # Global styles and theme
│   │   ├── tabs/              # Feature tab components
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
│   │   └── api/               # REST API routes
│   │       ├── auth/          # Authentication
│   │       ├── products/      # Products and bundles
│   │       ├── categories/    # Categories
│   │       ├── customers/     # Customer CRM
│   │       ├── transactions/  # Sales transactions
│   │       ├── payments/      # M-Pesa payments
│   │       ├── gift-cards/    # Gift card management
│   │       ├── financial/     # Accounts and journal
│   │       ├── shifts/        # Shift management
│   │       ├── debt/          # Debt tracking
│   │       ├── rentals/       # Equipment rentals
│   │       ├── suppliers/     # Supplier management
│   │       ├── expenses/      # Expense tracking
│   │       ├── reports/       # Reports and analytics
│   │       ├── dashboard/     # Dashboard data
│   │       ├── users/         # User management
│   │       ├── stores/        # Store management
│   │       ├── purchase-orders/ # Purchase orders
│   │       ├── stock-movements/ # Stock movements
│   │       ├── cash-drawer/   # Cash drawer
│   │       ├── receipts/      # Receipts
│   │       ├── notifications/ # Notifications
│   │       ├── audit-logs/    # Audit trail
│   │       ├── system-logs/   # System logs
│   │       └── system-config/ # System configuration
│   ├── components/
│   │   ├── ui/                # shadcn/ui components (40+)
│   │   └── error-boundary.tsx # Error boundary with admin overlay
│   ├── hooks/
│   │   ├── use-idle-timeout.ts      # 30-minute idle timeout
│   │   ├── use-state-persistence.ts # LocalStorage persistence
│   │   └── use-mobile.ts            # Mobile detection
│   └── lib/
│       ├── db.ts              # Prisma client singleton (with tenant and immutability extensions)
│       ├── api.ts             # API helper utilities
│       ├── stores.ts          # Zustand store definitions
│       ├── types.ts           # TypeScript type definitions
│       ├── utils.ts           # Utility functions
│       ├── helpers.ts         # Business logic helpers
│       ├── account-helper.ts  # Double-entry accounting helper
│       ├── logger.ts          # Structured logging
│       └── providers.tsx      # App providers (QueryClient, Theme, etc.)
├── docker/
│   ├── postgres-init.sql      # PostgreSQL init script
│   └── mpesa-mock/            # M-Pesa mock server
├── docs/                      # Documentation (see docs/README.md)
├── .env.example               # Environment template
├── docker-compose.yml         # Docker Compose for production
├── vercel.json                # Vercel deployment config
├── Caddyfile                  # Reverse proxy config
└── package.json               # Dependencies and scripts
```

## Where to look

| Task | Start here |
|------|------------|
| Add or change an API endpoint | `src/app/api/` and [API reference](api-reference.md) |
| Modify a data model | `prisma/schema.prisma` and [Database schema](database-schema.md) |
| Add a UI tab or screen | `src/app/tabs/` |
| Change tenant isolation or financial immutability | `src/lib/db.ts` and [Multi-tenant architecture](multi-tenant-architecture.md) |
| Configure the deployment | `.env.example`, `vercel.json`, `docker-compose.yml`, and [Configuration](configuration.md) |
