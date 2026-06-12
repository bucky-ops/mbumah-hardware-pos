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

## Database Changes

If this PR includes Prisma schema changes:

- [ ] No database changes
- [ ] Schema change — migration included (`prisma migrate dev` ran)
- [ ] Schema change — `prisma db push` compatible only
- [ ] Seed data updated

**Migration name**: _(if applicable)_

## Testing

Describe the tests you ran to verify your changes:

- [ ] Manual testing in development
- [ ] Unit tests pass (`bun test`)
- [ ] Lint passes (`bun run lint`)
- [ ] Build succeeds (`bun run build`)
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

## Checklist

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
