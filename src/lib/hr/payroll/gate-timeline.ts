// MBUMAH HARDWARE POS - the store-level gate timeline builder (v2.141.0)
//
// The per-run trail (v2.138.0) tells ONE run's story; the runs table chip
// (v2.139.0) counts ONE run's attempts. Neither answers the question a
// returning manager actually asks: "how has the gate behaved across every
// run this store has attempted?" The timeline fixes that read-back: the
// same append-only PayrollRunGateEvent rows, read ACROSS runs, newest
// first, with the movement still computed chronologically — because a
// verdict can only move from the attempt before it, whatever run it
// belonged to.
//
// HONESTY CONTRACT (the trail's own rules, carried across runs):
//   • Every attempt speaks — never deduped, never smoothed. Two identical
//     verdicts in a row means prepare ran twice and the gate said the same
//     thing twice; that IS the history.
//   • `moved` marks the row where the verdict text differs from the attempt
//     before it CHRONOLOGICALLY (the caller feeds oldest-first). The first
//     chronological row carries moved=false — nothing before it moved. A
//     run boundary does NOT reset the comparison: the story is the gate's,
//     not the run's.
//   • Garbage degrades, never guesses: an unreadable summary keeps its row
//     ('Verdict unreadable', muted); an unreadable clock has no ISO; an
//     unknown outcome speaks UNKNOWN; junk rows (no id, no runId) drop —
//     an attempt that cannot say which run it belongs to cannot sit in a
//     cross-run story.
//   • The window is the caller's honesty to speak: the route reads the
//     NEWEST N events and says so; the builder never pretends it saw more.
//
// PURE module: no db, no network, no clock, no window — same constraint as
// gate-trail.ts and run-history.ts. Verdict text comes from the v2.135.0
// parser so every surface speaks the frozen strip's exact words. (The
// v2.143.0 filename builder is the one injection point: the clock arrives
// as a parameter — `when: Date = new Date()`, the consent filenames' own
// pattern — so feeding a Date keeps it deterministic.)

import { parseGateVerdict, buildGateVerdictText, gateVerdictTone } from './gate-verdict';

export interface GateTimelineEvent {
  id: string;
  /** The run the attempt belongs to — a required relation at write time. */
  runId: string;
  /** What the run is called (period name or code) — null stays null. */
  runLabel: string | null;
  /** The run's status at read time (DRAFT/POSTED/…) — context, not verdict. */
  runStatus: string | null;
  outcome: string | null;
  checkedAt: Date | string | null;
  summary: unknown;
  actorLabel: string | null;
}

export interface GateTimelineRow {
  id: string;
  runId: string;
  runLabel: string | null;
  runStatus: string | null;
  outcome: 'PASSED' | 'BLOCKED' | 'UNKNOWN';
  /** ISO string or null — an unreadable clock degrades, never guesses. */
  atIso: string | null;
  /** The frozen strip's own words; 'Verdict unreadable' when garbage. */
  text: string;
  tone: 'emerald' | 'amber' | 'muted';
  actorLabel: string | null;
  /** true when this attempt's verdict differs from the one before it (chronological). */
  moved: boolean;
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Shape the store's gate events (caller passes them ordered OLDEST-FIRST —
 * movement is computed in the direction attempts actually happen; the UI
 * renders newest-first). Tolerant by construction: garbage degrades row by
 * row, junk rows drop, every surviving attempt speaks.
 */
