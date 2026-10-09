# Multi-tenant architecture

All data is isolated per store using a `storeId` discriminator column on every tenant-scoped model. One `Organization` (Mbumah Hardware) operates five stores: Juja Main, Thika, Ruiru, Nairobi CBD, and Nakuru. Authentication, the M-Pesa integration, and the financial engine are shared services; the business data underneath them is partitioned by store.

## How it works

1. Every request includes the authenticated user's `storeId`.
2. All queries are scoped with `where: { storeId }`, so there is no cross-store data leakage.
3. `SUPER_ADMIN` and `STORE_OWNER` can optionally query across stores.
4. Organization-level entities (accounts, suppliers) are shared; store-level entities (products, transactions, customers) are isolated.
5. API middleware validates the user's role and `storeId` before executing any operation.

## Enforcement in the data layer

Scoping does not rely on each developer remembering a `where` clause. A Prisma Client Extension backed by `AsyncLocalStorage` in `src/lib/db.ts` runs requests inside `runWithTenant(storeId, fn)`; while active, every `find*`, `update*`, and `delete*` on a store-scoped model automatically adds the current tenant's `storeId` to the `where` clause. `SUPER_ADMIN` and internal cross-store flows opt out explicitly with `runWithoutTenant(fn)`. The same extension enforces the financial immutability guard described in [Database schema](database-schema.md).

## Store seeding

The seed script creates 5 pre-configured stores:

```ts
const stores = [
  { name: "Juja Main",    location: "Juja, Kiambu" },
  { name: "Thika",        location: "Thika, Kiambu" },
  { name: "Ruiru",        location: "Ruiru, Kiambu" },
  { name: "Nairobi CBD",  location: "Nairobi" },
  { name: "Nakuru",       location: "Nakuru" },
];
```

Run it with `bun run db:seed` (see [Configuration](configuration.md) for the environment it expects). Each store also carries a short branch code used in receipts and reporting (for example `THI` for Thika).

## Related documents

- [Authentication and RBAC](authentication-and-rbac.md)
- [Database schema](database-schema.md)
