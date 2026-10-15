# Organization console expert information (v2.18.4)

This document describes the expert diagnostics surface added to the
organization console in release v2.18.4 (audit Finding 3, expert information
minimum): the API endpoints, the reason-code contract, the safety rules that
govern every mutation, and the UI behavior.

Purpose: an operator of the organization console should be able to answer,
for any branch, three questions without leaving the console: can this branch
workspace open right now, if not exactly why not, and what is the calm,
specific next step. Every figure is computed from the shared database with
the storeId discriminator; nothing is hardcoded and no synthetic demo data
exists.

## API shapes

All endpoints share the same response envelope (`{ "success": true, "data":
... }` or `{ "success": false, "error": "..." }`) and set
`export const dynamic = 'force-dynamic'`. Org-wide reads run inside
`runWithoutTenant` (the pattern established by `/api/org/kpi-summary` and
`/api/org/summary`: the routes wrap their handlers and the diagnostics data
layer wraps its own reads); the route handler is the authorization boundary.

### GET /api/org/expert-console

Roles: SUPER_ADMIN, STORE_OWNER. Rate limit: 30 per minute per user and
client IP.

Response `data`:

```json
{
  "ok": true,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "version": "2.18.4",
  "environment": "production",
  "databaseProvider": "sqlite",
  "workspace": {
    "mode": "auto",
    "currentHost": "mbumah.co.ke",
    "rootDomain": "mbumah.co.ke",
    "subdomainsEnabled": true,
    "allowedHostsValid": true,
    "trustedForwardedHost": false
  },
  "user": { "id": "...", "name": "...", "email": "...", "role": "SUPER_ADMIN", "isEngraved": false, "isSystem": false },
  "health": { "overall": 100, "label": "Good", "breakdown": [ { "key": "stock", "label": "Stock", "score": 100, "detail": "..." } ] },
  "kpis": { "revenueToday": 0, "transactionsToday": 0, "lowStockCount": 0, "overdueRentalsCount": 0, "debtTotal": 0, "mpesaPendingCount": 0, "branchCount": 5 },
  "branches": [ { "storeId": "...", "code": "THI", "name": "...", "location": "...", "slug": "thika", "subdomain": "thika", "status": "ACTIVE", "href": "/stores/thika/dashboard", "canOpenWorkspace": true, "reasonCode": "ready", "remediation": "...", "schemaStatus": "ok", "missingColumns": [], "revenueToday": 0, "transactionsToday": 0, "lowStockCount": 0, "overdueRentalsCount": 0, "debtTotal": 0, "mpesaPendingCount": 0, "etimsPendingCount": 0, "shiftStatus": "closed", "lastCheckedAt": "..." } ]
}
```

Notes:

- `version` comes from the release version source (`src/lib/version.ts`), the
  same value `/api/health` reports.
- `databaseProvider` uses the same heuristic as `/api/health/schema`
  (a `DATABASE_URL` starting with `file:` is SQLite, one containing
  `postgres` is PostgreSQL, anything else is unknown).
- The health model is a documented simplification of the kpi-summary
  penalties, computed from the KPIs this endpoint already has:
  overall = 100, minus 2 when low stock exists, minus 10 when debt exceeds
  KES 400,000, minus 2 when an overdue rental exists, minus 1 when an
  M-Pesa transaction is pending. Labels: 85 and above is Good, 70 to 84 is
  Fair, below 70 is Attention. Each penalty appears in `breakdown` so the
  operator sees the drivers, not just the score.

### GET /api/org/branch-diagnostics

Roles: SUPER_ADMIN, STORE_OWNER. Rate limit: 30 per minute per user and
client IP.

Response `data`: `{ "branches": [ ...BranchDiagnostic... ] }`. One entry per
non-archived store, ordered by name.

### GET /api/org/branch-diagnostics/[storeCode]

Roles: SUPER_ADMIN, STORE_OWNER. Same rate limit as the list endpoint.
Resolves one branch by slug, branch code or store id. Response `data` is a
single BranchDiagnostic object. A miss returns 404 with
`{ "success": false, "error": "Branch not found." }` and reveals nothing
about other stores.

