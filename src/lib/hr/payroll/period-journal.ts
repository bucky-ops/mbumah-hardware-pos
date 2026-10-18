// MBUMAH HARDWARE POS - Period ledger view model (v2.100.0)
//
// The period header says how many runs settled and what they are worth —
// but the journal story stayed one click away in the accounting module.
// The drill-down closes that distance: click a period's Ledger button and
// the drawer opens the month's actual journal entries, lines and all.
//
// HONESTY CONTRACT (inherits run-groups.ts):
//   • An entry appears only for a run that POSTED — the journal exists
//     because the run posted it, keyed payroll-run:{id}, and a locked run's
//     journal is append-only. The drawer never prices an estimate: runs in
//     motion (DRAFT / PENDING_APPROVAL / APPROVED) stay counts — "no journal
//     yet; the entry posts when the run posts."
//   • VOIDED runs are a closed door: no entry, no count, no line — they
//     appear nowhere in the ledger (same stance as the header arithmetic).
//   • A settled run (POSTED | LOCKED) whose journal is missing is a LIE the
//     header would be telling — so the ledger surfaces it as missing rather
//     than silently skipping it. Should never happen; must be impossible
//     to miss when it does.
//   • Balance is checked at money precision: both sides round to 2dp
//     before comparing, so a float drift of 0.0000001 can never shout
//     "unbalanced" at a teller.
//
// PURE module: no db, no network, no env — same constraint as
// run-groups.ts, so unit tests run without any mocking.

import { SETTLED_RUN_STATUSES } from './run-groups';

/** One journal line as the API serves it: the account resolved, money numeric. */
export interface LedgerLineSource {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  description: string | null;
}

/** One posted run's journal entry as the API serves it. */
export interface LedgerEntrySource {
  runId: string;
  runType: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  lines: LedgerLineSource[];
}

/** The runs of the period — the builder reads only id/type/status. */
export interface LedgerRunSource {
  id: string;
  runType: string;
  status: string;
}

/** A settled run's entry, verified: sums recomputed, balance proven. */
export interface PeriodLedgerEntry {
  runId: string;
  runType: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  /** Line sums recomputed from the lines — not trusted from the payload. */
  debitSum: number;
  creditSum: number;
  /** True when the recomputed sums agree at 2dp money precision. */
  balanced: boolean;
  lines: LedgerLineSource[];
}

/** A run alive and moving but not yet posted — counted, never priced. */
export interface UnsettledLedgerRun {
  runId: string;
  runType: string;
  status: string;
}

/** The period's ledger: posted entries, honest waiting counts, and the
 *  missing-journal alarm that must stay empty but is never assumed to be. */
export interface PeriodLedger {
  /** Posted entries, newest entryDate first — stable (equal dates never reorder). */
  entries: PeriodLedgerEntry[];
  /** DRAFT / PENDING_APPROVAL / APPROVED runs — no journal yet. */
  unsettled: UnsettledLedgerRun[];
  /** Settled runs with NO journal — must always be empty; surfaced, not skipped. */
  missingJournal: UnsettledLedgerRun[];
}

const money2 = (v: number): number => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/** Balance at money precision: both sides to 2dp before comparing. */
export function isLedgerBalanced(totalDebit: number, totalCredit: number): boolean {
  return money2(totalDebit) === money2(totalCredit);
}

/** Recompute a line-family sum at 2dp — the drawer never trusts the payload's own totals. */
export function sumLedgerLines(
  lines: Array<{ debit: number; credit: number }>,
): { debit: number; credit: number } {
  return {
    debit: money2(lines.reduce((s, l) => s + Number(l.debit || 0), 0)),
    credit: money2(lines.reduce((s, l) => s + Number(l.credit || 0), 0)),
  };
}

/**
 * Build the period's ledger view model. Takes the API's posted entries and
 * the period's full run list; returns the drawer's whole story:
 *   • entries — newest entryDate first, stable, each with recomputed sums
 *     and a proven balanced flag;
 *   • unsettled — runs in motion, counted honestly, never priced;
 *   • missingJournal — settled runs with no journal (alarm; must stay empty).
 * VOIDED runs appear nowhere: a voided run is a closed door.
 */
export function buildPeriodLedger(
  entries: LedgerEntrySource[],
  runs: LedgerRunSource[],
): PeriodLedger {
  const posted: PeriodLedgerEntry[] = entries.map((e) => {
    const sums = sumLedgerLines(e.lines);
    return {
      runId: e.runId,
      runType: e.runType,
      entryNumber: e.entryNumber,
      entryDate: e.entryDate,
      description: e.description,
      totalDebit: money2(Number(e.totalDebit)),
      totalCredit: money2(Number(e.totalCredit)),
      debitSum: sums.debit,
      creditSum: sums.credit,
      balanced:
        isLedgerBalanced(sums.debit, sums.credit) &&
        isLedgerBalanced(Number(e.totalDebit), Number(e.totalCredit)),
      lines: e.lines,
    };
  });
  posted.sort((a, b) => {
    const da = new Date(a.entryDate).getTime();
    const db = new Date(b.entryDate).getTime();
    if (da !== db) return db - da; // newest first
    return 0; // stable — equal stamps keep the API's order
  });

  const unsettled: UnsettledLedgerRun[] = [];
  const missingJournal: UnsettledLedgerRun[] = [];
  for (const run of runs) {
    if (run.status === 'VOIDED') continue; // a closed door appears nowhere
    if ((SETTLED_RUN_STATUSES as readonly string[]).includes(run.status)) {
      if (!entries.some((e) => e.runId === run.id)) {
        missingJournal.push({ runId: run.id, runType: run.runType, status: run.status });
      }
      continue;
    }
    unsettled.push({ runId: run.id, runType: run.runType, status: run.status });
  }

  return { entries: posted, unsettled, missingJournal };
}
