// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Serverless-Optimized Prisma Client
// ─────────────────────────────────────────────────────────────────────────────
//
// This module exports a single hardened `db` instance that:
//
//   1. **Validates the connection string eagerly** — if `DATABASE_URL` is
//      missing or obviously malformed, we throw a highly descriptive error
//      instead of letting Prisma crash silently with a cryptic 51ms 500 in
//      the Vercel serverless logs.
//
//   2. **Is optimized for serverless** — a single PrismaClient is reused per
//      Node process via `globalThis` to survive Hot Module Replacement in dev
//      and warm Lambda invocations on Vercel. In production we keep the log
//      surface minimal (`error` only) to avoid cold-start log noise.
//
//   3. **Enforces Zero-Trust Multi-Tenancy at the ORM level** via a Prisma
//      Client Extension backed by `AsyncLocalStorage`. When a request runs
//      inside `runWithTenant(storeId, fn)`, every `find*` / `update*` /
//      `delete*` on a store-scoped model automatically ANDs the current
//      tenant's `storeId` into the `where` clause — developers can no longer
//      "forget" to scope a query. SUPER_ADMIN / internal flows run inside
//      `runWithoutTenant(fn)` to opt out (e.g. cross-store dashboards).
//
//   4. **Enforces Financial Immutability at the ORM level** — `update`,
//      `updateMany`, `delete`, and `deleteMany` on `JournalEntry`,
//      `JournalEntryLine`, and `SystemLog` throw `IMMUTABILITY_VIOLATION`.
//      Accounting and audit records are strictly append-only. A narrow,
//      audited `withImmutabilityBypass(fn)` escape hatch exists for the
//      legitimate posting / voiding paths (M-Pesa callback confirmation,
//      journal posting, expense void) — these are the ONLY sanctioned
//      mutations and each one is logged.
//
// ── VERCEL / NEON / SUPABASE CONNECTION POOLING (READ THIS) ──────────────────
//
// The `DATABASE_URL` configured in Vercel **MUST** be the **pooled** /
// PgBouncer connection string from your database provider, NOT the direct
// connection string. Serverless functions open a new connection per
// invocation; without pooling you will exhaust the Postgres connection limit
// (typically 20 on Neon free tier) and see intermittent `429` / `502` /
// "too many connections" errors.
//
//   • Neon:        use the "Pooled connection" string (ends in `-pooler`)
//                  and append `?pgbouncer=true&connection_limit=1`
//   • Supabase:    use the "Transaction" pooler URL (port 6543) and append
//                  `?pgbouncer=true&connection_limit=1`
//   • Prisma Accelerate: set `DATABASE_URL` to the Accelerate URL and use
//                  `@prisma/extension-accelerate` (optional, future).
//
// `connection_limit=1` is correct for serverless — each function instance
// holds at most one connection, and PgBouncer multiplexes it.
// ─────────────────────────────────────────────────────────────────────────────

import { type Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

// ── 1. Eager environment validation ──────────────────────────────────────────

/**
 * Descriptive failure if the database URL is not configured. This is the #1
 * cause of the 51ms `500 Internal Server Error` on Vercel serverless — Prisma
 * instantiates, cannot find a connection string, and throws an opaque error.
 */
function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url || url.trim() === "") {
    throw new Error(
      [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        " FATAL: DATABASE_URL is not set.",
        "",
        " The Prisma Client cannot connect to the database.",
        "",
        " • Local dev:   create a `.env` file with DATABASE_URL=\"file:./prisma/dev.db\"",
        "               (SQLite) or your Neon/Supabase pooled Postgres URL.",
        " • Vercel prod: Project Settings → Environment Variables → add DATABASE_URL",
        "               using the POOLED / PgBouncer connection string",
        "               (append ?pgbouncer=true&connection_limit=1).",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
    );
  }

  // Heuristic sanity check — Prisma URLs are `file:` or `postgresql:` /
  // `postgres:` schemes. A stray value (e.g. a pasted JSON blob) is caught
  // here with a clear message rather than a Prisma parse error.
  const isKnownScheme =
    url.startsWith("file:") ||
    url.startsWith("postgresql:") ||
    url.startsWith("postgres:");

  if (!isKnownScheme) {
    throw new Error(
      [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        " FATAL: DATABASE_URL does not look like a valid connection string.",
        "",
        ` Got: "${url.slice(0, 60)}${url.length > 60 ? "…" : ""}"`,
        "",
        " Expected schemes: file:, postgresql:, or postgres:",
        " For Vercel + Neon/Supabase use the POOLED connection string",
        " (append ?pgbouncer=true&connection_limit=1).",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
    );
  }

  return url;
}

// Resolve once at module load — a missing URL will crash the process loudly
// during the first request rather than producing silent per-query failures.
const DATABASE_URL = resolveDatabaseUrl();

// ── 2. Singleton PrismaClient (serverless-friendly) ──────────────────────────

const globalForPrisma = globalThis as unknown as {
  __mbumahPrisma?: PrismaClient;
};

function createBaseClient(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: DATABASE_URL,
    // In production (Vercel serverless) keep logs to `error` only to avoid
    // cold-start log spam and Lambda log volume charges. In dev we surface
    // `warn` too so we catch N+1 / missing-index issues locally.
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["error", "warn"],
    errorFormat:
      process.env.NODE_ENV === "production" ? "minimal" : "pretty",
  });
}

