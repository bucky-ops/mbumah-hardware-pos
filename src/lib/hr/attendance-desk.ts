// MBUMAH HARDWARE POS - the timesheet desk's pure layer (v2.136.0)
//
// The run gate's second block code (TIMESHEET_NOT_APPROVED) finally has a
// desk: /hr/timesheets. This module is the desk's PURE half — the same
// discipline run-groups.ts brought to the runs table. It groups the
// pending read's attendance rows into per-employee desk rows, renders the
// day strip chips, and formats date-only labels in UTC.
//
// HONESTY CONTRACT:
//  - The grouping mirrors the gate's own where/order: ACTIVE employees,
//    store-scoped, employeeCode ascending (parity with run-gate.ts).
//  - Attendance dates are DATE-ONLY semantics stored at midnight UTC —
//    every label is derived through UTC parts, never a locale timezone,
//    so a day can never drift to the previous/next day for a Kenyan
//    manager (the exact off-by-one the schema note warns about).
//  - Garbage degrades, never guesses: an unparseable date is dropped from
//    the strip but stays counted; a missing code wears the em-dash.

export interface AttendanceDeskRow {
  employeeId: string;
  /** '—' when the employee has no code (the gate's own fallback). */
  employeeCode: string;
  employeeName: string;
  /** ISO date-only (YYYY-MM-DD) pending days, ascending, deduped. */
  days: string[];
  /** days[0] — '' when the row has no valid days. */
  firstDay: string;
  /** days[days.length - 1] — '' when the row has no valid days. */
  lastDay: string;
}

/** One raw pending-attendance record as the pending read returns it. */
export interface AttendanceDeskInput {
  employeeId: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  /** Date object or ISO string — both are date-only semantics (midnight UTC). */
  date: Date | string;
}

/**
 * Reduce an ISO-ish date (Date or string) to YYYY-MM-DD in UTC.
 * Returns null for garbage — the desk never invents a day.
 */
export function deskDateOnly(value: Date | string): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // YYYY-MM-DD (optionally followed by a time part) — take the date head.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Group the pending read's rows into per-employee desk rows, in the gate's
 * own order (employeeCode asc, name as tie-break). Days dedupe and sort
 * ascending; a garbage date never contributes a day but the row still
 * speaks if it has at least one valid day. Pure — no db, no clock.
 */
export function groupUnapprovedByEmployee(rows: readonly AttendanceDeskInput[]): AttendanceDeskRow[] {
  const byEmployee = new Map<string, { code: string; name: string; days: Set<string> }>();
  for (const row of rows) {
    const id = typeof row.employeeId === 'string' ? row.employeeId : '';
    if (!id) continue;
    const name = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
    let entry = byEmployee.get(id);
    if (!entry) {
      entry = { code: row.employeeCode ?? '—', name, days: new Set<string>() };
      byEmployee.set(id, entry);
    }
    if (entry.code === '—' && row.employeeCode) entry.code = row.employeeCode;
    if (!entry.name && name) entry.name = name;
    const day = deskDateOnly(row.date);
    if (day) entry.days.add(day);
  }

  return Array.from(byEmployee.entries())
    .map(([employeeId, entry]) => {
      const days = Array.from(entry.days).sort((a, b) => a.localeCompare(b));
      return {
        employeeId,
        employeeCode: entry.code || '—',
        employeeName: entry.name,
        days,
        firstDay: days[0] ?? '',
        lastDay: days[days.length - 1] ?? '',
      };
    })
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode) || a.employeeName.localeCompare(b.employeeName));
}

/** Short weekday names, indexed by getUTCDay(). */
const DESK_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * 'Mon 19' — the day chip's label, derived through UTC parts so the
 * date-only semantics hold for every timezone the desk is read from.
 * Null for garbage (the strip just omits it).
 */
