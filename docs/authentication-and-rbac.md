# Authentication and RBAC

The system enforces role-based access control across all endpoints and UI components. Permissions are checked in the API layer (every protected route validates the caller's role) and in the UI layer (tabs and actions gate rendering on the user's role).

## Roles

| Role | Scope | Description |
|------|-------|-------------|
| `SUPER_ADMIN` | Organization-wide | Full system access, all stores, user management, system configuration |
| `STORE_OWNER` | Organization-wide | Multi-store access, financial reports, supplier management |
| `BRANCH_MANAGER` | Single store | Store operations, inventory, staff shifts, reports |
| `CASHIER` | Single store | POS transactions, customer lookup, shift start and end |
| `ACCOUNTANT` | Organization-wide | Financial reports, journal entries, expense approval |
| `INVENTORY_MANAGER` | Single store | Catalog and inventory steward: catalog, inventory, suppliers, purchase orders, and transfers. No sales-override powers and no financial visibility. Added in v2.12.5. |

## Permission matrix

| Feature | SUPER_ADMIN | STORE_OWNER | BRANCH_MANAGER | CASHIER | ACCOUNTANT |
|---------|-------------|-------------|----------------|---------|------------|
| Dashboard | Yes (all stores) | Yes (all stores) | Yes (own store) | Yes (own store) | Yes (all stores) |
| POS / Transactions | Yes | Yes | Yes | Yes | No |
| Product management | Yes | Yes | Yes | Read-only | No |
| Inventory / Stock | Yes | Yes | Yes | Read-only | No |
| Customer CRM | Yes | Yes | Yes | Yes | Read-only |
| Gift cards | Yes | Yes | Yes | Read-only | Read-only |
| Equipment rentals | Yes | Yes | Yes | Yes | No |
| Financial reports | Yes | Yes | No | No | Yes |
| Journal entries | Yes | Yes | No | No | Yes |
| Expense approval | Yes | Yes | No | No | Yes |
| Shift management | Yes | Yes | Yes | Yes | No |
| Supplier management | Yes | Yes | Read-only | No | Read-only |
| Purchase orders | Yes | Yes | Yes | No | No |
| User management | Yes | Yes | No | No | No |
| Store management | Yes | Yes | No | No | No |
| System configuration | Yes | No | No | No | No |
| Audit logs | Yes | Yes | No | No | No |
| Error details | Yes | No | No | No | No |

## Feature permission keys

Beyond the resource-level matrix, business rules use dotted feature permission keys defined in `src/lib/permissions.ts` (16 keys such as `pos.sell`, `pos.void`, `pos.discount.gt5`, `pos.discount.gt10`, `dashboard.view.revenue`, `inventory.view.cost`, `customers.view.debt`, `debt.approve.high_risk`, `settings.roles.manage`). Lookups fail closed for unknown keys or roles, and `SUPER_ADMIN` has an explicit bypass. Every denial writes a hash-chained `AuditLog` row and a `SecurityEvent`, and feeds the privilege-abuse engine.

## Manager step-up authorization

Some actions require a second, stronger credential than the cashier's own session:

| Action | Requirement |
|--------|-------------|
| Discount above 5% | Manager tier (`SUPER_ADMIN`, `STORE_OWNER`, `BRANCH_MANAGER`) or a verified manager override credential |
| Discount above 10% | Store Owner tier; never cashier-overridable |
| Credit sale to a customer owing more than KES 150,000 | `debt.approve.high_risk` or a verified manager override |

The counter flow collects a manager's email and password through `POST /api/auth/manager-authorize`, which verifies the credential, gates on manager-tier roles, records `MANAGER_AUTHORIZED` audit rows, and rate-limits failed attempts (3 per 5 minutes per email and IP, returning `429 BRUTE_FORCE_PIN`). Every override or denial at checkout writes a `MANAGER_OVERRIDE` or `PERMISSION_DENIED` audit row.

## Related controls

- Tenant isolation by `storeId`: see [Multi-tenant architecture](multi-tenant-architecture.md).
- Financial immutability guard: see [Database schema](database-schema.md) and [SECURITY.md](../SECURITY.md).
- Cashier limited dashboard: revenue-denied roles receive a restricted payload with their own sales only (v2.12.4).
