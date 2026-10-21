import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.185.0 — the two revenues agree.
 *
 * Since v2.173.0 the two org surfaces put DIFFERENT numbers under the same
 * "Revenue" label: the owner dashboard's /api/org/summary spoke GROSS of tax
 * (`_sum.totalAmount`, the till face), while the expert console's
 * /api/org/kpi-summary subtracted `taxAmount` and spoke NET. The divergence
 * was recorded in v2.173.0, labeled into both CSVs (v2.178.0/v2.179.0), and
 * carried twice as the top reconciliation pick — this release it lands:
 *
 *   1. kpi-summary's revenue (today, week, prior, spark) is GROSS — the
 *      SAME `_sum.totalAmount` the summary speaks; the `netOf` helper is
 *      GONE (a subtraction on the revenue path can never come back).
 *   2. The VAT lens did not die: the payload carries `taxWeekTotal`,
 *      `taxPriorWeekTotal` and `netWeekTotal` ADDITIVELY, so an older
 *      client (and the health model) never has to care it arrived.
 *   3. The health model's revenue detail speaks "7d gross KES …".
 *   4. The console modal retitles to "Revenue trend (gross)", renders the
 *      emerald VAT ribbon ONLY when the additive fields arrived (tolerant:
 *      no NaN, no crash on an older cached answer), and the branch note
 *      says every shape speaks the same till face.
 *   5. The recorded-divergence comments (org/summary route, summary-trend
 *      lib, docs) and both CSV note lines now record the AGREEMENT.
 *
 * Structural pins, the house way: the subtraction is pinned OUT, the
 * additive fields are pinned IN, the tolerance is pinned, and the one
 * revenue contract is pinned across BOTH routes.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const kpiRoute = readRepo('src/app/api/org/kpi-summary/route.ts');
