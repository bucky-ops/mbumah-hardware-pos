import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGateVerdict, buildGateVerdictText, gateVerdictTone, type GateVerdictSummary } from '@/lib/hr/payroll/gate-verdict';

/**
 * v2.135.0 — the verdict leaves a paper trail.
 *
 * Gap: the v2.133.0 gate door speaks the verdict live, but the verdict
 * evaporated the moment it was spoken — prepare's own gate evaluation left
 * NO trace on the run it protected. A clear prepare proved nothing; an
 * auditor asking "what did the gate say when THIS run went through?" got
 * folklore, not history.
 *
 * Covered here:
 *  1. The pure module `gate-verdict.ts`: the tolerant parser (null for
 *     pre-v2.135.0 rows, arrays, malformed shapes, tallies that do not add
 *     up, unknown codes; checkedAt must parse or degrades to null), the
 *     verdict text (the live panel's own words and order; zero counts never
 *     speak), and the tone switch the UI keys its wardrobe off.
 *  2. The freeze contract: prepare's loop tallies the gate verdict and
 *     stamps gateCheckedAt + gateSummary on BOTH paths — the blocked path
 *     (the stop is as much history as the pass) and the success path inside
 *     the re-prepare transaction.
 *  3. The honesty contracts: pre-v2.135.0 runs render NOTHING in the runs
 *     table (never a fabricated verdict), the run dialog says "prepared
 *     before v2.135.0" once and plainly, and the list API exposes the
 *     snapshot additively.
 *  4. The remediation door: a MISSING_CONSENT blocked row carries the door
 *     to the Privacy tab's consent ledger (grant lives there since
 *     v2.119.0) — its own tab, aria-labelled, focus-visible. A timesheet
 *     block gets honest text, never a link that would 403 or 404.
 *  5. The styling contract (house discipline): emerald/amber with dark
 *     twins on every verdict surface, tabular numerals, focus-visible rings
 *     on the door.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const service = () => readRepo('src/lib/hr/payroll/run-service.ts');
const listRoute = () => readRepo('src/app/api/payroll/runs/route.ts');
const pageSrc = () => readRepo('src/app/(shell)/hr/payroll/page.tsx');
const dialogSrc = () => readRepo('src/components/hr/payroll-run-dialog.tsx');

const goodSummary: GateVerdictSummary = { total: 5, clear: 5, missingConsent: 0, timesheetNotApproved: 0, codes: [] };
const blockedSummary: GateVerdictSummary = { total: 5, clear: 3, missingConsent: 1, timesheetNotApproved: 1, codes: ['MISSING_CONSENT', 'TIMESHEET_NOT_APPROVED'] };

describe('parseGateVerdict - the tolerant reader of the frozen tally', () => {
  it('accepts a well-formed verdict and keeps its checkedAt', () => {
    const v = parseGateVerdict(goodSummary, '2026-10-19T09:30:00.000Z');
    expect(v).not.toBeNull();
    expect(v?.summary.total).toBe(5);
    expect(v?.summary.clear).toBe(5);
    expect(v?.checkedAt).toBe('2026-10-19T09:30:00.000Z');
  });

  it('returns null for pre-v2.135.0 runs (null/undefined summary) — honest absence', () => {
    expect(parseGateVerdict(null, null)).toBeNull();
    expect(parseGateVerdict(undefined, '2026-10-19T09:30:00.000Z')).toBeNull();
    expect(parseGateVerdict('nope', null)).toBeNull();
    expect(parseGateVerdict(42, null)).toBeNull();
  });

  it('returns null for arrays and for tallies that do not add up', () => {
    expect(parseGateVerdict([goodSummary], null)).toBeNull();
    // 3 + 1 + 1 = 5 but total says 4 — a snapshot that cannot count its own
    // people is not a snapshot, it is noise.
    expect(parseGateVerdict({ ...blockedSummary, total: 4 }, null)).toBeNull();
    expect(parseGateVerdict({ ...goodSummary, clear: '5' }, null)).toBeNull();
    expect(parseGateVerdict({ ...goodSummary, total: -1 }, null)).toBeNull();
    expect(parseGateVerdict({ total: 5, clear: 5 }, null)).toBeNull();
  });

  it('rejects unknown codes and duplicates — the gate speaks only its own two words', () => {
    expect(parseGateVerdict({ ...goodSummary, codes: ['NEGATIVE_NET'] }, null)).toBeNull();
    expect(parseGateVerdict({ ...goodSummary, codes: 'MISSING_CONSENT' }, null)).toBeNull();
    const v = parseGateVerdict({ ...blockedSummary, codes: ['MISSING_CONSENT', 'MISSING_CONSENT', 'TIMESHEET_NOT_APPROVED'] }, null);
    expect(v?.summary.codes).toEqual(['MISSING_CONSENT', 'TIMESHEET_NOT_APPROVED']);
  });

  it('degrades a garbage checkedAt to null but keeps the summary', () => {
    const v = parseGateVerdict(goodSummary, 'not-a-clock');
    expect(v).not.toBeNull();
    expect(v?.checkedAt).toBeNull();
  });
});

describe('buildGateVerdictText - the frozen verdict speaks the live panel\'s words', () => {
  it('a clear run says only "N clear"', () => {
    expect(buildGateVerdictText(goodSummary)).toBe('5 clear');
  });

  it('blocked counts speak in the panel\'s order — clear, missing consent, timesheet pending', () => {
    expect(buildGateVerdictText(blockedSummary)).toBe('3 clear · 1 missing consent · 1 timesheet pending');
  });

  it('zero counts never speak; plurals stay honest', () => {
    expect(buildGateVerdictText({ total: 2, clear: 1, missingConsent: 1, timesheetNotApproved: 0, codes: ['MISSING_CONSENT'] })).toBe('1 clear · 1 missing consent');
    expect(buildGateVerdictText({ total: 4, clear: 1, missingConsent: 0, timesheetNotApproved: 3, codes: ['TIMESHEET_NOT_APPROVED'] })).toBe('1 clear · 3 timesheet pending');
  });

  it('an empty month says "0 clear" — the truth, even when it is awkward', () => {
    expect(buildGateVerdictText({ total: 0, clear: 0, missingConsent: 0, timesheetNotApproved: 0, codes: [] })).toBe('0 clear');
  });
});

describe('gateVerdictTone - the wardrobe switch', () => {
  it('clear when nobody was stopped, blocked when anyone was', () => {
    expect(gateVerdictTone(goodSummary)).toBe('clear');
    expect(gateVerdictTone(blockedSummary)).toBe('blocked');
    expect(gateVerdictTone({ total: 2, clear: 1, missingConsent: 1, timesheetNotApproved: 0, codes: ['MISSING_CONSENT'] })).toBe('blocked');
  });
});

describe('the freeze contract - prepare stamps both paths', () => {
  it('the loop tallies consent and timesheet blocks and stamps the verdict on the BLOCKED path', () => {
    const s = service();
    expect(s).toContain('gateTally.total += 1');
    expect(s).toContain("gateTally.missingConsent += 1");
    expect(s).toContain("gateTally.timesheetNotApproved += 1");
    expect(s).toContain('gateTally.clear += 1');
    // v2.138.0: the snapshot and the trail row share ONE clock per attempt
    // (blockedAt / passedAt) — one moment, two records.
    expect(s).toContain('const blockedAt = new Date();');
    expect(s).toContain('gateCheckedAt: blockedAt');
    expect(s).toContain('gateSummary: gateTally');
    // The blocked path carries the snapshot WITH the issues it explains.
    expect(s).toMatch(/errorMessage: JSON\.stringify\(issues\),[\s\S]{0,400}?gateCheckedAt: blockedAt/);
  });

  it('the SUCCESS path stamps the verdict inside the re-prepare transaction', () => {
    const s = service();
    // v2.138.0: the pass path's shared clock (passedAt) freezes the snapshot
    // AND appends the trail row in the same transaction.
    expect(s).toMatch(/errorMessage: null,[\s\S]{0,600}?gateCheckedAt: passedAt,[\s\S]{0,300}?gateSummary: gateTally/);
    // ...and the stamp sits inside the tx update that also carries preparedAt.
    expect(s).toMatch(/preparedByUserId: ctx\.actorId,[\s\S]{0,900}?gateSummary: gateTally/);
    expect(s).toContain("outcome: 'PASSED'");
    expect(s).toContain('checkedAt: passedAt');
  });

  it('the tally speaks only the gate\'s two words — engine guardrails stay in errorMessage', () => {
    const s = service();
    expect(s).toMatch(/gateTally = \{ total: 0, clear: 0, missingConsent: 0, timesheetNotApproved: 0, codes: \[\] as string\[\] \}/);
  });

  it('the list API exposes the verdict additively (gateCheckedAt + gateSummary)', () => {
    const r = listRoute();
    expect(r).toContain('gateCheckedAt: r.gateCheckedAt?.toISOString() ?? null');
    expect(r).toContain('gateSummary: r.gateSummary ?? null');
  });
});

describe('the honesty contracts - the UI never guesses', () => {
  it('the runs table renders the verdict through the pure parser (no ad-hoc JSON reads)', () => {
    const p = pageSrc();
    expect(p).toContain("parseGateVerdict(run.gateSummary, run.gateCheckedAt)");
    // v2.139.0: the guard widened for the attempts chip (both chips parse
    // through pure builders and BOTH render nothing when absent) — the
    // pinned contract (honest absence, never a guess) is unchanged.
    expect(p).toContain("if (!verdict && !attempts) return null;");
    expect(p).toContain('data-testid="payroll-run-gate-verdict"');
  });

  it('the run dialog renders the verdict strip and the pre-v2.135.0 absence note', () => {
    const d = dialogSrc();
    expect(d).toContain('data-testid="payroll-run-gate-verdict-strip"');
    expect(d).toContain('data-testid="payroll-run-gate-verdict-missing"');
    expect(d).toContain('the live gate may have moved since');
    expect(d).toContain('prepared before verdicts started leaving a paper trail');
  });
});

describe('the remediation door - diagnosis joins its fix', () => {
  it('MISSING_CONSENT rows carry the door to the Privacy tab\'s consent ledger', () => {
    const p = pageSrc();
    expect(p).toContain('data-testid="payroll-gate-consent-door"');
    expect(p).toContain('href="/hr/reports?tab=privacy"');
    expect(p).toContain('target="_blank"');
    expect(p).toContain('rel="noopener noreferrer"');
    // The door is aria-labelled with the person it fixes.
    expect(p).toMatch(/aria-label=\{`Open the consent ledger to grant consent for \$\{r\.employeeName\}`\}/);
  });

  it('a timesheet block gets NO door — honest text, never a link that would 404', () => {
    const p = pageSrc();
    // The door renders ONLY on the consent branch of the blocked row.
    expect(p).toMatch(/r\.gateState === 'MISSING_CONSENT' \? \(/);
  });
});

describe('the styling contract - house discipline on every new surface', () => {
  it('the runs-table verdict chip wears emerald/amber WITH dark twins and tabular numerals', () => {
    const p = pageSrc();
    // The chip's className carries BOTH tones' dark twins + tabular numerals
    // (attribute order is JSX freedom; assert on the class family itself).
    expect(p).toMatch(/border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950\/50 dark:text-emerald-300/);
    expect(p).toMatch(/border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950\/50 dark:text-amber-300/);
    expect(p).toMatch(/payroll-run-gate-verdict"\s+title=|inline-flex items-center gap-1 rounded-full border px-1\.5 py-px text-\[10px\] font-medium tabular-nums/);
  });

  it('the dialog verdict strip carries dark twins for both tones', () => {
    const d = dialogSrc();
    expect(d).toMatch(/payroll-run-gate-verdict-strip[\s\S]{0,200}?dark:border-emerald-900 dark:bg-emerald-950\/30/);
    expect(d).toMatch(/payroll-run-gate-verdict-strip[\s\S]{0,300}?dark:border-amber-900 dark:bg-amber-950\/30/);
  });

  it('the consent door has hover AND focus-visible affordances', () => {
    const p = pageSrc();
    // Assert on the door's own class family, not attribute order.
    expect(p).toMatch(/text-violet-700 hover:bg-violet-50 hover:text-violet-900 hover:ring-1 hover:ring-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-300 dark:hover:bg-violet-950\/40 dark:hover:text-violet-200 dark:hover:ring-violet-800/);
  });
});
