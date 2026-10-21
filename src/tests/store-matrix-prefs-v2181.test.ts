import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseMatrixPrefs,
  serializeMatrixPrefs,
  loadMatrixPrefs,
  saveMatrixPrefs,
  clearMatrixPrefs,
  emptyPanelPrefs,
  MATRIX_PREFS_KEY,
  MATRIX_PREFS_VERSION,
  MATRIX_PREFS_MIN_WIDTH,
  MATRIX_PREFS_MAX_WIDTH,
} from '../lib/org/store-matrix-prefs';

/**
 * v2.181.0 — the matrix remembers.
 *
 * Every owner-tunable choice in the Store Intelligence Matrix (widths
 * since v2.18.3, hidden columns, the v2.180.0 sort, and the new compact
 * density) previously died with the panel. This release:
 *   1. a NEW pure spine (src/lib/org/store-matrix-prefs.ts) owns the
 *      saved layout — ONE versioned localStorage key, corrupt-tolerant
 *      field-by-field parsing, clamped widths, injected storage;
 *   2. the component restores AFTER hydration (stock first, saved second)
 *      and writes back DEBOUNCED, clearing the key when the layout is
 *      stock — "nothing saved" is the honest shape of "no customizations";
 *   3. the header grows the Compact-rows toggle (the fourth dimension)
 *      and the Columns menu grows the persistence hint + Reset layout.
 *
 * The spine EXECUTED here (not just pinned), the tolerance rule pinned
 * (nothing corrupt ever throws or lies), and the component contract
 * pinned as source text.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/store-matrix-prefs.ts');
const matrix = readRepo('src/components/org/store-matrix.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const changelog = readRepo('CHANGELOG.md');
const pkg = JSON.parse(readRepo('package.json'));

/** A Map-backed storage fake — the DOM Storage subset the spine speaks. */
const fakeStorage = (initial?: Record<string, string>) => {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map.entries()),
  };
};

describe('the spine executed - serialize and parse', () => {
  it('the ONE key and version are the exported constants', () => {
    expect(MATRIX_PREFS_KEY).toBe('mbumah.store-matrix.prefs');
    expect(MATRIX_PREFS_VERSION).toBe(1);
  });

  it('the payload carries EXACTLY the five fields, in order', () => {
    const bytes = serializeMatrixPrefs({ v: MATRIX_PREFS_VERSION, widths: {}, visible: {}, sort: null, dense: false });
    expect(Object.keys(JSON.parse(bytes))).toEqual(['v', 'widths', 'visible', 'sort', 'dense']);
    expect(JSON.parse(bytes).v).toBe(1);
  });

  it('a full round-trip keeps every field intact', () => {
    const prefs = { v: MATRIX_PREFS_VERSION, widths: { debt: 260, store: 220 }, visible: { mpesa: false, week: true }, sort: { key: 'debt', dir: 'desc' as const }, dense: true };
    const parsed = parseMatrixPrefs(serializeMatrixPrefs(prefs));
    expect(parsed).toEqual(prefs);
  });

  it('empty prefs are the calm default — and never the shared object', () => {
    const a = emptyPanelPrefs();
    const b = emptyPanelPrefs();
    expect(a).toEqual({ v: 1, widths: {}, visible: {}, sort: null, dense: false });
    expect(a).not.toBe(b);
    expect(a.widths).not.toBe(b.widths);
  });
});

