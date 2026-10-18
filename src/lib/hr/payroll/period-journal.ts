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

import { csvCell } from '@/lib/hr/digest-csv';
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

// ── v2.101.0: the ledger files itself ────────────────────────────────────────

/** '2026-10-17T09:21:00.000Z' → '2026-10-17'; null/invalid → ''. */
function dayKey(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Lowercase, non-alphanumeric → '-' — the governed filename fragment
 *  (same shape as performance-csv's slug). Falls back so the file is
 *  never anonymous. */
export function periodSlug(value: string, fallback: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

export interface PeriodLedgerCsvMeta {
  organizationName: string;
  scopeLabel: string;
  periodName: string;
  /** The period's honest date range, dayKey form: '2026-10-01 → 2026-10-31'. */
  windowLabel: string;
}

export interface PeriodLedgerCsvFile {
  filename: string;
  csv: string;
  byteSize: number;
}

/**
 * Build the governed CSV of the period's ledger — the EXACT entries the
 * drawer shows, through the same filing family the report tabs (v2.58),
 * the desk report (v2.70), the performance exports (v2.96–v2.99) and the
 * run digest (v2.53) file through.
 *
 * Layout:
 *   Report,Payroll period ledger
 *   Organization,<org>
 *   Scope,<scope>
 *   Period,<period name>
 *   Window,<start → end>
 *   Generated (UTC),<iso>
 *
 *   Ledger
 *   Entry Number,Entry Day,Run Type,Run ID,Entry Description,Account Code,Account Name,Account Type,Debit,Credit,Line Description
 *   <one row per journal line, entries newest first (drawer order)>
 *
 *   Totals,,,,,<sum debit>,<sum credit>   ← the file balances BY ITSELF
 *
 * Returns null on empty entries — the route turns that into an honest 404
 * NO_LEDGER_DATA (never an empty-looking sheet). Money files as bare 2dp
 * numbers (machine-readable, no thousands separators). The shared csvCell
 * escaper guards every cell (one OWASP formula-injection guard family-wide).
 */
export function periodLedgerToCsv(
  entries: readonly PeriodLedgerEntry[],
  meta: PeriodLedgerCsvMeta,
  generatedAt: Date = new Date(),
): PeriodLedgerCsvFile | null {
  if (entries.length === 0) return null;

  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', 'Payroll period ledger']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Period', meta.periodName]);
  row(['Window', meta.windowLabel]);
  row(['Generated (UTC)', generatedAt.toISOString()]);

  lines.push('');
  lines.push('Ledger');
  row([
    'Entry Number',
    'Entry Day',
    'Run Type',
    'Run ID',
    'Entry Description',
    'Account Code',
    'Account Name',
    'Account Type',
    'Debit',
    'Credit',
    'Line Description',
  ]);

  let totalDebit = 0;
  let totalCredit = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      row([
        e.entryNumber,
        dayKey(e.entryDate),
        e.runType,
        e.runId,
        e.description,
        l.accountCode,
        l.accountName,
        l.accountType,
        Number(l.debit || 0).toFixed(2),
        Number(l.credit || 0).toFixed(2),
        l.description ?? '',
      ]);
      totalDebit += Number(l.debit || 0);
      totalCredit += Number(l.credit || 0);
    }
  }

  lines.push('');
  row([
    'Totals',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    money2(totalDebit).toFixed(2),
    money2(totalCredit).toFixed(2),
    `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`,
  ]);

  const csv = lines.join('\r\n') + '\r\n';
  const filename = `mbumah-period-ledger-${periodSlug(meta.periodName, 'period')}.csv`;

  return { filename, csv, byteSize: Buffer.byteLength(csv, 'utf8') };
}
