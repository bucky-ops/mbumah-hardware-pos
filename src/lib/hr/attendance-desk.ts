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
  /** Days beyond the strip (garbage days count here too — they exist). */
  hidden: number;
}

/**
 * The strip under each desk row: which days are pending, at a glance.
 * Beyond `max` chips the overflow is an honest "+N" (hidden counts every
 * day not shown, including ones too malformed to label).
 */
export function deskDayStrip(days: readonly string[], max = 12): DeskDayStrip {
  const labels = days.map((day) => deskDayLabel(day));
  const shown: string[] = [];
  let hidden = 0;
  for (const label of labels) {
    if (label !== null && shown.length < max) shown.push(label);
    else hidden += 1;
  }
  return { shown, hidden };
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
