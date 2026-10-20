import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.187.0 — the modal learns the lens.
 *
 * v2.185.0 reconciled the two revenues: the headline is GROSS of tax on
 * both org surfaces, and the analyst's net/VAT view moved under an
 * explicitly-labeled ribbon. But the lens stayed a STRIP — one week tax
 * figure, one net figure — while the modal's chart and stat grid spoke
 * only the gross face, and `taxPriorWeekTotal` had no consumer at all.
 *
 * This release the lens deepens into a full second face of the SAME read:
 *
 *   1. `netSpark` — the per-day net-of-VAT buckets — fills alongside the
 *      gross buckets in the SAME loop over the SAME rows (sparkRows has
 *      selected `taxAmount` since v2.185.0): ZERO extra queries, two
 *      faces of one read, computed in one pass.
 *   2. `netTodayTotal` and `netPriorWeekTotal` join additively so EVERY
 *      cell of the modal's stat grid can follow the lens — and the VAT
 *      ribbon grows the week-over-week chip (taxPriorWeekTotal's first
 *      consumer).
 *   3. The modal grows an explicit Gross/Net toggle: gross is the DEFAULT
 *      and the contract (the v2.185.0 headline vocabulary never re-keys);
 *      the toggle renders ONLY when the payload carried the per-day net
 *      buckets (an older cached answer keeps the calm gross modal, never
 *      a broken control); the net line wears violet so a glance can never
 *      mistake the two faces; and the branch rows step aside honestly in
 *      the net lens (per-branch tax is not on the wire — a net-by-branch
 *      row would be a fabrication).
 *
 * Structural pins, the house way (this suite's v2.185.0 sibling is fully
 * structural too): the gross spark is pinned UNTOUCHED, the net buckets
 * are pinned INTO the same pass, the subtraction stays plain-number (the
 * Decimal-minus pin holds), the tolerance gates are pinned, and every
 * forbidden phrasing stays out.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const kpiRoute = readRepo('src/app/api/org/kpi-summary/route.ts');
const kpiRow = readRepo('src/components/org/kpi-row.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');
const pkg = JSON.parse(readRepo('package.json'));

describe('the kpi-summary route - the net buckets fill in the SAME pass', () => {
  it('the net buckets are declared beside the gross buckets and filled in the same loop', () => {
    expect(kpiRoute).toContain('const netBuckets = new Array<number>(7).fill(0);');
    expect(kpiRoute).toContain('sparkBuckets[i] += toDec(row.totalAmount).toNumber();');
    expect(kpiRoute).toContain('netBuckets[i] += toDec(row.totalAmount).toNumber() - toDec(row.taxAmount).toNumber();');
  });

  it('the gross spark keeps its exact shape - the till face is untouched', () => {
    expect(kpiRoute).toContain('const spark = sparkBuckets.map((v) => round2(v));');
    expect(kpiRoute).toContain('7-day gross-revenue sparkline');
  });

  it('the net spark is a NEW additive name derived from the net buckets', () => {
    expect(kpiRoute).toContain('const netSpark = netBuckets.map((v) => round2(v));');
    // The two faces never share a variable - each face keeps its own name.
    expect(kpiRoute.indexOf('const spark = sparkBuckets.map')).toBeLessThan(kpiRoute.indexOf('const netSpark = netBuckets.map'));
  });

  it('the missing net windows are computed from the aggregates already fetched', () => {
    expect(kpiRoute).toContain('const netToday = round2(toDec(todayAgg._sum.totalAmount).toNumber() - toDec(todayAgg._sum.taxAmount).toNumber());');
    expect(kpiRoute).toContain('const netPrior = round2(toDec(priorAgg._sum.totalAmount).toNumber() - toDec(priorAgg._sum.taxAmount).toNumber());');
    // Plain number subtraction - the gross path's Decimal-minus pin holds.
    expect(kpiRoute).not.toContain('.minus(toDec(sums.taxAmount))');
    expect(kpiRoute).not.toContain('netOf');
  });

  it('the payload carries the deepened lens ADDITIVELY under new names', () => {
    expect(kpiRoute).toContain('netTodayTotal: netToday,');
    expect(kpiRoute).toContain('netPriorWeekTotal: netPrior,');
    expect(kpiRoute).toContain('netSpark,');
    // The v2.185.0 lens block stays exactly where it was.
    expect(kpiRoute).toContain('taxWeekTotal: taxWeek,');
    expect(kpiRoute).toContain('taxPriorWeekTotal: taxPrior,');
    expect(kpiRoute).toContain('netWeekTotal: netWeek,');
  });

  it('the route header records the deepening - zero extra queries, gross untouched', () => {
    expect(kpiRoute).toContain('v2.187.0 (the lens deepens)');
    expect(kpiRoute).toContain('ZERO extra');
    expect(kpiRoute).toContain('`spark` stays the gross');
  });
});

