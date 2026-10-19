import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGateTrail, type GateTrailInput } from '@/lib/hr/payroll/gate-trail';
import { deskDayIsWeekend, deskDayStrip } from '@/lib/hr/attendance-desk';

/**
 * v2.138.0 — the verdict trail (and the weekend that stands out).
 *
 * Gap: the v2.135.0 frozen verdict REFRESHES in place — every re-prepare
 * overwrote the snapshot, so "how did the verdict move between attempts"
 evaporated the moment a second attempt happened. And on the timesheet
 * desk, a Saturday punch wore the exact same chip as a Tuesday one — the
 * anomaly was invisible.
 *
 * Covered here:
 *  1. The trail builder — every attempt speaks (never deduped), `changed`
 *     marks where the verdict MOVED, garbage degrades to a muted
 *     "Verdict unreadable" row (the attempt still happened), clocks that
 *     cannot be read say so, unknown outcomes wear UNKNOWN.
 *  2. The schema + the two append points — one PayrollRunGateEvent per
 *     prepare attempt, BOTH paths (the blocked stop and the in-tx pass),
 *     the SAME clock as the frozen snapshot, append-only (no updates).
 *  3. The detail route — additive `gateTrail`, best-effort (a trail read
 *     failure never degrades the run view), oldest-first, capped at 50.
 *  4. The dialog — the trail block with outcome chips, the sky "moved"
 *     marker, and the honest absence note for pre-v2.138.0 prepared runs.
 *  5. The weekend tint — Saturday/Sunday chips wear sky, garbage never
 *     reads as weekend, the shown/shownDays parallel arrays stay aligned.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The trail builder ─────────────────────────────────────────────────────

const evt = (overrides: Partial<GateTrailInput> & { id: string }): GateTrailInput => ({
  outcome: 'PASSED',
  checkedAt: '2026-10-19T09:00:00.000Z',
  summary: { total: 5, clear: 5, missingConsent: 0, timesheetNotApproved: 0, codes: [] },
  actorLabel: 'Owner',
  ...overrides,
});

describe('buildGateTrail - every attempt speaks, movement is marked', () => {
  it('shapes rows in order; the first attempt carries changed=false', () => {
    const rows = buildGateTrail([evt({ id: 'a' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'a',
      outcome: 'PASSED',
      atIso: '2026-10-19T09:00:00.000Z',
      text: '5 clear',
      tone: 'emerald',
      actorLabel: 'Owner',
      changed: false,
    });
  });

  it("marks the attempt where the verdict MOVED (the trail's whole point)", () => {
    const rows = buildGateTrail([
      evt({ id: 'a' }),
      evt({ id: 'b', summary: { total: 5, clear: 4, missingConsent: 1, timesheetNotApproved: 0, codes: ['MISSING_CONSENT'] } }),
      evt({ id: 'c', summary: { total: 5, clear: 4, missingConsent: 1, timesheetNotApproved: 0, codes: ['MISSING_CONSENT'] } }),
    ]);
    expect(rows.map((r) => r.changed)).toEqual([false, true, false]);
    expect(rows[1].text).toBe('4 clear · 1 missing consent');
    expect(rows[1].tone).toBe('amber');
  });

  it('never dedupes: two identical attempts are two rows (that IS the history)', () => {
    const rows = buildGateTrail([evt({ id: 'a' }), evt({ id: 'b' })]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.text === '5 clear')).toBe(true);
  });

  it('garbage degrades, never guesses: unreadable summary still speaks, muted', () => {
    const rows = buildGateTrail([
      evt({ id: 'a' }),
      evt({ id: 'b', summary: { nonsense: true } }),
      evt({ id: 'c', summary: 'a string' }),
    ]);
    expect(rows[1].text).toBe('Verdict unreadable');
    expect(rows[1].tone).toBe('muted');
    expect(rows[1].changed).toBe(true); // 5 clear → unreadable IS a move
    expect(rows[2].text).toBe('Verdict unreadable');
    expect(rows[2].changed).toBe(false); // unreadable → unreadable is not
  });

  it('unreadable clocks say so; unknown outcomes wear UNKNOWN; junk ids drop', () => {
    const rows = buildGateTrail([
      evt({ id: 'a', checkedAt: 'garbage', outcome: 'WEIRD' }),
      evt({ id: '', outcome: 'PASSED' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].atIso).toBeNull();
    expect(rows[0].outcome).toBe('UNKNOWN');
  });

  it('empty input is an empty trail (never null)', () => {
    expect(buildGateTrail([])).toEqual([]);
  });
});

// ── 2. The schema + the two append points ────────────────────────────────────

describe('schema + service - one row per attempt, both paths, one clock', () => {
  const SCHEMA = readRepo('prisma/schema.prisma');
  const SERVICE = readRepo('src/lib/hr/payroll/run-service.ts');

  it('the PayrollRunGateEvent model exists, append-only by shape', () => {
    expect(SCHEMA).toContain('model PayrollRunGateEvent');
    expect(SCHEMA).toContain('@@map("payroll_run_gate_events")');
    expect(SCHEMA).toContain('@@index([runId, checkedAt])');
  });

  it('the blocked path appends BLOCKED with the SAME clock as the snapshot', () => {
    expect(SERVICE).toContain("outcome: 'BLOCKED'");
    expect(SERVICE).toContain('const blockedAt = new Date();');
    expect(SERVICE.indexOf('gateCheckedAt: blockedAt')).toBeGreaterThan(-1);
    expect(SERVICE.indexOf('gateCheckedAt: blockedAt')).toBeLessThan(SERVICE.indexOf("outcome: 'BLOCKED'"));
  });

  it('the passing path appends PASSED inside the re-prepare transaction', () => {
    const passedTxIdx = SERVICE.indexOf("outcome: 'PASSED'");
    const txIdx = SERVICE.indexOf('await db.$transaction(async (tx) => {', SERVICE.indexOf('withImmutabilityBypass'));
    expect(passedTxIdx).toBeGreaterThan(txIdx);
    expect(SERVICE).toContain('const passedAt = new Date();');
    expect(SERVICE).toContain('gateCheckedAt: passedAt');
  });

  it('append-only: no code updates or deletes a trail row', () => {
    expect(SERVICE).not.toContain('payrollRunGateEvent.update');
    expect(SERVICE).not.toContain('payrollRunGateEvent.delete');
  });
});

// ── 3. The detail route ──────────────────────────────────────────────────────

describe('detail route - the trail rides additively, best-effort', () => {
  const ROUTE = readRepo('src/app/api/payroll/runs/[id]/route.ts');

  it('reads oldest-first, capped, store-scoped', () => {
    expect(ROUTE).toContain("orderBy: { checkedAt: 'asc' }");
    expect(ROUTE).toContain('take: 50');
    expect(ROUTE).toContain('storeId: session.storeId');
  });

  it('a trail failure never degrades the run view (catch empties BOTH blocks)', () => {
    expect(ROUTE).toMatch(/} catch \{\s*\n\s*history = \[\];\s*\n\s*gateTrail = \[\];\s*\n\s*\}/);
    expect(ROUTE).toContain('history, gateTrail');
  });

  it('the trail flows through the pure builder with resolved actor labels', () => {
    expect(ROUTE).toContain('buildGateTrail(');
    expect(ROUTE).toContain("actors[e.actorId] ?? 'Unknown user'");
  });
});

// ── 4. The dialog ────────────────────────────────────────────────────────────

describe('run dialog - the trail block speaks both outcomes + honest absence', () => {
  const DIALOG = readRepo('src/components/hr/payroll-run-dialog.tsx');

  it('the trail block renders rows with outcome chips and the count pill', () => {
    expect(DIALOG).toContain('data-testid="payroll-run-gate-trail"');
    expect(DIALOG).toContain('data-testid="payroll-run-gate-trail-count"');
    expect(DIALOG).toContain('payroll-run-gate-trail-outcome-${i}');
    expect(DIALOG).toContain('payroll-run-gate-trail-row-${i}');
  });

  it('the sky "moved" chip marks verdict movement, with dark twins', () => {
    expect(DIALOG).toContain('payroll-run-gate-trail-moved-${i}');
    expect(DIALOG).toContain('border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300');
  });

  it('outcome icons: ShieldAlert for BLOCKED, ShieldCheck for PASSED, muted UNKNOWN', () => {
    expect(DIALOG).toContain("row.outcome === 'BLOCKED' ? (");
    expect(DIALOG).toContain('ShieldAlert');
    expect(DIALOG).toContain('ShieldQuestion');
  });

  it('pre-v2.138.0 prepared runs get ONE dashed absence note, never a guess', () => {
    expect(DIALOG).toContain('data-testid="payroll-run-gate-trail-absent"');
    expect(DIALOG).toContain('run?.preparedAt ?');
  });

  it('the dialog accepts the trail additively (optional prop, null-safe read)', () => {
    expect(DIALOG).toContain('gateTrail?: GateTrailRow[]');
    expect(DIALOG).toContain('detail?.gateTrail ?? []');
  });
});

// ── 5. The weekend tint ──────────────────────────────────────────────────────

describe('desk day strip - the weekend stands out', () => {
  it('Saturday and Sunday read as weekend through UTC parts; garbage never does', () => {
    // 2026-10-17 is a Saturday, 2026-10-18 a Sunday, 2026-10-16 a Friday.
    expect(deskDayIsWeekend('2026-10-17')).toBe(true);
    expect(deskDayIsWeekend('2026-10-18')).toBe(true);
    expect(deskDayIsWeekend('2026-10-16')).toBe(false);
    expect(deskDayIsWeekend('garbage')).toBe(false);
    expect(deskDayIsWeekend('2026-10-32')).toBe(false);
  });

  it('shownDays runs parallel to shown (label ↔ day stay aligned)', () => {
    const days = ['2026-10-16', '2026-10-17', '2026-10-18'];
    const strip = deskDayStrip(days);
    expect(strip.shown).toEqual(['Fri 16', 'Sat 17', 'Sun 18']);
    expect(strip.shownDays).toEqual(days);
    expect(strip.hidden).toBe(0);
  });

  it('garbage days count in hidden, never enter shownDays', () => {
    const strip = deskDayStrip(['2026-10-16', 'garbage'], 12);
    expect(strip.shown).toEqual(['Fri 16']);
    expect(strip.shownDays).toEqual(['2026-10-16']);
    expect(strip.hidden).toBe(1);
  });

  it('the desk page tints weekend chips sky (dark twins + honest title)', () => {
    const DESK = readRepo('src/app/(shell)/hr/timesheets/page.tsx');
    expect(DESK).toContain('deskDayIsWeekend(day)');
    expect(DESK).toContain('border-sky-200 bg-sky-50/80 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300');
    expect(DESK).toContain('— weekend day');
    expect(DESK).toContain('data-weekend={weekend ? \'true\' : undefined}');
  });
});
