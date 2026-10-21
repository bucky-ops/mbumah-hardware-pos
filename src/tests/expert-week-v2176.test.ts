import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.176.0 — the expert console reads the week by branch.
 *
 * The org dashboard's branches table has spoken per-branch week shapes
 * since v2.175.0; the expert console (/console) already polls the SAME
 * /api/org/summary response every 30s but never drew it. This release:
 *   1. the store strip draws each branch's muted slate spark (72×20,
 *      #64748b — the dashboard's exact vocabulary), joined by storeId,
 *      the gross week total on the title tooltip + sr-only, an honest
 *      dash row when the block is absent;
 *   2. the Revenue drill-down lists the week by branch under the org
 *      line — loudest week first, with the net-vs-gross note spelled
 *      out where both vocabularies meet.
 *
 * The join/sort EXECUTED here (by storeId, never row order; ties keep
 * the payload's order), the tolerant degradations are pinned (null
 * block, missing entry, empty stores — nothing fabricated), and the
 * page wiring pins the no-second-fetch contract.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const primitives = readRepo('src/components/org/primitives.tsx');
const page = readRepo('src/app/(shell)/console/page.tsx');
const kpiRow = readRepo('src/components/org/kpi-row.tsx');
const dashboard = readRepo('src/components/workspace/org-console.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');
const whatsNew = readRepo('src/lib/whats-new.ts');

/** The executed join+sort the KpiRow modal speaks — mirrored from the card. */
const branchWeekOf = (
  perStoreTrend: Array<{ storeId: string; spark: number[]; weekTotal: number }> | null | undefined,
  stores: Array<{ id: string; name: string }>,
) =>
  perStoreTrend && stores.length > 0
    ? perStoreTrend
        .map((t) => ({
          storeId: t.storeId,
          spark: t.spark,
          weekTotal: t.weekTotal,
          name: stores.find((s) => s.id === t.storeId)?.name ?? 'Branch',
        }))
        .sort((a, b) => b.weekTotal - a.weekTotal)
    : null;

const trend = (id: string, weekTotal: number, spark: number[] = [1, 2, 3]) => ({ storeId: id, spark, weekTotal });
const store = (id: string, name: string) => ({ id, name });

