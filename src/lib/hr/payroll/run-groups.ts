// MBUMAH HARDWARE POS - Period-centric run grouping (v2.98.0)
//
// The runs table used to read as rows: four "October 2026" lines back to
// back, each a different run type at a different lifecycle stage, the period
// name repeated until it stopped meaning anything. Runs read as PERIODS
// now: one header per payroll period, its runs folded underneath, and the
// money that matters (what has actually posted) summed where the eye lands
// first — a ledger of months, not a log of rows.
//
// HONESTY CONTRACT:
//   • Money subtotals (settledGross / settledDeductions / settledNet) sum
//     ONLY settled runs — POSTED or LOCKED, journal posted, payslips
//     issued, append-only. A draft or a pending approval is an estimate;
//     mixing an estimate into a settled total would lie about money, so
//     unsettled runs only ever count as counts (the header says how many
//     wait, never what they are worth).
//   • VOIDED runs exist (runCount) but count toward nothing else — not
//     settled, not in motion, not attention. A voided run is a closed door.
//   • REJECTED / FAILED runs are "attention": they block the period from
//     reading as done and must be impossible to miss.
//   • `settledPayslips` counts payslips the same honest way — only issued
//     ones (POSTED | LOCKED employeeCount), never a draft's promise.
//   • Periods order by their LATEST run (newest first): the month you
//     worked on most recently leads. Runs inside a period keep the API's
//     newest-first order (stable — equal keys never reorder).
//   • Grouping key is the period NAME: the run DTO's payrollPeriod carries
//     name/dates but no id, and period names are unique among payroll
//     periods ("October 2026", "2026-W05" — the create dialog's example).
//
// PURE module: no db, no network, no env — same constraint as
// run-history.ts, so unit tests run without any mocking.

/** The lifecycle statuses whose money is real: journal posted, payslips issued. */
export const SETTLED_RUN_STATUSES = ['POSTED', 'LOCKED'] as const;

/** Statuses where the run is alive and moving but its money is still an estimate. */
export const IN_MOTION_RUN_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] as const;

/** Statuses that need a human before the period can read as done. */
export const ATTENTION_RUN_STATUSES = ['REJECTED', 'FAILED'] as const;

/**
 * Structural subset of the runs the console page already fetches from
 * `/api/payroll/runs` — the group builder reads only what grouping needs,
 * so the page's full DTO satisfies it without conversion (same pattern as
 * run-history.ts's RunHistorySource).
 */
export interface RunGroupSource {
  id: string;
  runType: string;
  status: string;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  employeeCount: number;
  createdAt: string;
  payrollPeriod: { name: string; payDate: string | null; startDate: string; endDate: string };
}

/** One period's folded story: its runs plus the honest arithmetic above them.
 *
 * Generic over the run type the caller hands in — the page's full
 * PayrollRunDto flows through UNNARROWED (a run row still carries
 * submittedAt, errorMessage, the lifecycle stamps), while the builder
 * itself only ever reads the RunGroupSource subset. Narrow in, wide out.
 */
export interface PayrollPeriodGroup<T extends RunGroupSource = RunGroupSource> {
  periodName: string;
  payDate: string | null;
  startDate: string;
  endDate: string;
  /** The period's runs, newest first (API order preserved — stable),
   *  typed as the caller's own DTO — nothing is dropped in the fold. */
  runs: T[];
  runCount: number;
  /** POSTED + LOCKED — the only runs whose money counts below. */
  settledCount: number;
  /** DRAFT / PENDING_APPROVAL / APPROVED — alive, but estimates. */
  inMotionCount: number;
  /** REJECTED / FAILED — blocks the period from reading as done. */
  attentionCount: number;
  /** VOIDED — exists, counts toward nothing else. */
  voidedCount: number;
  settledGross: number;
  settledDeductions: number;
  settledNet: number;
  /** employeeCount summed over SETTLED runs only — payslips actually issued. */
  settledPayslips: number;
  /** The newest createdAt in the period — drives period ordering. */
  latestRunAt: string;
}

const settled = (status: string): boolean =>
  (SETTLED_RUN_STATUSES as readonly string[]).includes(status);
const inMotion = (status: string): boolean =>
  (IN_MOTION_RUN_STATUSES as readonly string[]).includes(status);
const attention = (status: string): boolean =>
  (ATTENTION_RUN_STATUSES as readonly string[]).includes(status);

/**
 * Group payroll runs into period buckets with honest settled-money
 * subtotals. Empty in → empty out. Never throws on odd statuses: an
 * unknown status is simply none of settled / in-motion / attention (it
 * still shows its row and its runCount) — the header never invents a
 * category for a status it has not been taught.
 */
