import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStoreMatrixCsv, STORE_MATRIX_CSV_COLUMNS, STORE_MATRIX_TREND_NOTE, type StoreMatrixCsvStoreRow } from '../lib/org/store-matrix-csv';
import { weekDelta } from '../lib/org/summary-trend';

/**
 * v2.179.0 — the matrix reads the week.
 *
 * Three surfaces spoke every branch's week (the dashboard table v2.175.0,
 * the strip v2.176.0, the branches CSV v2.178.0) — the Store Intelligence
 * Matrix stayed week-blind. This release:
 *   1. the matrix's CSV bytes move into a PURE lib
 *      (src/lib/org/store-matrix-csv.ts) and grow the week inline:
 *      Week 7d (KES), Prior week (KES), Change (%) after Revenue, computed
 *      by the SAME weekDelta classifier the chips speak;
 *   2. the matrix gains the "Week 7d" column (spark + total + chip), the
 *      tolerant `trend` prop, the header hint, and the honest dash;
 *   3. the workspace dialog speaks the week at the top of its POS tab;
 *   4. the console page passes `summary.perStoreTrend` through — no second
 *      fetch.
 *
 * The join EXECUTED here (by storeId, never row order), the honesty rule
 * pinned (missing entry / undefined prior / zero or negative prior → empty
 * Change cell; flat → `0`), the note gate (present AND non-empty), the
 * RFC-4180 quoting, and the lib-is-the-one-writer refactor (the component
 * no longer assembles bytes inline).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/store-matrix-csv.ts');
const matrix = readRepo('src/components/org/store-matrix.tsx');
const page = readRepo('src/app/(shell)/console/page.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const changelog = readRepo('CHANGELOG.md');
const pkg = JSON.parse(readRepo('package.json'));

const AT = new Date('2026-10-20T09:00:00.000Z');
const NOTE_LINE = 'Note,Store week shapes are gross revenue — the expert console KPI agrees (gross till face, reconciled v2.185.0)';

const row = (over: Partial<StoreMatrixCsvStoreRow> = {}): StoreMatrixCsvStoreRow => ({
  id: 's1',
  code: 'JUJ',
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

describe('the lib executed - the file, byte-exact', () => {
  it('one store with a full week: the row carries week, prior and the signed change', () => {
    const csv = buildStoreMatrixCsv(
      [row({ id: 's2', debtOutstanding: 200340, debtCount: 6 })],
      AT,
      [{ storeId: 's2', weekTotal: 94150, priorWeekTotal: 266124 }],
    );
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Store Intelligence Matrix (generated 2026-10-20T09:00:00.000Z)');
    expect(lines[1]).toBe(STORE_MATRIX_CSV_COLUMNS.join(','));
    expect(lines[2]).toBe('JUJ,ACTIVE,0,94150,266124,-64.62,0,0,0,200340,6,0');
    expect(lines[3]).toBe(NOTE_LINE);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('the header is the matrix\u2019s own reading order with the week inline after Revenue', () => {
    expect(STORE_MATRIX_CSV_COLUMNS).toEqual([
      'Store',
      'Status',
      'Revenue',
      'Week 7d (KES)',
      'Prior week (KES)',
      'Change (%)',
      'Txns',
      'Low Stock',
      'Overdue Rentals',
      'Debt Total',
      'Debt Accts',
      'M-Pesa Pending',
    ]);
  });

  it('numbers export raw (no thousands separators) so a spreadsheet re-imports them as numbers', () => {
    const csv = buildStoreMatrixCsv([row({ todayRevenue: 123992, debtOutstanding: 200340 })], AT, []);
    expect(csv).toContain('JUJ,ACTIVE,123992,,,,0,0,0,200340,0,0');
  });

  it('empty stores still print the generated line and the header (an honest empty table)', () => {
    const csv = buildStoreMatrixCsv([], AT, null);
    expect(csv).toBe(
      `Store Intelligence Matrix (generated 2026-10-20T09:00:00.000Z)\n${STORE_MATRIX_CSV_COLUMNS.join(',')}\n`,
    );
  });
});

describe('the join - by storeId, never row order', () => {
  it('another store\u2019s week never lands on the wrong row', () => {
    const csv = buildStoreMatrixCsv(
      [row({ id: 'a', code: 'AAA' }), row({ id: 'b', code: 'BBB' })],
      AT,
      [
        { storeId: 'b', weekTotal: 300, priorWeekTotal: 100 },
        { storeId: 'a', weekTotal: 700, priorWeekTotal: 200 },
      ],
    );
    const rows = csv.split('\n');
    expect(rows[2]).toBe('AAA,ACTIVE,0,700,200,250,0,0,0,0,0,0');
    expect(rows[3]).toBe('BBB,ACTIVE,0,300,100,200,0,0,0,0,0,0');
  });

  it('a store with no entry in the block leaves its week cells EMPTY (columns never flicker)', () => {
    const csv = buildStoreMatrixCsv([row({ id: 'ghost' })], AT, [
      { storeId: 'someone-else', weekTotal: 5, priorWeekTotal: 5 },
    ]);
    expect(csv).toContain('JUJ,ACTIVE,0,,,,0,0,0,0,0,0');
    expect(csv).not.toContain(',,5');
  });

  it('the columns always exist even when the whole block is nullish or empty', () => {
    for (const trend of [undefined, null, []]) {
      const csv = buildStoreMatrixCsv([row()], AT, trend);
      expect(csv.split('\n')[1]).toBe(STORE_MATRIX_CSV_COLUMNS.join(','));
      expect(csv).toContain('JUJ,ACTIVE,0,,,,0,0,0,0,0,0');
    }
  });
});

describe('the honesty rule - the Change cell', () => {
  it('undefined prior → Prior and Change cells both empty (no comparison existed)', () => {
    const csv = buildStoreMatrixCsv([row({ id: 's1' })], AT, [{ storeId: 's1', weekTotal: 217400 }]);
    expect(csv).toContain('JUJ,ACTIVE,0,217400,,,0,0,0,0,0,0');
  });

  it('zero prior → the Prior cell prints 0 (the API always emits it) and the Change cell stays EMPTY', () => {
    const csv = buildStoreMatrixCsv([row({ id: 's1' })], AT, [{ storeId: 's1', weekTotal: 217400, priorWeekTotal: 0 }]);
    expect(csv).toContain('JUJ,ACTIVE,0,217400,0,,0,0,0,0,0,0');
  });

  it('negative prior → the Change cell stays EMPTY too (no honest comparison)', () => {
    const csv = buildStoreMatrixCsv([row({ id: 's1' })], AT, [{ storeId: 's1', weekTotal: 500, priorWeekTotal: -3 }]);
    expect(csv).toContain('JUJ,ACTIVE,0,500,-3,,0,0,0,0,0,0');
  });

  it('an exactly flat week prints 0 — which IS a real comparison', () => {
    const csv = buildStoreMatrixCsv([row({ id: 's1' })], AT, [{ storeId: 's1', weekTotal: 300, priorWeekTotal: 300 }]);
    expect(csv).toContain('JUJ,ACTIVE,0,300,300,0,0,0,0,0,0');
  });

  it('the file\u2019s Change cell equals weekDelta\u2019s own pct for the same inputs — chip and file can never disagree', () => {
    const pairs: Array<[number, number]> = [
      [123992, 9048],
      [94150, 266124],
      [63120, 44980],
      [35620, 39252],
      [17400, 49736],
    ];
    for (const [current, prior] of pairs) {
      const csv = buildStoreMatrixCsv([row({ id: 's1' })], AT, [{ storeId: 's1', weekTotal: current, priorWeekTotal: prior }]);
      const change = csv.split('\n')[2].split(',')[5];
      expect(change).toBe(String(weekDelta(current, prior)?.pct));
    }
    // the loudest real movements, pinned
    expect(weekDelta(123_992, 9_048)?.pct).toBe(1270.38);
    expect(weekDelta(94_150, 266_124)?.pct).toBe(-64.62);
  });
});

describe('the note gate and the quoting', () => {
  it('the note rides when the block is present AND non-empty', () => {
    const withWeek = buildStoreMatrixCsv([row()], AT, [{ storeId: 's1', weekTotal: 1 }]);
    expect(withWeek).toContain(NOTE_LINE);
  });

  it('the note never rides on a nullish or empty block (an absent week adds no labels)', () => {
    expect(buildStoreMatrixCsv([row()], AT, null)).not.toContain('Note,');
    expect(buildStoreMatrixCsv([row()], AT, undefined)).not.toContain('Note,');
    expect(buildStoreMatrixCsv([row()], AT, [])).not.toContain('Note,');
  });

  it('the exported STORE_MATRIX_TREND_NOTE constant is the exact note line', () => {
    expect(STORE_MATRIX_TREND_NOTE).toBe(NOTE_LINE);
  });

  it('RFC-4180: a value carrying a comma is quoted, a quote is doubled', () => {
    const csv = buildStoreMatrixCsv([row({ code: 'A,B' })], AT, null);
    expect(csv).toContain('"A,B",ACTIVE,');
    const quoted = buildStoreMatrixCsv([row({ code: 'He said "hi"' })], AT, null);
    expect(quoted).toContain('"He said ""hi""",ACTIVE,');
  });

  it('the generatedAt default is the caller\u2019s now (smoke — the stamp is a real ISO string)', () => {
    const csv = buildStoreMatrixCsv([row()]);
    expect(csv).toMatch(/^Store Intelligence Matrix \(generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('the lib contract - the classifier is imported, never re-derived', () => {
  it('imports weekDelta from the ONE summary-trend module', () => {
    expect(lib).toContain("import { weekDelta } from '@/lib/org/summary-trend';");
  });

  it('the trend parameter is tolerant (optional + nullable) on the exported signature', () => {
    expect(lib).toContain('  trend?: readonly StoreMatrixTrendCsvRow[] | null,');
  });

  it('the row shape carries the optional prior (the honesty gate\u2019s raw material)', () => {
    expect(lib).toContain('export interface StoreMatrixTrendCsvRow {');
    expect(lib).toContain('  priorWeekTotal?: number;');
  });

  it('the columns and note are exported constants (the tests pin them, not re-type them)', () => {
    expect(lib).toContain('export const STORE_MATRIX_CSV_COLUMNS = [');
    expect(lib).toContain('export const STORE_MATRIX_TREND_NOTE =');
  });

  it('the lib is pure by construction - no db, no fetch, no DOM', () => {
    expect(lib).not.toContain('prisma');
    expect(lib).not.toContain('fetch(');
    expect(lib).not.toContain('document.');
    expect(lib).not.toContain('Blob');
  });
});

describe('the component contract - the matrix speaks the week', () => {
  it('the Week 7d column sits after Revenue with its hint and renders the week cell', () => {
    expect(matrix).toContain("{ key: 'week', label: 'Week 7d', hint: '7-day gross revenue, week ending today', width: 168, min: 136, render: (s) => (");
    expect(matrix).toContain('<MatrixWeekCell entry={trendById.get(s.id) ?? null} />');
  });

  it('the join is by storeId from ONE Map, never row order', () => {
    expect(matrix).toContain('new Map((trend ?? []).map((t) => [t.storeId, t]))');
  });

  it('the trend prop is tolerant (optional + nullable) and exported as a named type', () => {
    expect(matrix).toContain('export type StoreMatrixTrendEntry = {');
    expect(matrix).toContain('  trend?: StoreMatrixTrendEntry[] | null;');
  });

  it('the cell stacks the total over the muted spark + chip (the branches table\u2019s exact vocabulary, sized to the cell)', () => {
    expect(matrix).toContain('<Sparkline data={entry.spark} stroke="#64748b" spokenLabel="Seven-day revenue per day, KES" width={64} height={18} />');
    expect(matrix).toContain('<WeekDeltaChip current={entry.weekTotal} prior={entry.priorWeekTotal ?? 0} />');
    expect(matrix).toContain('text-[13px] font-semibold tabular-nums text-slate-800');
  });

  it('the tooltip composes the prior week exactly when one exists', () => {
    expect(matrix).toContain('title={`7-day revenue ${kes(entry.weekTotal)} (gross)${entry.priorWeekTotal ? ` · prior ${kes(entry.priorWeekTotal)}` : \'\'}`}');
  });

  it('the accessible words ride weekDeltaWords as sr-only sentences', () => {
    expect(matrix).toContain('const words = weekDeltaWords(entry.weekTotal, entry.priorWeekTotal ?? 0);');
    expect(matrix).toContain('<span className="sr-only">7-day revenue {kes(entry.weekTotal)}</span>');
    expect(matrix).toContain('{words ? <span className="sr-only">{words}</span> : null}');
  });

  it('honest absence: the calm aria-hidden dash (the muted-foreground family), never a fabricated zero', () => {
    expect(matrix).toContain('<span className="text-muted-foreground" aria-hidden="true">');
  });

  it('the workspace dialog speaks the week at the top of its POS tab', () => {
    expect(matrix).toContain('const wsTrend = wsStore ? trendById.get(wsStore.id) ?? null : null;');
    expect(matrix).toContain('const wsWords = wsTrend ? weekDeltaWords(wsTrend.weekTotal, wsTrend.priorWeekTotal ?? 0) : null;');
    expect(matrix).toContain('7-day revenue (gross)');
    expect(matrix).toContain('border-orange-100 bg-orange-50/60 p-3 dark:border-orange-900/40 dark:bg-orange-950/20');
    expect(matrix).toContain('<Sparkline data={wsTrend.spark} stroke="#64748b" spokenLabel="Seven-day revenue per day, KES" width={72} height={20} />');
  });

  it('the lib is the ONE writer of the CSV bytes - the inline assembly is gone', () => {
    expect(matrix).toContain('buildStoreMatrixCsv(');
    expect(matrix).toContain("import { buildStoreMatrixCsv } from '@/lib/org/store-matrix-csv';");
    expect(matrix).not.toContain("export: (s)");
    expect(matrix).not.toContain('`Store Intelligence Matrix (generated');
    expect(matrix).not.toContain("new Blob([`Store Intelligence");
  });

  it('the export toast counts the week it carried (the v2.178.0 parity move)', () => {
    expect(matrix).toContain("onToast(trend && trend.length > 0 ? 'Exported store_intelligence.csv · week by store' : 'Exported store_intelligence.csv');");
  });

  it('the caller maps every field explicitly (code through the matrix\u2019s own storeCode)', () => {
    expect(matrix).toContain('code: storeCode(s),');
    expect(matrix).toContain('      new Date(),\n      trend,');
  });

  it('the header hint renders on the label spans', () => {
    expect(matrix).toContain('title={c.hint}');
  });
});

describe('the page wiring - no second fetch', () => {
  it('the console page passes the summary\u2019s own perStoreTrend block through', () => {
    expect(page).toContain('<StoreMatrix stores={summary.stores} trend={summary.perStoreTrend} onToast={onToast} />');
  });

  it('the wiring comment names the no-second-fetch contract', () => {
    expect(page).toContain('the perStoreTrend block\n                  the page already polls rides down untouched (no second\n                  fetch)');
  });

  it('the shared payload type already carried the block (primitives, v2.176.0) — untouched', () => {
    const primitives = readRepo('src/components/org/primitives.tsx');
    expect(primitives).toContain('perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;');
  });
});

describe('docs and release surfaces', () => {
  it('multi-store-workspaces.md carries the matrix-week bullet and the KPI row', () => {
    expect(doc).toContain('- The matrix reads the week (v2.179.0):');
    expect(doc).toContain('| Matrix · week by store | v2.179.0 —');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.179.0] The matrix reads the week');
    expect(changelog.indexOf('## [2.179.0]')).toBeLessThan(changelog.indexOf('## [2.178.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.179.0'");
    expect(whatsNew).toContain("title: 'The matrix reads the week'");
    expect(whatsNew.indexOf('2.179.0')).toBeLessThan(whatsNew.indexOf('2.178.0'));
  });

  it('package.json leads the current version in all three slots (re-anchored for 2.181.0) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.207.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.207.0');
    expect(pkg.mbumah.baseVersion).toBe('2.207.0');
    expect(pkg.scripts['verify:v2-179-0']).toBe('node scripts/verify-v2-179-0.mjs');
    expect(readRepo('scripts/verify-v2-179-0.mjs')).toContain('v2.179.0 verification');
  });

  it('the prior-round suites evolved their pkg pins to 2.179.0 (the treadmill tax, paid)', () => {
    for (const f of [
      'src/tests/trend-names-mover-v2174.test.ts',
      'src/tests/trend-doors-v2175.test.ts',
      'src/tests/expert-week-v2176.test.ts',
      'src/tests/branch-variance-v2177.test.ts',
      'src/tests/branches-csv-week-v2178.test.ts',
    ]) {
      expect(readRepo(f)).toContain("expect(pkg.version).toBe('2.207.0');");
    }
  });

  it('the branches CSV\u2019s own week contract is untouched (v2.178.0 stays v2.178.0)', () => {
    const branchesLib = readRepo('src/lib/org/branches-csv.ts');
    expect(branchesLib).toContain("'The week by branch (7d)',");
    expect(branchesLib).toContain("BRANCHES_TREND_CSV_COLUMNS.join(',')");
  });
});
