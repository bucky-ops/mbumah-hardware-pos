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

// ── v2.102.0: the account opens its month ────────────────────────────────────
//
// Click a ledger line and the account's month movement opens beside the
// drawer: what the ledger posted BEFORE the window (the honest opening),
// every posted line inside it in chronological replay, and a running
// balance expressed on the account's NORMAL side (Dr for debit-normal,
// Cr for credit-normal — the way an accountant reads a T-account).
//
// HONESTY CONTRACT (inherits the ledger's):
//   • Only POSTED, never-voided entries reach this builder — the route
//     filters them; a voided entry is a closed door, an in-motion entry
//     does not exist yet. The replay therefore never prices an estimate.
//   • The opening is the route's honest aggregate over ALL prior posted
//     lines (any source — sales, payments, payroll), not a guess: with no
//     prior lines the account starts the month at zero and says so.
//   • The replay is CHRONOLOGICAL (oldest first, stable on equal stamps —
//     the ledger's own convention), the opposite of the drawer's
//     newest-first entries: a running balance is a story told forward.
//   • Money is money2 everywhere: every running step re-rounds, so float
//     drift can never compound down the column.
//   • An unknown normalBalance is assumed DEBIT and FLAGGED
//     (normalBalanceAssumed) — the drawer never silently picks a side.
//
// PURE module: no db, no network, no env — same constraint as the rest of
// this file, so unit tests run without any mocking.

/** One movement line as the route serves it: the entry resolved, money numeric. */
export interface AccountMovementSource {
  entryNumber: string;
  entryDate: string;
  entryDescription: string;
  /** The most honest source the route could resolve: the run's type, else the entry's referenceType, else 'JOURNAL'. */
  source: string;
  debit: number;
  credit: number;
  lineDescription: string | null;
}

/** The account's identity — the route resolves it org-scoped before this builder runs. */
export interface AccountMovementMeta {
  accountCode: string;
  accountName: string;
  accountType: string;
  /** DEBIT | CREDIT — the schema's default is DEBIT; anything else is assumed DEBIT and flagged. */
  normalBalance: string;
}

/** One replay row: the line plus the running balance AFTER it. */
export interface AccountMovementRow extends AccountMovementSource {
  /** Running balance after this line, signed on the account's NORMAL side. */
  running: number;
}

/** The account's month, proven one line at a time. */
export interface AccountMovement {
  account: { code: string; name: string; type: string; normalBalance: string };
  /** What the ledger posted before the window — the route's honest aggregate. */
  opening: { debit: number; credit: number; balance: number; priorLines: number };
  /** Chronological replay — oldest first, stable; each row carries its running. */
  movements: AccountMovementRow[];
  /** The month's line sums at money precision (recomputed here, never trusted). */
  totals: { debit: number; credit: number };
  /** Opening + the month's signed movement — the last running step. */
  closing: { balance: number };
  /** True when normalBalance wasn't DEBIT/CREDIT and DEBIT was assumed. */
  normalBalanceAssumed: boolean;
}

/**
 * Balance expressed on the account's NORMAL side: debit-normal accounts
 * grow with debits (Dr-positive), credit-normal with credits (Cr-positive).
 * A negative result means the balance sits on the OTHER side — the reader
 * sees the side letter, never a bare negative.
 */
export function signedBalance(debit: number, credit: number, normalBalance: string): number {
  const d = money2(Number(debit || 0));
  const c = money2(Number(credit || 0));
  return normalBalance === 'CREDIT' ? money2(c - d) : money2(d - c);
}

/**
 * Build the account's month movement. Takes the route's honest opening
 * aggregate and the window's posted lines (already chronological from the
 * query); returns the replay with running balances, recomputed totals and
 * the closing balance — opening + replay, proven line by line.
 */
