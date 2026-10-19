import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGateTimelineCsv,
  escapeGateCsvCell,
  filterGateTimeline,
  type GateTimelineCsvRow,
} from '@/lib/hr/payroll/gate-timeline';

/**
 * v2.142.0 — the activity answers back; the picker wears the last run.
 *
 * Gap: the Gate activity card (v2.141.0) kept the whole story readable but
 * not workable — a manager hunting the stops scanned every PASSED row by
 * eye, and the audit story could not leave the screen. The New-run picker
 * (wearing the gate's pending counts since v2.137.0) said nothing about
 * what happened the LAST time someone prepared the selected period.
 *
 * Covered here:
 *  1. The CSV serializer — the RFC 4180 family's newest member: the pinned
 *     honest column set (counts and verdicts, never employee codes or pay
 *     data), CRLF, quote-on-need with double embedded quotes, nulls export
 *     empty (an unreadable clock exports '', never a guess), junk rows
 *     skipped, and NEVER a re-sort (what the card shows is what prints).
 *  2. The blocked-only lens — a view preference: order preserved, UNKNOWN
 *     never passes as BLOCKED, non-array degrades to [].
 *  3. The card contract — aria-pressed + rose family + dark twins, the lens
 *     composing BEFORE the show-all bound, the lens-empty honest note, the
 *     export disabled-when-empty, and the window-not-viewport export pin.
 *  4. The picker chip — the table's own buildGateAttemptChip over the runs
 *     already in memory (zero new fetch), honest absence, tone parity.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const row = (over: Partial<GateTimelineCsvRow>): GateTimelineCsvRow => ({
  attemptedAt: '2026-10-19T14:45:00.000Z',
  period: 'October 2026',
  runStatus: 'DRAFT',
  outcome: 'PASSED',
  verdict: '5 clear',
  actor: 'Mbumah Hardware Owner',
  ...over,
});

// ── 1. The CSV serializer ────────────────────────────────────────────────────

describe('buildGateTimelineCsv - the audit story prints itself', () => {
  it('header is the pinned honest column set; rows follow in the order fed', () => {
    const csv = buildGateTimelineCsv([
      row({}),
      row({ outcome: 'BLOCKED', verdict: '5 clear · 1 timesheet pending' }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('attempted_at,period,run_status,outcome,verdict,actor');
    expect(lines[1]).toContain(',PASSED,5 clear,');
    expect(lines[2]).toContain(',BLOCKED,5 clear · 1 timesheet pending,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('never re-sorts: the newest-first card order is the file order', () => {
    const csv = buildGateTimelineCsv([row({ attemptedAt: 'B-later' }), row({ attemptedAt: 'A-earlier' })]);
    const idx = [csv.indexOf('B-later'), csv.indexOf('A-earlier')];
    expect(idx[0]).toBeGreaterThan(-1);
    expect(idx[1]).toBeGreaterThan(idx[0]); // B stays BEFORE A — no chronological re-sort
  });

  it('quotes on need: commas, quotes, and newlines in the verdict survive round-trip', () => {
    const csv = buildGateTimelineCsv([row({ verdict: 'Said "4 clear, 1 pending"', actor: 'Owner, Jr' })]);
    expect(csv).toContain('"Said ""4 clear, 1 pending"""');
    expect(csv).toContain('"Owner, Jr"');
  });

  it('nulls export empty — an unreadable clock exports "", never a guess', () => {
    const csv = buildGateTimelineCsv([row({ attemptedAt: '', period: '', actor: '' })]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine.startsWith(',')).toBe(true); // attempted_at empty
    expect(dataLine.endsWith(',')).toBe(true); // actor (last column) empty
    expect(dataLine.split(',').filter(Boolean).length).toBe(3); // only runStatus/outcome/verdict speak
  });

  it('the column set carries NO employee codes and NO pay fields — pinned', () => {
    const src = readRepo('src/lib/hr/payroll/gate-timeline.ts');
    const headers = src.match(/const GATE_CSV_HEADERS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
    expect(headers).not.toMatch(/employee|code|pay|salary|net|gross|amount/i);
    expect(headers).toMatch(/attempted_at/);
    expect(headers).toMatch(/verdict/);
  });

  it('junk rows skip; non-array degrades to a header-only file', () => {
    const junk = [null, undefined, row({})] as unknown as GateTimelineCsvRow[];
    const csv = buildGateTimelineCsv(junk);
    expect(csv.match(/attempted_at,/g)?.length).toBe(1); // header once
    expect(csv.split('\r\n').filter(Boolean).length).toBe(2); // header + the one real row
    expect(buildGateTimelineCsv(undefined as unknown as GateTimelineCsvRow[])).toBe(
      'attempted_at,period,run_status,outcome,verdict,actor\r\n',
    );
  });
});

describe('escapeGateCsvCell - the family escape discipline', () => {
  it('plain cells stay bare; special cells get quoted and doubled', () => {
    expect(escapeGateCsvCell('PASSED')).toBe('PASSED');
    expect(escapeGateCsvCell('a,b')).toBe('"a,b"');
    expect(escapeGateCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeGateCsvCell('line\r\nbreak')).toBe('"line\r\nbreak"');
    expect(escapeGateCsvCell(null)).toBe('');
    expect(escapeGateCsvCell(undefined)).toBe('');
    expect(escapeGateCsvCell(3)).toBe('3');
  });
});

// ── 2. The blocked-only lens ─────────────────────────────────────────────────

describe('filterGateTimeline - the card answers "when did it block"', () => {
  type LensRow = Parameters<typeof filterGateTimeline>[0][number];
  const lensRow = (id: string, outcome: string): LensRow =>
    ({
      id,
      runId: 'r1',
      runLabel: 'October 2026',
      runStatus: 'DRAFT',
      outcome,
      atIso: '2026-10-19T14:45:00.000Z',
      text: '5 clear',
      tone: 'emerald',
      actorLabel: 'Owner',
      moved: false,
    }) as LensRow;

  it('blocked-only keeps every BLOCKED row in order; UNKNOWN never passes', () => {
    const rows = [
      lensRow('e1', 'PASSED'),
      lensRow('e2', 'BLOCKED'),
      lensRow('e3', 'UNKNOWN'),
      lensRow('e4', 'BLOCKED'),
    ];
    const filtered = filterGateTimeline(rows, true);
    expect(filtered.map((r) => r.id)).toEqual(['e2', 'e4']); // order preserved
  });

  it('lens off returns every row — a view preference, not a data change', () => {
    const rows = [lensRow('e1', 'PASSED'), lensRow('e2', 'BLOCKED')];
    const all = filterGateTimeline(rows, false);
    expect(all.map((r) => r.id)).toEqual(['e1', 'e2']);
    expect(all).not.toBe(rows); // a copy — the caller's array is never mutated
  });

  it('non-array degrades to [] — never a crash', () => {
    expect(filterGateTimeline(undefined as unknown as LensRow[], true)).toEqual([]);
    expect(filterGateTimeline(null as unknown as LensRow[], false)).toEqual([]);
  });
});

// ── 3. The card contract ─────────────────────────────────────────────────────

describe("the payroll page's card lens + export door", () => {
  const page = readRepo('src/app/(shell)/hr/payroll/page.tsx');
  const pure = readRepo('src/lib/hr/payroll/gate-timeline.ts');

  it('the lens toggle speaks aria-pressed, wears rose when on, dark twins included', () => {
    expect(page).toContain('aria-pressed={timelineBlockedOnly}');
    expect(page).toContain('payroll-gate-timeline-blocked-only');
    expect(page).toContain('border-rose-300 bg-rose-50 text-rose-800');
    expect(page).toContain('dark:bg-rose-950/50 dark:text-rose-300');
    expect(page).toContain('Blocked only');
  });

  it('the lens composes BEFORE the show-all bound — a PASSED row can never smuggle in', () => {
    // v2.143.0 re-anchor: the lens composes with the period scope inside the
    // ONE scopeGateTimeline memo; the bound still reads that scoped set.
    expect(page).toContain('scopeGateTimeline(timeline?.rows ?? [],');
    expect(page).toContain('(timelineShowAll ? timelineFiltered : timelineFiltered.slice(0, 8)).map(');
    expect(page).toContain('timelineFiltered.length > 8');
    expect(page).not.toContain('timelineShowAll ? timeline.rows : timeline.rows.slice(0, 8)');
  });

  it('the summary chip keeps speaking ALL attempts — view preference, not a rewrite', () => {
    const sumIdx = page.indexOf('payroll-gate-timeline-summary');
    expect(sumIdx > -1).toBe(true);
    expect(page.slice(sumIdx - 400, sumIdx)).toContain('timeline.summary.attempts > 0');
    // The chip reads the summary the ROUTE built (all rows), never the lens.
    expect(page).toContain('timeline.summary.attempts}');
  });

  it('the lens-empty state is honest: every prepare got through, full story one toggle away', () => {
    expect(page).toContain('payroll-gate-timeline-lens-empty');
    expect(page).toContain('No blocked attempts in the window');
    expect(page).toContain('timelineFiltered.length === 0 ?');
  });

  it('the export door: whole window, lens applied, disabled when empty', () => {
    expect(page).toContain('payroll-gate-timeline-export');
    expect(page).toContain('exportGateTimelineCsv');
    // v2.143.0 re-anchor: the export maps the SCOPED set (period ∩ lens via
    // scopeGateTimeline) and the filename comes from gateTimelineCsvFilename
    // — which keeps this shape for the unscoped case and slugs the period
    // when the story is scoped.
    expect(page).toContain('scopeGateTimeline(timeline.rows,');
    expect(page).toContain('gateTimelineCsvFilename(timelinePeriod)');
    expect(page).toContain('disabled={timeline === null || timelineFiltered.length === 0}');
    // The window-not-viewport honesty lives in the button's own title.
    expect(page).toContain('not just the rows on screen');
    expect(page).toContain('never pay data');
  });

  it('the pure module carries the serializer + lens; stays PURE', () => {
    expect(pure).toContain('export function buildGateTimelineCsv');
    expect(pure).toContain('export function filterGateTimeline');
    expect(pure).toContain("export function escapeGateCsvCell");
    const code = pure.replace(/^\s*\/\/.*$/gm, '');
    // v2.143.0 re-anchor: the no-clock ban scopes to the trail/lens builders.
    // gateTimelineCsvFilename takes the clock BY INJECTION
    // (when: Date = new Date() — the consent filenames' own pattern): a
    // default parameter is an injection point, not an internal clock read —
    // feed a Date and the filename is deterministic.
    const clockUses = code.match(/new Date\(\)/g) ?? [];
    expect(clockUses.length).toBe(1);
    expect(code).toContain('when: Date = new Date()');
    expect(!/@prisma\/client|node-fetch|axios|fetch\(|window\./.test(code)).toBe(true);
  });
});

// ── 4. The picker chip ───────────────────────────────────────────────────────

describe("the New-run picker's last-run attempts chip", () => {
  const page = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('rides buildGateAttemptChip over the runs already in memory — zero new fetch', () => {
    expect(page).toContain('runs.find((r) => r.payrollPeriodId === periodId)');
    expect(page).toContain('attemptCount: lastRun?.gateAttemptCount ?? null');
    expect(page).toContain('lastOutcome: lastRun?.gateLastOutcome ?? null');
    expect(page).toContain('runs: PayrollRunDto[];');
    expect(page).toContain('runs={runs ?? []}');
    // No new endpoint call inside the dialog (the only fetch it makes is the create POST;
    // the slice stops before the sibling CreatePeriodDialog's own fetch).
    const dialog = page.slice(page.indexOf('function CreateRunDialog'), page.indexOf('function CreatePeriodDialog'));
    expect(dialog.match(/fetch\(/g)?.length).toBe(1);
  });

  it('honest absence: null for no runs / pre-trail runs — the chip never invents an attempt', () => {
    expect(page).toContain('{attempts ? (');
    expect(page).toContain('payroll-picker-attempts-chip');
  });

  it('tone parity with the table: emerald/amber/muted families, dark twins', () => {
    const chipIdx = page.indexOf('payroll-picker-attempts-chip');
    const block = page.slice(chipIdx, chipIdx + 900);
    expect(block).toContain("attempts.tone === 'emerald'");
    expect(block).toContain("attempts.tone === 'amber'");
    expect(block).toContain('dark:bg-emerald-950/50');
    expect(block).toContain('dark:bg-amber-950/50');
  });
});
