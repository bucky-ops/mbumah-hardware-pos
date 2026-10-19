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
// parser so every surface speaks the frozen strip's exact words.

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