export function buildAccountMovement(
  meta: AccountMovementMeta,
  opening: { debit: number; credit: number; priorLines: number },
  sources: readonly AccountMovementSource[],
): AccountMovement {
  const normalBalance = meta.normalBalance === 'CREDIT' ? 'CREDIT' : 'DEBIT';
  const normalBalanceAssumed = meta.normalBalance !== 'CREDIT' && meta.normalBalance !== 'DEBIT';

  const openBalance = signedBalance(opening.debit, opening.credit, normalBalance);

  const movements: AccountMovementRow[] = [];
  let running = openBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  for (const s of sources) {
    const debit = money2(Number(s.debit || 0));
    const credit = money2(Number(s.credit || 0));
    running = money2(running + signedBalance(debit, credit, normalBalance));
    totalDebit += debit;
    totalCredit += credit;
    movements.push({ ...s, debit, credit, running });
  }

  return {
    account: {
      code: meta.accountCode,
      name: meta.accountName,
      type: meta.accountType,
      normalBalance,
    },
    opening: {
      debit: money2(Number(opening.debit || 0)),
      credit: money2(Number(opening.credit || 0)),
      balance: openBalance,
      priorLines: opening.priorLines,
    },
    movements,
    totals: { debit: money2(totalDebit), credit: money2(totalCredit) },
    closing: { balance: running },
    normalBalanceAssumed,
  };
}

// ── v2.103.0: the account files its month ────────────────────────────────────
//
// The movement dialog said "the account's month, replayed line by line" —
// now the replay can LEAVE the console as a governed file, through the same
// filing family the period ledger (v2.101), the desk report (v2.70), the run
// digest (v2.53) and the performance exports (v2.96–v2.99) file through.
//
// HONESTY CONTRACT (inherits the movement's):
//   • The file is THE DIALOG — one row per replay line in the dialog's
//     chronological order, the opening/totals/closing footer carrying the
//     same numbers the screen shows. The file cannot disagree with the
//     screen.
//   • The file CLOSES THE LOOP BY ITSELF: the Closing line's balance cell
//     is the LAST replay row's running cell, byte for byte (or the Opening
//     cell when the window posted nothing) — a teller can prove the file
//     without opening the console, the same self-check the ledger CSV's
//     Totals line taught.
//   • Balances file the accountant's way: the side letter (Dr/Cr) instead
//     of a bare negative, the screen's own convention — a balance sitting
//     on the OTHER side reads "… Cr" on a debit-normal account, never
//     "-70414.80". Zero is "0.00 —", the em-dash the screen taught.
//   • An assumed normal side is FILED, not smoothed over: "DEBIT (assumed)"
//     in the header — the file never silently picks a side.
//   • The opening's basis is stated: zero prior lines says the account
//     starts the month at zero; an aggregate says how many lines it summed.
//
// Returns null on an empty replay — the route turns that into an honest 404
// NO_MOVEMENT_DATA (never an empty-looking sheet): nothing posted inside
// the window means nothing to file. Money files as bare 2dp numbers (the
// family's machine-readable convention); the shared csvCell escaper guards
// every cell (one OWASP formula-injection guard family-wide).

/** A running/opening/closing balance as the file prints it: the 2dp
 *  magnitude, a space, the SIDE letter on the account's normal side —
 *  '258000.00 Dr', '70414.80 Cr', zero as '0.00 —'. The same story the
 *  screen's sideLabel tells, in the file's bare-money dialect. */
export function movementSideCell(signed: number, normalBalance: string): string {
  const magnitude = money2(Math.abs(Number(signed || 0)));
  if (magnitude === 0) return '0.00 —';
  const normal = normalBalance === 'CREDIT' ? 'Cr' : 'Dr';
  const opposite = normal === 'Dr' ? 'Cr' : 'Dr';
  return `${magnitude.toFixed(2)} ${Number(signed) > 0 ? normal : opposite}`;
}

export interface AccountMovementCsvMeta {
  organizationName: string;
  scopeLabel: string;
  periodName: string;
  /** The period's honest date range, dayKey form: '2026-10-01 → 2026-10-31'. */
  windowLabel: string;
}

