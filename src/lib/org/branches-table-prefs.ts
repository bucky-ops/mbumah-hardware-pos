// v2.182.0 — the branches table remembers.
//
// The org dashboard's branches table has been the org console's OTHER dense
// table since v2.149.0 (the matrix's twin across the page), and since
// v2.182.0 it is owner-tunable the same way: sortable headers, hideable
// columns, drag-resizable widths and a compact-rows density. Every one of
// those choices used to die with the panel — a reload, a tab switch or a
// navigation reset the table back to stock. This module is the ONE spine
// that remembers: a versioned, corrupt-tolerant localStorage payload the
// component restores after mount and saves back (debounced) on every change.
// It is the store-matrix spine's twin (src/lib/org/store-matrix-prefs.ts)
// under its OWN key — the two tables never share bytes, so resetting one
// can never surprise the other.
//
// THE HONESTY CONTRACT (the matrix spine's, carried over verbatim):
//   • ONE key, ONE version — `mbumah.branches-table.prefs` carrying `v: 1`;
//     an unknown version is not a legacy shape to guess at, it is discard.
//   • CORRUPT-TOLERANT by construction — a truncated edit, another tab's
//     half-write, a JSON blob from some future schema: nothing throws,
//     nothing lies. Anything that does not parse, or does not match the
//     validated shape field-by-field, degrades to the calm empty prefs.
//   • PURE — no window, no document, no clock. The storage is INJECTED
//     (the component hands its global storage over, guarded by its own
//     SSR check), so the whole spine runs under node test runners and
//     stays honest under SSR.
//   • BOUNDED — widths are clamped to a sane band and the maps cap their
//     entries, so a poisoned payload can never balloon the tab's storage
//     or feed the layout engine nonsense it cannot render.

import type { MatrixSortState } from './store-matrix-sort';

/** The ONE localStorage key the branches table's layout lives under. */
export const BRANCHES_TABLE_PREFS_KEY = 'mbumah.branches-table.prefs';

/** The payload version this module writes and accepts. */
export const BRANCHES_TABLE_PREFS_VERSION = 1 as const;

/** The saved layout — the whole of what the branches table remembers. */
export interface BranchesTablePrefs {
  v: typeof BRANCHES_TABLE_PREFS_VERSION;
  /** Column key → overridden pixel width (only the tuned columns ride). */
  widths: Record<string, number>;
  /** Column key → visibility (only explicitly hidden columns ride as false). */
  visible: Record<string, boolean>;
  /** The ONE active sort (the matrix-sort shape, shared vocabulary), or null for arrival order. */
  sort: MatrixSortState | null;
  /** v2.182.0: compact-rows density. */
  dense: boolean;
}

/** The calm default — stock layout, arrival order, comfortable rows. */
export const EMPTY_BRANCHES_TABLE_PREFS: BranchesTablePrefs = {
  v: BRANCHES_TABLE_PREFS_VERSION,
  widths: {},
  visible: {},
  sort: null,
  dense: false,
};

/** A fresh deep copy of the empty prefs (the shared object is never handed out). */
export function emptyBranchesTablePrefs(): BranchesTablePrefs {
  return { v: BRANCHES_TABLE_PREFS_VERSION, widths: {}, visible: {}, sort: null, dense: false };
}

/**
 * The storage the spine speaks — the subset of DOM Storage the table
 * needs, so tests can hand a Map-backed fake and the component can hand
 * the browser's own localStorage. `removeItem` is optional: a storage
 * without it still supports the reset (the spine overwrites with the
 * empty payload).
 */