Implementation note: v1 reuses the full batch computation and filters to the
requested branch afterwards (the batch is about ten grouped queries in
total, so the extra work is bounded). A dedicated single-store query path
can replace this when a profile shows the need.

### POST /api/org/branch-diagnostics/refresh

Roles: SUPER_ADMIN, STORE_OWNER. Rate limit: 6 per minute per user and
client IP (stricter than the read endpoints because it bypasses the 60
second schema-probe cache and re-runs the database probes on every call).

Response `data`: `{ "branches": [ ... ] }`. Writes a best-effort
`ORG_DIAGNOSTICS_REFRESH` entry (INFO) to the SystemLog audit trail with the
acting user and branch count.

### POST /api/org/slug-repair/preview

Roles: SUPER_ADMIN only. Rate limit: 30 per minute. Non-mutating: the
preview never writes anything.

Response `data`:

```json
{
  "planned": [
    {
      "storeId": "...",
      "storeName": "MBUMAH HARDWARE - Juja Main",
      "code": "JUJ",
      "status": "ACTIVE",
      "currentSlug": null,
      "plannedSlug": "juja-main",
      "conflict": false,
      "conflictWithStoreId": null,
      "conflictWithStoreName": null,
      "reason": "ready"
    }
  ],
  "summary": { "storesTotal": 5, "needsRepair": 1, "conflicts": 0 },
  "generatedAt": "..."
}
```

A store is planned for repair when its slug is missing, blank, or one of the
placeholder strings `undefined` or `null`. The planned slug comes from
`deriveSlugFromStoreName` (see below). `conflict` is true either when the
planned slug is empty (reason `unusable-name`) or when another store already
holds the planned slug or subdomain (reason `slug-taken`).

### POST /api/org/slug-repair/apply

Roles: SUPER_ADMIN only. Rate limit: 6 per minute. Body:
`{ "confirm": true, "force": false }`.

Safety rules, applied in order:

1. Refuses with 400 unless the body is exactly `{ "confirm": true }`.
2. Refuses with 400 when `DATABASE_URL` is not the local SQLite file (does
   not start with `file:`), with guidance to use a Prisma migration instead
   (see `docs/database-migration-policy.md`). Nothing is changed.
3. Backup-first: runs `scripts/backup-db.mjs` (the same script behind
   `npm run db:backup`) and aborts with 500 when it does not exit cleanly.
   Nothing is changed when the backup fails.
4. Per store: fills the slug only when it is missing or a placeholder (or
   `force` is true AND the target slug is free). When the target slug or
   subdomain is already held by another store, the store is recorded as a
   conflict and the conflicting store is never overwritten or renamed.
5. The subdomain is derived from the slug only when the subdomain is empty.
6. Writes one `db.store.update` per changed store. No destructive SQL.
7. Audits `ORG_SLUG_REPAIR_APPLIED` (WARN) with the per-store results.
8. Idempotent: a second run returns `applied: []` with the message
   `Nothing to repair.`

Response `data`: `{ "applied": [ { "storeId": "...", "slug": "juja-main",
"subdomain": "juja-main" } ], "conflicts": [ ... ], "backedUp": true,
"message": null }`.

## Reason codes

The complete vocabulary is exported from `src/lib/org/diagnostics.ts` as
`ORG_DIAGNOSTIC_REASON_CODES` and is part of the API contract. The v2.18.4
classifier assigns the subset it can derive cheaply; the remaining codes are
reserved so future expert modules can surface precise states without
breaking consumers.

