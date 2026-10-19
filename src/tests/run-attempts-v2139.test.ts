import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGateAttemptChip } from '@/lib/hr/payroll/gate-trail';
import { buildBulkApproveSummary, type DeskBulkAttemptResult } from '@/lib/hr/attendance-desk';

/**
 * v2.139.0 — the table counts the attempts; the batch walks the desk.
 *
 * Gap: the v2.138.0 trail lived only inside the run dialog — the runs
 * TABLE (the surface managers actually stare at) still answered "what did
 * the gate say" without "how many tries did it take". And the desk could
 * approve one employee at a time; a Monday-morning backlog of six rows
 * meant six rounds of click-wait-click.
 *
 * Covered here:
 *  1. The attempt chip builder — count + last outcome, honest absence
 *     (zero/garbage renders NOTHING, never a guessed attempt), outcome
 *     verbatim PASSED/BLOCKED or muted UNKNOWN, tone follows the outcome.
 *  2. The batch receipt builder — full success, partial (failures named),
 *     total failure, the raced-batch honesty (all days already approved),
 *     and null when the batch never ran.
 *  3. The runs list route — the additive trail surface (count via the
 *     run's own gateEvents, last outcome via the newest-clock row), the
 *     DTO fields optional and null-safe.
 *  4. The runs table — the chip rides BESIDE the frozen verdict in one
 *     wrapping row (the styling contract), muted family for UNKNOWN,
 *     the History icon, the dialog-pointer title.
 *  5. The desk batch — the ONE audited per-employee service looped on the
 *     client (never a new bulk write path: same URL, same body shape),
 *     single-flight both directions, honest progress label, receipt strip
 *     with per-failure lines, notes cleared on scope change.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The attempt chip ──────────────────────────────────────────────────────

describe('buildGateAttemptChip - the table answers "how many tries"', () => {
  it('one attempt, passed: singular label, emerald tone, outcome verbatim', () => {
    const chip = buildGateAttemptChip({ attemptCount: 1, lastOutcome: 'PASSED' });
    expect(chip).not.toBeNull();
    expect(chip?.label).toBe('1 attempt · last PASSED');
    expect(chip?.outcome).toBe('PASSED');
    expect(chip?.tone).toBe('emerald');
    expect(chip?.count).toBe(1);
  });

  it('plural honesty: 2 attempts · last BLOCKED wears amber', () => {
    const chip = buildGateAttemptChip({ attemptCount: 2, lastOutcome: 'BLOCKED' });
    expect(chip?.label).toBe('2 attempts · last BLOCKED');
    expect(chip?.tone).toBe('amber');
  });

  it('an unknown outcome degrades to muted UNKNOWN — never guessed', () => {
    const chip = buildGateAttemptChip({ attemptCount: 3, lastOutcome: 'WEIRD' });
    expect(chip?.label).toBe('3 attempts · last UNKNOWN');
    expect(chip?.outcome).toBe('UNKNOWN');
    expect(chip?.tone).toBe('muted');
    expect(buildGateAttemptChip({ attemptCount: 1, lastOutcome: null })?.outcome).toBe('UNKNOWN');
  });

  it('honest absence: zero, null, and garbage counts render nothing', () => {
    expect(buildGateAttemptChip({ attemptCount: 0, lastOutcome: 'PASSED' })).toBeNull();
    expect(buildGateAttemptChip({ attemptCount: null, lastOutcome: 'PASSED' })).toBeNull();
    expect(buildGateAttemptChip({ attemptCount: undefined, lastOutcome: 'PASSED' })).toBeNull();
    expect(buildGateAttemptChip({ attemptCount: 'two', lastOutcome: 'PASSED' })).toBeNull();
    expect(buildGateAttemptChip({ attemptCount: 1.5, lastOutcome: 'PASSED' })).toBeNull();
    expect(buildGateAttemptChip({ attemptCount: -1, lastOutcome: 'PASSED' })).toBeNull();
  });

  it('numeric strings are tolerated (the payload crosses JSON)', () => {
    expect(buildGateAttemptChip({ attemptCount: '2', lastOutcome: 'BLOCKED' })?.count).toBe(2);
  });

  it('the builder stays pure — no db, no fetch, no clock', () => {
    const src = readRepo('src/lib/hr/payroll/gate-trail.ts');
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    expect(code.includes('@/lib/db')).toBe(false);
    expect(code.includes('fetch(')).toBe(false);
    expect(code.includes('new Date()')).toBe(false);
  });
});

// ── 2. The batch receipt ─────────────────────────────────────────────────────

const okRow = (id: string, approved: number): DeskBulkAttemptResult => ({
  employeeId: id,
  employeeCode: `MBH-1-00${id}`,
  employeeName: `Person ${id}`,
  ok: true,
  approved,
});
const failRow = (id: string, error: string): DeskBulkAttemptResult => ({
  employeeId: id,
  employeeCode: `MBH-1-00${id}`,
  employeeName: `Person ${id}`,
  ok: false,
  approved: 0,
  error,
});

describe('buildBulkApproveSummary - the receipt never smooths', () => {
  it('full success speaks one emerald line with honest plurals', () => {
    const s = buildBulkApproveSummary([okRow('1', 2), okRow('2', 1)]);
    expect(s?.tone).toBe('ok');
    expect(s?.text).toBe('Approved 3 days across 2 employees.');
    expect(s?.failures).toEqual([]);
  });

  it('singular batch: one day, one employee', () => {
    const s = buildBulkApproveSummary([okRow('1', 1)]);
    expect(s?.text).toBe('Approved 1 day across 1 employee.');
  });

  it('partial failure names every loser and says retry-from-their-rows', () => {
    const s = buildBulkApproveSummary([okRow('1', 2), failRow('2', 'Approval failed (403).'), failRow('3', '')]);
    expect(s?.tone).toBe('partial');
    expect(s?.text).toBe('Approved 2 days for 1 of 3 employees — 2 approvals failed; retry from their rows.');
    expect(s?.failures[0]).toBe('MBH-1-002 Person 2 — Approval failed (403).');
    expect(s?.failures[1]).toBe('MBH-1-003 Person 3 — approval failed');
  });

  it('total failure approves nothing and says so', () => {
    const s = buildBulkApproveSummary([failRow('1', 'x'), failRow('2', 'y')]);
    expect(s?.tone).toBe('err');
    expect(s?.text).toBe('No approvals landed — all 2 attempts failed. Nothing was approved; retry from their rows.');
    expect(s?.failures).toHaveLength(2);
  });

  it('the raced batch is honest: every day already approved is NOT a hollow green', () => {
    const s = buildBulkApproveSummary([okRow('1', 0), okRow('2', 0)]);
    expect(s?.tone).toBe('ok');
    expect(s?.text).toBe('Nothing left to approve — every listed day was already approved.');
  });

  it('a batch that never ran renders nothing', () => {
    expect(buildBulkApproveSummary([])).toBeNull();
  });
});

// ── 3. The runs list route ───────────────────────────────────────────────────

describe('runs list route - the trail surface rides additively', () => {
  const src = () => readRepo('src/app/api/payroll/runs/route.ts').replace(/^\s*\/\/.*$/gm, '');

  it("the count rides the run's own gateEvents (one query, no per-run fetch)", () => {
    const code = src();
    expect(code.includes('_count: { select: { details: true, gateEvents: true } }')).toBe(true);
    expect(code.includes('gateAttemptCount: r._count.gateEvents')).toBe(true);
  });

  it('the last outcome is the newest-clock row, createdAt breaking ties', () => {
    const code = src();
    expect(code.includes("orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }]")).toBe(true);
    expect(code.includes('take: 1')).toBe(true);
    expect(code.includes('gateLastOutcome: r.gateEvents[0]?.outcome ?? null')).toBe(true);
  });

  it('the read stays read-only and store-scoped', () => {
    const code = src();
    expect(code.includes('storeId: session.storeId')).toBe(true);
    expect(code.includes('payrollRunGateEvent.create')).toBe(false);
    expect(code.includes('payrollRun.update')).toBe(false);
  });
});

// ── 4. The runs table chip ───────────────────────────────────────────────────

describe('runs table - the attempt chip sits beside the frozen verdict', () => {
  const src = () => readRepo('src/app/(shell)/hr/payroll/page.tsx').replace(/^\s*\/\/.*$/gm, '');

  it('the chip renders beside the verdict, in one wrapping row', () => {
    const code = src();
    expect(code.includes('data-testid="payroll-run-gate-attempts"')).toBe(true);
    expect(code.includes('mt-0.5 flex flex-wrap items-center gap-1')).toBe(true);
    expect(code.includes('buildGateAttemptChip({')).toBe(true);
  });

  it('tones match the trail vocabulary (emerald/amber/muted) with dark twins', () => {
    const code = src();
    expect(code.includes('attempts.tone === \'emerald\'')).toBe(true);
    expect(code.includes('attempts.tone === \'amber\'')).toBe(true);
    expect(code.includes('border-border bg-muted/60 text-muted-foreground dark:bg-muted/40')).toBe(true);
  });

  it("the chip points at the dialog's full trail (History icon, honest title)", () => {
    const code = src();
    expect(code.includes('<History className="h-2.5 w-2.5 shrink-0" aria-hidden />')).toBe(true);
    expect(code.includes("Every prepare attempt on record — the run dialog's Gate trail keeps the full story")).toBe(true);
  });

  it('the DTO carries the surface additively (optional, null-safe)', () => {
    const code = src();
    expect(code.includes('gateAttemptCount?: number | null;')).toBe(true);
    expect(code.includes('gateLastOutcome?: string | null;')).toBe(true);
  });
});

// ── 5. The desk batch ────────────────────────────────────────────────────────

describe('desk batch - the ONE service, walked one row at a time', () => {
  const src = () => readRepo('src/app/(shell)/hr/timesheets/page.tsx').replace(/^\s*\/\/.*$/gm, '');

  it('the batch loop posts the EXACT single-approve contract (never a bulk path)', () => {
    const code = src();
    expect((code.match(/\/api\/attendance\/timesheets\/approve/g) ?? []).length).toBe(2);
    expect(code.includes("body: JSON.stringify({ employeeId: row.employeeId, from: row.firstDay, to: row.lastDay })")).toBe(true);
    expect(code.includes('bulk')).toBe(true);
    expect(code.includes('approveMany')).toBe(false);
    expect(code.includes('bulkApprove')).toBe(false);
  });

  it('single-flight both directions: the batch rides approvingId, everything disables', () => {
    const code = src();
    expect(code.includes('disabled={!payload || loading || payload.rows.length === 0 || approvingId !== null || bulkRunning}')).toBe(true);
    expect(code.includes('setApprovingId(row.employeeId);')).toBe(true);
  });

  it('the button keeps an honest count of the walk', () => {
    const code = src();
    expect(code.includes('data-testid="hr-timesheet-approve-all"')).toBe(true);
    expect(code.includes("Approving {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : '…'}")).toBe(true);
  });

  it('the receipt strip names every failure, tone by outcome', () => {
    const code = src();
    expect(code.includes('data-testid="hr-timesheet-bulk-note"')).toBe(true);
    expect(code.includes('data-testid="hr-timesheet-bulk-failure"')).toBe(true);
    expect(code.includes("bulkNote.tone === 'partial'")).toBe(true);
    expect(code.includes('dark:bg-rose-950/40 dark:text-rose-300')).toBe(true);
  });

  it('a fresh scope clears both notes — old receipts never describe new data', () => {
    const code = src();
    expect(code.includes('setRowNote(null);')).toBe(true);
    expect(code.includes('setBulkNote(null);')).toBe(true);
  });

  it('the batch ends with a refetch — the desk re-reads what it just cleared', () => {
    const code = src();
    expect(code.includes('await loadPending(scopeId);')).toBe(true);
  });
});
