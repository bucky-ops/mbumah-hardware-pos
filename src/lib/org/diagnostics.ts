// MBUMAH HARDWARE POS - Organization branch diagnostics data layer (v2.18.4)
//
// One server-only module that answers, for every Store in the organization:
// "is this branch workspace ready to open, and if not, exactly why not?"
//
// Consumed by the expert console API surface:
//   GET  /api/org/expert-console
//   GET  /api/org/branch-diagnostics
//   GET  /api/org/branch-diagnostics/[storeCode]
//   POST /api/org/branch-diagnostics/refresh
//
// DESIGN RULES (v2.18.4 release spec, audit Finding 3):
//   - Org-wide reads follow the runWithoutTenant pattern used by
//     /api/org/kpi-summary and /api/org/summary. computeBranchDiagnostics
//     wraps its own reads in runWithoutTenant (nesting is supported), so it
//     behaves the same no matter the surrounding tenant context; the CALLING
//     ROUTE remains the authorization boundary (SUPER_ADMIN / STORE_OWNER
//     only). This module performs no session or role checks of its own.
//   - A diagnostics layer must never be the thing that breaks a response:
//     every aggregate is wrapped and degrades to zeros / 'unknown'.
//   - The query budget stays bounded: per-branch operational figures come
//     from BATCHED groupBy queries (one per domain for the whole org), never
//     one query per store. Cold-cache cost is about ten queries total.
//   - The schema drift probe runs the two cheapest probes from
//     /api/health/schema (transactions.idempotencyKey, users.isEngraved) and
//     is cached at module level for 60 seconds so the console and the
//     diagnostics routes share one cheap probe.

import { db, runWithoutTenant } from '@/lib/db';
import { resolveBranchWorkspace, type WorkspaceUnavailableReason } from '@/lib/branch-workspace';

// ---------------------------------------------------------------------------
// Documented reason-code vocabulary
// ---------------------------------------------------------------------------

/**
 * The complete reason-code vocabulary for branch diagnostics. The API
 * contract pins this list (see docs/org-console-expert-information.md); the
 * v2.18.4 classifier below assigns the subset it can derive cheaply
 * (store-inactive, missing-slug, workspace-disabled, schema-drift, ready,
 * unknown). The remaining codes exist so future expert modules can surface
 * precise states without breaking consumers.
 */
export const ORG_DIAGNOSTIC_REASON_CODES = [
  'ready',
  'missing-slug',
  'missing-subdomain',
  'store-inactive',
  'workspace-disabled',
  'invalid-host',
  'reserved-subdomain',
  'path-route-missing',
  'schema-drift',
  'permission-denied',
  'unknown',
] as const;

export type OrgDiagnosticReasonCode = (typeof ORG_DIAGNOSTIC_REASON_CODES)[number];

export type DiagnosticsSchemaStatus = 'ok' | 'drift' | 'unknown';

export interface BranchDiagnostic {
  storeId: string;
  code: string | null;
  name: string;
  location: string | null;
  slug: string | null;
  subdomain: string | null;
  status: string;
  /** Safe workspace URL (subdomain or path mode) built for the request host, or null. */
  href: string | null;
  canOpenWorkspace: boolean;
  reasonCode: OrgDiagnosticReasonCode;
  remediation: string;
  schemaStatus: DiagnosticsSchemaStatus;
  /** Missing schema columns as "model.column" (empty when none are known missing). */
  missingColumns: string[];
  // Per-branch operational snapshot. Cheap by design: batched aggregates for
  // the whole organization, degrading to zeros on error.
  revenueToday: number;
  transactionsToday: number;
  lowStockCount: number;
  overdueRentalsCount: number;
  debtTotal: number;
  mpesaPendingCount: number;
  etimsPendingCount: number;
  shiftStatus: 'open' | 'closed' | 'unknown';
  lastCheckedAt: string;
}

export interface ComputeBranchDiagnosticsOptions {
  /** Bypass the 60s schema-probe cache (used by the refresh route). */
  forceFresh?: boolean;
}