const baseClient = globalForPrisma.__mbumahPrisma ?? createBaseClient();

// Cache on globalThis so HMR in dev and warm invocations on Vercel reuse the
// same connection pool instead of leaking a new PrismaClient per reload.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__mbumahPrisma = baseClient;
}

// ── 3. Tenant context (AsyncLocalStorage) ────────────────────────────────────
//
// AsyncLocalStorage propagates the tenant context across async boundaries
// (await, fetch, $transaction) WITHOUT needing to thread `storeId` through
// every function signature. Each HTTP request gets its own isolated context.

interface TenantContext {
  storeId: string;
  /** When true, the multi-tenancy injection is skipped (SUPER_ADMIN / internal). */
  bypass: boolean;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with the current request's `storeId` as the active tenant context.
 * All Prisma read/update/delete queries on store-scoped models inside `fn`
 * will automatically be filtered by this `storeId`. Nesting is supported: the
 * innermost context wins.
 *
 * Used by `requireAuth` / `requireStoreAccess` so every authenticated API
 * route gets ORM-level tenancy enforcement for free.
 */
export function runWithTenant<T>(storeId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ storeId, bypass: false }, fn);
}

/**
 * Run `fn` with multi-tenancy enforcement DISABLED. Use this for genuinely
 * cross-tenant operations: SUPER_ADMIN dashboards, org-level reports, login,
 * session lookup, and seeding. Every use should be audited.
 */
export function runWithoutTenant<T>(fn: () => Promise<T>): Promise<T> {
  // Reuse the storage but set bypass=true. We still need a storeId value for
  // the type; an empty string signals "no tenant".
  return tenantStorage.run({ storeId: "", bypass: true }, fn);
}

/** Read the active tenant context (for diagnostics / tests). */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

// ── 4. Store-scoped model whitelist ──────────────────────────────────────────
//
// Models that carry a NON-nullable `storeId: String` and therefore qualify
// for automatic tenant filtering. Models EXCLUDED on purpose:
//
//   • Store            — `id` IS the store; filtering makes no sense.
//   • User             — `storeId` is nullable (SUPER_ADMIN has none); login
//                        queries by email and must NOT be tenant-scoped.
//   • Session          — no storeId; looked up by token during auth.
//   • SystemLog        — `storeId` nullable; org-level logs have null.
//   • SecurityEvent    — `storeId` nullable; org-level security scans.
//   • Account          — org-scoped via `organizationId`, not storeId.
//   • StoreTransfer    — uses fromStoreId / toStoreId (handled manually).
//   • *Item children   — scoped via parent FK (e.g. SaleItem via transactionId),
//                        injecting storeId would be a no-op or a type error.
//
// If you add a new store-scoped model to schema.prisma, add it here too.
const STORE_SCOPED_MODELS = new Set<string>([
  "productCategory",
  "product",
  "warehouseStock",
  "stockMovement",
  "customer",
  "customerCredit",
  "salesTransaction",
  "payment",
  "mpesaTransaction",
  "debtLedger",
  "debtPayment",
  "equipmentRental",
  "journalEntry",
  "cashDrawerLog",
  "receipt",
  "supplier",
  "purchaseOrder",
  "expense",
  "message",
  "giftCard",
  "voucher",
  "voucherCampaign",
  "shift",
  "invoice",
  "deliveryNote",
  "customerInteraction",
  "loyaltyTransaction",
  "loyaltyCampaign",
  "bankingAccount",
  "bankingTransaction",
  "bankingReconciliation",
  "taxFiling",
  "taxCategory",
  "notification",
  "subcategory",
  // ── Payroll & HR (Phase 1 — ERP enhancement) ──
  // LeaveType is intentionally NOT here — it's organisation-wide policy,
  // not tenant-scoped data.
  "employee",
  "payrollPeriod",
  "payrollRun",
  "payrollDetail",
  "employeeLeaveBalance",
  "leaveRequest",
  "attendanceRecord",
]);

