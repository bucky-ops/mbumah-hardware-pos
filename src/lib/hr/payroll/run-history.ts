// MBUMAH HARDWARE POS - Run history builder (v2.84.0, extended v2.85.0)
//
// The run remembers its own steps: one ordered list of WHO did WHAT, and
// when (EAT), built from the lifecycle stamps the PayrollRun row already
// carries — no new data, no new visibility (the dialog's viewers can already
// open the run; the timeline just stops making them re-read the header).
//
// HONESTY CONTRACT:
//   • Only facts the row stamps appear. A run that was never posted has no
//     Posted event — the timeline never promises a step that did not happen.
//   • The honest exceptions are the steps the row PROVES without being able
//     to stamp fully:
//       - Rejected: the schema stamps WHO rejected and WHY but never WHEN,
//         so that event rides with atIso null and the view says so —
//         dropping the bounce-back would hide the reason the run returned.
//       - Submitted (v2.85.0): the state machine proves a run reached
//         APPROVED only through PENDING_APPROVAL, so a run sitting past the
//         handover with a null submittedAt still shows the step — with an
//         honest "no timestamp recorded" and an em-dash actor. The stamp is
//         the fact; the state is the corroboration. A draft that was never
//         submitted shows nothing.
//   • Events follow LIFECYCLE order (initiated → prepared → submitted →
//     approved / rejected → posted → locked → paid), which is chronological
//     by definition — timestamps agree with it on every well-formed run.
//
// PURE module: no db, no network, no env — same constraint as
// payslip-bundle.ts, so unit tests run without any mocking.

export interface RunHistorySource {
  createdAt: Date | string | null;
  initiatedBy: string | null;
  /** v2.85.0: the run's status corroborates the steps the stamps may miss. */
  status: string;
  preparedAt: Date | string | null;
  preparedByUserId: string | null;
  /** v2.85.0: the handover's own stamp (previously it rode inside preparedAt). */
  submittedAt: Date | string | null;
  submittedById: string | null;
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
  key:
    | 'initiated'
    | 'prepared'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'posted'
    | 'locked'
    | 'paid';
  label: string;
  actorLabel: string;
  /** ISO string or null (the bounce-back / corroborated submission has no stamp by design). */
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
 * The statuses a run can only reach AFTER the maker handed it over. A run
 * sitting in one of these (or carrying any later stamp) has provably been
 * submitted, whatever the column says — the state machine admits no other
 * road. REJECTED is included by definition: nothing is bounced that was
 * never sent. DRAFT, VOIDED and FAILED prove nothing on their own.
 */
const PROVES_SUBMISSION = new Set([
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'LOCKED',
  'PAID',
  'REJECTED',
]);

/**
 * Build the run's history in lifecycle order. `actors` maps user IDs to
 * display labels (the route resolves them in ONE query; the builder stays
 * pure). Unstamped steps are left out — except the two honest exceptions
 * above: the rejection bounce-back and the state-proven submission.
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

  // v2.85.0: the handover. A stamped submittedAt is the full fact (who + when);
  // a run the state machine proves was submitted but whose stamp predates the
  // column still shows the step — honestly saying it has no timestamp to show.
  const submittedAt = iso(run.submittedAt);
  const submissionProven =
    submittedAt !== null ||
    PROVES_SUBMISSION.has(run.status) ||
    Boolean(run.approvedAt || run.postedAt || run.lockedAt || run.paidAt);
  if (submissionProven) {
    events.push({
      key: 'submitted',
      label: 'Submitted for approval',
      actorLabel: actor(actors, run.submittedById) ?? '—',
      atIso: submittedAt, // null ⇒ the view says "no timestamp recorded"
    });
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