describe('the tolerance rule - nothing corrupt ever throws or lies', () => {
  it('null, undefined and empty bytes degrade to empty prefs', () => {
    expect(parseMatrixPrefs(null)).toEqual(emptyPanelPrefs());
    expect(parseMatrixPrefs(undefined)).toEqual(emptyPanelPrefs());
    expect(parseMatrixPrefs('')).toEqual(emptyPanelPrefs());
  });

  it('garbage JSON and JSON non-objects degrade to empty prefs', () => {
    expect(parseMatrixPrefs('{not json').widths).toEqual({});
    expect(parseMatrixPrefs('42')).toEqual(emptyPanelPrefs());
    expect(parseMatrixPrefs('"a string"')).toEqual(emptyPanelPrefs());
    expect(parseMatrixPrefs('null')).toEqual(emptyPanelPrefs());
    expect(parseMatrixPrefs('[1,2,3]')).toEqual(emptyPanelPrefs());
  });

  it('an UNKNOWN VERSION is discarded, not guessed at', () => {
    const future = JSON.stringify({ v: 2, widths: { debt: 300 }, visible: {}, sort: null, dense: true });
    const p2 = parseMatrixPrefs(future);
    expect(p2.widths).toEqual({});
    expect(p2.sort).toBeNull();
    expect(p2.dense).toBe(false);
  });

  it('junk widths are dropped field-wise; survivors keep proven sound values', () => {
    const parsed = parseMatrixPrefs(JSON.stringify({
      v: 1,
      widths: { debt: 260, junk: 'wide', neg: -50, zero: 0, huge: 99999, nan: 'NaN', ok: 180.7 },
    }));
    expect(parsed.widths).toEqual({ debt: 260, huge: 2000, neg: 40, ok: 181, zero: 40 });
  });

  it('the clamp band IS the exported pair — the constants and the math can never drift apart', () => {
    expect(MATRIX_PREFS_MIN_WIDTH).toBe(40);
    expect(MATRIX_PREFS_MAX_WIDTH).toBe(2000);
    const parsed = parseMatrixPrefs(JSON.stringify({ v: 1, widths: { a: MATRIX_PREFS_MIN_WIDTH - 5, b: MATRIX_PREFS_MAX_WIDTH + 5 } }));
    expect(parsed.widths).toEqual({ a: MATRIX_PREFS_MIN_WIDTH, b: MATRIX_PREFS_MAX_WIDTH });
  });

  it('the entry cap bounds a poisoned payload — 34 widths in, 32 out (the first 32, in order)', () => {
    const widths: Record<string, number> = {};
    for (let i = 0; i < 34; i++) widths[`col${i}`] = 100 + i;
    const parsed = parseMatrixPrefs(JSON.stringify({ v: 1, widths, visible: {} }));
    expect(Object.keys(parsed.widths).length).toBe(32);
    expect(Object.keys(parsed.widths)[0]).toBe('col0');
    expect(Object.keys(parsed.widths)[31]).toBe('col31');
  });

  it('junk visible entries are dropped; booleans survive', () => {
    const parsed = parseMatrixPrefs(JSON.stringify({
      v: 1,
      visible: { mpesa: false, week: 'yes', debt: 1, actions: true },
    }));
    expect(parsed.visible).toEqual({ mpesa: false, actions: true });
  });

  it('a malformed sort degrades to null — never a half-shape', () => {
    const base = { v: 1, widths: {}, visible: {} };
    expect(parseMatrixPrefs(JSON.stringify({ ...base, sort: { key: 'debt' } })).sort).toBeNull();
    expect(parseMatrixPrefs(JSON.stringify({ ...base, sort: { key: 'debt', dir: 'up' } })).sort).toBeNull();
    expect(parseMatrixPrefs(JSON.stringify({ ...base, sort: { key: '', dir: 'asc' } })).sort).toBeNull();
    expect(parseMatrixPrefs(JSON.stringify({ ...base, sort: 'debt' })).sort).toBeNull();
    expect(parseMatrixPrefs(JSON.stringify({ ...base, sort: { key: 'week', dir: 'asc' } })).sort).toEqual({ key: 'week', dir: 'asc' });
  });

  it('missing fields read as defaults; unknown top-level keys are ignored', () => {
    const parsed = parseMatrixPrefs(JSON.stringify({ v: 1, mystery: 'future-field' }));
    expect(parsed).toEqual(emptyPanelPrefs());
  });

  it('a non-string key or absurd length is dropped everywhere', () => {
    const parsed = parseMatrixPrefs('{"v":1,"widths":{"":50,"debt":"wide"}}');
    expect(parsed.widths).toEqual({});
  });
});