export function groupRunsByPeriod<T extends RunGroupSource>(runs: T[]): PayrollPeriodGroup<T>[] {
  const byPeriod = new Map<string, T[]>();
  for (const run of runs) {
    const name = run.payrollPeriod.name;
    const bucket = byPeriod.get(name);
    if (bucket) bucket.push(run);
    else byPeriod.set(name, [run]);
  }

  const groups: PayrollPeriodGroup<T>[] = [];
  for (const [periodName, periodRuns] of byPeriod) {
    let settledGross = 0;
    let settledDeductions = 0;
    let settledNet = 0;
    let settledCount = 0;
    let inMotionCount = 0;
    let attentionCount = 0;
    let voidedCount = 0;
    let settledPayslips = 0;
    let latestMs = -1;
    let latestRunAt = periodRuns[0].createdAt;

    for (const run of periodRuns) {
      if (settled(run.status)) {
        settledCount++;
        settledPayslips += run.employeeCount;
        settledGross += Number(run.totalGross) || 0;
        settledDeductions += Number(run.totalDeductions) || 0;
        settledNet += Number(run.totalNet) || 0;
      } else if (inMotion(run.status)) {
        inMotionCount++;
      } else if (attention(run.status)) {
        attentionCount++;
      } else if (run.status === 'VOIDED') {
        voidedCount++;
      }
      const ms = Date.parse(run.createdAt);
      if (!Number.isNaN(ms) && ms > latestMs) {
        latestMs = ms;
        latestRunAt = run.createdAt;
      }
    }

    const head = periodRuns[0].payrollPeriod;
    groups.push({
      periodName,
      payDate: head.payDate,
      startDate: head.startDate,
      endDate: head.endDate,
      runs: periodRuns,
      runCount: periodRuns.length,
      settledCount,
      inMotionCount,
      attentionCount,
      voidedCount,
      settledGross,
      settledDeductions,
      settledNet,
      settledPayslips,
      latestRunAt,
    });
  }

  // Newest period first — by the period's latest run, never by name.
  return groups.sort((a, b) => {
    const da = Date.parse(a.latestRunAt);
    const db = Date.parse(b.latestRunAt);
    if (da !== db) return db - da;
    return b.runCount - a.runCount;
  });
}

// ── v2.134.0: the gate opens onto empty months ──────────────────────────────
//
// The v2.133.0 pre-flight gate door rode the runs table's period headers —
// and `groupRunsByPeriod` only groups periods that HAVE runs. A freshly
// opened period (the common case: a new month, zero runs) rendered nowhere,
// so the lifecycle's front door was locked exactly when it matters most:
// before the FIRST run of the month is prepared. `emptyPeriodRows` closes
// that gap at the data layer: given the periods the API knows and the
// groups the runs built, it names the periods the runs table will never
// render — the pre-flight rows.
//
// HONESTY CONTRACT:
//   • Matching is by period NAME — the same key `groupRunsByPeriod` groups
//     by (the run DTO's payrollPeriod carries name/dates but no id, and
//     "period names are unique among payroll periods" is the house rule the
//     grouping already stands on). A period whose name appears in ANY group
//     has runs; it never appears here, no matter how few.
//   • A period here carries its REAL id — the gate door needs
//     `GET /api/payroll/runs/gate?periodId=` and a run-less period has no
//     run to borrow an id from (the header door's `runs[0]?.payrollPeriodId`
//     trick has nothing to borrow from).
//   • Order is deterministic and honest for a pre-flight list: newest month
//     first (startDate descending — the month you're ABOUT to run leads),
//     ties broken by name ascending so equal stamps never flicker.
//   • VOIDED periods are NOT filtered out — the gate has an honest verdict
//     for them ("runs are closed") and the row's status chip says why.
//   • Pure: no db, no network, no env. Corrupt/missing stamps degrade in
//     the sort (string compare), never throw.

/** Structural subset of the periods the page already fetches from
 *  `/api/payroll/periods` — the empty-row builder reads only what it needs,
 *  so the page's full PayrollPeriodDto flows through UNNARROWED. */
export interface EmptyPeriodSource {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  payDate: string | null;
  /** The period's lifecycle word (OPEN / CLOSED / VOIDED …) — the row's
   *  chip speaks it verbatim; the gate has an honest verdict for each. */
  status?: string;
}

/** One run-less period: the minimum the pre-flight row and its gate door
 *  need. The period's real id rides every row — the gate is period-keyed,
 *  not run-keyed. */
export interface EmptyPeriodRow {
  periodId: string;
  periodName: string;
  startDate: string;
  endDate: string;
  payDate: string | null;
  /** The period's lifecycle word, passed through verbatim (an unknown or
   *  missing status degrades to '' — the chip renders UNKNOWN, never a
   *  guessed state). */
  status: string;
}

/**
 * Name the periods the runs table will never render: every period the API
 * knows whose name appears in NO run group. Empty periods in → empty rows
 * out; a fully-run month list in → an empty array (nothing is pre-flight).
 */
export function emptyPeriodRows(
  periods: readonly EmptyPeriodSource[],
  groups: readonly { periodName: string }[],
): EmptyPeriodRow[] {
  const withRuns = new Set(groups.map((g) => g.periodName));
  return periods
    .filter((p) => !withRuns.has(p.name))
    .map((p) => ({
      periodId: p.id,
      periodName: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      payDate: p.payDate,
      status: p.status ?? '',
    }))
    .sort((a, b) => {
      const byStart = String(b.startDate ?? '').localeCompare(String(a.startDate ?? ''));
      if (byStart !== 0) return byStart;
      return String(a.periodName ?? '').localeCompare(String(b.periodName ?? ''));
    });
}