export interface BranchesPrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Widths are clamped into this band — a column an owner can actually see. */
export const BRANCHES_TABLE_MIN_WIDTH = 40;
export const BRANCHES_TABLE_MAX_WIDTH = 2000;
/** Entry caps — the table has 9 columns; these caps are generous fences. */
const MAX_WIDTH_ENTRIES = 32;
const MAX_VISIBLE_ENTRIES = 32;
const MAX_KEY_LENGTH = 48;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Widths: finite numbers clamped into the band, capped entries, string keys. */
function sanitizeWidths(raw: unknown): Record<string, number> {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_WIDTH_ENTRIES) break;
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = Math.min(BRANCHES_TABLE_MAX_WIDTH, Math.max(BRANCHES_TABLE_MIN_WIDTH, Math.round(value)));
  }
  return out;
}

/** Visible: boolean values only, capped entries, string keys. */
function sanitizeVisible(raw: unknown): Record<string, boolean> {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_VISIBLE_ENTRIES) break;
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) continue;
    if (typeof value !== 'boolean') continue;
    out[key] = value;
  }
  return out;
}

/** Sort: only the exact {key, dir: 'asc'|'desc'} shape survives. */
function sanitizeSort(raw: unknown): MatrixSortState | null {
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
export function parseBranchesTablePrefs(raw: string | null | undefined): BranchesTablePrefs {
  if (typeof raw !== 'string' || raw.length === 0) return emptyBranchesTablePrefs();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyBranchesTablePrefs();
  }
  if (!isPlainObject(parsed)) return emptyBranchesTablePrefs();
  if (parsed.v !== BRANCHES_TABLE_PREFS_VERSION) return emptyBranchesTablePrefs();
  return {
    v: BRANCHES_TABLE_PREFS_VERSION,
    widths: sanitizeWidths(parsed.widths),
    visible: sanitizeVisible(parsed.visible),
    sort: sanitizeSort(parsed.sort),
    dense: parsed.dense === true,
  };
}

/**
 * Serialize prefs into the canonical bytes — the ONE writer of the key's
 * payload. Widths re-clamped, junk fields dropped: what lands in storage
 * is always a payload this module's own parser would accept back intact.
 */
export function serializeBranchesTablePrefs(prefs: BranchesTablePrefs): string {
  const sort = sanitizeSort(prefs?.sort ?? null);
  return JSON.stringify({
    v: BRANCHES_TABLE_PREFS_VERSION,
    widths: sanitizeWidths(prefs?.widths ?? {}),
    visible: sanitizeVisible(prefs?.visible ?? {}),
    sort,
    dense: prefs?.dense === true,
  });
}

/**
 * Load the saved layout. No storage (SSR, tests) → the calm empty prefs;
 * a throwing getItem (privacy modes, disabled storage) → the same — a
 * hostile storage degrades the layout, never the page.
 */
export function loadBranchesTablePrefs(storage?: BranchesPrefsStorage | null): BranchesTablePrefs {
  if (!storage || typeof storage.getItem !== 'function') return emptyBranchesTablePrefs();
  try {
    return parseBranchesTablePrefs(storage.getItem(BRANCHES_TABLE_PREFS_KEY));
  } catch {
    return emptyBranchesTablePrefs();
  }
}

/**
 * Save the layout. Returns true when the bytes landed, false when the
 * storage refused (quota, privacy mode) — the caller stays silent either
 * way (a refused save is never a toast-worthy event; the table simply
 * forgets on the next reload, exactly as it did before v2.182.0).
 */
export function saveBranchesTablePrefs(
  storage: BranchesPrefsStorage | null | undefined,
  prefs: BranchesTablePrefs,
): boolean {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(BRANCHES_TABLE_PREFS_KEY, serializeBranchesTablePrefs(prefs));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the saved layout (the Reset layout action). A storage with
 * removeItem loses the key outright; a storage without it gets the empty
 * payload written over (an honest "no saved layout" either way). Returns
 * true when the clear provably landed.
 */
export function clearBranchesTablePrefs(storage: BranchesPrefsStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(BRANCHES_TABLE_PREFS_KEY);
      return true;
    }
    return saveBranchesTablePrefs(storage, emptyBranchesTablePrefs());
  } catch {
    return false;
  }
}