// ---------------------------------------------------------------------------
// Reason-code remediation (calm, one sentence per code)
// ---------------------------------------------------------------------------

export const REASON_REMEDIATION: Record<OrgDiagnosticReasonCode, string> = {
  ready: 'All checks passed. The branch workspace can be opened from this console.',
  'missing-slug':
    'No usable URL slug is configured for this branch. Run the slug backfill (npm run db:backfill-slugs) or use the slug repair preview, then refresh diagnostics.',
  'missing-subdomain':
    'No subdomain is configured for this branch. Subdomains are derived from the slug when left empty.',
  'store-inactive':
    'The store record is not ACTIVE, so its workspace cannot be opened. Reactivate the store to restore access.',
  'workspace-disabled':
    'Branch workspace routing is disabled by configuration (NEXT_PUBLIC_STORE_WORKSPACE_MODE=off). Enable path or subdomain mode to restore workspaces.',
  'invalid-host':
    'The current host is not a valid workspace host. Check the ALLOWED_HOSTS configuration.',
  'reserved-subdomain':
    'The configured subdomain is a reserved label and cannot serve a branch workspace. Choose a different subdomain.',
  'path-route-missing':
    'The path workspace route could not be resolved for this build. Verify the stores/[slug] route exists.',
  'schema-drift':
    'The database schema is missing columns required by this release. Run the updater or npm run db:repair (backup-first), then refresh diagnostics.',
  'permission-denied':
    'Your role cannot open this branch workspace. Ask an administrator for access.',
  unknown: 'The diagnostic could not be completed for this branch. Refresh to retry.',
};

// ---------------------------------------------------------------------------
// Slug derivation (pure; shared by diagnostics and the slug repair routes)
// ---------------------------------------------------------------------------

/**
 * Derive the workspace slug from a store name. Deterministic and safe for
 * RFC 1123 labels: lowercase, the "MBUMAH HARDWARE - " / "MBUMAH HARDWARE "
 * prefix (case-insensitive) is stripped, every run of non-alphanumeric
 * characters becomes one hyphen, and leading/trailing hyphens are trimmed.
 * Returns '' when nothing usable remains (the caller must not write it).
 *
 * Canonical mappings: Juja Main -> juja-main, Thika -> thika, Ruiru -> ruiru,
 * Nairobi CBD -> nairobi-cbd, Nakuru -> nakuru.
 */
export function deriveSlugFromStoreName(name: string): string {
  const raw = (name ?? '').toString().trim().toLowerCase();
  if (!raw) return '';
  const withoutPrefix = raw
    .replace(/^mbumah hardware\s*-\s*/, '')
    .replace(/^mbumah hardware\s+/, '');
  return withoutPrefix
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A slug value that must be treated as "not configured": missing, blank, or
 * one of the literal placeholder strings written by broken upstream data.
 */
export function isPlaceholderSlug(slug: string | null | undefined): boolean {
  const value = (slug ?? '').toString().trim().toLowerCase();
  return value === '' || value === 'undefined' || value === 'null';
}

// ---------------------------------------------------------------------------
// Schema drift probe (module-level 60s cache)
// ---------------------------------------------------------------------------

interface SchemaProbeState {
  status: DiagnosticsSchemaStatus;
  missingColumns: string[];
  checkedAtMs: number;
}

const SCHEMA_PROBE_TTL_MS = 60_000;

let schemaProbeCache: SchemaProbeState | null = null;

/**
 * The two cheapest probes from /api/health/schema (v2.18.3.2). Model labels
 * mirror that route's drift vocabulary ("transactions", "users").
 */
const SCHEMA_PROBES: Array<{ model: string; column: string; probe: () => Promise<unknown> }> = [
  {
    model: 'transactions',
    column: 'idempotencyKey',
    probe: () => db.salesTransaction.findFirst({ select: { idempotencyKey: true }, take: 1 }),
  },
  {
    model: 'users',
    column: 'isEngraved',
    probe: () => db.user.findFirst({ select: { isEngraved: true }, take: 1 }),
  },
];

/** Prisma P2022: "The column ... does not exist in the current database." */
function isMissingColumnError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2022'
  );
}

