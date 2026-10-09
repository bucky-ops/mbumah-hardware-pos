// MBUMAH HARDWARE POS - Admin-controlled VAT rate (v2.8.0)
//
// CLIENT REQUIREMENT (2026-10):
//   "VAT should be fully controlled by Admin. If Admin sets VAT to 0%, then
//    all VAT fields on all invoices should automatically become 0. VAT rate
//    keeps changing, so it should not be hardcoded."
//
// The rate is persisted in the global `SystemConfig` key-value store under
// `vat_rate_percent` (SUPER_ADMIN/STORE_OWNER editable via PATCH
// /api/settings/vat). Every document-creation path (POS checkout, invoices,
// purchase orders) reads the rate through `getVatRatePercent()` - the admin
// setting is AUTHORITATIVE and overrides any per-product/per-line default.
// Historical documents keep their stored amounts.
//
// A tiny in-process TTL cache keeps the per-request DB hit negligible while
// still making admin changes effective within seconds (and instantly on the
// same pod after a write via `invalidateVatRateCache()`).

import { db } from '@/lib/db';
import { VAT_RATE_PERCENT as LEGACY_DEFAULT_VAT_RATE_PERCENT } from '@/lib/utils/financialMath';

/** SystemConfig key that stores the admin-controlled VAT rate (percent). */
export const VAT_CONFIG_KEY = 'vat_rate_percent';

/**
 * Fallback used only when the admin has never configured a rate.
 * (Kept numerically identical to the historical Kenya standard 16%.)
 */
export const DEFAULT_VAT_RATE_PERCENT = LEGACY_DEFAULT_VAT_RATE_PERCENT;

const CACHE_TTL_MS = 15_000;

let cachedRate: number | null = null;
let cachedAt = 0;

/** Parse any stored/ garbage value into a safe 0-100 rate. */
function sanitizeRate(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/**
 * Read the admin-controlled VAT rate (percent).
 * Returns a value in [0, 100] - 0 means "VAT disabled globally".
 */
export async function getVatRatePercent(): Promise<number> {
  const now = Date.now();
  if (cachedRate !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedRate;
  }
  try {
    const config = await db.systemConfig.findUnique({
      where: { key: VAT_CONFIG_KEY },
      select: { value: true },
    });
    const rate = sanitizeRate(config?.value);
    cachedRate = rate ?? DEFAULT_VAT_RATE_PERCENT;
    cachedAt = now;
    return cachedRate;
  } catch {
    // Config table unavailable - never block sales; fall back to default.
    return DEFAULT_VAT_RATE_PERCENT;
  }
}

/** Force the next read to hit the DB (called after an admin update). */
export function invalidateVatRateCache(): void {
  cachedRate = null;
  cachedAt = 0;
}
