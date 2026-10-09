# MBUMAH HARDWARE POS & ERP

Point-of-sale and business management system for Kenyan hardware stores. Multi-branch operations, M-Pesa payments through the Daraja API (STK Push), contractor debt management, equipment rentals, double-entry accounting, gift cards, supplier purchase orders, shift reconciliation, and eTIMS-ready invoice structures.

Built with Next.js 16 (App Router), TypeScript, Prisma ORM, PostgreSQL (Neon in production, SQLite for local development), Tailwind CSS 4, shadcn/ui, Zustand, and TanStack Query.

| Badge | Status |
|---|---|
| CI | GitHub Actions workflow `ci-cd.yml` on every push and pull request |
| Runtime | Node.js 20+ / Bun 1.1+ |
| License | See [LICENSE](LICENSE) |

## Core modules

| Module | Description |
|---|---|
| Multi-branch POS | Five stores: Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru, each with isolated stock and reporting |
| Sales and checkout | Fast POS flow with barcode scanning, held carts, split payments, and M-Pesa STK Push |
| Inventory | Categories, bundles, units of measure with conversion, stock movements, low-stock alerts |
| Role-based access control | Five roles with a permission matrix enforced in the API and the UI |
| Customer CRM and debt | Credit limits, aging buckets, debt payment plans, loyalty points, statements |
| Equipment rentals | Rent-out tracking, return processing, overdue alerts |
| Financials | Double-entry journal, chart of accounts, trial balance, expense approvals |
| Shift management | Shift open and close with expected-cash reconciliation |
| Suppliers | Supplier profiles, purchase orders, fulfillment tracking |
| Reporting | Sales, inventory, and financial reports with CSV and PDF export |
| Tax compliance | eTIMS-ready invoice structures and KRA tax-type summaries |

## Quick start

Prerequisites: Node.js 20 or newer (or Bun 1.1+), and a PostgreSQL or SQLite database.

```bash
# Clone the repository
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos

# Install dependencies
bun install

# Create the environment file from the template
cp .env.example .env
# Edit .env with your database URL and session secrets (see docs/configuration.md)

# Generate the Prisma client and create the schema
bun run db:generate
bun run db:push

# Seed demo data (stores, catalog, users)
bun run db:seed

# Start the development server
bun run dev
```

Open http://localhost:3000 and sign in with a demo account.

### Demo accounts (local development only)

The seed script creates the following accounts. They are for local development and demo environments only; never reuse these credentials in production.

| Role | Email | Password |
|---|---|---|
| SUPER_ADMIN | admin@mbumahhardware.co.ke | password123 |
| System service user | system@mbumahhardware.co.ke | random UUID (not sign-in capable) |

Demo staff accounts for other roles (cashier, accountant, inventory manager, branch manager) are created by the demo-data population scripts with the password `password123`.

## Documentation

Deep-dive documentation lives in the `docs/` directory:

| Document | Contents |
|---|---|
| [Architecture overview](docs/architecture.md) | System design, data flow, offline strategy |
| [API reference](docs/api-reference.md) | REST endpoints, auth, error formats |
| [Database schema](docs/database-schema.md) | Prisma models, relationships, key constraints |
| [Authentication and RBAC](docs/authentication-and-rbac.md) | Roles, permission matrix, manager step-up authorization |
| [Multi-tenant architecture](docs/multi-tenant-architecture.md) | Store isolation, seeding, branch codes |
| [Configuration](docs/configuration.md) | Environment variables, M-Pesa Daraja, optional services |
| [Deployment](docs/deployment.md) | Vercel, Docker, Neon setup, migrations |
| [Troubleshooting and FAQ](docs/troubleshooting-and-faq.md) | Common issues and fixes |
| [Release process](docs/release-process.md) | Versioning, changelog, release automation |
| [Contributing](CONTRIBUTING.md) | Development workflow, commit convention, code style |
| [Security policy](SECURITY.md) | Reporting vulnerabilities, credential handling |

## Support

See [SUPPORT.md](SUPPORT.md) for help channels and how to report a problem. Security issues are handled privately through [SECURITY.md](SECURITY.md).

## License

This project is licensed under the terms found in [LICENSE](LICENSE).