/**
 * Build the governed CSV of the account's month movement — the EXACT replay
 * the movement dialog shows (v2.102), through the filing family.
 *
 * Layout:
 *   Report,Payroll account movement
 *   Organization,<org>
 *   Scope,<scope>
 *   Period,<period name>
 *   Window,<start → end>
 *   Generated (UTC),<iso>
 *   Account Code,<code>
 *   Account Name,<name>
 *   Account Type,<type>
 *   Normal Balance,DEBIT            ← or "DEBIT (assumed — no known normal side)"
 *   Opening Basis,<the opening's honesty story>
 *
 *   Movement
 *   Day,Entry Number,Source,Entry Description,Line Description,Debit,Credit,Running (Dr/Cr)
 *   <one row per replay line, chronological (dialog order)>
 *
 *   Opening,,,,,,<open debit>,<open credit>,<balance cell>
 *   Month totals,,,,,,<sum debit>,<sum credit>,
 *   Closing,,,,,,<close debit>,<close credit>,<balance cell>
 *     ↑ the Closing balance cell IS the last replay row's running cell —
 *       the file closes its own loop.
 */
export function accountMovementToCsv(
  movement: AccountMovement,
  meta: AccountMovementCsvMeta,
  generatedAt: Date = new Date(),
): PeriodLedgerCsvFile | null {
  if (movement.movements.length === 0) return null;

  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', 'Payroll account movement']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Period', meta.periodName]);
  row(['Window', meta.windowLabel]);
  row(['Generated (UTC)', generatedAt.toISOString()]);
  row(['Account Code', movement.account.code]);
  row(['Account Name', movement.account.name]);
  row(['Account Type', movement.account.type]);
  row([
    'Normal Balance',
    movement.normalBalanceAssumed
      ? `${movement.account.normalBalance} (assumed — no known normal side)`
      : movement.account.normalBalance,
  ]);
  row([
    'Opening Basis',
    movement.opening.priorLines === 0
      ? 'No posted lines before the window — the account starts the month at zero'
      : `Summed from ${movement.opening.priorLines} posted ${movement.opening.priorLines === 1 ? 'line' : 'lines'} before the window — every source, not just payroll`,
  ]);

  lines.push('');
  lines.push('Movement');
  row([
    'Day',
    'Entry Number',
    'Source',
    'Entry Description',
    'Line Description',
    'Debit',
    'Credit',
    'Running (Dr/Cr)',
  ]);

  for (const m of movement.movements) {
    row([
      dayKey(m.entryDate),
      m.entryNumber,
      m.source,
      m.entryDescription,
      m.lineDescription ?? '',
      m.debit.toFixed(2),
      m.credit.toFixed(2),
      movementSideCell(m.running, movement.account.normalBalance),
    ]);
  }

  // The footer carries the same three numbers the screen's footer cards do:
  // the opening aggregate, the month's own sums, and the closing — whose
  // balance cell equals the LAST replay row's running cell (or the opening's
  // when the window posted nothing — unreachable here, the builder's only
  // null path is the empty replay, but the identity keeps the footer honest
  // for any future caller).
  const closingDebit = money2(movement.opening.debit + movement.totals.debit);
  const closingCredit = money2(movement.opening.credit + movement.totals.credit);
  const lastRunning =
    movement.movements.length > 0
      ? movementSideCell(movement.movements[movement.movements.length - 1].running, movement.account.normalBalance)
      : movementSideCell(movement.opening.balance, movement.account.normalBalance);

  lines.push('');
  row([
    'Opening',
    '',
    '',
    '',
    '',
    '',
    movement.opening.debit.toFixed(2),
    movement.opening.credit.toFixed(2),
    movementSideCell(movement.opening.balance, movement.account.normalBalance),
  ]);
  row([
    'Month totals',
    '',
    '',
    '',
    '',
    '',
    movement.totals.debit.toFixed(2),
    movement.totals.credit.toFixed(2),
    '',
  ]);
  row([
    'Closing',
    '',
    '',
    '',
    '',
    '',
    closingDebit.toFixed(2),
    closingCredit.toFixed(2),
    lastRunning,
  ]);

  const csv = lines.join('\r\n') + '\r\n';
  const accountSlug = periodSlug(
    `${movement.account.code}-${movement.account.name}`,
    'account',
  );
  const periodPart = periodSlug(meta.periodName, 'period');
  const filename = `mbumah-account-movement-${accountSlug}-${periodPart}.csv`;

  return { filename, csv, byteSize: Buffer.byteLength(csv, 'utf8') };
}
