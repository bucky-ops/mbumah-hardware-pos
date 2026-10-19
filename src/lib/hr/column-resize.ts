// MBUMAH HARDWARE POS - resizable column mechanics (v2.132.0)
//
// Pure helpers behind the reports desk's resizable columns — the EMS spec
// Phase 4.8 acceptance's last unsatisfied table affordance (sticky headers,
// column visibility, CSV export and print PDF already shipped). The drag
// itself is a delegated pointer handler on the reports tabs container: a
// pointerdown within EDGE_BAND px of a resizable th's right edge starts a
// resize; the th carries its key via data-resize-key and its live width via
// an inline style, so no new DOM is created and no table layout flips.
//
// Widths persist per browser in localStorage (COL_WIDTHS_STORAGE_KEY) under
// their column key — two tables that share a key ("Period" on cost and
// statutory) share their width on purpose: the key IS the column's identity.
// A double-click on the edge resets that one column; "Show all columns"
// visibility and every other affordance keep working untouched.

/** The narrowest a column may be squeezed — enough for a stamped date. */
export const COL_WIDTH_MIN = 88;
/** The widest a column may grow — past this the table scrolls, not bends. */
export const COL_WIDTH_MAX = 480;
/** How close to a th's right edge a pointerdown means "resize", in px. */
export const EDGE_BAND = 8;
/** localStorage slot for the reports desk's per-column widths. */
export const COL_WIDTHS_STORAGE_KEY = 'hr-reports-col-widths';

/** Clamp a desired width into the honest [MIN, MAX] band. */
export function clampColWidth(width: number): number {
  if (!Number.isFinite(width)) return COL_WIDTH_MIN;
  return Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round(width)));
}

/**
 * The width after a drag: the width the pointerdown started from plus the
 * pointer's horizontal travel, clamped. One pure formula so the E2E and the
 * unit tests exercise the same math the desk runs.
 */
export function nudgeColWidth(startWidth: number, dx: number): number {
  return clampColWidth(startWidth + dx);
}

/**
 * Parse the stored widths safely: anything that is not a plain object of
 * finite in-band numbers degrades to an empty map — a corrupted or foreign
 * localStorage value never renders a broken desk, it just resizes nothing.
 */
export function loadColWidths(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const w = clampColWidth(value);
    // a stored width outside the band was never set by this desk — drop it
    if (value < COL_WIDTH_MIN || value > COL_WIDTH_MAX) continue;
    out[key] = w;
  }
  return out;
}