export function buildGateTimeline(events: readonly GateTimelineEvent[]): GateTimelineRow[] {
  if (!Array.isArray(events)) return [];
  const rows: GateTimelineRow[] = [];
  let previousText: string | null = null;
  for (const event of events) {
    if (!event || typeof event.id !== 'string' || !event.id) continue;
    if (typeof event.runId !== 'string' || !event.runId) continue;
    const outcome =
      event.outcome === 'PASSED' || event.outcome === 'BLOCKED' ? event.outcome : 'UNKNOWN';
    const verdict = parseGateVerdict(
      event.summary,
      typeof event.checkedAt === 'string' ? event.checkedAt : undefined,
    );
    // The parser returns a VERDICT { checkedAt, summary }; the text/tone
    // builders speak the SUMMARY (the v2.135.0 frozen strip's own contract).
    const text = verdict ? buildGateVerdictText(verdict.summary) : 'Verdict unreadable';
    const rawTone = verdict ? gateVerdictTone(verdict.summary) : null;
    const tone: GateTimelineRow['tone'] =
      rawTone === 'clear' ? 'emerald' : rawTone === 'blocked' ? 'amber' : 'muted';
    rows.push({
      id: event.id,
      runId: event.runId,
      runLabel: typeof event.runLabel === 'string' && event.runLabel.trim() ? event.runLabel : null,
      runStatus:
        typeof event.runStatus === 'string' && event.runStatus.trim() ? event.runStatus : null,
      outcome,
      atIso: toIso(event.checkedAt),
      text,
      tone,
      actorLabel: event.actorLabel ?? null,
      moved: previousText !== null && previousText !== text,
    });
    previousText = text;
  }
  return rows;
}

export interface GateTimelineSummary {
  attempts: number;
  /** Distinct runs the visible attempts belong to — the story's breadth. */
  runs: number;
  lastOutcome: 'PASSED' | 'BLOCKED' | 'UNKNOWN' | null;
  lastAtIso: string | null;
}

/**
 * Summarize a timeline (caller passes it in ANY order — the summary reads
 * the clock, not the position; ties fall back to array order which the
 * route has already made deterministic). Zeros are honest: no attempts is
 * a store that has never prepared, not a failure.
 */
export function summarizeGateTimeline(rows: readonly GateTimelineRow[]): GateTimelineSummary {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { attempts: 0, runs: 0, lastOutcome: null, lastAtIso: null };
  }
  let last: GateTimelineRow | null = null;
  for (const row of rows) {
    if (!last) {
      last = row;
      continue;
    }
    const rowAt = row.atIso ? Date.parse(row.atIso) : NaN;
    const lastAt = last.atIso ? Date.parse(last.atIso) : NaN;
    if (Number.isFinite(rowAt) && (!Number.isFinite(lastAt) || rowAt >= lastAt)) last = row;
  }
  const runs = new Set(rows.map((r) => r.runId)).size;
  return {
    attempts: rows.length,
    runs,
    lastOutcome: last ? last.outcome : null,
    lastAtIso: last ? last.atIso : null,
  };
}

// ── v2.142.0: the activity card answers back ────────────────────────────────
// The card kept the whole story readable but not WORKABLE: a manager hunting
// the stops had to scan every PASSED row, and the audit story could not
// leave the screen. The lens (a view preference — the summary chip keeps
// speaking ALL attempts) and the RFC 4180 export door (the family's newest
// member, after discipline-ledger, discipline-list, and the timesheet desk)
// fix both. Same honesty rules as everywhere else on the card.

// ── v2.143.0: the story scopes itself ───────────────────────────────────────
// The lens answered "show me the stops"; it could not answer "what did the
// gate do in OCTOBER". The read already carries each run's period name, so
// the scope rides the SAME payload — one pure list of the periods present,
// one pure filter that composes the period with the lens, and a filename
// that says when the export is scoped. The header chip keeps speaking ALL
// attempts (route-built); the scoped counts wear their own line. Honesty
// rules unchanged: order preserved, nothing guessed, "All periods" is a
// real option — unlabeled runs never vanish from the view, they only step
// aside when a period is picked.

export interface GateTimelineCsvRow {
  /** ISO string or '' — an unreadable clock exports empty, never guessed. */
  attemptedAt: string;
  period: string;
  runStatus: string;
  outcome: string;
  /** The frozen strip's own words ('Verdict unreadable' when garbage). */
  verdict: string;
  actor: string;
}

// Pinned by tests: the honest column set of the timeline row itself. No
// employee codes, no pay fields — the verdict text speaks counts, not
// identities, so an export can never become a surveillance list.
const GATE_CSV_HEADERS = [
  'attempted_at',
  'period',
  'run_status',
  'outcome',
  'verdict',
  'actor',
] as const;

/** RFC 4180 cell escaping: quote when needed, double embedded quotes. */
export function escapeGateCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The gate activity as CSV — the caller passes rows AS SHOWN (lens applied,
 * display order preserved): what the card shows is what prints. The export
 * is the WHOLE window the read returned (never the 8-row viewport — a
 * display bound must never silently truncate an audit artifact).
 */
