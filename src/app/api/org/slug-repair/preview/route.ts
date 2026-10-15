// POST /api/org/slug-repair/preview (v2.18.4, audit Finding 3)
//
// NON-MUTATING dry run for the branch slug repair. Lists every store whose
// slug is missing or a placeholder ("undefined"/"null"), the slug that
// deriveSlugFromStoreName would write, and whether that target is already
// taken by another store (slug or subdomain). Never writes anything.
//
// SECURITY: SUPER_ADMIN only (requireRole('SUPER_ADMIN'), the health/schema
// in-handler pattern). Rate limited per user + client IP (30/min).
// Org-wide reads run inside runWithoutTenant (the kpi-summary pattern).

import { type NextRequest } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, requireRole, type AuthSession } from '@/lib/auth';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { deriveSlugFromStoreName, isPlaceholderSlug } from '@/lib/org/diagnostics';

export const dynamic = 'force-dynamic';

const requireSuperAdmin = requireRole('SUPER_ADMIN');

interface StoreIdentityRow {
  id: string;
  name: string;
  code: string | null;
  slug: string | null;
  subdomain: string | null;
  status: string;
}

async function slugRepairPreviewHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  return runWithoutTenant(async () => {
    const denied = requireSuperAdmin(session);
    if (denied) return denied;

    const rl = isRateLimited(`slug-repair-preview:${session.userId}:${getClientIp(request)}`, {
      max: 30,
      windowMs: 60 * 1000,
    });
    if (rl.limited) {
      return Response.json(
        { success: false, error: 'Too many slug repair preview requests. Retry later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }

    const stores = (await db.store.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, slug: true, subdomain: true, status: true },
    })) as StoreIdentityRow[];

    // Every slug and subdomain currently in use, with the holding store id:
    // the apply step refuses to write a slug that collides with either.
    const usedKeys = new Map<string, string>();
    for (const store of stores) {
      if (store.slug) usedKeys.set(store.slug, store.id);
      if (store.subdomain) usedKeys.set(store.subdomain, store.id);
    }

    const planned = stores
      .filter((store) => isPlaceholderSlug(store.slug))
      .map((store) => {
        const plannedSlug = deriveSlugFromStoreName(store.name);
        const holder = plannedSlug ? usedKeys.get(plannedSlug) : undefined;
        const conflictWith = holder && holder !== store.id ? holder : undefined;
        const conflictWithStore = conflictWith
          ? stores.find((s) => s.id === conflictWith) ?? null
          : null;
        return {
          storeId: store.id,
          storeName: store.name,
          code: store.code,
          status: store.status,
          currentSlug: store.slug,
          plannedSlug: plannedSlug || null,
          conflict: !plannedSlug || Boolean(conflictWith),
          conflictWithStoreId: conflictWith ?? null,
          conflictWithStoreName: conflictWithStore?.name ?? null,
          reason: !plannedSlug
            ? 'unusable-name'
            : conflictWith
              ? 'slug-taken'
              : 'ready',
        };
      });

    return Response.json({
      success: true,
      data: {
        planned,
        summary: {
          storesTotal: stores.length,
          needsRepair: planned.length,
          conflicts: planned.filter((p) => p.conflict).length,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  });
}

export const POST = withErrorBoundary(requireAuth(slugRepairPreviewHandler), LogComponent.API);
