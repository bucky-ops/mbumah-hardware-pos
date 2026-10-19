// MBUMAH HARDWARE POS - the frozen gate verdict (v2.135.0, spec Phase 4.6)
//
// "The verdict leaves a paper trail." Since v2.133.0 the desk could ASK the
// gate who it would block; since v2.134.0 that door opens onto empty months.
// But the verdict evaporated the moment it was spoken — prepare's own gate
// evaluation left no trace on the run it protected. This module shapes the
// snapshot prepare now freezes onto the run record (PayrollRun.gateSummary),
// so the front door becomes auditable history: what did the gate say when
// this run was allowed through (or stopped)?
//
// HONESTY CONTRACT: the snapshot is prepare's OWN loop evaluation — parity by
// construction (it IS the run), never a re-read, never recomputed here. A run
// prepared before v2.135.0 carries no snapshot; parseGateSummary returns null
// and the UI says so honestly — it never guesses.

/** The frozen tally prepare snaps onto the run at prepare time. */
export interface GateVerdictSummary {
  /** Active employees prepare's loop walked for this run. */
  total: number;
  /** Employees who passed both gates. */
  clear: number;
  /** Employees blocked by the consent gate (MISSING_CONSENT). */
  missingConsent: number;
  /** Employees blocked by the timesheet gate (TIMESHEET_NOT_APPROVED). */
  timesheetNotApproved: number;
  /**
   * Distinct gate codes prepare acted on, in prepare's loop order. Empty on a
   * fully clear run. Engine guardrails (NEGATIVE_NET etc.) are a different
   * door — they live in errorMessage, never in the gate's tally.
   */
  codes: GateVerdictCode[];
}

export type GateVerdictCode = 'MISSING_CONSENT' | 'TIMESHEET_NOT_APPROVED';

export interface GateVerdict {
  checkedAt: string | null;
  summary: GateVerdictSummary;
}

const CODES: GateVerdictCode[] = ['MISSING_CONSENT', 'TIMESHEET_NOT_APPROVED'];

const isFiniteCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && Number.isInteger(v);

/**
 * Tolerant parser for the frozen snapshot. Returns null for anything that is
 * not a well-formed verdict — pre-v2.135.0 rows (null), malformed JSON, or a
 * summary with impossible counts — and the UI renders honest absence instead
 * of a guess. Accepts Prisma's JsonValue (object form) as stored.
 */
export function parseGateVerdict(
  rawGateSummary: unknown,
  rawGateCheckedAt: unknown,
): GateVerdict | null {
  if (rawGateSummary === null || rawGateSummary === undefined || typeof rawGateSummary !== 'object') {
    return null;
  }
  if (Array.isArray(rawGateSummary)) return null;
  const s = rawGateSummary as Record<string, unknown>;
  const total = s.total;
  const clear = s.clear;
  const missingConsent = s.missingConsent;
  const timesheetNotApproved = s.timesheetNotApproved;
  if (!isFiniteCount(total) || !isFiniteCount(clear) || !isFiniteCount(missingConsent) || !isFiniteCount(timesheetNotApproved)) {
    return null;
  }
  // The tally must add up — a snapshot that cannot count its own people is
  // not a snapshot, it is noise.
  if (clear + missingConsent + timesheetNotApproved !== total) return null;
  const rawCodes = s.codes;
  if (!Array.isArray(rawCodes)) return null;
  const codes: GateVerdictCode[] = [];
  for (const c of rawCodes) {
    if (typeof c !== 'string' || !CODES.includes(c as GateVerdictCode)) return null;
    if (!codes.includes(c as GateVerdictCode)) codes.push(c as GateVerdictCode);
  }
  const checkedAt =
    typeof rawGateCheckedAt === 'string' && !Number.isNaN(Date.parse(rawGateCheckedAt))
      ? rawGateCheckedAt
      : null;
  return { checkedAt, summary: { total, clear, missingConsent, timesheetNotApproved, codes } };
}

/**
 * The verdict's own words — the gate panel's counts, frozen at prepare time,
 * in the same order and wording the live panel speaks ("N clear · N missing
 * consent · N timesheet pending"). Zero counts never speak.
 */
export function buildGateVerdictText(summary: GateVerdictSummary): string {
  const parts: string[] = [];
  parts.push(`${summary.clear} clear`);
  if (summary.missingConsent > 0) parts.push(`${summary.missingConsent} missing consent`);
  if (summary.timesheetNotApproved > 0) parts.push(`${summary.timesheetNotApproved} timesheet pending`);
  return parts.join(' · ');
}

/**
 * The verdict's tone: 'clear' when the gate let everyone through, 'blocked'
 * when anyone was stopped. The UI keys its emerald/amber wardrobe off this —
 * never off ad-hoc string checks scattered across surfaces.
 */
export function gateVerdictTone(summary: GateVerdictSummary): 'clear' | 'blocked' {
  return summary.missingConsent === 0 && summary.timesheetNotApproved === 0 ? 'clear' : 'blocked';
}