describe('the storage contract - injected, silent, honest', () => {
  it('loadMatrixPrefs with no storage (SSR, tests) returns the calm empty prefs', () => {
    expect(loadMatrixPrefs(null)).toEqual(emptyPanelPrefs());
    expect(loadMatrixPrefs(undefined)).toEqual(emptyPanelPrefs());
  });

  it('a hostile storage (throwing getItem) degrades, never crashes', () => {
    const hostile = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {}, removeItem: () => {} };
    expect(loadMatrixPrefs(hostile)).toEqual(emptyPanelPrefs());
  });

  it('saveMatrixPrefs writes the canonical bytes through the ONE writer', () => {
    const store = fakeStorage();
    const saved = saveMatrixPrefs(store, { v: MATRIX_PREFS_VERSION, widths: { debt: 300 }, visible: { mpesa: false }, sort: { key: 'week', dir: 'desc' }, dense: true });
    expect(saved).toBe(true);
    const onDisk = JSON.parse(store.dump()[MATRIX_PREFS_KEY]);
    expect(onDisk).toEqual({ v: 1, widths: { debt: 300 }, visible: { mpesa: false }, sort: { key: 'week', dir: 'desc' }, dense: true });
  });

  it('a refused save (quota, privacy mode) returns false — never throws', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(saveMatrixPrefs(full, emptyPanelPrefs())).toBe(false);
    expect(saveMatrixPrefs(null, emptyPanelPrefs())).toBe(false);
  });

  it('saveMatrixPrefs re-sanitizes: what lands is always a payload the parser accepts back', () => {
    const store = fakeStorage();
    saveMatrixPrefs(store, { v: MATRIX_PREFS_VERSION, widths: { debt: 99999, junk: -1 }, visible: {}, sort: { key: 'debt', dir: 'sideways' as never }, dense: false });
    const round = parseMatrixPrefs(store.dump()[MATRIX_PREFS_KEY]);
    expect(round.widths).toEqual({ debt: 2000, junk: 40 });
    expect(round.sort).toBeNull();
  });

  it('clearMatrixPrefs removes the key when removeItem exists', () => {
    const store = fakeStorage({ [MATRIX_PREFS_KEY]: serializeMatrixPrefs(emptyPanelPrefs()) });
    expect(clearMatrixPrefs(store)).toBe(true);
    expect(store.dump()[MATRIX_PREFS_KEY]).toBeUndefined();
  });

  it('a removeItem-less storage gets the empty payload written over (an honest reset)', () => {
    const minimal = fakeStorage({ [MATRIX_PREFS_KEY]: serializeMatrixPrefs({ v: 1, widths: { debt: 300 }, visible: {}, sort: null, dense: true }) });
    const noRemove = { getItem: minimal.getItem, setItem: minimal.setItem };
    expect(clearMatrixPrefs(noRemove)).toBe(true);
    expect(JSON.parse(minimal.dump()[MATRIX_PREFS_KEY])).toEqual(emptyPanelPrefs());
  });

  it('a hostile clear returns false and the caller stays silent', () => {
    const hostile = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('SecurityError'); } };
    expect(clearMatrixPrefs(hostile)).toBe(false);
    expect(clearMatrixPrefs(null)).toBe(false);
  });
});