/**
 * Probe the drift-sensitive columns. A missing column (P2022) reports drift
 * with the model.column name; any other failure (unreachable database,
 * locked file, unknown driver error) degrades to 'unknown' instead of
 * guessing. Never throws.
 */
async function probeSchemaStatus(forceFresh: boolean): Promise<SchemaProbeState> {
  const now = Date.now();
  if (!forceFresh && schemaProbeCache && now - schemaProbeCache.checkedAtMs < SCHEMA_PROBE_TTL_MS) {
    return schemaProbeCache;
  }
  let state: SchemaProbeState;
  try {
    const missing: string[] = [];
    let degraded = false;
    for (const p of SCHEMA_PROBES) {
      try {
        await p.probe();
      } catch (error) {
        if (isMissingColumnError(error)) {
          missing.push(`${p.model}.${p.column}`);
        } else {
          // Not a recognizable drift signature: report 'unknown' rather than
          // blaming the schema for what may be a connectivity problem.
          degraded = true;
        }
      }
    }
    state = degraded
      ? { status: 'unknown', missingColumns: [], checkedAtMs: now }
      : missing.length > 0
        ? { status: 'drift', missingColumns: missing, checkedAtMs: now }
        : { status: 'ok', missingColumns: [], checkedAtMs: now };
  } catch {
    state = { status: 'unknown', missingColumns: [], checkedAtMs: now };
  }
  schemaProbeCache = state;
  return state;
}

/** Test hook: reset the module-level schema probe cache. */
export function resetSchemaProbeCacheForTests(): void {
  schemaProbeCache = null;
}

// ---------------------------------------------------------------------------
// Batched operational aggregates (bounded query budget)
// ---------------------------------------------------------------------------

/** Run a query and degrade to the fallback on any failure. Never throws. */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

interface StoreRow {
  id: string;
  code: string | null;
  name: string;
  location: string | null;
  slug: string | null;
  subdomain: string | null;
  status: string;
}

interface OrgAggregates {
  revenue: Map<string, { sum: number; count: number }>;
  lowStock: Map<string, number>;
  overdueRentals: Map<string, number>;
  debt: Map<string, number>;
  mpesaPending: Map<string, number>;
  etimsPending: Map<string, number>;
  /** storeId -> open shift count; null when the whole query failed. */
  openShifts: Map<string, number> | null;
}

/**
 * Batched per-domain aggregates for the whole organization. The where
 * clauses mirror the existing org surfaces exactly:
 *   - revenue/transactions: /api/org/summary per-store sales (SALE type,
 *     settled payment statuses COMPLETED/PARTIAL, created today)
 *   - low stock / overdue rentals / debt / mpesa pending: /api/org/summary
 *   - etims pending: /api/org/kpi-summary etimsStatus group (PENDING)
 *   - open shift: the Shift model's ACTIVE status with a null endedAt
 *
 * Each query is a named function so the degraded fallbacks reuse the exact
 * Prisma row type via Awaited<ReturnType> (hand-written lookalikes drift,
 * e.g. Decimal columns are not number | null).
 */
function revenueGroupQuery(startOfToday: Date) {
  return db.salesTransaction.groupBy({
    by: ['storeId'],
    where: {
      createdAt: { gte: startOfToday },
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    },
    _sum: { totalAmount: true },
    _count: { _all: true },
  });
}
type RevenueGroupRow = Awaited<ReturnType<typeof revenueGroupQuery>>[number];

function lowStockGroupQuery() {
  return db.product.groupBy({
    by: ['storeId'],
    where: { quantityInStock: { lte: db.product.fields.reorderLevel }, isActive: true },
    _count: { _all: true },
  });
}
type LowStockGroupRow = Awaited<ReturnType<typeof lowStockGroupQuery>>[number];