| Reason code | Assigned in v2.18.4 | Remediation (verbatim) |
| --- | --- | --- |
| `ready` | yes | All checks passed. The branch workspace can be opened from this console. |
| `missing-slug` | yes | No usable URL slug is configured for this branch. Run the slug backfill (npm run db:backfill-slugs) or use the slug repair preview, then refresh diagnostics. |
| `missing-subdomain` | reserved | No subdomain is configured for this branch. Subdomains are derived from the slug when left empty. |
| `store-inactive` | yes | The store record is not ACTIVE, so its workspace cannot be opened. Reactivate the store to restore access. |
| `workspace-disabled` | yes | Branch workspace routing is disabled by configuration (NEXT_PUBLIC_STORE_WORKSPACE_MODE=off). Enable path or subdomain mode to restore workspaces. |
| `invalid-host` | reserved | The current host is not a valid workspace host. Check the ALLOWED_HOSTS configuration. |
| `reserved-subdomain` | reserved | The configured subdomain is a reserved label and cannot serve a branch workspace. Choose a different subdomain. |
| `path-route-missing` | reserved | The path workspace route could not be resolved for this build. Verify the stores/[slug] route exists. |
| `schema-drift` | yes | The database schema is missing columns required by this release. Run the updater or npm run db:repair (backup-first), then refresh diagnostics. |
| `permission-denied` | reserved | Your role cannot open this branch workspace. Ask an administrator for access. |
| `unknown` | yes (degraded) | The diagnostic could not be completed for this branch. Refresh to retry. |

Classification order: the store status wins first (a non-ACTIVE store is
`store-inactive`), then the workspace resolver's precise reason
(`missing-slug`, `workspace-disabled`), then the schema drift probe
(`schema-drift`), then `ready`. An unexpected failure inside the per-branch
mapping degrades that branch to `unknown` without losing its identity.

## Schema drift probe

The probe runs the two cheapest checks from `/api/health/schema`:
`transactions.idempotencyKey` (a `findFirst` selecting the column) and
`users.isEngraved`. A Prisma P2022 error (column does not exist) reports
`schemaStatus: "drift"` with the missing columns as `model.column`; any
other failure (unreachable database, locked file) degrades to
`schemaStatus: "unknown"` instead of blaming the schema. Results are cached
at module level for 60 seconds and shared by all diagnostics endpoints; the
refresh endpoint bypasses the cache. A probe failure can never throw out of
`computeBranchDiagnostics`.

## Operational snapshot

Per-branch operational figures come from batched `groupBy` queries for the
whole organization (one per domain, about ten queries total on a cold cache),
mirroring the existing org surfaces: revenue and transactions from the
per-store sales aggregate in `/api/org/summary` (SALE type, settled payment
statuses COMPLETED or PARTIAL, created today), low stock, overdue rentals
and debt from the same summary, pending M-Pesa from the PENDING status
group, pending eTIMS from the kpi-summary `etimsStatus` group, and the shift
state from the Shift model (ACTIVE status with a null `endedAt` is open).
Every aggregate degrades to zeros, and the shift state to `unknown`, when
its query fails.

## Slug derivation

`deriveSlugFromStoreName` is pure and deterministic: trim, lowercase, strip
a leading case-insensitive `MBUMAH HARDWARE - ` or `MBUMAH HARDWARE `
prefix, replace every run of non-alphanumeric characters with one hyphen,
then trim leading and trailing hyphens. It returns the empty string when
nothing usable remains. The five seeded stores map to `juja-main`, `thika`,
`ruiru`, `nairobi-cbd` and `nakuru`.

## UI notes

The Branches table in the organization console (`src/components/workspace/
org-console.tsx`) has a per-row Expert affordance (a small ghost button with
the accessible name `Expert diagnostics for {store name}`). It opens a
Dialog that lazily fetches `GET /api/org/branch-diagnostics` on first open,
caches the list for the session, and shows: slug, subdomain, status, reason
code, remediation, schema status with missing columns, and the last checked
time. Actions inside the dialog:

- Copy diagnostics: writes the diagnostic JSON to the clipboard and confirms
  with `Diagnostics copied.` in an `aria-live="polite"` region.
- Refresh: re-fetches the list, bypassing the client cache.
- Open path workspace: a plain link to `/stores/{slug}/dashboard` (only when
  a slug exists), opening in a new tab with `rel="noopener noreferrer"`.

Loading shows `Loading diagnostics...`, failures show a calm message with a
Retry button. Escape closes the dialog (handled by the Dialog component);
focus management is the component's built-in behavior, no manual trap.
Status is always carried by text; color never conveys it.