describe('the component contract - restore, write-back, and the two new controls', () => {
  it('the spine is imported from the ONE module (never re-derived in the component)', () => {
    expect(matrix).toContain("} from '@/lib/org/store-matrix-prefs';");
    expect(matrix).toContain('clearMatrixPrefs,');
    expect(matrix).toContain('loadMatrixPrefs,');
    expect(matrix).toContain('saveMatrixPrefs,');
    expect(matrix).toContain('MATRIX_PREFS_VERSION,');
  });

  it('the restore runs in a mount effect AFTER hydration — never during render', () => {
    expect(matrix).toContain('useEffect(() => {');
    expect(matrix).toContain('const prefs = loadMatrixPrefs(storage);');
    expect(matrix).toContain('setWidths(prefs.widths);');
    expect(matrix).toContain('setVisible(prefs.visible);');
    expect(matrix).toContain('setSortState(prefs.sort);');
    expect(matrix).toContain('setDense(prefs.dense);');
    expect(matrix).toContain('restored.current = true;');
    expect(matrix).toContain('const restored = useRef(false);');
  });

  it('the storage is SSR-guarded at every use site', () => {
    const guards = matrix.split("typeof window === 'undefined' ? null : window.localStorage").length - 1;
    expect(guards).toBeGreaterThanOrEqual(2);
  });

  it('the write-back is gated by the restored ref and debounced 250ms', () => {
    expect(matrix).toContain('if (!restored.current) return;');
    expect(matrix).toContain('}, 250);');
    expect(matrix).toContain('}, [widths, visible, sortState, dense]);');
  });

  it('the stock layout CLEARS the key; only a real choice saves', () => {
    expect(matrix).toContain('const stock =');
    expect(matrix).toContain('Object.keys(widths).length === 0 &&');
    expect(matrix).toContain('sortState === null &&');
    expect(matrix).toContain('dense === false;');
    expect(matrix).toContain('if (stock) clearMatrixPrefs(storage);');
    expect(matrix).toContain('else saveMatrixPrefs(storage, { v: MATRIX_PREFS_VERSION, widths, visible, sort: sortState, dense });');
  });

  it('the Compact toggle: aria-pressed, the orange pressed family, the dense override', () => {
    expect(matrix).toContain('aria-pressed={dense}');
    expect(matrix).toContain("${dense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}");
    expect(matrix).toContain('onClick={() => setDense((d) => !d)}');
    expect(matrix).toContain("<Table className={dense ? '[&_td]:px-2 [&_td]:py-1 [&_th]:h-8 [&_th]:py-1' : undefined}>");
    expect(matrix).toContain('<Rows3 className="mr-1 h-3 w-3" /> Compact');
  });

  it('the Columns menu: the persistence hint + the muted Reset layout item', () => {
    expect(matrix).toContain('Widths, hidden columns, sort and density save to this browser automatically.');
    expect(matrix).toContain('onSelect={resetLayout}');
    expect(matrix).toContain('<RotateCcw className="mr-2 h-3 w-3" /> Reset layout');
    expect(matrix).toContain("className=\"text-[11px] text-slate-500 focus:text-slate-800\"");
    expect(matrix).toContain('onToast(\'Matrix layout reset to defaults\');');
    expect(matrix).toContain('DropdownMenuSeparator');
  });

  it('the reset restores ALL FOUR dimensions to stock', () => {
    const reset = matrix.slice(matrix.indexOf('const resetLayout'), matrix.indexOf('};', matrix.indexOf('const resetLayout')));
    expect(reset).toContain('setWidths({});');
    expect(reset).toContain('setVisible({});');
    expect(reset).toContain('setSortState(null);');
    expect(reset).toContain('setDense(false);');
  });

  it('the v2.180.0 sort contract rides untouched — one comparator, two readers', () => {
    expect(matrix).toContain("import { nextSortState, sortMatrixRows, type MatrixSortState } from '@/lib/org/store-matrix-sort';");
    expect(matrix).toContain('() => sortMatrixRows(stores, sortState, (s) => trendById.get(s.id)?.weekTotal),');
    expect(matrix).toContain('sortedStores.map((s) => ({');
  });

  it('the lib is pure by construction — no window, no document, no clock', () => {
    expect(lib).not.toContain('window.');
    expect(lib).not.toContain('document.');
    expect(lib).not.toContain('Date.now');
    expect(lib).not.toContain('new Date');
  });
});

describe('docs and release surfaces', () => {
  it('multi-store-workspaces.md carries the matrix-remembers bullet and the KPI row', () => {
    expect(doc).toContain('- The matrix remembers (v2.181.0):');
    expect(doc).toContain('| Matrix · layout memory | v2.181.0 —');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.181.0] The matrix remembers');
    expect(changelog.indexOf('## [2.181.0]')).toBeLessThan(changelog.indexOf('## [2.180.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.181.0'");
    expect(whatsNew).toContain("title: 'The matrix remembers'");
    expect(whatsNew.indexOf('2.181.0')).toBeLessThan(whatsNew.indexOf('2.180.0'));
  });

  it('package.json leads 2.181.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.209.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.209.0');
    expect(pkg.mbumah.baseVersion).toBe('2.209.0');
    expect(pkg.scripts['verify:v2-181-0']).toBe('node scripts/verify-v2-181-0.mjs');
    expect(readRepo('scripts/verify-v2-181-0.mjs')).toContain('v2.181.0 verification');
  });

  it('the prior-round suites evolved their pkg pins to 2.181.0 (the treadmill tax, paid)', () => {
    for (const f of [
      'src/tests/trend-names-mover-v2174.test.ts',
      'src/tests/trend-doors-v2175.test.ts',
      'src/tests/expert-week-v2176.test.ts',
      'src/tests/branch-variance-v2177.test.ts',
      'src/tests/branches-csv-week-v2178.test.ts',
      'src/tests/store-matrix-week-v2179.test.ts',
      'src/tests/store-matrix-sort-v2180.test.ts',
    ]) {
      expect(readRepo(f)).toContain("expect(pkg.version).toBe('2.209.0');");
    }
  });

  it('the v2.180.0 comparator suite contract is untouched (the sort lib stays the ONE orderer)', () => {
    const sortLib = readRepo('src/lib/org/store-matrix-sort.ts');
    expect(sortLib).toContain('export function sortMatrixRows');
    expect(sortLib).toContain('if (missingA) return 1;');
  });
});
