// PURE module - imported by client components and tests, so it must stay
// free of any server-only imports (same constraint as src/lib/whats-new.ts).
//
// v2.124.0: the manual sweep's outcome humaniser. The dry run (v2.123.0)
// shows what the nightly sweep WOULD anonymise; the "Sweep now" door lets a
// settings manager run it early. This module turns the sweep's per-scope
// results into the card's own honest note — emerald when the run spoke,
// rose when the answer is unreadable (never a fake success).

export interface SweepOutcomeResult {
  scope: string;
  held: boolean;
  anonymised: number;
}

export interface SweepOutcomeView {
  ok: boolean;
  text: string;
}

/** Shop-floor labels for the sweep scopes (falls back to the raw scope). */
const SCOPE_LABELS: Record<string, { one: string; many: string }> = {
  hr_applicant_rejection_data: { one: 'applicant record', many: 'applicant records' },
  hr_disciplinary_closed: { one: 'closed disciplinary case', many: 'closed disciplinary cases' },
  hr_attendance_daily: { one: 'attendance row', many: 'attendance rows' },
};

const rows = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

/**
 * Human outcome text for a manual sweep run. Pure; garbage degrades to the
 * rose truth instead of inventing a success. Held scopes report zero rows
 * (they were skipped by their hold) and are named as skipped.
 */
export function describeSweepOutcome(results: unknown): SweepOutcomeView {
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, text: 'Sweep returned nothing readable — check the audit log before running again.' };
  }
  let total = 0;
  let heldScopes = 0;
  const parts: string[] = [];
  for (const r of results) {
    const row = r as Partial<SweepOutcomeResult> | null;
    if (!row || typeof row.scope !== 'string' || typeof row.anonymised !== 'number') {
      return { ok: false, text: 'Sweep returned a shape the desk cannot read — check the audit log.' };
    }
    total += row.anonymised;
    if (row.held === true) heldScopes += 1;
    if (row.anonymised > 0) {
      const label = SCOPE_LABELS[row.scope];
      const text = label ? (row.anonymised === 1 ? label.one : label.many) : row.scope;
      parts.push(`${row.anonymised} ${text}`);
    }
  }
  const heldSuffix = heldScopes > 0 ? ` Held scopes were skipped (${heldScopes}).` : '';
  if (total === 0) {
    return { ok: true, text: `Sweep ran — nothing to anonymise; every scope sits inside its window.${heldSuffix}` };
  }
  return { ok: true, text: `Sweep ran — ${rows(total)} anonymised (${parts.join(', ')}).${heldSuffix}` };
}
