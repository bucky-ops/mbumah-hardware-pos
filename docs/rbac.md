# RBAC (role-based access control)

Roles answer "what can this user do"; workspaces and tenancy answer "where can they do it". This document summarises the role set (including the v2.16.0 `WAREHOUSE_MANAGER`), the permission matrix, the enforcement layers, and ORM-level tenancy. For the workspace routing and workspace authorization rules see [Subdomain workspaces](subdomain-workspaces.md); this page focuses on the API and data layers.

## Roles

Defined in `src/lib/types.ts` (`UserRole`):

| Role | Scope | Summary |
|------|-------|---------|
| `SUPER_ADMIN` | Organization-wide, cross-store | Full control of every module, users, stores and system configuration. Can open any workspace, including inactive stores (diagnostic view). |
| `STORE_OWNER` | Organization-wide, cross-store | Full business control minus system-level administration (no `system_config`, no store management via the matrix). |
| `BRANCH_MANAGER` | Own store | Runs a branch: catalog, sales, refunds, customers, rentals, POs, reports. |
| `CASHIER` | Own store | Sells: products read, transactions create/read, customers read, POs read. No financials, no reports. |
| `ACCOUNTANT` | Organization-wide, read-only financial | Reads financials, exports, approves and adjusts; read-only elsewhere. In branch workspaces the store context comes back `readOnly: true`. |
| `INVENTORY_MANAGER` | Own store | Catalog and supply chain steward: products create/read/update, purchase orders create/read/update/receive, customers read. No sales, no financials. |
| `WAREHOUSE_MANAGER` (new in v2.16.0) | Multi-branch via `StoreMembership` | Same operational envelope as `INVENTORY_MANAGER` plus reports read and admin read; per-branch reach comes from active `StoreMembership` rows, not from the matrix. Enters branches through `/branches/select`. No sales, no financials, no debt. |

Role sets used by route guards: `MANAGER_PLUS_ROLES` = `SUPER_ADMIN`, `STORE_OWNER`, `BRANCH_MANAGER`; `OWNER_ROLES` = `SUPER_ADMIN`, `STORE_OWNER`.

## Permission matrix overview

`PERMISSION_MATRIX` (`src/lib/types.ts`) maps each role to resource actions across nine resources: `products`, `transactions`, `customers`, `financials`, `rentals`, `admin`, `reports`, `debt`, `purchase_orders`. Highlights:

- `SUPER_ADMIN` has every action on every resource (including `delete`, `void`, `manage_users`, `manage_stores`, `system_config`).
- `STORE_OWNER` matches `SUPER_ADMIN` except for the `transactions` resource (no `delete`, though `refund` and `void` are present) and `admin` (no `manage_stores`, no `system_config`).
- `BRANCH_MANAGER` has create/update on catalog, customers, rentals and POs; read/export financials; no deletes.
- `CASHIER` is deliberately minimal (sell and read).
- `ACCOUNTANT` is read/export/approve/adjust on financials plus read everywhere and `update`/`remind` on debt, `approve` on POs.
- `INVENTORY_MANAGER` and `WAREHOUSE_MANAGER` have empty `transactions` and `financials` - they never sell and never see money. The database seed mirrors the matrix as permission rows (RBAC stage, `createMany` with `skipDuplicates`).

The same matrix is enforced in the UI (`use-permissions.ts` / `hasPermission`) so buttons and tabs hide before the server ever rejects.

## Enforcement layers (defense in depth)

From `src/lib/auth.ts`:

| Layer | Where | What it does |
|-------|-------|--------------|
| 1. Edge check | `src/proxy.ts` | Cheap checks: Bearer presence on protected routes, rate limits, request size, CSRF, content-type. Convenience only - never the security boundary. |
| 2. Session + roles | `requireAuth(handler, { roles })` / `requireStoreAccess` | DB-backed session validation on every route (401), optional role gate (403 + security log), store-scope resolution. |
| 3. Permission matrix | `assertPermission()` in handlers | Fine-grained action/resource checks with friendly denial copy. |
| 4. ORM tenancy | `src/lib/db.ts` | Automatic `storeId` filtering so a valid session can only touch its own store's rows. |

A route is properly guarded only when layers 2+ are applied in-file.

### requireAuth / requireStoreAccess / assertStoreScope

- `requireAuth(handler)` validates the session (Bearer header first, `mbt_token` cookie as workspace fallback) and returns 401 for anonymous, expired or locked-out callers.
- `requireStoreAccess(handler, { roles })` adds the role gate, then `assertStoreScope`.
- `assertStoreScope(request, session)` blocks cross-store probing via `?storeId=` / `?store=` query params for non-`SUPER_ADMIN` sessions:
  - `STORE_OWNER` may open any branch.
  - Any other role passes only for their primary store or a store with an active `StoreMembership` (v2.16.0 multi-store rule).
  - Everything else is denied 403 and security-logged (`denyCrossStoreAccess` writes the audit row and feeds the abuse counter).
- When a validated request targets a different store than the session's primary one, `requireStoreAccess` runs the ORM tenancy against **that** store (`tenantOverride`), so a warehouse manager's workspace shows the assigned branch's data instead of an empty primary-store filter.

## ORM tenancy (src/lib/db.ts)

`STORE_SCOPED_MODELS` names 47 Prisma models (products, stock, customers, sales, payments, M-Pesa, debt, rentals, journal entries, banking, tax, payroll, audit log and more). For those models the Prisma extension injects `storeId` into every query's `where` (including unique lookups), `createMany` data and any nested writes, based on the tenant context established by `runWithTenant(storeId)` / `runWithoutTenant(fn)`.

Rules of thumb:

- Store-scoped routes wrap their handlers in `requireStoreAccess`, which establishes the tenant context (primary store or validated `tenantOverride`).
- Cross-store operations (org summary, chat, store listing) call `runWithoutTenant` explicitly and must carry their own validated filters and role gates.
- Append-only financial and audit models additionally reject `update`/`delete` (`IMMUTABILITY_VIOLATION`).

## Memberships (store_memberships)

`StoreMembership` grants access to an additional store; details and assignment examples are in [Multi-store workspaces](multi-store-workspaces.md). Everything that answers "which stores can this user open" reads it with `status = 'ACTIVE'`: `resolveStoreContext` (workspace gate), `assertStoreScope` (query-param gate) and `getChatAccessibleStoreIds` (chat).

## Abuse lockout

Permission denials feed a sliding-window abuse counter (`noteDeniedAndMaybeLock` in `src/lib/auth.ts`): 5 or more denials in 10 minutes lock the account out of the API for 15 minutes - session resolution returns null, so every guarded route answers 401 while the lock is active. The lock also writes a `SecurityEvent` (`ACCOUNT_LOCKED`, severity `ERROR`) and notifies every active `SUPER_ADMIN` (notification type `WARNING`, category `SECURITY`, priority `URGENT`). The counter is per app instance (in-memory) - a documented limitation on multi-instance serverless, where each instance keeps its own window.

## Related documents

- [Authentication and RBAC](authentication-and-rbac.md) - session mechanics, CSRF, manager step-up authorization
- [Subdomain workspaces](subdomain-workspaces.md) - workspace-level authorization rules per role
- [Multi-store workspaces](multi-store-workspaces.md) - membership assignment and the branch selector
- [Multi-tenant architecture](multi-tenant-architecture.md) - store isolation and seeding
