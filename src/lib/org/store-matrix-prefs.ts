// v2.181.0 — the Store Intelligence Matrix remembers.
//
// The matrix has been owner-tunable since v2.18.3 (drag-resizable columns,
// hideable columns) and sortable since v2.180.0 — but every one of those
// choices lived in component state and died with the panel: a reload, a
// tab switch, or a navigation reset the owner's matrix back to stock. This
// module is the ONE spine that remembers: a versioned, corrupt-tolerant
// localStorage payload the component restores after mount and saves back
// (debounced) on every change.
//
// THE HONESTY CONTRACT:
//   • ONE key, ONE version — `mbumah.store-matrix.prefs` carrying `v: 1`;
//     an unknown version is not a legacy shape to guess at, it is discard.
//   • CORRUPT-TOLERANT by construction — a truncated edit, another tab's
//     half-write, a JSON blob from some future schema: nothing throws,
//     nothing lies. Anything that does not parse, or does not match the
//     validated shape field-by-field, degrades to the calm empty prefs
//     (the same degrade-to-defaults rule the week column speaks on absence).
//   • PURE — no window, no document, no clock. The storage is INJECTED
//     (the component hands its global storage over, guarded by its own
//     SSR check), so the whole spine runs under node test
//     runners and stays honest under SSR.
//   • BOUNDED — widths are clamped to a sane band and the maps cap their
//     entries, so a poisoned payload can never balloon the tab's storage
//     or feed the layout engine nonsense it cannot render.

import type { MatrixSortState } from './store-matrix-sort';

/** The ONE localStorage key the matrix's layout lives under. */
export const MATRIX_PREFS_KEY = 'mbumah.store-matrix.prefs';

/** The payload version this module writes and accepts. */
export const MATRIX_PREFS_VERSION = 1 as const;

/** The saved layout — the whole of what the matrix remembers. */
export interface MatrixPanelPrefs {
  v: typeof MATRIX_PREFS_VERSION;
  /** Column key → overridden pixel width (only the tuned columns ride). */
  widths: Record<string, number>;
  /** Column key → visibility (only explicitly hidden columns ride as false). */
  visible: Record<string, boolean>;
  /** The ONE active sort (v2.180.0's shape), or null for arrival order. */
  sort: MatrixSortState | null;
  /** v2.181.0: compact-rows density. */
  dense: boolean;
}

/** The calm default — stock layout, arrival order, comfortable rows. */
export const EMPTY_PANEL_PREFS: MatrixPanelPrefs = {
  v: MATRIX_PREFS_VERSION,
  widths: {},
  visible: {},
  sort: null,
  dense: false,
};

/** A fresh deep copy of the empty prefs (the shared object is never handed out). */
export function emptyPanelPrefs(): MatrixPanelPrefs {
  return { v: MATRIX_PREFS_VERSION, widths: {}, visible: {}, sort: null, dense: false };
}

/**
 * The storage the spine speaks — the subset of DOM Storage the matrix
 * needs, so tests can hand a Map-backed fake and the component can hand
 * the browser's own localStorage. `removeItem` is optional: a storage
 * without it still supports the reset (the spine overwrites with the
 * empty payload).
 */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Widths are clamped into this band — a column a owner can actually see. */
export const MATRIX_PREFS_MIN_WIDTH = 40;
export const MATRIX_PREFS_MAX_WIDTH = 2000;
/** Entry caps — the table has 11 columns; these caps are generous fences. */
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
    out[key] = Math.min(MATRIX_PREFS_MAX_WIDTH, Math.max(MATRIX_PREFS_MIN_WIDTH, Math.round(value)));
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
export function parseMatrixPrefs(raw: string | null | undefined): MatrixPanelPrefs {
  if (typeof raw !== 'string' || raw.length === 0) return emptyPanelPrefs();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyPanelPrefs();
  }
  if (!isPlainObject(parsed)) return emptyPanelPrefs();
  if (parsed.v !== MATRIX_PREFS_VERSION) return emptyPanelPrefs();
  return {
    v: MATRIX_PREFS_VERSION,
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
export function serializeMatrixPrefs(prefs: MatrixPanelPrefs): string {
  const sort = sanitizeSort(prefs?.sort ?? null);
  return JSON.stringify({
    v: MATRIX_PREFS_VERSION,
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
export function loadMatrixPrefs(storage?: PrefsStorage | null): MatrixPanelPrefs {
  if (!storage || typeof storage.getItem !== 'function') return emptyPanelPrefs();
  try {
    return parseMatrixPrefs(storage.getItem(MATRIX_PREFS_KEY));
  } catch {
    return emptyPanelPrefs();
  }
}

/**
 * Save the layout. Returns true when the bytes landed, false when the
 * storage refused (quota, privacy mode) — the caller stays silent either
 * way (a refused save is never a toast-worthy event; the matrix simply
 * forgets on the next reload, exactly as it did before v2.181.0).
 */
export function saveMatrixPrefs(storage: PrefsStorage | null | undefined, prefs: MatrixPanelPrefs): boolean {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(MATRIX_PREFS_KEY, serializeMatrixPrefs(prefs));
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
export function clearMatrixPrefs(storage: PrefsStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(MATRIX_PREFS_KEY);
      return true;
    }
    return saveMatrixPrefs(storage, emptyPanelPrefs());
  } catch {
    return false;
  }
}
