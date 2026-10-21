import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sortMatrixRows,
  nextSortState,
  defaultDirFor,
  toggledDir,
  MATRIX_NUMERIC_COLUMNS,
  MATRIX_TEXT_COLUMNS,
  type MatrixSortRow,
  type MatrixSortState,
} from '../lib/org/store-matrix-sort';

/**
 * v2.180.0 — the matrix learns to sort.
 *
 * The matrix has been resizable, hideable and exportable (v2.179.0's
 * offline twin) — but its rows only ever appeared in the API's arrival
 * order. This release:
 *   1. a NEW pure comparator (src/lib/org/store-matrix-sort.ts) owns the
 *      ordering for BOTH the table body and the CSV export — numbers
 *      loudest-first, text A→Z, the week column by its weekTotal join with
 *      absence LAST in both directions, ties stable;
 *   2. every data column's header becomes a real sort button (Actions
 *      stays a span), the visible state riding SortGlyph and the
 *      accessible state riding aria-sort;
 *   3. the export follows the sort — the file mirrors the order on screen.
 *
 * The comparator EXECUTED here (not just pinned), the honesty rule pinned
 * (absence never wins loudest-first, never hides as a zero), and the
 * component contract pinned as source text.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/store-matrix-sort.ts');
const matrix = readRepo('src/components/org/store-matrix.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const changelog = readRepo('CHANGELOG.md');
const pkg = JSON.parse(readRepo('package.json'));

const row = (id: string, over: Partial<MatrixSortRow> = {}): MatrixSortRow => ({
  id,
  code: id.toUpperCase(),
  status: 'ACTIVE',
  todayRevenue: 0,
  todayTransactions: 0,
  lowStockCount: 0,
  overdueRentals: 0,
  debtOutstanding: 0,
  debtCount: 0,
  pendingMpesa: 0,
  ...over,
});

const WEEKS: Record<string, number> = { a: 94150, b: 123992, c: 63120 };

describe('the comparator executed - defaults and the flip', () => {
  it('numeric columns default loudest-first (desc)', () => {
    expect(defaultDirFor('debt')).toBe('desc');
    expect(defaultDirFor('week')).toBe('desc');
    expect(defaultDirFor('revenue')).toBe('desc');
  });

  it('text columns default A→Z (asc) — and an unknown key reads as text', () => {
    expect(defaultDirFor('store')).toBe('asc');
    expect(defaultDirFor('status')).toBe('asc');
    expect(defaultDirFor('mystery')).toBe('asc');
  });

  it('every exported numeric column is covered by the field map — no silent no-sort', () => {
    expect(MATRIX_NUMERIC_COLUMNS).toEqual([
      'revenue', 'week', 'txns', 'low', 'overdue', 'debt', 'debtcount', 'mpesa',
    ]);
    expect(MATRIX_TEXT_COLUMNS).toEqual(['store', 'status']);
  });

  it('toggledDir flips and nextSortState flips the SAME column', () => {
    expect(toggledDir('asc')).toBe('desc');
    expect(toggledDir('desc')).toBe('asc');
    expect(nextSortState({ key: 'debt', dir: 'desc' }, 'debt')).toEqual({ key: 'debt', dir: 'asc' });
  });

  it('a NEW column starts at its default direction', () => {
    expect(nextSortState({ key: 'debt', dir: 'desc' }, 'store')).toEqual({ key: 'store', dir: 'asc' });
    expect(nextSortState(null, 'week')).toEqual({ key: 'week', dir: 'desc' });
  });

  it('nextSortState is pure — the input state is never mutated', () => {
    const current: MatrixSortState = { key: 'debt', dir: 'desc' };
    nextSortState(current, 'debt');
    expect(current).toEqual({ key: 'debt', dir: 'desc' });
  });
});

describe('the comparator executed - ordering', () => {
  it('sorts a numeric column loudest-first by default and flips on asc', () => {
    const rows = [row('a', { debtOutstanding: 100 }), row('b', { debtOutstanding: 300 }), row('c', { debtOutstanding: 200 })];
    expect(sortMatrixRows(rows, { key: 'debt', dir: 'desc' }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortMatrixRows(rows, { key: 'debt', dir: 'asc' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('every numeric column maps to its OWN field — txns never reads debt', () => {
    const rows = [
      row('a', { todayTransactions: 5, debtOutstanding: 900 }),
      row('b', { todayTransactions: 9, debtOutstanding: 100 }),
    ];
    expect(sortMatrixRows(rows, { key: 'txns', dir: 'desc' }).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('text sorts A→Z by code on the store column (null code falls back to the id)', () => {
    const rows = [row('thi'), row('juj'), row('nak')];
    expect(sortMatrixRows(rows, { key: 'store', dir: 'asc' }).map((r) => r.id)).toEqual(['juj', 'nak', 'thi']);
    const nullCode = [row('zzz'), row('aaa', { code: null })];
    expect(sortMatrixRows(nullCode, { key: 'store', dir: 'asc' }).map((r) => r.id)).toEqual(['aaa', 'zzz']);
  });

  it('status sorts with the same A→Z default', () => {
    const rows = [row('a', { status: 'ACTIVE' }), row('b', { status: 'INACTIVE' })];
    expect(sortMatrixRows(rows, { key: 'status', dir: 'asc' }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(sortMatrixRows(rows, { key: 'status', dir: 'desc' }).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('the week column sorts through the weekOf join — loudest first by default', () => {
    const rows = ['a', 'b', 'c'].map((id) => row(id));
    const sorted = sortMatrixRows(rows, { key: 'week', dir: 'desc' }, (r) => WEEKS[r.id]);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('HONEST ABSENCE: a store with no week entry sorts LAST in BOTH directions', () => {
    const rows = [row('ghost'), row('a'), row('b')];
    const desc = sortMatrixRows(rows, { key: 'week', dir: 'desc' }, (r) => WEEKS[r.id]);
    const asc = sortMatrixRows(rows, { key: 'week', dir: 'asc' }, (r) => WEEKS[r.id]);
    expect(desc[desc.length - 1]?.id).toBe('ghost');
    expect(asc[asc.length - 1]?.id).toBe('ghost');
    expect(desc[0]?.id).toBe('b'); // loudest still leads
    expect(asc[0]?.id).toBe('a'); // quietest real week still leads asc
  });

  it('two absent stores keep their arrival order (ties are stable)', () => {
    const rows = [row('g1'), row('a'), row('g2')];
    const sorted = sortMatrixRows(rows, { key: 'week', dir: 'asc' }, (r) => WEEKS[r.id]);
    expect(sorted.filter((r) => !WEEKS[r.id]).map((r) => r.id)).toEqual(['g1', 'g2']);
  });

  it('ties on the sorted value keep arrival order (Array.sort is stable)', () => {
    const rows = [row('x', { lowStockCount: 3 }), row('y', { lowStockCount: 3 }), row('z', { lowStockCount: 1 })];
    expect(sortMatrixRows(rows, { key: 'low', dir: 'desc' }).map((r) => r.id)).toEqual(['x', 'y', 'z']);
  });

  it('null state → arrival order, COPIED (never the caller\u2019s array)', () => {
    const rows = [row('a'), row('b')];
    const out = sortMatrixRows(rows, null);
    expect(out).not.toBe(rows);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('an unknown key returns arrival order — the lib never guesses a comparator', () => {
    const rows = [row('a'), row('b')];
    expect(sortMatrixRows(rows, { key: 'mystery', dir: 'desc' }).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('empty and single-row tables come back intact', () => {
    expect(sortMatrixRows([], { key: 'debt', dir: 'desc' })).toEqual([]);
    const one = [row('only')];
    expect(sortMatrixRows(one, { key: 'debt', dir: 'desc' }).map((r) => r.id)).toEqual(['only']);
  });

  it('the comparator never mutates the caller\u2019s array', () => {
    const rows = [row('b', { debtOutstanding: 9 }), row('a', { debtOutstanding: 1 })];
    sortMatrixRows(rows, { key: 'debt', dir: 'asc' });
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('the component contract - one comparator, two readers', () => {
  it('the sort lib is imported from the ONE module (never re-derived in the component)', () => {
    expect(matrix).toContain("import { nextSortState, sortMatrixRows, type MatrixSortState } from '@/lib/org/store-matrix-sort';");
  });

  it('the sort state lives in the component and feeds ONE sorted memo', () => {
    expect(matrix).toContain('const [sortState, setSortState] = useState<MatrixSortState | null>(null);');
    expect(matrix).toContain('() => sortMatrixRows(stores, sortState, (s) => trendById.get(s.id)?.weekTotal),');
    expect(matrix).toContain('[stores, sortState, trendById],');
  });

  it('the header click handler delegates to nextSortState (the lib owns the semantics)', () => {
    expect(matrix).toContain('const onSort = (key: string) => setSortState((prev) => nextSortState(prev, key));');
  });

  it('aria-sort speaks the REAL ARIA values, never the shorthand', () => {
    expect(matrix).toContain("const ariaSortOf = (key: string): 'ascending' | 'descending' | 'none' =>");
    expect(matrix).toContain('aria-sort={ariaSortOf(c.key)}');
  });

  it('every data column\u2019s header is a button; Actions stays a plain span', () => {
    expect(matrix).toContain("{c.key === 'actions' && <span className=\"whitespace-nowrap\">{c.label}</span>}");
    expect(matrix).toContain("onClick={() => onSort(c.key)}");
    expect(matrix).toContain("className={`focus-ring group -ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-100 ${");
    expect(matrix).toContain("className={`focus-ring group ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-100 ${");
  });

  it('the active column\u2019s label speaks font-semibold text-slate-900', () => {
    expect(matrix).toContain("sortState?.key === c.key ? 'font-semibold text-slate-900' : ''");
  });

  it('the SortGlyph vocabulary: orange arrows active, a hover/focus-only chevron pair at rest', () => {
    expect(matrix).toContain('function SortGlyph({ state }: { state: \'asc\' | \'desc\' | \'none\' })');
    expect(matrix).toContain('<ArrowUp className="h-3 w-3 text-orange-500" aria-hidden="true" />');
    expect(matrix).toContain('<ArrowDown className="h-3 w-3 text-orange-500" aria-hidden="true" />');
    expect(matrix).toContain('group-hover:opacity-100 group-focus-visible:opacity-100');
  });

  it('the glyphs are aria-hidden — the accessible state rides aria-sort, never the icon', () => {
    const glyph = matrix.slice(matrix.indexOf('function SortGlyph'), matrix.indexOf('export function StoreMatrix'));
    expect(glyph).not.toContain('sr-only');
  });

  it('the resize separator stays OUTSIDE the button — drag and click never fight', () => {
    const header = matrix.slice(matrix.indexOf('<TableHeader'), matrix.indexOf('</TableHeader>'));
    expect(header).toContain('onMouseDown={(e) => onDown(c.key, e)}');
    expect(header.indexOf('<button')).toBeLessThan(header.indexOf('onMouseDown='));
  });

  it('the table body AND the export read the SAME sorted memo', () => {
    expect(matrix).toContain('{sortedStores.map((s, i) => (');
    expect(matrix).toContain('sortedStores.map((s) => ({');
  });

  it('the week join rides the SAME trendById map (no second fetch)', () => {
    expect(matrix).toContain('(s) => trendById.get(s.id)?.weekTotal');
  });

  it('the lib is pure by construction - no React, no DOM, no clock', () => {
    expect(lib).not.toContain('useState');
    expect(lib).not.toContain('document.');
    expect(lib).not.toContain('Date.now');
    expect(lib).not.toContain('new Date');
  });
});

describe('docs and release surfaces', () => {
  it('multi-store-workspaces.md carries the matrix-sort bullet and the KPI row', () => {
    expect(doc).toContain('- The matrix learns to sort (v2.180.0):');
    expect(doc).toContain('| Matrix · sort | v2.180.0 —');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.180.0] The matrix learns to sort');
    expect(changelog.indexOf('## [2.180.0]')).toBeLessThan(changelog.indexOf('## [2.179.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.180.0'");
    expect(whatsNew).toContain("title: 'The matrix learns to sort'");
    expect(whatsNew.indexOf('2.180.0')).toBeLessThan(whatsNew.indexOf('2.179.0'));
  });

  it('package.json leads 2.180.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.206.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.206.0');
    expect(pkg.mbumah.baseVersion).toBe('2.206.0');
    expect(pkg.scripts['verify:v2-180-0']).toBe('node scripts/verify-v2-180-0.mjs');
    expect(readRepo('scripts/verify-v2-180-0.mjs')).toContain('v2.180.0 verification');
  });

  it('the prior-round suites evolved their pkg pins to 2.180.0 (the treadmill tax, paid)', () => {
    for (const f of [
      'src/tests/trend-names-mover-v2174.test.ts',
      'src/tests/trend-doors-v2175.test.ts',
      'src/tests/expert-week-v2176.test.ts',
      'src/tests/branch-variance-v2177.test.ts',
      'src/tests/branches-csv-week-v2178.test.ts',
      'src/tests/store-matrix-week-v2179.test.ts',
    ]) {
      expect(readRepo(f)).toContain("expect(pkg.version).toBe('2.206.0');");
    }
  });

  it('the week column\u2019s v2.179.0 contract is untouched (the CSV lib stays the ONE writer)', () => {
    const csvLib = readRepo('src/lib/org/store-matrix-csv.ts');
    expect(csvLib).toContain("'Week 7d (KES)',");
    expect(csvLib).toContain("import { weekDelta } from '@/lib/org/summary-trend';");
    expect(matrix).toContain('<MatrixWeekCell entry={trendById.get(s.id) ?? null} />');
  });
});
