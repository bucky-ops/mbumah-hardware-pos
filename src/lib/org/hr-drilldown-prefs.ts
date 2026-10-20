// v2.183.0 — the drill-down remembers.
//
// The org dashboard's HR drill-down ("People & payroll by branch") has been
// the console's THIRD dense table since v2.23.0, and its siblings both
// learned to remember before it did — the matrix (v2.181.0) and the
// branches table (v2.182.0) — while every choice the owner made here still
// died with the panel: a reload collapsed it, a navigation reset its sort.
// This module is the ONE spine that remembers: a versioned,
// corrupt-tolerant localStorage payload the component restores after mount
// and saves back (debounced) on every change. It is the branches spine's
// twin under its OWN key — the three tables never share bytes, so resetting
// one can never surprise the others.
//
// THE HONEST RESTRAINT (why this payload is FOUR fields, not six): the
// drill-down is a collapsed-by-design section of six ESSENTIAL columns —
// headcount, cost, absence, latest run, expiry alerts are the whole point
// of the panel — inside a max-h-96 scroll region that already handles its
// own width. Hideable columns and drag-resizable widths would be feature
// bloat on a table nobody has asked to reshape; the matrix and the branches
// table (nine data columns, a real workspace cell) earned theirs. What an
// owner actually loses on reload here is the OPEN state, the sort and the
// density — so those are exactly what this spine carries.
//
// THE HONESTY CONTRACT (the matrix/branches spines', carried over
// verbatim):
//   • ONE key, ONE version — `mbumah.hr-drilldown.prefs` carrying `v: 1`;
//     an unknown version is not a legacy shape to guess at, it is discard.
//   • CORRUPT-TOLERANT by construction — a truncated edit, another tab's
//     half-write, a JSON blob from some future schema: nothing throws,
//     nothing lies. Anything that does not parse, or does not match the
//     validated shape field-by-field, degrades to the calm empty prefs.
//   • PURE — no window, no document, no clock. The storage is INJECTED
//     (the component hands its global storage over, guarded by its own
//     SSR check), so the whole spine runs under node test runners and
//     stays honest under SSR.
//   • BOUNDED — the payload's fields are individually validated and the
//     sort key is length-capped, so a poisoned payload can never balloon
//     the tab's storage or feed the comparator a key it cannot speak.

import type { HrDrillSortState } from './hr-drilldown-sort';

/** The ONE localStorage key the HR drill-down's layout lives under. */
export const HR_DRILLDOWN_PREFS_KEY = 'mbumah.hr-drilldown.prefs';

/** The payload version this module writes and accepts. */
export const HR_DRILLDOWN_PREFS_VERSION = 1 as const;

/** The saved layout — the whole of what the drill-down remembers. */
export interface HrDrilldownPrefs {
  v: typeof HR_DRILLDOWN_PREFS_VERSION;
  /** v2.183.0: the section's open state — the door the owner opened. */
  open: boolean;
  /** The ONE active sort (the drill-down sort shape, shared vocabulary), or null for arrival order. */
  sort: HrDrillSortState | null;
  /** v2.183.0: compact-rows density. */
  dense: boolean;
}

/** The calm default — the door closed, arrival order, comfortable rows. */
export const EMPTY_HR_DRILLDOWN_PREFS: HrDrilldownPrefs = {
  v: HR_DRILLDOWN_PREFS_VERSION,
  open: false,
  sort: null,
  dense: false,
};

/** A fresh deep copy of the empty prefs (the shared object is never handed out). */
export function emptyHrDrilldownPrefs(): HrDrilldownPrefs {
  return { v: HR_DRILLDOWN_PREFS_VERSION, open: false, sort: null, dense: false };
}

/**
 * The storage the spine speaks — the subset of DOM Storage the panel
 * needs, so tests can hand a Map-backed fake and the component can hand
 * the browser's own localStorage. `removeItem` is optional: a storage
 * without it still supports the reset (the spine overwrites with the
 * empty payload).
 */
export interface HrDrilldownPrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Entry fences — the payload has three tunables; these caps are generous. */
const MAX_KEY_LENGTH = 48;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Sort: only the exact {key, dir: 'asc'|'desc'} shape survives. */
function sanitizeSort(raw: unknown): HrDrillSortState | null {
  if (!isPlainObject(raw)) return null;
  const { key, dir } = raw as { key?: unknown; dir?: unknown };
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
  if (dir !== 'asc' && dir !== 'desc') return null;
  return { key, dir };
}

/**
 * Parse raw storage bytes into prefs. ANY failure — null bytes, garbage
 * JSON, an unknown version, a non-object payload — degrades to the calm
 * empty prefs. Field-by-field validation: the shape the module does not
 * recognize is dropped FIELD-WISE, so a partially-corrupt payload keeps
 * whatever is provably sound and discards the rest.
 */
export function parseHrDrilldownPrefs(raw: string | null | undefined): HrDrilldownPrefs {
  if (typeof raw !== 'string' || raw.length === 0) return emptyHrDrilldownPrefs();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyHrDrilldownPrefs();
  }
  if (!isPlainObject(parsed)) return emptyHrDrilldownPrefs();
  if (parsed.v !== HR_DRILLDOWN_PREFS_VERSION) return emptyHrDrilldownPrefs();
  return {
    v: HR_DRILLDOWN_PREFS_VERSION,
    open: parsed.open === true,
    sort: sanitizeSort(parsed.sort),
    dense: parsed.dense === true,
  };
}

/**
 * Serialize prefs into the canonical bytes — the ONE writer of the key's
 * payload. Junk fields dropped: what lands in storage is always a payload
 * this module's own parser would accept back intact.
 */
export function serializeHrDrilldownPrefs(prefs: HrDrilldownPrefs): string {
  const sort = sanitizeSort(prefs?.sort ?? null);
  return JSON.stringify({
    v: HR_DRILLDOWN_PREFS_VERSION,
    open: prefs?.open === true,
    sort,
    dense: prefs?.dense === true,
  });
}

/**
 * Load the saved layout. No storage (SSR, tests) → the calm empty prefs;
 * a throwing getItem (privacy modes, disabled storage) → the same — a
 * hostile storage degrades the layout, never the page.
 */
export function loadHrDrilldownPrefs(storage?: HrDrilldownPrefsStorage | null): HrDrilldownPrefs {
  if (!storage || typeof storage.getItem !== 'function') return emptyHrDrilldownPrefs();
  try {
    return parseHrDrilldownPrefs(storage.getItem(HR_DRILLDOWN_PREFS_KEY));
  } catch {
    return emptyHrDrilldownPrefs();
  }
}

/**
 * Save the layout. Returns true when the bytes landed, false when the
 * storage refused (quota, privacy mode) — the caller stays silent either
 * way (a refused save is never a toast-worthy event; the drill-down simply
 * forgets on the next reload, exactly as it did before v2.183.0).
 */
export function saveHrDrilldownPrefs(
  storage: HrDrilldownPrefsStorage | null | undefined,
  prefs: HrDrilldownPrefs,
): boolean {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(HR_DRILLDOWN_PREFS_KEY, serializeHrDrilldownPrefs(prefs));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the saved layout (the Reset action). A storage with removeItem
 * loses the key outright; a storage without it gets the empty payload
 * written over (an honest "no saved layout" either way). Returns true
 * when the clear provably landed.
 */
export function clearHrDrilldownPrefs(storage: HrDrilldownPrefsStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(HR_DRILLDOWN_PREFS_KEY);
      return true;
    }
    return saveHrDrilldownPrefs(storage, emptyHrDrilldownPrefs());
  } catch {
    return false;
  }
}
