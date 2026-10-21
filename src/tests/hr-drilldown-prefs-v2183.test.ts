import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseHrDrilldownPrefs,
  serializeHrDrilldownPrefs,
  loadHrDrilldownPrefs,
  saveHrDrilldownPrefs,
  clearHrDrilldownPrefs,
  emptyHrDrilldownPrefs,
  HR_DRILLDOWN_PREFS_KEY,
  HR_DRILLDOWN_PREFS_VERSION,
} from '../lib/org/hr-drilldown-prefs';
import {
  defaultDirFor,
  toggledDir,
  nextSortState,
  sortHrDrillRows,
  HR_DRILL_NUMERIC_COLUMNS,
  HR_DRILL_TEXT_COLUMNS,
  type HrDrillSortRow,
} from '../lib/org/hr-drilldown-sort';

/**
 * v2.183.0 — the drill-down remembers.
 *
 * The org dashboard's HR drill-down ("People & payroll by branch") — the
 * console's THIRD dense table since v2.23.0 — learns the owner vocabulary
 * its two siblings already speak: a sortable driven header (its OWN pure
 * comparator, the sibling of the matrix's), a Compact-rows density, and a
 * versioned, corrupt-tolerant localStorage spine under its OWN key
 * (`mbumah.hr-drilldown.prefs`) that remembers the open door, the sort and
 * the density across reloads. The three tables never share bytes, so
 * resetting one can never surprise the others.
 *
 * The spine EXECUTED here (not just pinned), the tolerance rule pinned
 * (nothing corrupt ever throws or lies), the comparator EXECUTED (numbers
 * loudest-first, text A→Z, the payroll column by STATUS RANK since
 * v2.190.0 — the badge the cell wears — with a branch that has no payroll
 * run sorting LAST in both directions), the restraint pinned (FOUR
 * fields, not six — the honest scope of a collapsed-by-design six-column
 * table), and the component contract pinned as source text.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/hr-drilldown-prefs.ts');
const sortLib = readRepo('src/lib/org/hr-drilldown-sort.ts');
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

const row = (over: Partial<HrDrillSortRow>): HrDrillSortRow => ({
  storeId: 's',
  storeName: 'Branch',
  headcountActive: 0,
  monthEmploymentCost: 0,
  monthAbsenceRatePct: 0,
  latestPayroll: null,
  expiryAlerts: { documentsExpiring90Days: 0, assetsOverdue: 0 },
  ...over,
});

describe('the spine executed - serialize and parse', () => {
  it('the ONE key and version are the exported constants — the drill-down\u2019s OWN key, never its siblings\u2019', () => {
    expect(HR_DRILLDOWN_PREFS_KEY).toBe('mbumah.hr-drilldown.prefs');
    expect(HR_DRILLDOWN_PREFS_VERSION).toBe(1);
    expect(HR_DRILLDOWN_PREFS_KEY).not.toBe('mbumah.store-matrix.prefs');
    expect(HR_DRILLDOWN_PREFS_KEY).not.toBe('mbumah.branches-table.prefs');
  });

  it('the payload carries EXACTLY the four fields, in order — the honest restraint, pinned', () => {
    const bytes = serializeHrDrilldownPrefs({ v: HR_DRILLDOWN_PREFS_VERSION, open: false, sort: null, dense: false });
    expect(Object.keys(JSON.parse(bytes))).toEqual(['v', 'open', 'sort', 'dense']);
    expect(JSON.parse(bytes).v).toBe(1);
  });

  it('a full round-trip keeps every field intact', () => {
    const prefs = { v: HR_DRILLDOWN_PREFS_VERSION, open: true, sort: { key: 'alerts', dir: 'desc' as const }, dense: true };
    const parsed = parseHrDrilldownPrefs(serializeHrDrilldownPrefs(prefs));
    expect(parsed).toEqual(prefs);
  });

  it('empty prefs are the calm default — and never the shared object', () => {
    const a = emptyHrDrilldownPrefs();
    const b = emptyHrDrilldownPrefs();
    expect(a).toEqual({ v: 1, open: false, sort: null, dense: false });
    expect(a).not.toBe(b);
    // mutating one copy never leaks into the other (a mutated sort is a NEW
    // object — the lib hands out fresh copies, never the shared shape)
    a.sort = { key: 'cost', dir: 'desc' };
    expect(b.sort).toBeNull();
  });

  it('junk open, sort and dense are dropped field-wise; sound fields survive', () => {
    const parsed = parseHrDrilldownPrefs(
      JSON.stringify({ v: 1, open: 'yes', sort: { key: 7, dir: 'sideways' }, dense: 'on' }),
    );
    expect(parsed.open).toBe(false);
    expect(parsed.sort).toBeNull();
    expect(parsed.dense).toBe(false);
    const kept = parseHrDrilldownPrefs(
      JSON.stringify({ v: 1, open: true, junk: 'ignored', dense: true }),
    );
    expect(kept.open).toBe(true);
    expect(kept.dense).toBe(true);
  });

  it('an over-long sort key is dropped — the bounded fence holds', () => {
    const parsed = parseHrDrilldownPrefs(
      JSON.stringify({ v: 1, sort: { key: 'k'.repeat(49), dir: 'asc' } }),
    );
    expect(parsed.sort).toBeNull();
  });

  it('an unknown version is discard, never a guess', () => {
    expect(parseHrDrilldownPrefs(JSON.stringify({ v: 2, open: true }))).toEqual(emptyHrDrilldownPrefs());
    expect(parseHrDrilldownPrefs(JSON.stringify({ open: true }))).toEqual(emptyHrDrilldownPrefs());
  });

  it('garbage JSON, null bytes, empty strings and non-objects all degrade to calm', () => {
    expect(parseHrDrilldownPrefs('{"v":1,"open":BROKEN')).toEqual(emptyHrDrilldownPrefs());
    expect(parseHrDrilldownPrefs('null')).toEqual(emptyHrDrilldownPrefs());
    expect(parseHrDrilldownPrefs('42')).toEqual(emptyHrDrilldownPrefs());
    expect(parseHrDrilldownPrefs('"saved"')).toEqual(emptyHrDrilldownPrefs());
    expect(parseHrDrilldownPrefs('')).toEqual(emptyHrDrilldownPrefs());
    expect(parseHrDrilldownPrefs(null)).toEqual(emptyHrDrilldownPrefs());
    expect(parseHrDrilldownPrefs(undefined)).toEqual(emptyHrDrilldownPrefs());
  });

  it('serialize re-sanitizes — what lands is always a payload the parser accepts back', () => {
    const bytes = serializeHrDrilldownPrefs({
      v: HR_DRILLDOWN_PREFS_VERSION,
      open: true,
      sort: { key: 'headcount', dir: 'up' as unknown as 'desc' },
      dense: true,
    });
    const parsed = parseHrDrilldownPrefs(bytes);
    expect(parsed.open).toBe(true);
    expect(parsed.sort).toBeNull(); // the bad dir never lands
    expect(parsed.dense).toBe(true);
  });
});

describe('the storage contract - injected, silent, honest', () => {
  it('save returns true on landing and writes the canonical bytes', () => {
    const s = fakeStorage();
    expect(saveHrDrilldownPrefs(s, { v: HR_DRILLDOWN_PREFS_VERSION, open: true, sort: null, dense: false })).toBe(true);
    expect(JSON.parse(s.dump()[HR_DRILLDOWN_PREFS_KEY]).open).toBe(true);
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
    expect(loadHrDrilldownPrefs(hostile)).toEqual(emptyHrDrilldownPrefs());
    expect(saveHrDrilldownPrefs(hostile, emptyHrDrilldownPrefs())).toBe(false);
  });

  it('no storage at all (SSR, tests) reads the calm empty prefs and saves nothing', () => {
    expect(loadHrDrilldownPrefs(null)).toEqual(emptyHrDrilldownPrefs());
    expect(loadHrDrilldownPrefs(undefined)).toEqual(emptyHrDrilldownPrefs());
    expect(loadHrDrilldownPrefs({} as never)).toEqual(emptyHrDrilldownPrefs());
    expect(saveHrDrilldownPrefs(null, emptyHrDrilldownPrefs())).toBe(false);
    expect(clearHrDrilldownPrefs(null)).toBe(false);
  });

  it('clear with removeItem loses the key outright; without it the empty payload writes over', () => {
    const withRemove = fakeStorage({ [HR_DRILLDOWN_PREFS_KEY]: '{"v":1}' });
    expect(clearHrDrilldownPrefs(withRemove)).toBe(true);
    expect(withRemove.dump()[HR_DRILLDOWN_PREFS_KEY]).toBeUndefined();

    const withoutRemove = fakeStorage({ [HR_DRILLDOWN_PREFS_KEY]: '{"v":1}' });
    const bare = { getItem: withoutRemove.getItem, setItem: withoutRemove.setItem };
    expect(clearHrDrilldownPrefs(bare)).toBe(true);
    expect(JSON.parse(bare.getItem(HR_DRILLDOWN_PREFS_KEY) as string)).toEqual({ v: 1, open: false, sort: null, dense: false });
  });

  it('both libs are pure by construction — no window, no document, no clock', () => {
    for (const src of [lib, sortLib]) {
      expect(src).not.toContain('window.');
      expect(src).not.toContain('document.');
      expect(src).not.toContain('Date.now');
      expect(src).not.toContain('new Date');
    }
  });

  it('the restraint is written down — the lib header says WHY the payload has no widths/visible', () => {
    expect(lib).toContain('THE HONEST RESTRAINT');
    expect(lib).toContain('collapsed-by-design');
  });
});

describe('the comparator executed - the drill-down sort lib', () => {
  it('the vocabulary is exported — four numeric, one text, one rank (v2.190.0 moved payroll out of TEXT)', () => {
    expect([...HR_DRILL_NUMERIC_COLUMNS]).toEqual(['headcount', 'cost', 'absence', 'alerts']);
    // v2.190.0 pin evolution (deliberate): the payroll column sorts by the
    // status badge's finality ladder now, not by periodName text — it left
    // HR_DRILL_TEXT_COLUMNS for HR_DRILL_RANK_COLUMNS (reasoning comment
    // where the pin lives; the full rank semantics live in the v2190 suite).
    expect([...HR_DRILL_TEXT_COLUMNS]).toEqual(['branch']);
    expect(defaultDirFor('alerts')).toBe('desc');
    expect(defaultDirFor('headcount')).toBe('desc');
    expect(defaultDirFor('cost')).toBe('desc');
    expect(defaultDirFor('absence')).toBe('desc');
    expect(defaultDirFor('branch')).toBe('asc');
    // v2.190.0 pin evolution (deliberate): a fresh payroll click wants the
    // SETTLED branches on top — most-final first — so the default flipped
    // from the text column's asc to the rank column's desc.
    expect(defaultDirFor('payroll')).toBe('desc');
    expect(defaultDirFor('mystery')).toBe('asc'); // total, never guessed
  });

  it('click semantics: a new column starts at its default, the same column flips', () => {
    expect(nextSortState(null, 'cost')).toEqual({ key: 'cost', dir: 'desc' });
    expect(nextSortState({ key: 'cost', dir: 'desc' }, 'cost')).toEqual({ key: 'cost', dir: 'asc' });
    expect(nextSortState({ key: 'cost', dir: 'desc' }, 'branch')).toEqual({ key: 'branch', dir: 'asc' });
    expect(toggledDir('asc')).toBe('desc');
  });

  it('numbers sort loudest-first on a fresh click — alerts sums BOTH counters, the cell\u2019s own number', () => {
    const rows = [
      row({ storeId: 'a', expiryAlerts: { documentsExpiring90Days: 1, assetsOverdue: 0 } }),
      row({ storeId: 'b', expiryAlerts: { documentsExpiring90Days: 2, assetsOverdue: 4 } }),
      row({ storeId: 'c', expiryAlerts: { documentsExpiring90Days: 0, assetsOverdue: 9 } }),
    ];
    const sorted = sortHrDrillRows(rows, { key: 'alerts', dir: 'desc' });
    expect(sorted.map((r) => r.storeId)).toEqual(['c', 'b', 'a']);
    expect(sortHrDrillRows(rows, { key: 'alerts', dir: 'asc' }).map((r) => r.storeId)).toEqual(['a', 'b', 'c']);
  });

  it('headcount, cost and absence sort by their own fields', () => {
    const rows = [
      row({ storeId: 'a', headcountActive: 3, monthEmploymentCost: 300, monthAbsenceRatePct: 4 }),
      row({ storeId: 'b', headcountActive: 9, monthEmploymentCost: 100, monthAbsenceRatePct: 12 }),
      row({ storeId: 'c', headcountActive: 1, monthEmploymentCost: 200, monthAbsenceRatePct: 8 }),
    ];
    expect(sortHrDrillRows(rows, { key: 'headcount', dir: 'desc' }).map((r) => r.storeId)).toEqual(['b', 'a', 'c']);
    expect(sortHrDrillRows(rows, { key: 'cost', dir: 'desc' }).map((r) => r.storeId)).toEqual(['a', 'c', 'b']);
    expect(sortHrDrillRows(rows, { key: 'absence', dir: 'desc' }).map((r) => r.storeId)).toEqual(['b', 'c', 'a']);
  });

  it('branch sorts A→Z through storeName', () => {
    const rows = [row({ storeName: 'Thika Town' }), row({ storeName: 'Juja Main' }), row({ storeName: 'Makongeni' })];
    expect(sortHrDrillRows(rows, { key: 'branch', dir: 'asc' }).map((r) => r.storeName)).toEqual(['Juja Main', 'Makongeni', 'Thika Town']);
    expect(sortHrDrillRows(rows, { key: 'branch', dir: 'desc' }).map((r) => r.storeName)).toEqual(['Thika Town', 'Makongeni', 'Juja Main']);
  });

  it('payroll sorts through the latestPayroll join by STATUS RANK — a branch with NO run still sorts LAST in BOTH directions', () => {
    // v2.190.0 pin evolution (deliberate): the v2.183.0 join sorted by
    // periodName text (a fragile recency proxy); the primary axis is the
    // badge's finality ladder now, with createdAt/periodName tie-breaks —
    // the full rank semantics live in hr-drilldown-rank-v2190. This suite
    // keeps the rule that outlived the change: missing runs last, both
    // directions, and the join still reads the SAME latestPayroll field.
    const rows = [
      row({ storeId: 'a', latestPayroll: { periodName: 'October 2026', status: 'DRAFT', createdAt: '2026-10-01T09:00:00Z' } }),
      row({ storeId: 'b', latestPayroll: null }),
      row({ storeId: 'c', latestPayroll: { periodName: 'August 2026', status: 'POSTED', createdAt: '2026-08-01T09:00:00Z' } }),
      row({ storeId: 'd', latestPayroll: null }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'asc' }).map((r) => r.storeId)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('null state returns arrival order, COPIED; ties keep arrival order; an unknown key never sorts', () => {
    const rows = [row({ storeId: 'a' }), row({ storeId: 'b' })];
    const copy = sortHrDrillRows(rows, null);
    expect(copy).toEqual(rows);
    expect(copy).not.toBe(rows);
    const tied = [row({ storeId: 'x', headcountActive: 5 }), row({ storeId: 'y', headcountActive: 5 })];
    expect(sortHrDrillRows(tied, { key: 'headcount', dir: 'desc' }).map((r) => r.storeId)).toEqual(['x', 'y']);
    expect(sortHrDrillRows(rows, { key: 'mystery', dir: 'desc' })).toEqual(rows);
  });
});

describe('the component contract - the driven header, the spine wiring, the controls', () => {
  it('both libs are imported from their ONE modules (never re-derived in the component)', () => {
    expect(comp).toContain("} from '@/lib/org/hr-drilldown-sort';");
    expect(comp).toContain('nextSortState as nextHrSortState,');
    expect(comp).toContain('sortHrDrillRows,');
    expect(comp).toContain("} from '@/lib/org/hr-drilldown-prefs';");
    expect(comp).toContain('HR_DRILLDOWN_PREFS_VERSION,');
    expect(comp).toContain('clearHrDrilldownPrefs,');
    expect(comp).toContain('loadHrDrilldownPrefs,');
    expect(comp).toContain('saveHrDrilldownPrefs,');
  });

  it('the ONE column spec drives the header — six sortable columns with their stock rhythm', () => {
    expect(comp).toContain('const HR_DRILLDOWN_COLS: HrDrillColDef[] = [');
    expect(comp).toContain("{ key: 'branch', label: 'Branch', pad: 'px-3.5', sortable: true },");
    expect(comp).toContain("{ key: 'headcount', label: 'Headcount', align: 'right', pad: 'px-3', sortable: true },");
    expect(comp).toContain("{ key: 'cost', label: 'Cost (month)', align: 'right', pad: 'px-3', sortable: true },");
    expect(comp).toContain("{ key: 'absence', label: 'Absence', align: 'right', pad: 'px-3', sortable: true },");
    // v2.190.0 pin evolution (deliberate): the payroll entry grew the
    // honest `hint` line (the rank semantics, spoken as the button's
    // title) and became a multi-line object — the pin follows the shape.
    expect(comp).toContain("key: 'payroll',");
    expect(comp).toContain("label: 'Latest payroll',");
    expect(comp).toContain("title={c.hint}");
    expect(comp).toContain("{ key: 'alerts', label: 'Expiry alerts', align: 'right', pad: 'px-3', sortable: true },");
    expect(comp).toContain('{HR_DRILLDOWN_COLS.map((c) => (');
    expect(comp).toContain('aria-sort={hrAriaSortOf(c.key)}');
  });

  it('ONE comparator, ONE order for the body AND the CSV — the v2.180.0 rule across all three tables', () => {
    expect(comp).toContain('() => (summary?.hrPerStore ? sortHrDrillRows(summary.hrPerStore, hrSort) : []),');
    expect(comp).toContain("const onHrSort = (key: string) => setHrSort((prev) => nextHrSortState(prev, key));");
    expect(comp).toContain('{hrRows.map((row) => {');
    const call = comp.indexOf('hrRows.map((r) => ({');
    expect(call).toBeGreaterThan(comp.indexOf('const csv = buildBranchesCsv('));
  });

  it('the glyph is REUSED, not re-invented — one sort language across all three tables', () => {
    expect(comp).toContain("<BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />");
    expect(comp).toContain("<BranchSortGlyph state={branchSort?.key === c.key ? branchSort.dir : 'none'} />");
  });

  it('the restore runs in a mount effect AFTER hydration — the macrotask deferral, the house pattern', () => {
    expect(comp).toContain('const prefs = loadHrDrilldownPrefs(storage);');
    expect(comp).toContain('setHrPerStoreOpen(prefs.open);');
    expect(comp).toContain('setHrSort(prefs.sort);');
    expect(comp).toContain('setHrDense(prefs.dense);');
    expect(comp).toContain('hrRestored.current = true;');
    expect(comp).toContain('const hrRestored = useRef(false);');
    expect(comp).toContain('const id = window.setTimeout(() => {');
    expect(comp).toContain('return () => window.clearTimeout(id);');
  });

  it('the storage is SSR-guarded at every use site', () => {
    const guards = comp.split("typeof window === 'undefined' ? null : window.localStorage").length - 1;
    expect(guards).toBeGreaterThanOrEqual(4);
  });

  it('the write-back is gated by the restored ref and debounced 250ms; stock CLEARS the key', () => {
    expect(comp).toContain('if (!hrRestored.current) return;');
    expect(comp).toContain('const stock = !hrPerStoreOpen && hrSort === null && hrDense === false;');
    expect(comp).toContain('if (stock) clearHrDrilldownPrefs(storage);');
    expect(comp).toContain('open: hrPerStoreOpen,');
    expect(comp).toContain('sort: hrSort,');
    expect(comp).toContain('dense: hrDense,');
    // v2.184.0 pin evolution (deliberate): the deps carry the restore tick —
    // the post-restore pulse that walks the stock fork even when the restore
    // changed nothing by reference, so corrupt bytes self-heal to absent
    // (the siblings' behavior: their restore always hands back a FRESH
    // widths object; the drill-down has none by the documented restraint).
    expect(comp).toContain('}, [hrRestoreTick, hrPerStoreOpen, hrSort, hrDense]);');
    expect(comp).toContain('setHrRestoreTick((t) => t + 1);');
    expect(comp).toContain('const [hrRestoreTick, setHrRestoreTick] = useState(0);');
  });

  it('the header row is a legal tree — the controls are SIBLINGS of the door button, never children', () => {
    expect(comp).toContain('<div className="flex items-stretch justify-between gap-2 bg-muted/40">');
    expect(comp).toContain('className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"');
    expect(comp).toContain('· layout saves to this browser');
  });

  it('the Compact toggle: aria-pressed, the orange pressed family, the dense override', () => {
    expect(comp).toContain('aria-pressed={hrDense}');
    expect(comp).toContain("${hrDense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}");
    expect(comp).toContain('onClick={() => setHrDense((d) => !d)}');
    expect(comp).toContain("<table className={`w-full text-sm${hrDense ? ' [&_td]:px-2 [&_td]:py-1 [&_th]:py-1' : ''}`}>");
  });

  it('Reset appears only when there is something to reset; the note is the polite confirmation', () => {
    expect(comp).toContain('{hrSort !== null || hrDense ? (');
    expect(comp).toContain('onClick={resetHrDrillLayout}');
    expect(comp).toContain('data-testid="org-console-hr-note"');
    const reset = comp.slice(comp.indexOf('const resetHrDrillLayout'), comp.indexOf('};', comp.indexOf('const resetHrDrillLayout')));
    expect(reset).toContain('setHrSort(null);');
    expect(reset).toContain('setHrDense(false);');
    expect(reset).toContain("setHrLayoutNote('Drill-down layout reset to defaults');");
  });

  it('the three tables never share bytes — the component never inlines ANY spine key', () => {
    expect(comp).not.toContain('mbumah.store-matrix.prefs');
    expect(comp).not.toContain('mbumah.branches-table.prefs');
    expect(comp).not.toContain('mbumah.hr-drilldown.prefs');
    expect(readRepo('src/lib/org/store-matrix-prefs.ts')).toContain("export const MATRIX_PREFS_KEY = 'mbumah.store-matrix.prefs';");
    expect(readRepo('src/lib/org/branches-table-prefs.ts')).toContain("export const BRANCHES_TABLE_PREFS_KEY = 'mbumah.branches-table.prefs';");
    expect(lib).toContain("export const HR_DRILLDOWN_PREFS_KEY = 'mbumah.hr-drilldown.prefs';");
  });

  it('the v2.149.0 scroll region and the payroll cell vocabulary ride untouched', () => {
    expect(comp).toContain('aria-label="People and payroll by branch, scrollable table"');
    expect(comp).toContain('max-h-96 min-w-0 overflow-x-auto overflow-y-auto');
    expect(comp).toContain('no runs yet');
    expect(comp).toContain('hover:bg-muted/30');
  });
});

describe('docs and release surfaces', () => {
  it('multi-store-workspaces.md carries the drill-down bullet and the KPI row', () => {
    expect(doc).toContain('- The drill-down remembers (v2.183.0):');
    expect(doc).toContain('| HR drill-down · layout memory | v2.183.0 —');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.183.0] The drill-down remembers');
    expect(changelog.indexOf('## [2.183.0]')).toBeLessThan(changelog.indexOf('## [2.182.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.183.0'");
    expect(whatsNew).toContain("title: 'The drill-down remembers'");
    expect(whatsNew.indexOf('2.183.0')).toBeLessThan(whatsNew.indexOf('2.182.0'));
  });

  it('package.json leads 2.190.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.202.1');
    expect(pkg.mbumah.releaseVersion).toBe('2.202.1');
    expect(pkg.mbumah.baseVersion).toBe('2.202.1');
    expect(pkg.scripts['verify:v2-183-0']).toBe('node scripts/verify-v2-183-0.mjs');
    expect(readRepo('scripts/verify-v2-183-0.mjs')).toContain('v2.183.0 verification');
  });

  it('the prior-round suites evolved their pkg pins to 2.183.0 (the treadmill tax, paid)', () => {
    for (const f of [
      'src/tests/trend-names-mover-v2174.test.ts',
      'src/tests/trend-doors-v2175.test.ts',
      'src/tests/expert-week-v2176.test.ts',
      'src/tests/branch-variance-v2177.test.ts',
      'src/tests/branches-csv-week-v2178.test.ts',
      'src/tests/store-matrix-week-v2179.test.ts',
      'src/tests/store-matrix-sort-v2180.test.ts',
      'src/tests/store-matrix-prefs-v2181.test.ts',
      'src/tests/branches-table-prefs-v2182.test.ts',
    ]) {
      expect(readRepo(f)).toContain("expect(pkg.version).toBe('2.202.1');");
    }
  });
});
