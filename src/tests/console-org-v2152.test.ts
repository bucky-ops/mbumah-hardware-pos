import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBranchesCsv, BRANCHES_HR_CSV_COLUMNS } from '../lib/org/branches-csv';

/**
 * v2.152.0 — counts that read.
 *
 * The v2.151.0 re-audit's six contrast nodes, each probed numerically and
 * fixed at its true root:
 *  - THREE were animation frames: `console-slide-fade` ramped opacity 0→1,
 *    and the alerts rows re-animate on every poll — axe kept catching
 *    red-600 at 3.36:1 mid-fade on rows that pass 4.83:1 at rest. The
 *    keyframe is transform-only now; contrast is measurable at every frame.
 *  - ONE was a knife edge: the store matrix's overdue badge measured
 *    text-red-700 on bg-red-100 = 4.53:1 — inside the rounding noise axe
 *    resolves as a fail. red-800 on red-100 is 5.9:1.
 *  - ONE was a plain fail: the Action queue's warning count wore
 *    text-orange-600 (3.2:1) — orange-800 clears 7:1 with dark kept.
 *  - ONE was introduced by the v2.149.0 sweep itself: the console footer
 *    sits on bg-white in light mode, so the health score's light token
 *    emerald-400 measured 1.97:1 — emerald-700/amber-700 light tokens,
 *    dark:emerald-400/amber-400 preserved for the dark footer.
 *  - PLUS the carried desk-report pairs: the light halves (slate-400,
 *    2.9:1) unify to slate-500 while every dark half keeps its token.
 *
 * FEATURE: the branches CSV export now carries the People & payroll
 * drill-down as a second section — one download, both tables.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the slide-in never dims the text it carries', () => {
  it('console-slide-fade animates transform only — no opacity ramp', () => {
    const css = readRepo('src/app/globals.css');
    expect(css).toMatch(/@keyframes console-slide-fade \{from\{transform:translateY\(8px\)\} to\{transform:translateY\(0\)\}\}/);
    // the keyframe block itself carries no opacity
    const block = css.slice(css.indexOf('@keyframes console-slide-fade'), css.indexOf('@keyframes console-slide-fade') + 120);
    expect(block).not.toContain('opacity');
  });
});

describe('the count badges pass with margin, not on a knife edge', () => {
  it('the matrix overdue badge is red-800 on red-100', () => {
    expect(readRepo('src/components/org/store-matrix.tsx')).toContain(
      '<Badge className="bg-red-100 text-red-800 hover:bg-red-100">',
    );
  });

  it('the Action queue warning count is orange-800 (dark keeps orange-300)', () => {
    const panels = readRepo('src/components/org/panels.tsx');
    expect(panels).toContain(
      "value > 0 ? 'border-orange-300 text-orange-800 dark:border-orange-500/40 dark:text-orange-300' : 'text-slate-500'",
    );
    expect(panels).not.toContain('text-orange-600');
  });

  it('the console footer health speaks light tokens on its light footer', () => {
    const chrome = readRepo('src/components/org/chrome.tsx');
    expect(chrome).toContain(
      "kpi && kpi.health.score >= 80 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'",
    );
    // the always-dark rail keeps its bright tokens
    expect(chrome).toContain("text-xs font-bold text-emerald-400");
  });
});

describe('the desk-report light halves stop failing by arithmetic', () => {
  it('no bare text-slate-400 remains; bare tokens carry dark:slate-400', () => {
    const src = readRepo('src/components/org/desk-report-view.tsx');
    // every remaining text-slate-400 is a dark: half
    const bare = src.match(/(^|[^:-])text-slate-400/g) ?? [];
    expect(bare.length).toBe(0);
    expect((src.match(/dark:text-slate-400/g) ?? []).length).toBeGreaterThanOrEqual(15);
    // no conflicting dark-token doubles in either order
    expect(src.includes("dark:text-slate-500 dark:text-slate-400")).toBe(false);
    expect(src.includes("dark:text-slate-400 dark:text-slate-500")).toBe(false);
  });
});

describe('the branches CSV carries both tables', () => {
  it('appends the People & payroll section when hrPerStore is present', () => {
    const csv = buildBranchesCsv(
      [
        {
          name: 'Juja Main', code: 'MBH-1', location: 'Juja', status: 'ACTIVE',
          todayRevenue: 1000, todayTransactions: 3, lowStockCount: 0,
          overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0,
        },
      ],
      new Date('2026-10-20T00:00:00.000Z'),
      [
        {
          storeName: 'Juja Main',
          headcountActive: 5,
          monthEmploymentCost: 182500,
          monthAbsenceRatePct: 2.4,
          latestPayroll: { periodName: 'October 2026', status: 'DRAFT' },
          expiryAlerts: 3,
        },
        {
          storeName: 'Thika Town',
          headcountActive: 2,
          monthEmploymentCost: 64000,
          monthAbsenceRatePct: 0,
          latestPayroll: null,
          expiryAlerts: 0,
        },
      ],
    );
    const lines = csv.split('\n');
    const hrHead = lines.indexOf('People & payroll by branch');
    expect(hrHead).toBeGreaterThan(0);
    expect(lines[hrHead + 1]).toBe(BRANCHES_HR_CSV_COLUMNS.join(','));
    expect(lines[hrHead + 2]).toBe('Juja Main,5,182500,2.4,October 2026,DRAFT,3');
    // honest absence: no run -> empty cells, never a guess
    expect(lines[hrHead + 3]).toBe('Thika Town,2,64000,0,,,0');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('stays byte-identical to v2.149.0 when hrPerStore is absent or empty', () => {
    const args = [
      [
        {
          name: 'Juja Main', code: 'MBH-1', location: 'Juja', status: 'ACTIVE',
          todayRevenue: 1000, todayTransactions: 3, lowStockCount: 0,
          overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0,
        },
      ],
      new Date('2026-10-20T00:00:00.000Z'),
    ] as const;
    const without = buildBranchesCsv(...args);
    const empty = buildBranchesCsv(args[0], args[1], []);
    const nullish = buildBranchesCsv(args[0], args[1], null);
    expect(without).toBe(empty);
    expect(empty).toBe(nullish);
    expect(without).not.toContain('People & payroll');
  });

  it('the handler passes the drill-down rows from the summary payload', () => {
    const org = readRepo('src/components/workspace/org-console.tsx');
    expect(org).toContain('(summary.hrPerStore ?? []).map((r) => ({');
    expect(org).toContain('expiryAlerts.documentsExpiring90Days + r.expiryAlerts.assetsOverdue');
  });
});

describe('the release surfaces speak 2.152.0', () => {
  it('package.json, changelog and the feed lead with 2.152.0', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.156.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.156.0');
    expect(pkg.mbumah.baseVersion).toBe('2.156.0');
    expect(readRepo('CHANGELOG.md')).toContain('## [2.156.0]');
    const feed = readRepo('src/lib/whats-new.ts');
    expect(feed.indexOf("'2.156.0'")).toBeLessThan(feed.indexOf("'2.153.0'"));
  });
});
