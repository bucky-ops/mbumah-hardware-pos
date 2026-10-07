// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — VAT rate client cache (v2.8.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// Plain (non-'use client') module so BOTH client code and client-only libs
// (e.g. offline-sync) can read the last known admin-controlled VAT rate
// without dragging React into the bundle. The `useVatRate` hook mirrors the
// server value into localStorage; this helper reads that mirror.
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage key mirroring the admin-controlled VAT rate. */
export const VAT_RATE_CACHE_KEY = 'mbumah_vat_rate';

/** Fallback when nothing is cached (server render / fresh device). */
export const FALLBACK_VAT_RATE_PERCENT = 16;

/**
 * Read the last known admin-controlled VAT rate (percent) from the
 * localStorage mirror. Safe on the server (returns the fallback) and with
 * storage disabled. Always returns a finite number in [0, 100].
 */
export function getCachedVatRate(): number {
  if (typeof window === 'undefined') return FALLBACK_VAT_RATE_PERCENT;
  try {
    const raw = window.localStorage.getItem(VAT_RATE_CACHE_KEY);
    const n = raw === null ? NaN : parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100
      ? n
      : FALLBACK_VAT_RATE_PERCENT;
  } catch {
    return FALLBACK_VAT_RATE_PERCENT;
  }
}

/** Mirror the server rate into localStorage (called by useVatRate). */
export function setCachedVatRate(percent: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VAT_RATE_CACHE_KEY, String(percent));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
