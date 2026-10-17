// MBUMAH HARDWARE POS - Run history builder (v2.84.0)
//
// The run remembers its own steps: one ordered list of WHO did WHAT, and
// when (EAT), built from the lifecycle stamps the PayrollRun row already
// carries — no new data, no new visibility (the dialog's viewers can already
// open the run; the timeline just stops making them re-read the header).
//
// HONESTY CONTRACT:
//   • Only facts the row stamps appear. A run that was never posted has no
//     Posted event — the timeline never promises a step that did not happen.
//   • The ONE exception is Rejected: the schema stamps WHO rejected and WHY
//     but never WHEN, so that event rides with atIso null and the view says
//     so — dropping the bounce-back would hide the reason the run returned.
//   • Events follow LIFECYCLE order (initiated → prepared → approved /
//     rejected → posted → locked → paid), which is chronological by
//     definition — timestamps agree with it on every well-formed run.
//
// PURE module: no db, no network, no env — same constraint as
// payslip-bundle.ts, so unit tests run without any mocking.

export interface RunHistorySource {
  createdAt: Date | string | null;
  initiatedBy: string | null;
  preparedAt: Date | string | null;
  preparedByUserId: string | null;
  approvedAt: Date | string | null;
  approvedByUserId: string | null;
  rejectedByUserId: string | null;
  rejectionReason: string | null;
  postedAt: Date | string | null;
  postedByUserId: string | null;
  lockedAt: Date | string | null;
  lockedByUserId: string | null;
  paidAt: Date | string | null;
  journalEntryNumber?: string | null;
}

export interface RunHistoryEvent {
  /** Stable key — the view keys DOM nodes and colors by it. */
  key: 'initiated' | 'prepared' | 'approved' | 'rejected' | 'posted' | 'locked' | 'paid';
  label: string;
  actorLabel: string;
  /** ISO string or null (the rejection bounce-back has no stamp by design). */
  atIso: string | null;
  note?: string;
}

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const actor = (actors: Record<string, string>, id: string | null | undefined): string | null =>
  (id ? actors[id]?.trim() || null : null) ?? (id ? 'Unknown user' : null);

/**
 * Build the run's history in lifecycle order. `actors` maps user IDs to
 * display labels (the route resolves them in ONE query; the builder stays
 * pure). Unstamped steps are left out — except the rejection, which carries
 * its reason and an explicit null stamp.
 */
export function buildRunHistory(run: RunHistorySource, actors: Record<string, string>): RunHistoryEvent[] {
  const events: RunHistoryEvent[] = [];

  const createdAt = iso(run.createdAt);
  if (createdAt) {
    events.push({ key: 'initiated', label: 'Initiated', actorLabel: actor(actors, run.initiatedBy) ?? '—', atIso: createdAt });
  }

  const preparedAt = iso(run.preparedAt);
  if (preparedAt) {
    events.push({ key: 'prepared', label: 'Prepared', actorLabel: actor(actors, run.preparedByUserId) ?? '—', atIso: preparedAt });
  }

  const approvedAt = iso(run.approvedAt);
  if (approvedAt) {
    events.push({ key: 'approved', label: 'Approved', actorLabel: actor(actors, run.approvedByUserId) ?? '—', atIso: approvedAt });
  }

  if (run.rejectedByUserId || run.rejectionReason) {
    events.push({
      key: 'rejected',
      label: 'Rejected',
      actorLabel: actor(actors, run.rejectedByUserId) ?? '—',
      atIso: null, // the schema stamps who and why, never when — the view says so
      note: run.rejectionReason ? `Reason: ${run.rejectionReason}` : undefined,
    });
  }

  const postedAt = iso(run.postedAt);
  if (postedAt) {
    events.push({
      key: 'posted',
      label: 'Posted',
      actorLabel: actor(actors, run.postedByUserId) ?? '—',
      atIso: postedAt,
      note: run.journalEntryNumber ? `Journal entry ${run.journalEntryNumber}` : undefined,
    });
  }

  const lockedAt = iso(run.lockedAt);
  if (lockedAt) {
    events.push({ key: 'locked', label: 'Locked', actorLabel: actor(actors, run.lockedByUserId) ?? '—', atIso: lockedAt });
  }

  const paidAt = iso(run.paidAt);
  if (paidAt) {
    events.push({ key: 'paid', label: 'Marked paid', actorLabel: '—', atIso: paidAt });
  }

  return events;
}