const summaryRoute = readRepo('src/app/api/org/summary/route.ts');
const kpiRow = readRepo('src/components/org/kpi-row.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const trendLib = readRepo('src/lib/org/summary-trend.ts');
const branchesCsv = readRepo('src/lib/org/branches-csv.ts');
const matrixCsv = readRepo('src/lib/org/store-matrix-csv.ts');
const doc = readRepo('docs/multi-store-workspaces.md');
const pkg = JSON.parse(readRepo('package.json'));

describe('the kpi-summary route - gross by contract', () => {
  it('the revenue path sums totalAmount AS-IS - no tax subtraction anywhere on it', () => {
    // The old net helper is GONE — its name may never return on this route.
    expect(kpiRoute).not.toContain('netOf');
    expect(kpiRoute).toContain('const grossOf = (sums: { totalAmount: Parameters<typeof toDec>[0] }) =>');
    expect(kpiRoute).toContain('toDec(sums.totalAmount);');
    expect(kpiRoute).not.toContain('.minus(toDec(sums.taxAmount))');
  });

  it('the headline variables read through grossOf, and the spark buckets too', () => {
    expect(kpiRoute).toContain('const revToday = round2(grossOf(todayAgg._sum));');
    expect(kpiRoute).toContain('const revWeek = round2(grossOf(weekAgg._sum));');
    expect(kpiRoute).toContain('const revPrior = round2(grossOf(priorAgg._sum));');
    expect(kpiRoute).toContain('sparkBuckets[i] += toDec(row.totalAmount).toNumber();');
    expect(kpiRoute).toContain('7-day gross-revenue sparkline');
  });

  it('the aggregates still sum taxAmount - the VAT lens needs the raw sums', () => {
    expect(kpiRoute).toContain('_sum: { totalAmount: true, taxAmount: true }');
    expect(kpiRoute).toContain('const taxWeek = round2(toDec(weekAgg._sum.taxAmount));');
    expect(kpiRoute).toContain('const taxPrior = round2(toDec(priorAgg._sum.taxAmount));');
    expect(kpiRoute).toContain('const netWeek = round2(revWeek - taxWeek);');
  });

  it('the payload carries the lens ADDITIVELY - additive, labeled, never mixed', () => {
    expect(kpiRoute).toContain('taxWeekTotal: taxWeek,');
    expect(kpiRoute).toContain('taxPriorWeekTotal: taxPrior,');
    expect(kpiRoute).toContain('netWeekTotal: netWeek,');
    expect(kpiRoute).toContain('the headline numbers are GROSS');
  });

  it('the route header records the reconciliation, not a live divergence', () => {
    expect(kpiRoute).toContain('REVENUE SEMANTICS (v2.185.0');
    expect(kpiRoute).toContain('the two revenues agree');
    expect(kpiRoute).toContain('ADDITIVELY');
  });

  it('the health model revenue detail speaks gross', () => {
    expect(kpiRoute).toContain("detail: `7d gross KES ${revWeek.toLocaleString('en-KE')} vs prior ${revPrior.toLocaleString('en-KE')}`");
  });
});

describe('the one revenue contract across BOTH org routes', () => {
  it('both routes speak the same gross till face', () => {
    expect(kpiRoute).toContain('the SAME number\n    // /api/org/summary puts under "Revenue today"');
    expect(summaryRoute).toContain('GROSS by contract');
    expect(summaryRoute).toContain('RECONCILED in v2.185.0');
  });

  it('the trend lib header retires the divergence note - this contract is THE contract', () => {
    expect(trendLib).toContain('RECONCILED in v2.185.0');
    expect(trendLib).toContain('not one side of a divergence');
  });
});

describe('the console modal - gross lead + the tolerant VAT ribbon', () => {
  it('the modal retitles to gross and the chip wears the till-face qualifier', () => {
    expect(kpiRow).toContain('Revenue trend (gross)');
    expect(kpiRow).not.toContain('Revenue trend (net of VAT)');
    expect(kpiRow).toContain('>gross</span>');
  });

  it('the VAT ribbon renders ONLY when the additive fields arrived', () => {
    expect(kpiRow).toContain('{k.revenue.taxWeekTotal != null && (');
    expect(kpiRow).toContain('incl. VAT (7d)');
    expect(kpiRow).toContain('net {kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - k.revenue.taxWeekTotal)}');
  });

  it('the ribbon is labeled emerald - never a bare second number', () => {
    expect(kpiRow).toContain('Week revenue net of VAT');
    expect(kpiRow).toContain('border-emerald-100 bg-emerald-50/70');
  });

  it('the branch note speaks the one till face', () => {
    expect(kpiRow).toContain('branch shapes and the org line above speak the same gross till face');
    // The RETIRED phrasings may never return (the ribbon's own labeled
    // "net of VAT" tooltip is the additive lens — that one stays).
    expect(kpiRow).not.toContain('Revenue trend (net of VAT)');
    expect(kpiRow).not.toContain('org line above is net of VAT');
  });

  it('the KpiSummaryData type carries the lens as OPTIONAL - tolerant of an older answer', () => {
    expect(primitives).toContain('taxWeekTotal?: number; taxPriorWeekTotal?: number; netWeekTotal?: number');
  });
});

describe('the recorded history - comments, docs, CSV notes', () => {
  it('the branches CSV note records the agreement', () => {
    expect(branchesCsv).toContain('the org trend line and the expert console KPI agree (gross till face, reconciled v2.185.0)');
    expect(branchesCsv).not.toContain('is net of VAT');
  });

  it('the matrix CSV note records the agreement', () => {
    expect(matrixCsv).toContain('the expert console KPI agrees (gross till face, reconciled v2.185.0)');
    expect(matrixCsv).not.toContain('is net of VAT');
  });

  it('the doc records divergence → reconciliation', () => {
    expect(doc).toContain('COMPUTED its revenue NET of tax');
    expect(doc).toContain('RECONCILED in v2.185.0');
    expect(doc).toContain('taxWeekTotal`/`netWeekTotal');
  });
});

describe('the version contract', () => {
  it('package.json rides at 2.185.0', () => {
    expect(pkg.version).toBe('2.202.1');
    expect(pkg.mbumah.releaseVersion).toBe('2.202.1');
    expect(pkg.mbumah.baseVersion).toBe('2.202.1');
  });
});
