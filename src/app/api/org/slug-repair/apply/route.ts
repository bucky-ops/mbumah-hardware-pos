// POST /api/org/slug-repair/apply (v2.18.4, audit Finding 3)
//
// Guarded, backup-first repair of missing/placeholder branch slugs.
//
// SAFETY RULES (in order):
//   1. SUPER_ADMIN only (requireRole('SUPER_ADMIN'), health/schema pattern).
//   2. Rate limited strictly per user + client IP (6/min).
//   3. Refuses with 400 unless the body is exactly { confirm: true }.
//   4. Refuses with 400 when DATABASE_URL is not the local SQLite file
//      (production PostgreSQL must set slugs through a Prisma migration:
//      see docs/database-migration-policy.md). No changes are made.
//   5. Backup-first: runs scripts/backup-db.mjs (npm run db:backup) and
//      aborts with 500 when it does not exit cleanly. No changes are made.
//   6. Per store: only fills the slug when it is missing or a placeholder
//      (or force === true AND the target slug is free); NEVER overwrites or
//      renames another store; records a conflict instead. The subdomain is
//      derived from the slug only when the subdomain is empty.
//   7. Writes one db.store.update per changed store (no destructive SQL).
//   8. Audits ORG_SLUG_REPAIR_APPLIED (WARN) with the per-store results.
//   9. Idempotent: a second run finds nothing to repair.
//
// Org-wide reads and writes run inside runWithoutTenant (the kpi-summary
// pattern): Store is the tenant root and this is an organization-level
// operation; the route is the authorization boundary.

import { type NextRequest } from 'next/server';
import { spawnSync } from 'node:child_process';
import { join as joinPath } from 'node:path';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, requireRole, type AuthSession } from '@/lib/auth';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogComponent, LogSeverity } from '@/lib/types';
import { deriveSlugFromStoreName, isPlaceholderSlug } from '@/lib/org/diagnostics';

export const dynamic = 'force-dynamic';

const requireSuperAdmin = requireRole('SUPER_ADMIN');

interface SlugRepairBody {
  confirm?: unknown;
  force?: unknown;
}

interface StoreIdentityRow {
  id: string;
  name: string;
  code: string | null;
  slug: string | null;
  subdomain: string | null;
  status: string;
}

interface AppliedRepair {
  storeId: string;
  slug: string;
  subdomain: string | null;
}

interface RepairConflict {
  storeId: string;
  storeName: string;
  plannedSlug: string | null;
  reason: 'unusable-name' | 'slug-taken';
  detail: string;
  heldByStoreId: string | null;
}

async function slugRepairApplyHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  return runWithoutTenant(async () => {
    const denied = requireSuperAdmin(session);
    if (denied) return denied;

    // A write endpoint with a backup step: the strictest budget of the
    // diagnostics surface (6/min, mirroring the refresh route).
    const rl = isRateLimited(`slug-repair-apply:${session.userId}:${getClientIp(request)}`, {
      max: 6,
      windowMs: 60 * 1000,
    });
    if (rl.limited) {
      return Response.json(
        { success: false, error: 'Too many slug repair requests. Retry in a minute.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }

    // Rule 3: explicit confirmation. An absent body is the same as no.
    let body: SlugRepairBody = {};
    try {
      body = (await request.json()) as SlugRepairBody;
    } catch {
      body = {};
    }
    if (body?.confirm !== true) {
      return Response.json(
        {
          success: false,
          error:
            'Confirmation required. Send { "confirm": true } in the request body to apply the slug repair.',
        },
        { status: 400 },
      );
    }
    const force = body?.force === true;

    // Rule 4: local SQLite only. PostgreSQL deployments converge slugs
    // through versioned migrations, not runtime writes.
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl.startsWith('file:')) {
      return Response.json(
        {
          success: false,
          error:
            'Slug repair supports the local SQLite database only (a DATABASE_URL that starts with file:). Production PostgreSQL deployments must set branch slugs through a Prisma migration instead. See docs/database-migration-policy.md.',
        },
        { status: 400 },
      );
    }

    // Rule 5: backup-first. The backup script is the same one the updater
    // and the repair scripts use; a failed backup aborts everything.
    // The script path is computed at runtime (join, not a literal) so the
    // bundler never tries to resolve it as a module dependency.
    const backupScript = joinPath('scripts', 'backup-db' + '.mjs');
    const backup = spawnSync(process.execPath, [backupScript], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    if (backup.error || backup.status !== 0) {
      return Response.json(
        {
          success: false,
          error:
            'The pre-repair database backup did not complete. No changes were made. Run npm run db:backup manually, then retry.',
        },
        { status: 500 },
      );
    }

    const stores = (await db.store.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, slug: true, subdomain: true, status: true },
    })) as StoreIdentityRow[];

    // Every slug and subdomain currently in use, with the holding store id.
    // The repair refuses any target held by ANOTHER store (slug or
    // subdomain): it never overwrites and never renames anyone.
    const usedKeys = new Map<string, string>();
    for (const store of stores) {
      if (store.slug) usedKeys.set(store.slug, store.id);
      if (store.subdomain) usedKeys.set(store.subdomain, store.id);
    }

    const applied: AppliedRepair[] = [];
    const conflicts: RepairConflict[] = [];

    for (const store of stores) {
      const slugMissing = isPlaceholderSlug(store.slug);
      if (!slugMissing && !force) continue;

      const plannedSlug = deriveSlugFromStoreName(store.name);
      if (!plannedSlug) {
        conflicts.push({
          storeId: store.id,
          storeName: store.name,
          plannedSlug: null,
          reason: 'unusable-name',
          detail:
            'The store name contains no usable slug characters. Set the slug manually on the store record.',
          heldByStoreId: null,
        });
        continue;
      }

      const holder = usedKeys.get(plannedSlug);
      if (holder && holder !== store.id) {
        conflicts.push({
          storeId: store.id,
          storeName: store.name,
          plannedSlug,
          reason: 'slug-taken',
          detail:
            'Another store already uses this slug or subdomain. The conflicting store was not changed.',
          heldByStoreId: holder,
        });
        continue;
      }

      // Build the update payload: the slug only when it must change (with
      // force, an unchanged equal slug is an idempotent no-op), and the
      // subdomain derived from the slug only when it is empty.
      const data: { slug?: string; subdomain?: string } = {};
      if (slugMissing || (force && store.slug !== plannedSlug)) data.slug = plannedSlug;
      if (isPlaceholderSlug(store.subdomain)) data.subdomain = plannedSlug;

      if (Object.keys(data).length === 0) continue;

      await db.store.update({ where: { id: store.id }, data });
      usedKeys.set(plannedSlug, store.id);
      applied.push({
        storeId: store.id,
        slug: data.slug ?? store.slug ?? plannedSlug,
        subdomain: data.subdomain ?? store.subdomain ?? null,
      });
    }

    // Rule 8: durable audit trail with the per-store results. systemLog is
    // best-effort and never throws.
    await systemLog({
      userId: session.userId,
      action: 'ORG_SLUG_REPAIR_APPLIED',
      component: LogComponent.API,
      severity: LogSeverity.WARN,
      message: `Branch slug repair applied to ${applied.length} store(s); ${conflicts.length} conflict(s) recorded.`,
      metadata: { applied, conflicts, forced: force },
      ipAddress: getClientIp(request),
    });

    return Response.json({
      success: true,
      data: {
        applied,
        conflicts,
        backedUp: true,
        message: applied.length === 0 ? 'Nothing to repair.' : null,
      },
    });
  });
}

export const POST = withErrorBoundary(requireAuth(slugRepairApplyHandler), LogComponent.API);