describe('the executed join - by storeId, loudest week first', () => {
  it('joins by storeId — another branch\'s total never lands on the wrong name', () => {
    const rows = branchWeekOf(
      [trend('s1', 100), trend('s2', 300)],
      [store('s1', 'Juja Main'), store('s2', 'Thika')],
    );
    expect(rows).not.toBeNull();
    expect((rows ?? [])[0]?.name).toBe('Thika'); // loudest first
    expect((rows ?? [])[1]?.name).toBe('Juja Main');
  });

  it('sorts loudest week first regardless of payload order', () => {
    const rows = branchWeekOf(
      [trend('a', 50), trend('b', 900), trend('c', 400)],
      [store('a', 'A'), store('b', 'B'), store('c', 'C')],
    );
    expect((rows ?? []).map((r) => r.name)).toEqual(['B', 'C', 'A']);
  });

  it('ties keep the payload\'s order (Array.sort is stable)', () => {
    const rows = branchWeekOf(
      [trend('a', 100), trend('b', 100)],
      [store('a', 'A'), store('b', 'B')],
    );
    expect((rows ?? []).map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('a branch with no entry in stores degrades to the honest "Branch" label — never a crash', () => {
    const rows = branchWeekOf([trend('ghost', 10)], [store('s1', 'Juja Main')]);
    expect((rows ?? [])[0]?.name).toBe('Branch');
  });

  it('the spark array rides through untouched — the card never reshapes the lib\'s zeros', () => {
    const spark = [0, 0, 0, 0, 0, 0, 5];
    const rows = branchWeekOf([trend('s1', 5, spark)], [store('s1', 'Juja Main')]);
    expect((rows ?? [])[0]?.spark).toBe(spark); // same reference — pure carry
  });
});

describe('the tolerant degradations', () => {
  it('null trend block → null rows (branch manager without matrix access)', () => {
    expect(branchWeekOf(null, [store('s1', 'Juja Main')])).toBeNull();
  });

  it('undefined trend block → null rows (an older cached answer)', () => {
    expect(branchWeekOf(undefined, [store('s1', 'Juja Main')])).toBeNull();
  });

  it('empty stores → null rows (the modal keeps its org-wide story only)', () => {
    expect(branchWeekOf([trend('s1', 100)], [])).toBeNull();
  });
});

describe('the type contract - one tolerant declaration, two surfaces', () => {
  it('OrgSummaryData (expert console) grows the SAME tolerant perStoreTrend the dashboard speaks', () => {
    expect(primitives).toContain('perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;');
    expect(dashboard).toContain('perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;');
  });

  it('KpiRow carries the same optional prop shape + the stores list for names', () => {
    expect(kpiRow).toContain('perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;');
    expect(kpiRow).toContain('stores?: StoreRow[];');
  });
});

describe('the strip contract - the dashboard\'s exact vocabulary', () => {
  it('the page imports the Sparkline primitive — no new chart code', () => {
    expect(page).toContain("import { KenyaMap, Sparkline, WeekDeltaChip, weekDeltaWords, kes");
  });

  it('the strip joins by storeId from the summary it already polls', () => {
    expect(page).toContain('summary?.perStoreTrend?.find((t) => t.storeId === s.id) ?? null');
  });

  it('the spark is muted slate, 72×20 — the dashboard table\'s exact numbers', () => {
    expect(page).toContain('stroke="#64748b"');
    expect(page).toContain('width={72} height={20}');
    expect(dashboard).toContain('stroke="#64748b"');
    expect(dashboard).toContain('width={72} height={20}');
  });

  it('the gross week total rides the title tooltip AND an sr-only clause', () => {
    // evolved for v2.177.0: the tooltip gains the prior week exactly when one
    // exists; the base sr-only clause keeps its exact v2.176.0 shape.
    expect(page).toContain("title={`7-day revenue ${kes(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${kes(storeTrend.priorWeekTotal)}` : ''}`}");
    expect(page).toContain('<span className="sr-only">7-day revenue {kes(storeTrend.weekTotal)}</span>');
  });

  it('an absent block keeps a calm dash row at spark height — never a fabricated shape', () => {
    expect(page).toContain('min-h-[20px] items-center');
    expect(page).toContain("className=\"text-[10px] text-muted-foreground\">—</span>");
  });

  it('the spark sits inside the existing workspace door — the card\'s click target untouched', () => {
    expect(page).toContain("onClick={() => window.open(storeHref(s), '_blank', 'noopener')}");
  });

  it('the KpiRow wiring rides the polled summary — no second fetch', () => {
    expect(page).toContain('perStoreTrend={summary?.perStoreTrend ?? null}');
    expect(page).toContain('stores={stores}');
  });
});

describe('the modal contract - the week by branch', () => {
  it('the drill-down names the section + speaks the reconciled gross note where both vocabularies meet', () => {
    expect(kpiRow).toContain('The week by branch');
    // v2.185.0: the net-vs-gross qualifier retires — every shape in the
    // modal speaks the same gross till face, and the note says exactly that.
    expect(kpiRow).toContain('branch shapes and the org line above speak the same gross till face');
  });

  it('the join is executed in the card, by storeId, with the honest fallback label', () => {
    expect(kpiRow).toContain('stores.find((s) => s.id === t.storeId)?.name ?? \'Branch\'');
  });

  it('the rows sort loudest week first', () => {
    expect(kpiRow).toContain('.sort((a, b) => b.weekTotal - a.weekTotal)');
  });

  it('the section renders only when BOTH halves arrived — honest absence otherwise', () => {
    // v2.187.0: the gate grew the lens — the branch rows speak the GROSS
    // face only (per-branch tax is not on the wire), so the section now
    // renders only in the gross lens; the net lens steps them aside with
    // an honest note (pinned in revenue-net-lens-v2187). The honest
    // absence rule itself is unchanged: both halves or nothing.
    expect(kpiRow).toContain("{branchWeek && branchWeek.length > 0 && lens === 'gross' && (");
  });

  it('each row: spark + name + week total, the spark aria-hidden decoration', () => {
    expect(kpiRow).toContain('<Sparkline data={b.spark} stroke="#64748b" width={72} height={20} />');
    expect(kpiRow).toContain('<span className="truncate text-xs text-slate-600 dark:text-slate-400">{b.name}</span>');
    expect(kpiRow).toContain('{kes(b.weekTotal)}</span>');
  });

  it('the modal keeps its org-wide gross lead — the branches speak underneath, not instead', () => {
    // v2.185.0: the lead is GROSS (the reconciliation) — same position rule.
    expect(kpiRow.indexOf('Revenue trend (gross)')).toBeLessThan(kpiRow.indexOf('The week by branch'));
    expect(kpiRow).toContain('<Sparkline data={k.revenue.spark} width={380} height={80} />');
  });
});

describe('the doc contract', () => {
  it('the doc teaches the expert console week', () => {
    expect(doc).toContain('The expert console (`/console`) speaks the same week (v2.176.0)');
    expect(doc).toContain('no second fetch');
  });

  it('the KPI table defines both v2.176.0 rows', () => {
    expect(doc).toContain('| Trend · expert strip spark |');
    expect(doc).toContain('| Trend · expert drill-down by branch |');
  });

  it('the v2.173–v2.175 trend rows stay on the record', () => {
    expect(doc).toContain('| Trend · Revenue spark |');
    expect(doc).toContain('| Trend · top mover |');
    expect(doc).toContain('| Trend · mover link |');
    expect(doc).toContain('| Trend · per-branch 7d spark |');
  });
});

describe('the release surfaces', () => {
  it('the changelog head speaks v2.176.0', () => {
    expect(readRepo('CHANGELOG.md')).toContain('## [2.176.0] The expert console reads the week by branch');
  });

  it('the whats-new feed leads with v2.176.0', () => {
    expect(whatsNew).toContain("version: '2.176.0'");
    expect(whatsNew.indexOf('2.176.0')).toBeLessThan(whatsNew.indexOf('2.175.0'));
  });

  it('package.json leads the current version in all three slots + the verify script (re-anchored for 2.181.0)', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.194.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.194.0');
    expect(pkg.mbumah.baseVersion).toBe('2.194.0');
    expect(pkg.scripts['verify:v2-176-0']).toBe('node scripts/verify-v2-176-0.mjs');
  });
});
