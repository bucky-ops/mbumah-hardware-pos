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

// ── v2.139.0: the table's compact surface ──────────────────────────────────
// The dialog keeps the full story; the runs TABLE should answer "how did
// this run get here" at a glance. One chip: how many attempts are on record
// and what the LAST one said. Honest absence by construction — a run with
// no trail rows (pre-v2.138.0, or garbage) renders NOTHING, never a guessed
// "1 attempt". The count comes from the route's own _count; the outcome is
// verbatim PASSED/BLOCKED or the muted UNKNOWN (same vocabulary as the
// trail chips — one gate, one story, every surface speaks the same words).

export interface GateAttemptChipInput {
  attemptCount: number | string | null | undefined;
  lastOutcome: string | null | undefined;
}

export interface GateAttemptChip {
  count: number;
  /** '1 attempt · last PASSED' — pluralized honestly, outcome verbatim. */
  label: string;
  outcome: 'PASSED' | 'BLOCKED' | 'UNKNOWN';
  tone: 'emerald' | 'amber' | 'muted';
}

/**
 * Shape the compact attempt chip for the runs table. Null = render nothing
 * (no trail on record, or a count that is not a positive whole number —
 * the chip never invents an attempt). Tolerant of numeric strings because
 * the payload crosses JSON, strict about everything else.
 */
export function buildGateAttemptChip(input: GateAttemptChipInput): GateAttemptChip | null {
  const raw = input?.attemptCount;
  const count = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(count) || count <= 0) return null;
  const outcome =
    input?.lastOutcome === 'PASSED' || input?.lastOutcome === 'BLOCKED' ? input.lastOutcome : 'UNKNOWN';
  const tone: GateAttemptChip['tone'] =
    outcome === 'PASSED' ? 'emerald' : outcome === 'BLOCKED' ? 'amber' : 'muted';
  return {
    count,
    label: `${count} ${count === 1 ? 'attempt' : 'attempts'} · last ${outcome}`,
    outcome,
    tone,
  };
}

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
