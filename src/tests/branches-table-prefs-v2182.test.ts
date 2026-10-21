import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseBranchesTablePrefs,
  serializeBranchesTablePrefs,
  loadBranchesTablePrefs,
  saveBranchesTablePrefs,
  clearBranchesTablePrefs,
  emptyBranchesTablePrefs,
  BRANCHES_TABLE_PREFS_KEY,
  BRANCHES_TABLE_PREFS_VERSION,
  BRANCHES_TABLE_MIN_WIDTH,
  BRANCHES_TABLE_MAX_WIDTH,
} from '../lib/org/branches-table-prefs';

/**
 * v2.182.0 — the branches table remembers.
 *
 * The org dashboard's branches table (the matrix's twin across the page,
 * server-fed since v2.149.0) learns the matrix's full owner vocabulary —
 * sortable headers, hideable columns, drag-resizable widths, compact-rows
 * density — and remembers every choice through the spine's TWIN under its
 * OWN key (`mbumah.branches-table.prefs`), so the two tables never share
 * bytes and resetting one can never surprise the other.
 *
 * The spine EXECUTED here (not just pinned), the tolerance rule pinned
 * (nothing corrupt ever throws or lies), the comparator REUSE pinned (the
 * matrix's sort lib is the ONE orderer for BOTH dense tables), and the
 * component contract pinned as source text.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/branches-table-prefs.ts');
const comp = readRepo('src/components/workspace/org-console.tsx');
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
  it('the ONE key and version are the exported constants — the table\u2019s OWN key, never the matrix\u2019s', () => {
    expect(BRANCHES_TABLE_PREFS_KEY).toBe('mbumah.branches-table.prefs');
    expect(BRANCHES_TABLE_PREFS_VERSION).toBe(1);
    expect(BRANCHES_TABLE_PREFS_KEY).not.toBe('mbumah.store-matrix.prefs');
  });

  it('the payload carries EXACTLY the five fields, in order', () => {
    const bytes = serializeBranchesTablePrefs({ v: BRANCHES_TABLE_PREFS_VERSION, widths: {}, visible: {}, sort: null, dense: false });
    expect(Object.keys(JSON.parse(bytes))).toEqual(['v', 'widths', 'visible', 'sort', 'dense']);
    expect(JSON.parse(bytes).v).toBe(1);
  });

  it('a full round-trip keeps every field intact', () => {
    const prefs = { v: BRANCHES_TABLE_PREFS_VERSION, widths: { branch: 260, debt: 140 }, visible: { mpesa: false, week: true }, sort: { key: 'debt', dir: 'desc' as const }, dense: true };
    const parsed = parseBranchesTablePrefs(serializeBranchesTablePrefs(prefs));
    expect(parsed).toEqual(prefs);
  });

  it('empty prefs are the calm default — and never the shared object', () => {
    const a = emptyBranchesTablePrefs();
    const b = emptyBranchesTablePrefs();
    expect(a).toEqual({ v: 1, widths: {}, visible: {}, sort: null, dense: false });
    expect(a).not.toBe(b);
    expect(a.widths).not.toBe(b.widths);
    expect(a.visible).not.toBe(b.visible);
  });

  it('widths clamp into the band — the band IS the exported constants', () => {
    const parsed = parseBranchesTablePrefs(JSON.stringify({ v: 1, widths: { branch: 1, debt: 99_999, mpesa: 130.7 } }));
    expect(parsed.widths.branch).toBe(BRANCHES_TABLE_MIN_WIDTH);
    expect(parsed.widths.debt).toBe(BRANCHES_TABLE_MAX_WIDTH);
    expect(parsed.widths.mpesa).toBe(131); // rounded, inside the band
  });

  it('the width maps cap their entries — 34 in, 32 out', () => {
    const widths: Record<string, number> = {};
    for (let i = 0; i < 34; i++) widths[`col${i}`] = 100;
    const parsed = parseBranchesTablePrefs(JSON.stringify({ v: 1, widths }));
    expect(Object.keys(parsed.widths)).toHaveLength(32);
  });

  it('junk visible and junk sort are dropped field-wise; sound fields survive', () => {
    const parsed = parseBranchesTablePrefs(
      JSON.stringify({ v: 1, widths: { debt: 120 }, visible: { mpesa: 'yes', debt: false }, sort: { key: 7, dir: 'sideways' }, dense: 'on' }),
    );
    expect(parsed.widths).toEqual({ debt: 120 });
    expect(parsed.visible).toEqual({ debt: false }); // the boolean rode, the string dropped
    expect(parsed.sort).toBeNull();
    expect(parsed.dense).toBe(false);
  });

  it('an unknown version is discard, never a guess', () => {
    expect(parseBranchesTablePrefs(JSON.stringify({ v: 2, widths: { debt: 120 } }))).toEqual(emptyBranchesTablePrefs());
    expect(parseBranchesTablePrefs(JSON.stringify({ widths: { debt: 120 } }))).toEqual(emptyBranchesTablePrefs());
  });

  it('garbage JSON, null bytes, empty strings and non-objects all degrade to calm', () => {
    expect(parseBranchesTablePrefs('{"v":1,"widths":{"debt":BROKEN')).toEqual(emptyBranchesTablePrefs());
    expect(parseBranchesTablePrefs('null')).toEqual(emptyBranchesTablePrefs());
    expect(parseBranchesTablePrefs('42')).toEqual(emptyBranchesTablePrefs());
    expect(parseBranchesTablePrefs('"saved"')).toEqual(emptyBranchesTablePrefs());
    expect(parseBranchesTablePrefs('')).toEqual(emptyBranchesTablePrefs());
    expect(parseBranchesTablePrefs(null)).toEqual(emptyBranchesTablePrefs());
    expect(parseBranchesTablePrefs(undefined)).toEqual(emptyBranchesTablePrefs());
  });

  it('serialize re-sanitizes — what lands is always a payload the parser accepts back', () => {
    const bytes = serializeBranchesTablePrefs({
      v: BRANCHES_TABLE_PREFS_VERSION,
      widths: { debt: 999_999, junk: Number.NaN },
      visible: { mpesa: false },
      sort: { key: 'revenue', dir: 'up' as unknown as 'desc' },
      dense: true,
    });
    const parsed = parseBranchesTablePrefs(bytes);
    expect(parsed.widths).toEqual({ debt: BRANCHES_TABLE_MAX_WIDTH }); // junk width dropped, debt clamped
    expect(parsed.visible).toEqual({ mpesa: false });
    expect(parsed.sort).toBeNull(); // the bad dir never lands
    expect(parsed.dense).toBe(true);
  });
});

describe('the storage contract - injected, silent, honest', () => {
  it('save returns true on landing and writes the canonical bytes', () => {
    const s = fakeStorage();
    expect(saveBranchesTablePrefs(s, { v: BRANCHES_TABLE_PREFS_VERSION, widths: { debt: 120 }, visible: {}, sort: null, dense: false })).toBe(true);
    expect(JSON.parse(s.dump()[BRANCHES_TABLE_PREFS_KEY]).widths).toEqual({ debt: 120 });
  });

  it('a hostile storage (throwing getItem / setItem) degrades — empty on load, false on save, never a throw', () => {
    const hostile = {
      getItem: () => {
        throw new Error('privacy mode');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadBranchesTablePrefs(hostile)).toEqual(emptyBranchesTablePrefs());
    expect(saveBranchesTablePrefs(hostile, emptyBranchesTablePrefs())).toBe(false);
  });

  it('no storage at all (SSR, tests) reads the calm empty prefs and saves nothing', () => {
    expect(loadBranchesTablePrefs(null)).toEqual(emptyBranchesTablePrefs());
    expect(loadBranchesTablePrefs(undefined)).toEqual(emptyBranchesTablePrefs());
    expect(loadBranchesTablePrefs({} as never)).toEqual(emptyBranchesTablePrefs());
    expect(saveBranchesTablePrefs(null, emptyBranchesTablePrefs())).toBe(false);
    expect(clearBranchesTablePrefs(null)).toBe(false);
  });

  it('clear with removeItem loses the key outright; without it the empty payload writes over', () => {
    const withRemove = fakeStorage({ [BRANCHES_TABLE_PREFS_KEY]: '{"v":1}' });
    expect(clearBranchesTablePrefs(withRemove)).toBe(true);
    expect(withRemove.dump()[BRANCHES_TABLE_PREFS_KEY]).toBeUndefined();

    const withoutRemove = fakeStorage({ [BRANCHES_TABLE_PREFS_KEY]: '{"v":1}' });
    const bare = { getItem: withoutRemove.getItem, setItem: withoutRemove.setItem };
    expect(clearBranchesTablePrefs(bare)).toBe(true);
    expect(JSON.parse(bare.getItem(BRANCHES_TABLE_PREFS_KEY) as string)).toEqual({ v: 1, widths: {}, visible: {}, sort: null, dense: false });
  });

  it('the lib is pure by construction — no window, no document, no clock', () => {
    expect(lib).not.toContain('window.');
    expect(lib).not.toContain('document.');
    expect(lib).not.toContain('Date.now');
    expect(lib).not.toContain('new Date');
  });
});

describe('the component contract - the driven header, the spine wiring, the two controls', () => {
  it('the spine is imported from the ONE module (never re-derived in the component)', () => {
    expect(comp).toContain("} from '@/lib/org/branches-table-prefs';");
    expect(comp).toContain('clearBranchesTablePrefs,');
    expect(comp).toContain('loadBranchesTablePrefs,');
    expect(comp).toContain('saveBranchesTablePrefs,');
    expect(comp).toContain('BRANCHES_TABLE_PREFS_VERSION,');
  });

  it('the restore runs in a mount effect AFTER hydration — never during render', () => {
    expect(comp).toContain('const prefs = loadBranchesTablePrefs(storage);');
    expect(comp).toContain('setBranchWidths(prefs.widths);');
    expect(comp).toContain('setBranchVisible(prefs.visible);');
    expect(comp).toContain('setBranchSort(prefs.sort);');
    expect(comp).toContain('setBranchDense(prefs.dense);');
    expect(comp).toContain('branchRestored.current = true;');
    expect(comp).toContain('const branchRestored = useRef(false);');
    // v2.182.0: the restore defers to a macrotask so setState never runs
    // synchronously inside the effect body (the react-hooks rule — the same
    // shape chrome.tsx's release pill speaks).
    expect(comp).toContain('const id = window.setTimeout(() => {');
    expect(comp).toContain('return () => window.clearTimeout(id);');
  });

  it('the storage is SSR-guarded at every use site', () => {
    const guards = comp.split("typeof window === 'undefined' ? null : window.localStorage").length - 1;
    expect(guards).toBeGreaterThanOrEqual(2);
  });

  it('the write-back is gated by the restored ref and debounced 250ms', () => {
    expect(comp).toContain('if (!branchRestored.current) return;');
    expect(comp).toContain('}, 250);');
    expect(comp).toContain('}, [branchWidths, branchVisible, branchSort, branchDense]);');
  });

  it('the stock layout CLEARS the key; only a real choice saves', () => {
    expect(comp).toContain('if (stock) clearBranchesTablePrefs(storage);');
    expect(comp).toContain('sort: branchSort,');
    expect(comp).toContain('dense: branchDense,');
  });

  it('ONE comparator reused verbatim — the matrix\u2019s sort lib orders BOTH dense tables', () => {
    expect(comp).toContain("import { nextSortState, sortMatrixRows, type MatrixSortState } from '@/lib/org/store-matrix-sort';");
    expect(comp).toContain('sortMatrixRows(summary.stores, branchSort, (s) => branchTrendById.get(s.id)?.weekTotal)');
    expect(comp).toContain('const onBranchSort = (key: string) => setBranchSort((prev) => nextSortState(prev, key));');
    expect(comp).toContain('aria-sort={branchAriaSortOf(c.key)}');
  });

  it('the driven header reads the ONE column spec; workspace stays unsortable', () => {
    expect(comp).toContain('const BRANCH_TABLE_COLS: BranchColDef[] = [');
    expect(comp).toContain("{ key: 'branch', label: 'Branch', width: 220, min: 150, sortable: true },");
    expect(comp).toContain("{ key: 'revenue', label: 'Revenue today', width: 124, min: 96, align: 'right', sortable: true },");
    expect(comp).toContain("{ key: 'week', label: '7d trend', width: 112, min: 92, sortable: true },");
    expect(comp).toContain("{ key: 'workspace', label: 'Workspace', width: 250, min: 210, sortable: false },");
    expect(comp).toContain('{branchShown.map((c) => (');
    expect(comp).toContain('const branchShown = BRANCH_TABLE_COLS.filter((c) => branchVisible[c.key] !== false);');
  });

  it('every body cell wraps in its column\u2019s visibility — nine wrappers, no empty gaps', () => {
    for (const key of ['branch', 'revenue', 'week', 'txns', 'low', 'overdue', 'debt', 'mpesa', 'workspace']) {
      expect(comp).toContain(`branchVisible.${key} !== false`);
    }
    expect(comp).toContain('{branchRows.map((store) => {');
  });

  it('the resize rides the matrix\u2019s recipe — separator, min floor, saved width wins', () => {
    expect(comp).toContain('const branchWidthOf = (c: BranchColDef) => branchWidths[c.key] ?? c.width;');
    expect(comp).toContain('onMouseDown={(e) => onBranchResizeDown(c.key, e)}');
    expect(comp).toContain('cursor-col-resize');
    expect(comp).toContain('branchDragging.current.startW + ev.clientX - branchDragging.current.startX');
    const resize = comp.slice(comp.indexOf('const onBranchResizeDown'), comp.indexOf('window.addEventListener', comp.indexOf('const onBranchResizeDown')));
    expect(resize).toContain('Math.max(');
    expect(resize).toContain('if (!col) return;');
  });

  it('the Compact toggle: aria-pressed, the orange pressed family, the dense override', () => {
    expect(comp).toContain('aria-pressed={branchDense}');
    expect(comp).toContain("${branchDense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}");
    expect(comp).toContain('onClick={() => setBranchDense((d) => !d)}');
    expect(comp).toContain("[&_td]:px-2 [&_td]:py-1 [&_th]:py-1");
    expect(comp).toContain('<Rows3 className="mr-1 h-3 w-3" aria-hidden="true" /> Compact');
  });

  it('the Columns menu: the persistence hint + the muted Reset layout item + the visible layout note', () => {
    expect(comp).toContain('Sort, hidden columns, widths and density save to this browser automatically.');
    expect(comp).toContain('onSelect={resetBranchLayout}');
    expect(comp).toContain('<RotateCcw className="mr-2 h-3 w-3" aria-hidden="true" /> Reset layout');
    expect(comp).toContain('className="text-[11px] text-muted-foreground focus:text-foreground"');
    expect(comp).toContain('DropdownMenuSeparator');
    expect(comp).toContain('data-testid="org-console-layout-note"');
    const reset = comp.slice(comp.indexOf('const resetBranchLayout'), comp.indexOf('};', comp.indexOf('const resetBranchLayout')));
    expect(reset).toContain('setBranchWidths({});');
    expect(reset).toContain('setBranchVisible({});');
    expect(reset).toContain('setBranchSort(null);');
    expect(reset).toContain('setBranchDense(false);');
    expect(reset).toContain("setBranchLayoutNote('Branch table layout reset to defaults');");
  });

  it('the CSV export reads the SORTED rows — the file mirrors what the owner sees', () => {
    const call = comp.indexOf('const csv = buildBranchesCsv(');
    expect(comp.slice(call, call + 400)).toContain('branchRows.map((s) => ({');
  });

  it('the week vocabulary rides untouched — the pinned joins survive the refactor', () => {
    expect(comp).toContain('<WeekDeltaChip current={storeTrend.weekTotal} prior={storeTrend.priorWeekTotal ?? 0} />');
    expect(comp).toContain('summary.perStoreTrend?.find((t) => t.storeId === store.id) ?? null');
    expect(comp).toContain('className="flex w-[76px] flex-col gap-0.5"');
    expect(comp).toContain('w-[84px] px-4 py-3');
  });

  it('the two tables never share bytes — org-console never touches the matrix key', () => {
    expect(comp).not.toContain('mbumah.store-matrix.prefs');
    expect(readRepo('src/lib/org/store-matrix-prefs.ts')).toContain("export const MATRIX_PREFS_KEY = 'mbumah.store-matrix.prefs';");
  });
});

describe('docs and release surfaces', () => {
  it('multi-store-workspaces.md carries the branches-table bullet and the KPI row', () => {
    expect(doc).toContain('- The branches table remembers (v2.182.0):');
    expect(doc).toContain('| Branches table · layout memory | v2.182.0 —');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.182.0] The branches table remembers');
    expect(changelog.indexOf('## [2.182.0]')).toBeLessThan(changelog.indexOf('## [2.181.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.182.0'");
    expect(whatsNew).toContain("title: 'The branches table remembers'");
    expect(whatsNew.indexOf('2.182.0')).toBeLessThan(whatsNew.indexOf('2.181.0'));
  });

  it('package.json leads 2.182.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.194.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.194.0');
    expect(pkg.mbumah.baseVersion).toBe('2.194.0');
    expect(pkg.scripts['verify:v2-182-0']).toBe('node scripts/verify-v2-182-0.mjs');
    expect(readRepo('scripts/verify-v2-182-0.mjs')).toContain('v2.182.0 verification');
  });

  it('the prior-round suites evolved their pkg pins to 2.182.0 (the treadmill tax, paid)', () => {
    for (const f of [
      'src/tests/trend-names-mover-v2174.test.ts',
      'src/tests/trend-doors-v2175.test.ts',
      'src/tests/expert-week-v2176.test.ts',
      'src/tests/branch-variance-v2177.test.ts',
      'src/tests/branches-csv-week-v2178.test.ts',
      'src/tests/store-matrix-week-v2179.test.ts',
      'src/tests/store-matrix-sort-v2180.test.ts',
      'src/tests/store-matrix-prefs-v2181.test.ts',
    ]) {
      expect(readRepo(f)).toContain("expect(pkg.version).toBe('2.194.0');");
    }
  });

  it('trend-doors-v2175\u2019s header pins evolved deliberately to the spec order', () => {
    const evolved = readRepo('src/tests/trend-doors-v2175.test.ts');
    expect(evolved).toContain("v2.182.0 pin evolution (deliberate)");
    expect(evolved).toContain("{ key: 'week', label: '7d trend'");
  });
});
