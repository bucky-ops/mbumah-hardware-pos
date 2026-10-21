import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultDirFor,
  nextSortState,
  sortHrDrillRows,
  payrollStatusRank,
  HR_DRILL_NUMERIC_COLUMNS,
  HR_DRILL_TEXT_COLUMNS,
  HR_DRILL_RANK_COLUMNS,
  type HrDrillSortRow,
} from '../lib/org/hr-drilldown-sort';

/**
 * v2.190.0 — the drill-down ranks its payrolls.
 *
 * The v2.183.0 payroll join sorted by latestPayroll.periodName TEXT — a
 * fragile proxy for recency ("November 2025" sorts after "March 2026"
 * alphabetically) that ignored the one thing the cell actually WEARS: the
 * status badge. The house rule is that a comparator sorts what the cell
 * shows (the alerts cell sorts its SUM), so the payroll column now sorts
 * by STATUS RANK — the run's finality ladder (LOCKED/POSTED > APPROVED >
 * DRAFT > VOIDED, unknown 0), with directional createdAt then periodName
 * ties inside a rank, and the missing-run rule UNCHANGED (last in both
 * directions). The fresh click is desc (settled branches on top — the
 * "which branches are settled vs still open" scan); the asc click is the
 * honest mirror (least final first — the "who needs attention" scan).
 *
 * The rank function is EXECUTED (total, never guessed), the comparator is
 * EXECUTED (finality, directional recency, periodName final tie, missing
 * last, copy-not-mutate, stability), the category move is pinned (payroll
 * leaves TEXT, joins RANK, fresh click desc), the component's honest hint
 * is pinned as source text, and the release surfaces speak 2.190.0.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const sortLib = readRepo('src/lib/org/hr-drilldown-sort.ts');
const comp = readRepo('src/components/workspace/org-console.tsx');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const pkg = JSON.parse(readRepo('package.json'));

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

const run = (status: string, createdAt: string, periodName = 'October 2026') => ({
  periodName,
  status,
  createdAt,
});

describe('the rank ladder executed - payrollStatusRank is total', () => {
  it('LOCKED and POSTED share the top rank (the cell paints them the same emerald)', () => {
    expect(payrollStatusRank('LOCKED')).toBe(4);
    expect(payrollStatusRank('POSTED')).toBe(4);
  });

  it('APPROVED, DRAFT, VOIDED walk the finality ladder in order', () => {
    expect(payrollStatusRank('APPROVED')).toBe(3);
    expect(payrollStatusRank('DRAFT')).toBe(2);
    expect(payrollStatusRank('VOIDED')).toBe(1);
  });

  it('an unknown status reads as 0 and never throws — a future enum or a corrupt payload sorts beneath the known ladder', () => {
    expect(payrollStatusRank('PROCESSING')).toBe(0);
    expect(payrollStatusRank('')).toBe(0);
    expect(payrollStatusRank('draft')).toBe(0); // the wire speaks the uppercase enum — not a guess at case
    expect(payrollStatusRank('DRAFT ')).toBe(0); // no silent trimming either
  });
});

describe('the payroll sort executed - finality first, the mirror honest', () => {
  it('desc (the fresh click) clusters the settled branches on top: LOCKED/POSTED > APPROVED > DRAFT > VOIDED', () => {
    const rows = [
      row({ storeId: 'draft', latestPayroll: run('DRAFT', '2026-10-01T09:00:00Z') }),
      row({ storeId: 'locked', latestPayroll: run('LOCKED', '2026-09-01T09:00:00Z') }),
      row({ storeId: 'voided', latestPayroll: run('VOIDED', '2026-10-20T09:00:00Z') }),
      row({ storeId: 'posted', latestPayroll: run('POSTED', '2026-08-01T09:00:00Z') }),
      row({ storeId: 'approved', latestPayroll: run('APPROVED', '2026-10-15T09:00:00Z') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual([
      'locked', 'posted', 'approved', 'draft', 'voided',
    ]);
  });

  it('the recency trap is closed: a NOVEMBER text never beats a MARCH of the later year — rank and createdAt decide, not periodName', () => {
    const rows = [
      row({ storeId: 'old-period-late-year', latestPayroll: run('POSTED', '2025-11-01T00:00:00Z', 'November 2025') }),
      row({ storeId: 'new-period-early-year', latestPayroll: run('POSTED', '2026-03-01T00:00:00Z', 'March 2026') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual([
      'new-period-early-year', 'old-period-late-year',
    ]);
  });

  it('inside one rank, desc puts the freshest run first (directional createdAt)', () => {
    const rows = [
      row({ storeId: 'older', latestPayroll: run('POSTED', '2026-08-01T09:00:00Z') }),
      row({ storeId: 'newer', latestPayroll: run('POSTED', '2026-09-15T09:00:00Z') }),
      row({ storeId: 'newest', latestPayroll: run('POSTED', '2026-10-02T09:00:00Z') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual([
      'newest', 'newer', 'older',
    ]);
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'asc' }).map((r) => r.storeId)).toEqual([
      'older', 'newer', 'newest',
    ]);
  });

  it('asc is the honest MIRROR: least final first — the who-needs-attention scan', () => {
    const rows = [
      row({ storeId: 'locked', latestPayroll: run('LOCKED', '2026-09-01T09:00:00Z') }),
      row({ storeId: 'voided', latestPayroll: run('VOIDED', '2026-10-20T09:00:00Z') }),
      row({ storeId: 'draft', latestPayroll: run('DRAFT', '2026-10-01T09:00:00Z') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'asc' }).map((r) => r.storeId)).toEqual([
      'voided', 'draft', 'locked',
    ]);
  });

  it('same rank, same instant: periodName keeps its A→Z voice as the FINAL tie', () => {
    const rows = [
      row({ storeId: 'zeta', latestPayroll: run('POSTED', '2026-09-01T09:00:00Z', 'September 2026') }),
      row({ storeId: 'alpha', latestPayroll: run('POSTED', '2026-09-01T09:00:00Z', 'August 2026') }),
      row({ storeId: 'mid', latestPayroll: run('POSTED', '2026-09-01T09:00:00Z', 'March 2026') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual([
      'zeta', 'mid', 'alpha',
    ]);
  });

  it('a branch with NO run sorts LAST in BOTH directions — the v2.183.0 absence rule rides untouched', () => {
    const rows = [
      row({ storeId: 'no-run-1', latestPayroll: null }),
      row({ storeId: 'locked', latestPayroll: run('LOCKED', '2026-09-01T09:00:00Z') }),
      row({ storeId: 'no-run-2', latestPayroll: null }),
      row({ storeId: 'voided', latestPayroll: run('VOIDED', '2026-10-20T09:00:00Z') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual([
      'locked', 'voided', 'no-run-1', 'no-run-2',
    ]);
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'asc' }).map((r) => r.storeId)).toEqual([
      'voided', 'locked', 'no-run-1', 'no-run-2',
    ]);
  });

  it('an unparseable createdAt reads as the oldest within its rank — never NaN, never a thrown date', () => {
    const rows = [
      row({ storeId: 'garbage-stamp', latestPayroll: run('POSTED', 'not-a-date') }),
      row({ storeId: 'real-stamp', latestPayroll: run('POSTED', '2026-09-01T09:00:00Z') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual([
      'real-stamp', 'garbage-stamp',
    ]);
  });

  it('the input is never mutated — a copied sort, the v2.183.0 contract', () => {
    const rows = [
      row({ storeId: 'b', latestPayroll: run('DRAFT', '2026-10-01T09:00:00Z') }),
      row({ storeId: 'a', latestPayroll: run('LOCKED', '2026-09-01T09:00:00Z') }),
    ];
    const snapshot = rows.map((r) => r.storeId);
    sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' });
    expect(rows.map((r) => r.storeId)).toEqual(snapshot);
  });

  it('full ties keep arrival order (the stable sort) — same rank, same instant, same name', () => {
    const rows = [
      row({ storeId: 'first', latestPayroll: run('POSTED', '2026-09-01T09:00:00Z', 'September 2026') }),
      row({ storeId: 'second', latestPayroll: run('POSTED', '2026-09-01T09:00:00Z', 'September 2026') }),
    ];
    expect(sortHrDrillRows(rows, { key: 'payroll', dir: 'desc' }).map((r) => r.storeId)).toEqual([
      'first', 'second',
    ]);
  });
});

describe('the category move - payroll leaves TEXT, joins RANK', () => {
  it('the vocabulary: four numeric, ONE text, ONE rank', () => {
    expect([...HR_DRILL_NUMERIC_COLUMNS]).toEqual(['headcount', 'cost', 'absence', 'alerts']);
    expect([...HR_DRILL_TEXT_COLUMNS]).toEqual(['branch']);
    expect([...HR_DRILL_RANK_COLUMNS]).toEqual(['payroll']);
  });

  it('a fresh payroll click is desc — most final first, never the voided branches on top', () => {
    expect(defaultDirFor('payroll')).toBe('desc');
    expect(nextSortState(null, 'payroll')).toEqual({ key: 'payroll', dir: 'desc' });
    expect(nextSortState({ key: 'payroll', dir: 'desc' }, 'payroll')).toEqual({ key: 'payroll', dir: 'asc' });
  });

  it('the text and numeric defaults ride untouched', () => {
    expect(defaultDirFor('branch')).toBe('asc');
    expect(defaultDirFor('alerts')).toBe('desc');
    expect(defaultDirFor('mystery')).toBe('asc');
  });

  it('the lib stays pure — no window, no document, no clock construct (Date.parse is a pure decoder)', () => {
    expect(sortLib).not.toContain('window.');
    expect(sortLib).not.toContain('document.');
    expect(sortLib).not.toContain('new Date');
    expect(sortLib).not.toContain('Date.now');
  });

  it('the rank language is written down — the lib header says WHY periodName text lost the primary axis', () => {
    expect(sortLib).toContain('STATUS RANK');
    expect(sortLib).toContain('finality');
    expect(sortLib).toContain('November 2025');
  });
});

describe('the component contract - the honest hint on the rank sort', () => {
  it('the payroll column carries the hint; the spec keeps its stock rhythm', () => {
    expect(comp).toContain("key: 'payroll',");
    expect(comp).toContain("label: 'Latest payroll',");
    expect(comp).toContain('Sorts by run finality: locked & posted first, then approved, draft, voided.');
    expect(comp).toContain('Click again for the mirror (least final first). Branches with no runs sort last.');
  });

  it('the hint rides the button title — the semantics live where the click happens', () => {
    expect(comp).toContain('title={c.hint}');
  });

  it('the v2.183.0 machinery rides untouched — the ONE sorted memo feeds body AND CSV', () => {
    expect(comp).toContain('() => (summary?.hrPerStore ? sortHrDrillRows(summary.hrPerStore, hrSort) : []),');
    expect(comp).toContain('aria-sort={hrAriaSortOf(c.key)}');
    expect(comp).toContain("<BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />");
  });
});

describe('the styling math - the avatar-hue family carries its numbers', () => {
  it('the contrast-math script exists and models the real composite stacks', () => {
    const script = readRepo('scripts/contrast-math-avatar-hues-v2190.mjs');
    expect(script).toContain('bg-{c}-500/20');
    expect(script).toContain('node_modules/tailwindcss/theme.css');
    expect(script).toContain("'calm'");
    expect(script).toContain("'hover'");
    expect(script).toContain("'drilled'");
  });

  it('the a11y recipe doc records the family as reviewed-passing', () => {
    expect(a11yDoc).toContain("the desk roster's avatar-hue family (v2.190.0)");
    expect(a11yDoc).toContain('24/24');
  });
});

describe('docs and release surfaces', () => {
  it('package.json rides at 2.190.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.196.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.196.0');
    expect(pkg.mbumah.baseVersion).toBe('2.196.0');
    expect(pkg.scripts['verify:v2-190-0']).toBe('node scripts/verify-v2-190-0.mjs');
    expect(pkg.scripts['verify:v2-189-0']).toBe('node scripts/verify-v2-189-0.mjs');
    expect(readRepo('scripts/verify-v2-190-0.mjs')).toContain('v2.190.0 verification');
  });

  it('the CHANGELOG heads with this release', () => {
    const changelog = readRepo('CHANGELOG.md');
    expect(changelog).toContain('## [2.190.0] The drill-down ranks its payrolls');
    expect(changelog.indexOf('## [2.190.0]')).toBeLessThan(changelog.indexOf('## [2.189.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    const whatsNew = readRepo('src/lib/whats-new.ts');
    expect(whatsNew).toContain("version: '2.190.0'");
    expect(whatsNew).toContain("title: 'The drill-down ranks its payrolls'");
    expect(whatsNew.indexOf('2.190.0')).toBeLessThan(whatsNew.indexOf('2.189.0'));
  });

  it('the workspace doc carries the rank sentence', () => {
    const doc = readRepo('docs/multi-store-workspaces.md');
    expect(doc).toContain('v2.190.0 — the payroll column sorts by STATUS RANK');
  });
});
