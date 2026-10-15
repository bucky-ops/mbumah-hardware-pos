// MBUMAH HARDWARE POS - EMS feature flag (v2.18.5)
//
// HR_MODULE_ENABLED is data-driven (HrSetting row, key hr.module.enabled).
// Default: enabled. Operators can disable per organization without a deploy;
// when disabled, /hr pages and /api/hr routes return 403 FEATURE_DISABLED and
// no POS route changes behavior.
//
// The value is cached briefly (30s, per process) because it is read on every
// HR request; the settings PUT clears the cache entry on write.

import { db } from '@/lib/db';

const SETTING_KEY = 'hr.module.enabled';
const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { value: boolean; at: number }>();

export async function isHrModuleEnabled(organizationId: string): Promise<boolean> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value;
  }
  try {
    const row = await db.hrSetting.findUnique({
      where: { organizationId_key: { organizationId, key: SETTING_KEY } },
      select: { value: true },
    });
    let value = true; // default enabled
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as { enabled?: boolean };
        value = parsed.enabled !== false;
      } catch {
        value = true;
      }
    }
    cache.set(organizationId, { value, at: Date.now() });
    return value;
  } catch {
    // Table may not exist yet on databases mid-migration: fail open for reads
    // so HR stays reachable after a deploy that ships the schema.
    return true;
  }
}

export async function setHrModuleEnabled(
  organizationId: string,
  enabled: boolean,
  updatedByUserId: string,
): Promise<void> {
  await db.hrSetting.upsert({
    where: { organizationId_key: { organizationId, key: SETTING_KEY } },
    create: {
      organizationId,
      key: SETTING_KEY,
      value: JSON.stringify({ enabled }),
      updatedByUserId,
    },
    update: {
      value: JSON.stringify({ enabled }),
      updatedByUserId,
    },
  });
  cache.delete(organizationId);
}

export const HR_MODULE_SETTING_KEY = SETTING_KEY;
