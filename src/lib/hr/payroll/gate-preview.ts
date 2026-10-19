// MBUMAH HARDWARE POS - the period picker's gate preview (v2.137.0)
//
// Pre-flight inside the prepare intent: when the "Start a payroll run"
// dialog lists periods, each one can now wear the gate's own pending counts
// — how many unapproved timesheet days sit in that period, how many active
// employees lack consent (consent is period-independent; it blocks every
// period equally, so the same count rides each row honestly).
//
// HONESTY CONTRACT: this is a PREVIEW, not a verdict — the numbers are the
// same where-clauses the gate reads (run-gate.ts parity), but the per-person
// verdict stays the gate panel's job on the desk. The chips speak only when
// something would block: silence means clear, never guessed-clear. A null
// preview (the read failed) renders an honest "unavailable" line, never a
// guessed chip.

export interface GatePreview {
  /** Unapproved (checkIn not null, not approved) days inside the period. */
  unapprovedDays: number;
  /** Active employees without an active consent (period-independent). */
  missingConsent: number;
  /** ISO stamp of the preview read — one read speaks once. */
  checkedAt: string;
}

/**
 * Bucket pending attendance dates into periods by date-only range. Pure:
 * the API fetches ALL pending dates for the store once (they are bounded —
 * the desk exists to clear them) and this buckets them in memory, so the
 * periods endpoint never runs one query per period.
 * Dates and ranges are ISO strings; comparisons are string-safe because
 * both sides are UTC date-only (YYYY-MM-DD).
 */
export function bucketPendingDays(
  dates: ReadonlyArray<string | Date>,
  periods: ReadonlyArray<{ id: string; startDate: string | Date; endDate: string | Date }>,
): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const period of periods) {
    if (!period || typeof period.id !== 'string' || !period.id) continue;
    const start = dateOnly(period.startDate);
    const end = dateOnly(period.endDate);
    if (!start || !end) continue;
    buckets[period.id] = 0;
  }
  for (const raw of dates) {
    const day = dateOnly(raw);
    if (!day) continue;
    for (const period of periods) {
      const start = dateOnly(period.startDate);
      const end = dateOnly(period.endDate);
      if (!start || !end) continue;
      if (day >= start && day <= end) buckets[period.id] = (buckets[period.id] ?? 0) + 1;
    }
  }
  return buckets;
}

/** Reduce an ISO-ish input to YYYY-MM-DD; garbage never buckets. */
function dateOnly(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export interface GatePreviewChip {
  tone: 'amber' | 'rose';
  label: string;
}

/**
 * The chips one period wears in the picker — the gate's own words, pluralized
 * honestly. Only blocking counts speak; a clear period renders no chips
 * (silence means clear). Order follows prepare's loop: consent first, then
 * timesheets.
 */
export function gatePreviewChips(
  preview: GatePreview | null | undefined,
): GatePreviewChip[] {
  if (!preview) return [];
  const chips: GatePreviewChip[] = [];
  if (preview.missingConsent > 0) {
    chips.push({
      tone: 'rose',
      label: `${preview.missingConsent} missing consent`,
    });
  }
  if (preview.unapprovedDays > 0) {
    chips.push({
      tone: 'amber',
      label: `${preview.unapprovedDays} unapproved ${preview.unapprovedDays === 1 ? 'day' : 'days'}`,
    });
  }
  return chips;
}

/**
 * The preview line under the picker for the SELECTED period — the panel's
 * own voice ("N clear · N missing consent · N timesheet pending" is the
 * gate; this is its compact sibling). Null preview → an honest unavailable
 * line; all-clear → an honest all-clear line.
 */
export function gatePreviewLine(preview: GatePreview | null | undefined): string {
  if (!preview) return 'Gate preview unavailable — the run gate still checks on prepare.';
  if (preview.unapprovedDays === 0 && preview.missingConsent === 0) {
    return 'Gate preview: nothing pending for this period.';
  }
  const parts: string[] = [];
  if (preview.missingConsent > 0) {
    parts.push(`${preview.missingConsent} missing consent`);
  }
  if (preview.unapprovedDays > 0) {
    parts.push(`${preview.unapprovedDays} unapproved ${preview.unapprovedDays === 1 ? 'day' : 'days'}`);
  }
  return `Gate preview: ${parts.join(' · ')} — prepare would block until cleared.`;
}
