import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBranchesCsv,
  BRANCHES_TREND_CSV_COLUMNS,
  type BranchCsvRow,
  type BranchTrendCsvRow,
} from '../lib/org/branches-csv';
import { weekDelta } from '../lib/org/summary-trend';

/**
 * v2.178.0 — the export carries the week.
 *
 * The branches table speaks every branch's week (spark v2.175.0, verdict
 * chip v2.177.0, prior on hover); the branches CSV stayed at the desk
 * digest. This release the export becomes the offline twin: a FOURTH
 * section — "The week by branch (7d)" — the drill-down's own rows loudest
 * week first, each branch's gross week total, prior week, and a signed
 * Change % computed by the SAME weekDelta classifier the chips speak.
 * Still ZERO new queries: the block has ridden every summary response
 * since v2.174.0; the caller pre-joins it to the branch names by storeId.
 *
 * Pinned here: the section EXECUTED (bytes end-to-end, loudest-first with
 * stable ties, the weekDelta parity assertion), the honesty rule (a
 * missing/zero/negative prior leaves the Change cell EMPTY — never a
 * fabricated "+0%" or an invented infinity; exactly flat IS a real
 * comparison), the whole-block honest absence (nullish/empty → the exact
 * v2.177.0 bytes), the caller contract (join by storeId, the 'Branch'
 * fallback, no second fetch, the section-count note, the busy-state
 * button), the lib contract, the docs rows, and the release surfaces.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/branches-csv.ts');
const org = readRepo('src/components/workspace/org-console.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');
const csvDoc = readRepo('docs/payroll-run-lifecycle.md');
const changelog = readRepo('CHANGELOG.md');
const feed = readRepo('src/lib/whats-new.ts');

const AT = new Date('2026-10-20T10:00:00.000Z');

const STORES: BranchCsvRow[] = [
  {
    name: 'Juja Road',
    code: 'JUJA',
    location: 'Juja',
    status: 'ACTIVE',
    todayRevenue: 12_000,
    todayTransactions: 6,
    lowStockCount: 2,
    overdueRentals: 0,
    debtOutstanding: 5_000,
    pendingMpesa: 1,
  },
  {
    name: 'Nairobi CBD',
    code: 'CBD',
    location: 'Nairobi',
    status: 'ACTIVE',
    todayRevenue: 30_000,
    todayTransactions: 11,
    lowStockCount: 0,
    overdueRentals: 1,
    debtOutstanding: 0,
    pendingMpesa: 0,
  },
];

const WEEK: BranchTrendCsvRow[] = [
  { storeName: 'Juja Road', weekTotal: 94_150, priorWeekTotal: 266_124 },
  { storeName: 'Nairobi CBD', weekTotal: 123_992, priorWeekTotal: 9_048 },
  { storeName: 'Ruiru', weekTotal: 35_620, priorWeekTotal: 39_252 },
  { storeName: 'Thika', weekTotal: 217_400 },
];

// The section's exact bytes, given WEEK: loudest first (Thika 217,400 →
// Nairobi 123,992 → Juja 94,150 → Ruiru 35,620), Thika's absent prior
// leaving BOTH the prior and the Change cells empty, the signed pct from
// the SAME weekDelta the chips speak, and the closing gross-vs-net note.
const WEEK_SECTION = [
  'The week by branch (7d)',
  'Branch,Revenue 7d (KES),Prior week (KES),Change (%)',
  'Thika,217400,,',
  'Nairobi CBD,123992,9048,1270.38',
  'Juja Road,94150,266124,-64.62',
  'Ruiru,35620,39252,-9.25',
  'Note,Branch week shapes are gross revenue — the org trend line and the expert console KPI agree (gross till face, reconciled v2.185.0)',
  '',
].join('\n');

describe('the week section EXECUTED - the offline twin', () => {
  it('appends the section loudest week first, with the verdict math the chips speak', () => {
    const csv = buildBranchesCsv(STORES, AT, null, null, WEEK);
    expect(csv).toContain(WEEK_SECTION);
    expect(csv.endsWith(WEEK_SECTION)).toBe(true);
  });

  it('the Change cell equals weekDelta\u2019s own pct for the same inputs — chip and file can never disagree', () => {
    for (const t of WEEK) {
      const d = t.priorWeekTotal === undefined ? null : weekDelta(t.weekTotal, t.priorWeekTotal);
      // slice AFTER the section marker — the branch name also leads a
      // branches-table row, and the section is what this test speaks about.
      const tail = buildBranchesCsv(STORES, AT, null, null, [t]).split(
        'The week by branch (7d)\n',
      )[1] ?? '';
      const row = tail.split('\n').find((l) => l.startsWith(t.storeName));
      const cells = (row ?? '').split(',');
      const printed = cells[cells.length - 1];
      expect(printed).toBe(d ? String(d.pct) : '');
    }
    expect(weekDelta(123_992, 9_048)?.pct).toBe(1270.38);
    expect(weekDelta(94_150, 266_124)?.pct).toBe(-64.62);
  });

  it('the prior week rides its own raw column (spreadsheet-ready numbers, no separators)', () => {
    const row = buildBranchesCsv(STORES, AT, null, null, [
      { storeName: 'X', weekTotal: 1_234_567, priorWeekTotal: 22_000 },
    ])
      .split('\n')
      .find((l) => l.startsWith('X,'));
    expect(row).toBe('X,1234567,22000,5511.67');
  });

  it('ties keep their arrival order (Array.sort is stable — the drill-down never reshuffles equals)', () => {
    const csv = buildBranchesCsv(STORES, AT, null, null, [
      { storeName: 'First', weekTotal: 500, priorWeekTotal: 100 },
      { storeName: 'Second', weekTotal: 500, priorWeekTotal: 400 },
    ]);
    const iFirst = csv.indexOf('First,500,100,400');
    const iSecond = csv.indexOf('Second,500,400,25');
    expect(iFirst).toBeGreaterThan(-1);
    expect(iSecond).toBeGreaterThan(iFirst);
  });

  it('an empty week still compares honestly against a real prior (flat line, real verdict)', () => {
    const row = buildBranchesCsv(STORES, AT, null, null, [
      { storeName: 'Quiet', weekTotal: 0, priorWeekTotal: 12_345 },
    ])
      .split('\n')
      .find((l) => l.startsWith('Quiet,'));
    expect(row).toBe('Quiet,0,12345,-100');
  });
});

describe('the honesty rule - no comparison, no number', () => {
  it('an absent priorWeekTotal leaves BOTH the prior and the Change cells empty', () => {
    const row = buildBranchesCsv(STORES, AT, null, null, [
      { storeName: 'Thika', weekTotal: 217_400 },
    ])
      .split('\n')
      .find((l) => l.startsWith('Thika,'));
    expect(row).toBe('Thika,217400,,');
  });

  it('a zero or negative prior is NO comparison — empty Change cell, never "+0%" or an invented sign flip', () => {
    // the Prior column passes the raw number through (an honest zero week
    // prints 0); the CHANGE cell is where the honesty gate lives.
    for (const prior of [0, -50]) {
      const row = buildBranchesCsv(STORES, AT, null, null, [
        { storeName: 'X', weekTotal: 200, priorWeekTotal: prior },
      ])
        .split('\n')
        .find((l) => l.startsWith('X,'));
      expect(row).toBe(`X,200,${prior},`);
      expect(row?.endsWith(',')).toBe(true);
    }
  });

  it('an exactly flat week IS a real comparison — 0, which the sign speaks as calm', () => {
    const row = buildBranchesCsv(STORES, AT, null, null, [
      { storeName: 'X', weekTotal: 300, priorWeekTotal: 300 },
    ])
      .split('\n')
      .find((l) => l.startsWith('X,'));
    expect(row).toBe('X,300,300,0');
  });
});

describe('honest absence, whole-block - the v2.177.0 file shape survives', () => {
  it('trend nullish or empty ends the file byte-identically to the four-argument call', () => {
    const without = buildBranchesCsv(STORES, AT);
    const nullish = buildBranchesCsv(STORES, AT, null, null, null);
    const empty = buildBranchesCsv(STORES, AT, null, null, []);
    expect(nullish).toBe(without);
    expect(empty).toBe(without);
    expect(without).not.toContain('The week by branch');
    expect(without).not.toContain('Change (%)');
  });

  it('the section composes after the desk digest — four sections in one blob', () => {
    const desk = {
      label: 'Yesterday, Tue 20 Oct',
      visits: 4,
      clears: 2,
      reviewers: 2,
      requests: 1,
      busiestBranch: { storeName: 'Juja Road', visits: 3 },
      topReviewer: { name: 'Achieng', visits: 3 },
      branches: [{ storeName: 'Juja Road', visits: 3 }],
    };
    const csv = buildBranchesCsv(STORES, AT, null, desk, WEEK);
    const iDesk = csv.indexOf('Desk report — Yesterday, Tue 20 Oct');
    const iWeek = csv.indexOf('The week by branch (7d)');
    expect(iDesk).toBeGreaterThan(-1);
    expect(iWeek).toBeGreaterThan(iDesk);
    expect(csv.endsWith(WEEK_SECTION)).toBe(true);
  });

  it('the section survives alone (no HR, no desk) — the fourth section never depends on the others', () => {
    const csv = buildBranchesCsv(STORES, AT, null, null, WEEK);
    expect(csv).toContain('The week by branch (7d)');
    expect(csv).not.toContain('People & payroll');
    expect(csv).not.toContain('Desk report');
    expect(csv.endsWith(WEEK_SECTION)).toBe(true);
  });
});

describe('the lib contract - one classifier, one section', () => {
  it('the verdict math is imported from the ONE lib — never re-derived file-side', () => {
    expect(lib).toContain("import { weekDelta } from '@/lib/org/summary-trend';");
  });

  it('the fifth parameter is tolerant by contract (optional + nullable)', () => {
    expect(lib).toContain('  trend?: readonly BranchTrendCsvRow[] | null,');
  });

  it('BranchTrendCsvRow speaks the pre-joined row — name, week total, optional prior', () => {
    expect(lib).toContain('export interface BranchTrendCsvRow {');
    expect(lib).toContain('  storeName: string;');
    expect(lib).toContain('  weekTotal: number;');
    expect(lib).toContain('  priorWeekTotal?: number;');
  });

  it('the section header names the table\u2019s own 7d column, as numbers', () => {
    expect(BRANCHES_TREND_CSV_COLUMNS).toEqual([
      'Branch',
      'Revenue 7d (KES)',
      'Prior week (KES)',
      'Change (%)',
    ]);
    expect(lib).toContain("BRANCHES_TREND_CSV_COLUMNS.join(','),");
  });

  it('loudest-first is the drill-down\u2019s sort, spelled in code', () => {
    expect(lib).toContain('const ordered = [...trend].sort((a, b) => b.weekTotal - a.weekTotal);');
  });

  it('the section gate is honest — present AND non-empty, never a bare truthiness', () => {
    expect(lib).toContain('if (trend && trend.length > 0) {');
  });

  it('the title line carries the drill-down\u2019s vocabulary', () => {
    expect(lib).toContain("'The week by branch (7d)',");
  });

  it('the note carries the v2.185.0 reconciliation into the offline artifact', () => {
    expect(lib).toContain('Branch week shapes are gross revenue');
    // v2.185.0: the divergence label retires — the note records the AGREEMENT.
    expect(lib).toContain('expert console KPI agree (gross till face, reconciled v2.185.0)');
  });

  it('the change cell prints the signed pct and the empty absence — spelled in code', () => {
    expect(lib).toContain("d ? String(d.pct) : '',");
    expect(lib).toContain("t.priorWeekTotal === undefined ? '' : t.priorWeekTotal,");
  });
});

describe('the caller contract - the summary payload rides, nothing is fetched', () => {
  it('the trend rows are the summary\u2019s own block, joined to branch names by storeId', () => {
    expect(org).toContain('const trendRows = (summary.perStoreTrend ?? []).map((t) => ({');
    expect(org).toContain("summary.stores.find((s) => s.id === t.storeId)?.name ?? 'Branch',");
    expect(org).toContain('weekTotal: t.weekTotal,');
    expect(org).toContain('priorWeekTotal: t.priorWeekTotal,');
  });

  it('the call grew its fifth argument — the week rides the SAME download', () => {
    expect(org).toContain('      trendRows,\n    );');
  });

  it('NO second fetch — the block has ridden every summary response since v2.174.0', () => {
    expect(org).toContain('const trendRows = (summary.perStoreTrend ?? []).map');
    expect(org).not.toContain("authorizedFetchJson('/api/org/summary?week=trendRows')");
  });

  it('the note counts the sections it actually wrote (singular handled)', () => {
    expect(org).toContain('const sections =');
    expect(org).toContain('(summary.hrPerStore && summary.hrPerStore.length > 0 ? 1 : 0)');
    expect(org).toContain('(desk ? 1 : 0)');
    expect(org).toContain('(trendRows.length > 0 ? 1 : 0)');
    expect(org).toContain('section${sections === 1 ? \'\' : \'s\'}');
  });

  it('the button speaks its own busy state — aria-busy, the label swap, the pulsing icon', () => {
    expect(org).toContain('aria-busy={exporting}');
    expect(org).toContain("exporting ? 'Exporting\\u2026' : 'Export CSV'");
    expect(org).toContain("exporting ? ' animate-pulse' : ''");
    expect(org).toContain('disabled={exporting}');
  });

  it('the v2.154.0 Open link and one-blob rule survive untouched', () => {
    expect(org).toContain('data-testid="org-console-export-open"');
    expect(org).toContain('if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);');
  });
});

describe('the docs speak the fourth section', () => {
  it('multi-store-workspaces.md gains the export bullet and the KPI row', () => {
    expect(doc).toContain('- The export carries the week (v2.178.0):');
    expect(doc).toContain('| Export · week by branch | v2.178.0 —');
  });

  it('the branches CSV contract is now the four-section contract', () => {
    expect(csvDoc).toContain('## The branches CSV contract (v2.152.0 + v2.154.0 + v2.178.0)');
    expect(csvDoc).toContain('Four sections in one blob');
  });
});

describe('release surfaces', () => {
  it('package.json leads the current version in all three slots (re-anchored for 2.181.0) and the verify script is wired', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.198.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.198.0');
    expect(pkg.mbumah.baseVersion).toBe('2.198.0');
    expect(pkg.scripts['verify:v2-178-0']).toBe('node scripts/verify-v2-178-0.mjs');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.178.0] The export carries the week');
  });

  it('the whats-new feed heads with this release, above 2.177.0', () => {
    expect(feed).toContain("version: '2.178.0'");
    expect(feed.indexOf('2.178.0')).toBeGreaterThan(-1);
    expect(feed.indexOf('2.178.0')).toBeLessThan(feed.indexOf('2.177.0'));
  });

  it('the verify script exists on disk', () => {
    expect(readRepo('scripts/verify-v2-178-0.mjs')).toContain('v2.178.0 verification');
  });
});