export function deskDayLabel(day: string): string | null {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${DESK_WEEKDAYS[date.getUTCDay()]} ${String(date.getUTCDate()).padStart(2, '0')}`;
}

export interface DeskDayStrip {
  /** The first `max` valid labels, in ascending day order. */
  shown: string[];
  /** The days behind `shown` (parallel array) — lets the UI tint weekends. */
  shownDays: string[];
  /** Days beyond the strip (garbage days count here too — they exist). */
  hidden: number;
}

/**
 * Saturday or Sunday, read through UTC parts — the desk tints weekend
 * chips so a Saturday punch stands out from the working week (an honest
 * anomaly spotlight, not a judgement). Garbage never reads as weekend.
 */
export function deskDayIsWeekend(day: string): boolean {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const weekday = date.getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * The strip under each desk row: which days are pending, at a glance.
 * Beyond `max` chips the overflow is an honest "+N" (hidden counts every
 * day not shown, including ones too malformed to label).
 */
export function deskDayStrip(days: readonly string[], max = 12): DeskDayStrip {
  const labels = days.map((day) => deskDayLabel(day));
  const shown: string[] = [];
  const shownDays: string[] = [];
  let hidden = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label !== null && shown.length < max) {
      shown.push(label);
      shownDays.push(days[i]);
    } else {
      hidden += 1;
    }
  }
  return { shown, shownDays, hidden };
}

// ── v2.140.0: the weekends-only lens ────────────────────────────────────────
// The weekend TINT (v2.138) made a Saturday punch stand out; a long strip
// still buries it. The lens is the desk's second reading: keep only the
// weekend days, in the same ascending order, so a Monday-morning review can
// ask "who worked the weekend?" without counting amber chips. Pure and
// additive — the strip builder never learns about weekends; the page
// composes. Garbage never passes (deskDayIsWeekend is false for it), and a
// row with no weekend days lenses to an honest empty, not to silence about
// the whole row (the count chip still speaks the total).

/**
 * The weekend subset of a row's pending days, order preserved. Garbage and
 * weekday days drop; the result only ever contains real Sat/Sun date-onlys.
 */
export function deskWeekendDays(days: readonly string[]): string[] {
  if (!Array.isArray(days)) return [];
  return days.filter((day) => deskDayIsWeekend(day));
}

/**
 * '1 Oct – 31 Oct 2026' — the scope line under the picker. UTC again; the
 * year prints once when both days share it, twice when they do not.
 */
export function deskRangeLabel(from: string, to: string): string {
  const a = deskDateOnly(from);
  const b = deskDateOnly(to);
  if (!a || !b) return '';
  const label = (iso: string) => {
    const date = new Date(`${iso}T00:00:00Z`);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
  };
  const ay = a.slice(0, 4);
  const by = b.slice(0, 4);
  return ay === by ? `${label(a)} – ${label(b)} ${by}` : `${label(a)} ${ay} – ${label(b)} ${by}`;
}

// ── v2.139.0: the batch's honest receipt ───────────────────────────────────
// "Approve all" loops the ONE per-employee approve service on the client —
// never a new bulk write path. Each attempt lands in a result; this builder
// turns the results into the strip the desk shows when the batch ends. It
// never smooths: partial batches say exactly who failed and why, and a
// batch that raced the desk (every day already approved) says so instead
// of wearing a hollow green.

export interface DeskBulkAttemptResult {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  ok: boolean;
  approved: number;
  error?: string | null;
}

export interface DeskBulkSummary {
  tone: 'ok' | 'partial' | 'err';
  /** The strip's first line — counts pluralized honestly. */
  text: string;
  /** One line per failed employee: 'MBH-1-001 John Mwangi — the reason'. */
  failures: string[];
}

/**
 * Shape the batch receipt from the per-employee results, in the order the
 * desk attempted them. Null only when the batch never ran (no rows) —
 * the strip renders nothing rather than an empty promise.
 */
export function buildBulkApproveSummary(
  results: readonly DeskBulkAttemptResult[],
): DeskBulkSummary | null {
  if (!results || results.length === 0) return null;
  const failures = results
    .filter((r) => !r || !r.ok)
    .map(
      (r) =>
        `${r.employeeCode || '—'} ${r.employeeName || ''}`.trim() +
        ` — ${r.error && r.error.trim() ? r.error.trim() : 'approval failed'}`,
    );
  const okRows = results.filter((r) => r && r.ok);
  const days = okRows.reduce((sum, r) => sum + (Number.isFinite(r.approved) ? r.approved : 0), 0);
  const employees = okRows.length;
  const dayWord = days === 1 ? 'day' : 'days';
  const employeeWord = employees === 1 ? 'employee' : 'employees';
  if (failures.length === results.length) {
    return {
      tone: 'err',
      text: `No approvals landed — all ${results.length} ${
        results.length === 1 ? 'attempt' : 'attempts'
      } failed. Nothing was approved; retry from their rows.`,
      failures,
    };
  }
  if (failures.length > 0) {
    return {
      tone: 'partial',
      text: `Approved ${days} ${dayWord} for ${employees} of ${results.length} ${
        results.length === 1 ? 'employee' : 'employees'
      } — ${failures.length} ${failures.length === 1 ? 'approval' : 'approvals'} failed; retry from their rows.`,
      failures,
    };
  }
  if (days === 0) {
    return {
      tone: 'ok',
      text: 'Nothing left to approve — every listed day was already approved.',
      failures: [],
    };
  }
  return {
    tone: 'ok',
    text: `Approved ${days} ${dayWord} across ${employees} ${employeeWord}.`,
    failures: [],
  };
}

// ── v2.141.0: the desk lens keeps its preference ────────────────────────────
// The weekends-only lens (v2.140.0) reset on every navigation — a manager
// hunting weekend anomalies re-toggled it all morning. The lens now persists
// per browser (localStorage), read through these guards so a dead storage
// degrades to the lens OFF, never a crash. Stored here (the desk's own pure
// module) so the desk page stays thin and the contract is testable without
// a browser host.

export const DESK_LENS_STORAGE_KEY = 'mbumah.hr.timesheets.lens.weekendsOnly';

/** Read the persisted lens preference. 'weekdays' reads as itself; the legacy
 * boolean era reads as its own meaning ('1' → 'weekends' — the value the
 * writer of that '1' actually chose); anything else (unset, '0', junk) reads
 * 'all'. A throwing/dead storage reads 'all' — the lens never guesses a
 * preference it cannot read. */
export function readDeskLensPref(store: Pick<Storage, 'getItem'> | null | undefined): DeskLensPref {
  try {
    const raw = store?.getItem(DESK_LENS_STORAGE_KEY);
    if (raw === 'weekdays') return 'weekdays';
    if (raw === 'weekends' || raw === '1') return 'weekends';
    return 'all';
  } catch {
    return 'all';
  }
}

/** Persist the lens preference: 'weekends'/'weekdays' store their word, 'all'
 * REMOVES the key (no stale-value litter — the old turn-off's own rule); a
 * throwing storage degrades to silence — the lens is a view preference,
 * never worth a crashed render. */
export function writeDeskLensPref(
  store: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  pref: DeskLensPref,
): void {
  try {
    if (!store) return;
    if (pref === 'weekends' || pref === 'weekdays') store.setItem(DESK_LENS_STORAGE_KEY, pref);
    else store.removeItem(DESK_LENS_STORAGE_KEY);
  } catch {
    // Cosmetic — a blocked persistence costs nothing honest.
  }
}

// ── v2.145.0: the desk lens learns weekdays ─────────────────────────────
// The weekends-only lens answered "who worked the weekend?"; the mirror
// question — "show me just the working-week days" — still needed an eyeball.
// The lens completes the pair as a three-way day-kind filter (ALL / WEEKENDS
// / WEEKDAYS), the gate card's outcome trio's own shape (v2.144.0). The
// persisted preference grows WITHOUT abandoning old browsers: the v2.141.0
// boolean '1' still reads as 'weekends' — a reader who chose the weekend
// lens keeps it across the upgrade, never a silent reset. The storage KEY
// is unchanged (the name is cosmetic; this comment carries the dual-value
// era). deskWeekdayDays is deskWeekendDays's honest sibling below.

/** The desk lens's three ways: 'all' keeps every day, 'weekends' keeps real
 * Sat/Sun, 'weekdays' keeps valid non-weekend days. Garbage survives only
 * under 'all' — an unreadable day is honestly neither. */
export type DeskLensPref = 'all' | 'weekends' | 'weekdays';

/**
 * The weekday subset of a row's pending days, order preserved — valid days
 * that are NOT Sat/Sun. Garbage drops from BOTH day-kind lenses (an
 * unreadable day belongs to no day-kind view, only to All) and stays counted
 * in the row's total chip either way. Readability rides deskDayLabel itself
 * (v2.146.0) — a shape-valid but calendar-impossible day ('2026-13-99') is
 * unreadable, and unreadable is honestly neither kind.
 */
export function deskWeekdayDays(days: readonly string[]): string[] {
  if (!Array.isArray(days)) return [];
  return days.filter((day) => deskDayLabel(day) !== null && !deskDayIsWeekend(day));
}

// ── v2.146.0: the split the lenses imply ────────────────────────────────
// The lens trio (v2.145.0) answers "show me one kind" one click at a time;
// neither click tells you the SHAPE of a row at a glance — a manager
// scanning ten rows still counts chips by eye. The split is the two counts
// the lenses imply, printed under the total chip, always visible without
// lensing. ONE definition of each kind: the split composes
// deskWeekdayDays/deskWeekendDays themselves — never a second parser. The
// honesty rule is the lenses' own: an unreadable day counts in NEITHER
// bucket (it stays counted in the row's total chip, which keeps speaking
// the whole row) — the split speaks only what it can honestly read.

/** A row's pending days by kind: weekday count (Mon–Fri) and weekend count
 * (Sat/Sun). Garbage days contribute to neither — the total chip owns them. */
export interface DeskDaySplit {
  weekday: number;
  weekend: number;
}

/**
 * Count a row's pending days by kind. Composes the two day-kind siblings
 * (ONE definition of weekday, ONE of weekend); non-array reads empty — a
 * missing strip counts zero, never a guessed pair.
 */
export function deskDaySplit(days: readonly string[]): DeskDaySplit {
  if (!Array.isArray(days)) return { weekday: 0, weekend: 0 };
  return { weekday: deskWeekdayDays(days).length, weekend: deskWeekendDays(days).length };
}

/**
 * The split's spoken form: '1 weekday · 1 weekend' when both kinds are
 * present, the lone non-zero kind when only one is (a zero bucket adds
 * noise, not honesty — the missing number reads as zero), '' when nothing
 * is readable (an all-garbage row has no honest split; the total chip is
 * already speaking its truth). Garbage input reads '' — never a guess.
 */
export function deskSplitLabel(split: DeskDaySplit | null | undefined): string {
  if (!split) return '';
  const weekday =
    Number.isFinite(split.weekday) && split.weekday > 0
      ? `${split.weekday} ${split.weekday === 1 ? 'weekday' : 'weekdays'}`
      : '';
  const weekend =
    Number.isFinite(split.weekend) && split.weekend > 0
      ? `${split.weekend} ${split.weekend === 1 ? 'weekend' : 'weekends'}`
      : '';
  if (weekday && weekend) return `${weekday} · ${weekend}`;
  return weekday || weekend;
}