function overdueRentalsGroupQuery(now: Date) {
  return db.equipmentRental.groupBy({
    by: ['storeId'],
    where: { status: { in: ['ACTIVE', 'OVERDUE'] }, expectedReturnDate: { lt: now } },
    _count: { _all: true },
  });
}
type OverdueRentalsGroupRow = Awaited<ReturnType<typeof overdueRentalsGroupQuery>>[number];

function debtGroupQuery() {
  return db.debtLedger.groupBy({
    by: ['storeId'],
    where: { status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] }, balance: { gt: 0 } },
    _sum: { balance: true },
  });
}
type DebtGroupRow = Awaited<ReturnType<typeof debtGroupQuery>>[number];

function mpesaPendingGroupQuery() {
  return db.mpesaTransaction.groupBy({
    by: ['storeId'],
    where: { status: 'PENDING' },
    _count: { _all: true },
  });
}
type MpesaPendingGroupRow = Awaited<ReturnType<typeof mpesaPendingGroupQuery>>[number];

function etimsPendingGroupQuery() {
  return db.salesTransaction.groupBy({
    by: ['storeId'],
    where: { transactionType: 'SALE', etimsStatus: 'PENDING' },
    _count: { _all: true },
  });
}
type EtimsPendingGroupRow = Awaited<ReturnType<typeof etimsPendingGroupQuery>>[number];

function openShiftGroupQuery() {
  return db.shift.groupBy({
    by: ['storeId'],
    where: { status: 'ACTIVE', endedAt: null },
    _count: { _all: true },
  });
}
type OpenShiftGroupRow = Awaited<ReturnType<typeof openShiftGroupQuery>>[number];

async function loadOrgAggregates(startOfToday: Date): Promise<OrgAggregates> {
  const now = new Date();
  const [revenueRows, lowStockRows, overdueRows, debtRows, mpesaRows, etimsRows, openShiftResult] =
    await Promise.all([
      safeQuery(() => revenueGroupQuery(startOfToday), [] as RevenueGroupRow[]),
      safeQuery(() => lowStockGroupQuery(), [] as LowStockGroupRow[]),
      safeQuery(() => overdueRentalsGroupQuery(now), [] as OverdueRentalsGroupRow[]),
      safeQuery(() => debtGroupQuery(), [] as DebtGroupRow[]),
      safeQuery(() => mpesaPendingGroupQuery(), [] as MpesaPendingGroupRow[]),
      safeQuery(() => etimsPendingGroupQuery(), [] as EtimsPendingGroupRow[]),
      // One grouped query for the whole organization. null (not []) marks a
      // failed query so shiftStatus can degrade to 'unknown' honestly.
      safeQuery(() => openShiftGroupQuery(), null as OpenShiftGroupRow[] | null),
    ]);

  return {
    revenue: new Map(
      revenueRows.map((r) => [
        r.storeId,
        { sum: Number(r._sum?.totalAmount ?? 0), count: r._count?._all ?? 0 },
      ]),
    ),
    lowStock: new Map(lowStockRows.map((r) => [r.storeId, r._count._all])),
    overdueRentals: new Map(overdueRows.map((r) => [r.storeId, r._count._all])),
    debt: new Map(debtRows.map((r) => [r.storeId, Number(r._sum?.balance ?? 0)])),
    mpesaPending: new Map(mpesaRows.map((r) => [r.storeId, r._count._all])),
    etimsPending: new Map(etimsRows.map((r) => [r.storeId, r._count._all])),
    openShifts:
      openShiftResult === null ? null : new Map(openShiftResult.map((r) => [r.storeId, r._count._all])),
  };
}

// ---------------------------------------------------------------------------
// Reason-code classifier
// ---------------------------------------------------------------------------

/**
 * Assign the v2.18.4 reason code. Order matters: the store status wins over
 * the workspace resolver (an inactive store is 'store-inactive' even though
 * the resolver reports the same), then the resolver's precise reason, then
 * the schema drift probe, then ready.
 */
