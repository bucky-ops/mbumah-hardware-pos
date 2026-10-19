// MBUMAH HARDWARE POS - the gate verdict trail builder (v2.138.0)
//
// The v2.135.0 snapshot froze THE verdict on the run — but it refreshes in
// place, so "how did the verdict move between attempts" evaporated on every
// re-prepare. The trail fixes that: every prepare attempt appends ONE
// PayrollRunGateEvent row (append-only, never updated), and this pure
// builder shapes those rows for the run dialog.
//
// HONESTY CONTRACT:
//   • Every attempt speaks — the trail never dedupes, never smooths. Two
//     identical verdicts in a row means prepare ran twice and the gate said
//     the same thing twice; that IS the history.
//   • `changed` marks the row where the verdict text differs from the
//     attempt before it — the whole point of the trail, surfaced honestly.
//     The first attempt carries changed=false (nothing before it moved).
//   • A garbage summary degrades, never guesses: the row stays (the
//     attempt happened), the text says the verdict is unreadable, the tone
//     goes muted.
//   • Outcome verbatim: 'PASSED' | 'BLOCKED' | anything else (muted).
//
// PURE module: no db, no network, no clock — same constraint as
// run-history.ts. Verdict text comes from the v2.135.0 parser so the trail
// speaks the frozen strip's exact words.

import { parseGateVerdict, buildGateVerdictText, gateVerdictTone } from './gate-verdict';

export interface GateTrailInput {
  id: string;
  outcome: string | null;
  checkedAt: Date | string | null;
  summary: unknown;
  actorLabel: string | null;
}

export interface GateTrailRow {
  id: string;
  outcome: 'PASSED' | 'BLOCKED' | 'UNKNOWN';
  /** ISO string or null — an unreadable clock degrades, never guesses. */
  atIso: string | null;
  /** The frozen strip's own words; 'Verdict unreadable' when garbage. */
  text: string;
  tone: 'emerald' | 'amber' | 'muted';
  actorLabel: string | null;
  /** true when this attempt's verdict differs from the one before it. */
  changed: boolean;
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Shape the run's gate events (caller passes them ordered oldest-first —
 * the trail reads as a story). Tolerant by construction: an event with an
 * unparseable summary still speaks, just muted and unreadable.
 */
export function buildGateTrail(events: readonly GateTrailInput[]): GateTrailRow[] {
  const rows: GateTrailRow[] = [];
  let previousText: string | null = null;
  for (const event of events) {
    if (!event || typeof event.id !== 'string' || !event.id) continue;
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
    const tone: GateTrailRow['tone'] =
      rawTone === 'clear' ? 'emerald' : rawTone === 'blocked' ? 'amber' : 'muted';
    rows.push({
      id: event.id,
      outcome,
      atIso: toIso(event.checkedAt),
      text,
      tone,
      actorLabel: event.actorLabel ?? null,
      changed: previousText !== null && previousText !== text,
    });
    previousText = text;
  }
  return rows;
}
