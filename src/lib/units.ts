/**
 * Unit display helpers (v2.12.1 hotfix — the "per NULL" bug).
 *
 * A batch of legacy products (e.g. Bamburi Cement rows) was saved with a
 * NULL `unitType`, which made the product card render a dangling "per "
 * and raw renders print "null" / empty strings across the POS. Every
 * render site now goes through these two shared, null-safe formatters
 * instead of interpolating `unitType` directly.
 *
 * (Owner-side data backfill: scripts/fix-null-units.ts clears the NULLs.)
 */

/**
 * Full unit label for "per UNIT" style badges. NULL/empty → 'UNIT' fallback.
 * `per {unitLabel(p.unitType)}` — never renders a dangling "per " again.
 */
export function unitLabel(unit: string | null | undefined): string {
  const trimmed = unit?.trim().toUpperCase();
  return trimmed || 'UNIT';
}

/**
 * Short unit suffix for stock counters: "393 kg left", "12 bags left".
 * Unknown/NULL units → '' (the counter falls back to a bare "5 left").
 */
export function unitShort(unit: string | null | undefined): string {
  const SHORT_UNITS: Record<string, string> = {
    KILOGRAM: 'kg',
    METER: 'm',
    LITER: 'L',
    BAG: 'bags',
    PIECE: 'pcs',
    BOX: 'boxes',
    SET: 'sets',
  };
  const key = unit?.trim().toUpperCase() ?? '';
  return SHORT_UNITS[key] ?? '';
}