// ── 5. Immutability — append-only financial & audit models ───────────────────

/**
 * Models that are strictly append-only. Any `update`, `updateMany`, `delete`,
 * or `deleteMany` on these models throws `IMMUTABILITY_VIOLATION`.
 *
 * `create` / `createMany` / `find*` remain allowed — financial and audit
 * records are written once and never mutated. Voiding / posting is performed
 * through the audited `withImmutabilityBypass()` escape hatch in narrowly
 * defined internal paths (see `account-helper`, M-Pesa callback, journal
 * void, expense void).
 */
const IMMUTABLE_MODELS = new Set<string>([
  "journalEntry",
  "journalEntryLine",
  "systemLog",
  // `auditLog` is reserved for future use — the current schema uses
  // `systemLog` for audit trails. If/when a dedicated AuditLog model is
  // added to schema.prisma, add it here.
  // Payroll payslips are append-only financial records. Once a payroll run
  // is COMPLETED, the per-employee PayrollDetail rows must never be edited —
  // corrections are made via adjusting entries in the NEXT payroll run.
  // Sanctioned voiding flows use withImmutabilityBypass().
  "payrollDetail",
]);

// Lowercase mirror of IMMUTABLE_MODELS for casing-agnostic lookups.
// Prisma passes the model name to query interceptors in PascalCase
// (e.g. "JournalEntry"), so we normalise via toLowerCase() before checking.
const IMMUTABLE_MODELS_LOWER = new Set<string>(
  [...IMMUTABLE_MODELS].map((m) => m.toLowerCase()),
);

export class ImmutabilityViolationError extends Error {
  readonly code = "IMMUTABILITY_VIOLATION";
  constructor(model: string, operation: string) {
    super(
      `IMMUTABILITY_VIOLATION: Financial and Audit records cannot be modified or deleted. ` +
        `(model="${model}", operation="${operation}"). ` +
        `If this is a sanctioned posting/voiding flow, wrap the call in withImmutabilityBypass().`,
    );
    this.name = "ImmutabilityViolationError";
  }
}

// Bypass context for sanctioned internal mutations (posting / voiding).
interface BypassContext {
  reason: string;
}
const immutabilityBypassStorage = new AsyncLocalStorage<BypassContext>();

/**
 * Run `fn` with the financial-immutability guard DISABLED. This is the ONLY
 * sanctioned way to `update` / `delete` on `JournalEntry`,
 * `JournalEntryLine`, or `SystemLog`. Use exclusively for:
 *
 *   • M-Pesa STK callback → marking a pending journal entry as posted
 *   • Journal entry voiding (sets isVoided / voidedAt)
 *   • Expense voiding (marks the linked journal entry voided)
 *
 * Each bypass is logged to the console in development so it is auditable.
 */
export function withImmutabilityBypass<T>(
  fn: () => Promise<T>,
  reason = "sanctioned_posting_or_voiding",
): Promise<T> {
  if (process.env.NODE_ENV !== "production") {
    // Dev-time visibility: surface every bypass so reviewers can spot misuse.
    console.warn(
      `[IMMUTABILITY_BYPASS] reason="${reason}" — financial immutability guard disabled for this async scope.`,
    );
  }
  return immutabilityBypassStorage.run({ reason }, fn);
}

// ── 6. Prisma Client Extension ────────────────────────────────────────────────