export function buildGateTimelineCsv(rows: readonly GateTimelineCsvRow[]): string {
  const lines = [GATE_CSV_HEADERS.join(',')];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    lines.push(
      [
        escapeGateCsvCell(row.attemptedAt),
        escapeGateCsvCell(row.period),
        escapeGateCsvCell(row.runStatus),
        escapeGateCsvCell(row.outcome),
        escapeGateCsvCell(row.verdict),
        escapeGateCsvCell(row.actor),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * The card's blocked-only lens. A view preference, not a data change: order
 * preserved, garbage never passes (an UNKNOWN outcome is not BLOCKED), and
 * the summary chip keeps speaking the row set's TOTAL. Non-array → [].
 */
export function filterGateTimeline(
  rows: readonly GateTimelineRow[],
  blockedOnly: boolean,
): GateTimelineRow[] {
  if (!Array.isArray(rows)) return [];
  if (!blockedOnly) return [...rows];
  return rows.filter((r) => r && r.outcome === 'BLOCKED');
}

/** One period present in the timeline read, with its own honest counts. */
export interface GateTimelinePeriod {
  /** The run's payroll period name — the only period identity the payload carries. */
  label: string;
  attempts: number;
  /** Distinct runs inside the period — a period prepared twice in one run counts one run. */
  runs: number;
}

/**
 * The periods present in this window, first-appearance ordered. The route
 * feeds newest-first, so the picker lists the newest period first — the
 * same reading direction the card itself uses. Rows without a period label
 * never invent an entry (they stay visible under "All periods"); a period's
 * runs are DISTINCT run ids, not row count.
 */
export function listTimelinePeriods(rows: readonly GateTimelineRow[]): GateTimelinePeriod[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Map<string, { attempts: number; runs: Set<string> }>();
  for (const row of rows) {
    if (!row || typeof row.runLabel !== 'string' || !row.runLabel.trim()) continue;
    const entry = seen.get(row.runLabel) ?? { attempts: 0, runs: new Set<string>() };
    entry.attempts += 1;
    entry.runs.add(row.runId);
    seen.set(row.runLabel, entry);
  }
  return Array.from(seen.entries()).map(([label, v]) => ({
    label,
    attempts: v.attempts,
    runs: v.runs.size,
  }));
}

export interface GateScopeOptions {
  /** The lens: BLOCKED attempts only. Undefined/false keeps every outcome. */
  blockedOnly?: boolean;
  /** The period scope: a run label from listTimelinePeriods. Null/'' = all. */
  periodLabel?: string | null;
}

/**
 * The card's one composition point: period scope ∩ lens. Order preserved,
 * intersection is the filter (either dimension alone narrows the same way),
 * and with both dimensions off this is a COPY — the caller's array is never
 * mutated. Non-array → []; an unknown period → [] (an empty scope is an
 * honest empty, never a silent unscoped view).
 */
export function scopeGateTimeline(
  rows: readonly GateTimelineRow[],
  opts: GateScopeOptions,
): GateTimelineRow[] {
  if (!Array.isArray(rows)) return [];
  const period =
    typeof opts?.periodLabel === 'string' && opts.periodLabel ? opts.periodLabel : null;
  let out = period ? rows.filter((r) => r && r.runLabel === period) : [...rows];
  if (opts?.blockedOnly) out = out.filter((r) => r && r.outcome === 'BLOCKED');
  return out;
}

/**
 * The export's filename — date-stamped like the desk export, and when the
 * story is scoped to one period the name says so (a scoped export and the
 * full-window export must never look alike in a downloads folder). The
 * slug keeps [a-z0-9-]: every other character collapses to one '-'. The
 * clock is injected (the consent timeline filenames' own pattern) — the
 * module stays pure, the caller feeds now.
 */
export function gateTimelineCsvFilename(
  periodLabel?: string | null,
  when: Date = new Date(),
): string {
  const date = when.toISOString().slice(0, 10);
  const slug =
    typeof periodLabel === 'string' && periodLabel
      ? periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : '';
  return slug ? `gate-activity-${slug}-${date}.csv` : `gate-activity-${date}.csv`;
}