function classifyBranch(input: {
  status: string;
  unavailableReason: WorkspaceUnavailableReason | null;
  schemaStatus: DiagnosticsSchemaStatus;
}): OrgDiagnosticReasonCode {
  if (input.status !== 'ACTIVE') return 'store-inactive';
  if (input.unavailableReason === 'missing-slug') return 'missing-slug';
  if (input.unavailableReason === 'workspace-disabled') return 'workspace-disabled';
  if (input.schemaStatus === 'drift') return 'schema-drift';
  return 'ready';
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Compute the diagnostics for every non-archived store in the organization.
 * The caller (API route) must have already authorized the session; this
 * function only reads, inside runWithoutTenant (the org-wide pattern from
 * /api/org/kpi-summary). Never throws: every failure mode degrades.
 */
export async function computeBranchDiagnostics(
  requestHost: string,
  options: ComputeBranchDiagnosticsOptions = {},
): Promise<BranchDiagnostic[]> {
  return runWithoutTenant(async () => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const lastCheckedAt = now.toISOString();

    const schema = await probeSchemaStatus(options.forceFresh === true);

    let stores: StoreRow[];
    try {
      stores = await db.store.findMany({
        // Mirror /api/org/summary: archived stores are organization history,
        // not operating branches, and never appear in the console table.
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
          slug: true,
          subdomain: true,
          status: true,
        },
      });
    } catch {
      return [];
    }

    const aggregates = await loadOrgAggregates(startOfToday);
    const openShifts = aggregates.openShifts;

    return stores.map((store): BranchDiagnostic => {
      const identity = {
        storeId: store.id,
        code: store.code ?? null,
        name: store.name,
        location: store.location ?? null,
        slug: store.slug ?? null,
        subdomain: store.subdomain ?? null,
        status: store.status,
      };
      try {
        const resolution = resolveBranchWorkspace({
          store: {
            slug: store.slug,
            subdomain: store.subdomain,
            isActive: store.status === 'ACTIVE',
          },
          currentHost: requestHost,
        });
        const reasonCode = classifyBranch({
          status: store.status,
          unavailableReason: resolution.unavailableReason,
          schemaStatus: schema.status,
        });
        const revenue = aggregates.revenue.get(store.id);
        return {
          ...identity,
          href: resolution.href,
          canOpenWorkspace: resolution.href !== null && store.status === 'ACTIVE',
          reasonCode,
          remediation: REASON_REMEDIATION[reasonCode],
          schemaStatus: schema.status,
          missingColumns: schema.missingColumns,
          revenueToday: revenue?.sum ?? 0,
          transactionsToday: revenue?.count ?? 0,
          lowStockCount: aggregates.lowStock.get(store.id) ?? 0,
          overdueRentalsCount: aggregates.overdueRentals.get(store.id) ?? 0,
          debtTotal: aggregates.debt.get(store.id) ?? 0,
          mpesaPendingCount: aggregates.mpesaPending.get(store.id) ?? 0,
          etimsPendingCount: aggregates.etimsPending.get(store.id) ?? 0,
          shiftStatus:
            openShifts === null ? 'unknown' : openShifts.has(store.id) ? 'open' : 'closed',
          lastCheckedAt,
        };
      } catch {
        // Degrade this branch to 'unknown' without losing its identity.
        return {
          ...identity,
          href: null,
          canOpenWorkspace: false,
          reasonCode: 'unknown',
          remediation: REASON_REMEDIATION.unknown,
          schemaStatus: schema.status,
          missingColumns: schema.missingColumns,
          revenueToday: 0,
          transactionsToday: 0,
          lowStockCount: 0,
          overdueRentalsCount: 0,
          debtTotal: 0,
          mpesaPendingCount: 0,
          etimsPendingCount: 0,
          shiftStatus: 'unknown',
          lastCheckedAt,
        };
      }
    });
  });
}