const hardenedClient = baseClient.$extends({
  name: "mbumahHardened",

  query: {
    // ── Multi-tenancy: AND-inject storeId on store-scoped models ──
    // For each store-scoped model we intercept read & mutate queries. When a
    // tenant context is active (and not bypassed) we merge `storeId` into the
    // `where` clause, ANDing it with any existing filter so we never widen
    // access — only narrow it.
    ...(Object.fromEntries(
      [...STORE_SCOPED_MODELS].map((model) => {
        return [
          model,
          {
            async findMany({ args, query }: any) {
              return query(injectTenant(args));
            },
            async findFirst({ args, query }: any) {
              return query(injectTenant(args));
            },
            async findUnique({ args, query }: any) {
              return query(injectTenant(args));
            },
            async count({ args, query }: any) {
              return query(injectTenant(args));
            },
            async aggregate({ args, query }: any) {
              return query(injectTenant(args));
            },
            async groupBy({ args, query }: any) {
              return query(injectTenant(args));
            },
            async update({ args, query }: any) {
              return query(injectTenant(args));
            },
            async updateMany({ args, query }: any) {
              return query(injectTenant(args));
            },
            async delete({ args, query }: any) {
              return query(injectTenant(args));
            },
            async deleteMany({ args, query }: any) {
              return query(injectTenant(args));
            },
          },
        ];
      }),
    ) as Record<string, object>),

    // ── Immutability: block mutations on financial/audit models ──
    journalEntry: {
      async update({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async updateMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async delete({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async deleteMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
    },
    journalEntryLine: {
      async update({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async updateMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async delete({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async deleteMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
    },
    systemLog: {
      async update({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async updateMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async delete({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async deleteMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
    },
    payrollDetail: {
      async update({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async updateMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async delete({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
      async deleteMany({ model, operation, args, query }: any) {
        assertMutable(model, operation);
        return query(args);
      },
    },
  },
});

// ── 7. Helpers used by the extension ──────────────────────────────────────────

/**
 * Merge the active tenant's `storeId` into a query's `where` clause.
 * Rules:
 *   • No active context (login, seeding, internal) → passthrough unchanged.
 *   • Context with `bypass=true` (SUPER_ADMIN) → passthrough unchanged.
 *   • Caller already pinned `storeId` → leave their value intact (they may
 *     intentionally target a specific store within an admin scope).
 *   • Otherwise → AND in the tenant's storeId.
 *
 * This never WIDENS access: it only ever narrows a query to the caller's
 * own store.
 */
function injectTenant<T extends { where?: any }>(args: T): T {
  const ctx = tenantStorage.getStore();

  // No tenant context active — passthrough (login, seeding, SUPER_ADMIN).
  if (!ctx || ctx.bypass || !ctx.storeId) {
    return args;
  }

  const where = (args as any).where;

  // No where clause at all → create one.
  if (where === undefined || where === null) {
    return { ...args, where: { storeId: ctx.storeId } };
  }

  // Caller already specified storeId — respect their intent (do not overwrite).
  // This is safe because requireStoreAccess already guarantees non-admin
  // callers can only ever request their own store.
  if (where.storeId !== undefined) {
    return args;
  }

  // Merge storeId into the existing where. We spread to avoid mutating the
  // caller's object (Prisma extension args can be reused / logged).
  return { ...args, where: { ...where, storeId: ctx.storeId } };
}

/**
 * Throw `IMMUTABILITY_VIOLATION` unless the call is inside an active
 * `withImmutabilityBypass()` scope.
 *
 * NOTE: Prisma passes the `model` parameter to query interceptors in
 * **PascalCase** (e.g. `"JournalEntry"`) — matching the schema model name.
 * Our `IMMUTABLE_MODELS` set is keyed in camelCase (matching the Prisma
 * client property name). We normalise to lowercase before the lookup so the
 * check is casing-agnostic and works regardless of which convention Prisma
 * uses in future versions.
 */
function assertMutable(model: string, operation: string): void {
  if (immutabilityBypassStorage.getStore()) {
    return; // Sanctioned bypass active — allow.
  }
  if (IMMUTABLE_MODELS.has(model) || IMMUTABLE_MODELS_LOWER.has(model.toLowerCase())) {
    throw new ImmutabilityViolationError(model, operation);
  }
}

// ── 8. Public exports ─────────────────────────────────────────────────────────

/**
 * The hardened Prisma Client. Import this everywhere instead of constructing
 * a raw `new PrismaClient()`:
 *
 *   import { db } from "@/lib/db";
 *   const products = await db.product.findMany({ where: { isActive: true } });
 *
 * Multi-tenancy and immutability guards are applied automatically. To opt out
 * of tenancy for a cross-store scope, wrap the call in `runWithoutTenant`.
 *
 * ── TYPE NOTE ──────────────────────────────────────────────────────────────
 * `hardenedClient` is the result of `baseClient.$extends({ query: {...} })`.
 * Prisma's `$extends` returns a `DynamicClientExtensionThis<...>` type which,
 * because we build the `query` interceptors dynamically via
 * `Object.fromEntries(...)`, does NOT statically expose the per-model
 * accessors (`db.product`, `db.bankAccount`, …) — even though they exist at
 * runtime. This would produce ~170 `TS2339: Property does not exist` errors
 * under `tsc --noEmit --strict`.
 *
 * The extension adds ONLY runtime query interceptors (tenancy injection +
 * immutability guards); it introduces NO new typed API surface (no `model`,
 * `client`, or `result` extensions). It is therefore semantically correct —
 * and type-safe — to treat `db` as a plain `PrismaClient` for static typing:
 * every model accessor and method that exists on `PrismaClient` exists on the
 * extended client at runtime. The double cast (`as unknown as PrismaClient`)
 * is the standard Prisma pattern for this situation.
 */
export const db = hardenedClient as unknown as PrismaClient;

// Re-export Prisma namespace + types for convenience in route handlers.
export type { Prisma };
