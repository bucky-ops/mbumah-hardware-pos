# Pull Request

## Description

A clear and concise description of the changes in this PR.

Fixes # (issue number)

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Refactor (code restructuring without changing external behavior)
- [ ] Documentation update
- [ ] Database migration (Prisma schema change)
- [ ] CI/CD change

## Affected Areas

- [ ] POS / Checkout
- [ ] Inventory Management
- [ ] Customer Management
- [ ] M-Pesa Integration
- [ ] Debt Tracking
- [ ] Equipment Rentals
- [ ] Financial / Double-Entry Bookkeeping
- [ ] Reports & Exports
- [ ] Authentication / Authorization
- [ ] Admin / System Configuration
- [ ] API Routes
- [ ] Database Schema

## ✅ Quality Checklist (Required)

These items are **mandatory** for every PR. Please do not request review until all are checked.

- [ ] **Tested locally** — I ran `bun run dev` and manually verified the feature/fix works end-to-end (not just "it compiles").
- [ ] **Prisma migrations included** — If this PR changes `prisma/schema.prisma`, I ran `bun run db:migrate --name <desc>` and committed the `prisma/migrations/` files. (Check this box even if there were no schema changes.)
- [ ] **No `any` types used** — I did not introduce any `any` types or `@ts-ignore` / `@ts-expect-error` suppressions. TypeScript strict mode passes.
- [ ] **Multi-tenancy (`storeId`) verified** — Every new/modified database query is scoped by `storeId` (or explicitly SUPER_ADMIN scoped). No cross-store data leakage is possible.
- [ ] **Added `export const dynamic = 'force-dynamic'` to API routes** — Every new/modified API route handler (`src/app/api/**/route.ts`) exports `dynamic = 'force-dynamic'`. This prevents Next.js from statically pre-rendering dynamic routes during `next build`, which would crash the Vercel build by triggering eager env validation when runtime secrets aren't injected. (Check this box even if the PR doesn't touch API routes.)

## Database Changes

If this PR includes Prisma schema changes:

- [ ] No database changes
- [ ] Schema change — migration included (`bun run db:migrate --name <desc>` run)
- [ ] Schema change — `bun run db:push` compatible only
- [ ] Seed data updated

**Migration name**: _(if applicable)_

## Testing

Describe the tests you ran to verify your changes:

- [ ] Manual testing in development
- [ ] Unit tests pass (`bun run test`)
- [ ] Lint passes (`bun run lint`)
- [ ] API endpoint tested via curl/Postman
- [ ] Tested with SQLite (local dev)
- [ ] Tested with PostgreSQL (Docker/CI)

### Test Configuration

- **Node.js version**:
- **Bun version**:
- **Database**: SQLite / PostgreSQL
- **Browser**:

## Kenya-Specific Validation

If this PR touches payment, tax, or regulatory features:

- [ ] KRA tax calculations correct (VAT 16%)
- [ ] M-Pesa STK Push flow works
- [ ] KES currency formatting preserved
- [ ] Receipt format compliant
- [ ] Financial ledger immutability preserved (no edits/deletes to posted journal entries)

## Additional Checklist

- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published in downstream modules
- [ ] I have checked my code for hardcoded secrets or credentials

## Screenshots (if applicable)

Add screenshots of UI changes here.

## Additional Notes

Add any other context about the PR here.