describe('the modal - the explicit Gross/Net lens toggle', () => {
  it('gross is the DEFAULT lens - the v2.185.0 contract survives the toggle', () => {
    expect(kpiRow).toContain("useState<'gross' | 'net'>('gross')");
  });

  it('the toggle renders ONLY when the payload carried the per-day net buckets', () => {
    expect(kpiRow).toContain('Array.isArray(k.revenue.netSpark) && k.revenue.netSpark.length === 7');
    expect(kpiRow).toContain('{netReady && (');
  });

  it('the toggle is an accessible grouped control with pressed state', () => {
    expect(kpiRow).toContain('role="group" aria-label="Revenue lens"');
    expect(kpiRow).toContain('data-testid="revenue-lens-toggle"');
    expect(kpiRow).toContain('aria-pressed={lens === l}');
    expect(kpiRow).toContain('data-testid={`revenue-lens-${l}`}');
  });

  it('the active face wears its own hue - emerald gross, violet net', () => {
    expect(kpiRow).toContain("'bg-emerald-600 text-white shadow'");
    expect(kpiRow).toContain("'bg-violet-600 text-white shadow'");
  });

  it('the title follows the lens and the forbidden phrasing stays out', () => {
    expect(kpiRow).toContain("lens === 'gross' ? 'Revenue trend (gross)' : 'Revenue trend (net)'");
    expect(kpiRow).not.toContain('Revenue trend (net of VAT)');
  });

  it('the net spark wears violet - a different face, a different hue', () => {
    expect(kpiRow).toContain('stroke="#8b5cf6"');
    expect(kpiRow).toContain('k.revenue.netSpark ?? []');
  });

  it('the net stat grid mirrors the gross grid cell for cell - never a NaN', () => {
    expect(kpiRow).toContain('data-testid="revenue-net-today"');
    expect(kpiRow).toContain('data-testid="revenue-net-week"');
    expect(kpiRow).toContain('data-testid="revenue-net-prior"');
    expect(kpiRow).toContain('data-testid="revenue-net-avg"');
    expect(kpiRow).toContain('k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0)');
    expect(kpiRow).toContain('k.revenue.netTodayTotal ?? 0');
    expect(kpiRow).toContain('k.revenue.netPriorWeekTotal ?? 0');
  });

  it('the branch rows speak GROSS only - the net lens steps them aside honestly', () => {
    expect(kpiRow).toContain("branchWeek && branchWeek.length > 0 && lens === 'gross'");
    expect(kpiRow).toContain("branchWeek && branchWeek.length > 0 && lens === 'net'");
    expect(kpiRow).toContain('net by branch is not on the wire');
    // The v2.185.0 one-till-face note keeps its place in the gross lens.
    expect(kpiRow).toContain('branch shapes and the org line above speak the same gross till face');
  });

  it('the VAT ribbon keeps its v2.185.0 contract AND grows the week-over-week', () => {
    expect(kpiRow).toContain('{k.revenue.taxWeekTotal != null && (');
    expect(kpiRow).toContain('incl. VAT (7d)');
    expect(kpiRow).toContain('net {kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - k.revenue.taxWeekTotal)}');
    expect(kpiRow).toContain('border-emerald-100 bg-emerald-50/70');
    expect(kpiRow).toContain('data-testid="revenue-vat-wow"');
    expect(kpiRow).toContain('k.revenue.taxPriorWeekTotal != null && (() => {');
    // The WeekDeltaChip honesty rule: a zero prior invents no percentage.
    expect(kpiRow).toContain('k.revenue.taxPriorWeekTotal > 0 ? Math.round((vatDelta / k.revenue.taxPriorWeekTotal) * 1000) / 10 : null');
  });

  it('the KPI card itself stays the calm gross story - the toggle lives in the modal', () => {
    expect(kpiRow).toContain('>gross</span>');
  });
});

describe('the type - the deepened lens rides OPTIONAL', () => {
  it('KpiSummaryData carries the new fields as optional - an older answer stays calm', () => {
    expect(primitives).toContain('netTodayTotal?: number; netPriorWeekTotal?: number; netSpark?: number[]');
    // The v2.185.0 fields keep their exact contiguity (the sibling suite pins it).
    expect(primitives).toContain('taxWeekTotal?: number; taxPriorWeekTotal?: number; netWeekTotal?: number');
  });
});

describe('the recorded history - the doc tells the deepening', () => {
  it('the trend row records the lens toggle and the honest branch absence', () => {
    expect(doc).toContain('explicit Gross/Net toggle backed by `netSpark`');
    expect(doc).toContain('netTodayTotal`/`netPriorWeekTotal');
    expect(doc).toContain('`spark` and the headline stay gross');
  });
});

describe('the version contract', () => {
  it('package.json rides at 2.189.0', () => {
    expect(pkg.version).toBe('2.189.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.189.0');
    expect(pkg.mbumah.baseVersion).toBe('2.189.0');
  });

  it('the fresh verify surface is wired beside the prior one', () => {
    expect(pkg.scripts['verify:v2-187-0']).toBeTruthy();
    expect(pkg.scripts['verify:v2-186-0']).toBeTruthy();
  });
});
