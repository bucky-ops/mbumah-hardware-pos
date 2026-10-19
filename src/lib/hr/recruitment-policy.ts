// MBUMAH HARDWARE POS - recruitment pipeline policy (v2.127.0)
//
// PURE module (client-safe, no db import — same constraint as permissions.ts):
// the recruitment pipeline's single source of truth for WHO may act and WHAT
// may happen at each candidate status. v2.125.0 extracts the role gates that
// were hand-copied across five route files and the status-to-action map the
// desk previously encoded as scattered ternaries — one truth for routes, UI,
// and tests alike, so a button can never render for a status the service
// would refuse.

/** Who may read the recruitment workspace (same set the jobs/applicants GETs accept). */
export const RECRUITMENT_READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'] as const;

/** Who may open/close jobs, move candidates, draft offers, hire, reject. */
export const RECRUITMENT_WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export type RecruitmentAction = 'interview' | 'offer' | 'approve' | 'hire' | 'reject' | 'withdraw';

/**
 * The pipeline's honest map: which actions a status allows. Terminal states
 * (HIRED, REJECTED, WITHDRAWN) allow nothing — the desk shows history, not
 * buttons that 403. Rejection rides the 90-day retention window set by
 * rejectApplicant, so it stays available until a terminal state is reached.
 *
 * v2.127.0: every live status also allows 'withdraw' — the candidate's own
 * exit, recorded by the desk but never decided by it. Leaving the process,
 * whichever direction, starts the SAME retention clock (REJECTION_RETENTION_DAYS).
 */
const PIPELINE_ACTIONS: Record<string, readonly RecruitmentAction[]> = {
  NEW: ['interview', 'reject', 'withdraw'],
  SCREENING: ['interview', 'reject', 'withdraw'],
  INTERVIEW: ['offer', 'reject', 'withdraw'],
  OFFER: ['hire', 'reject', 'withdraw'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

export function actionsForStatus(status: string): readonly RecruitmentAction[] {
  return PIPELINE_ACTIONS[status] ?? [];
}

/**
 * Interview-stage actions depend on whether a DRAFT offer is pending (v2.125.0
 * E2E finding: `createOffer` leaves the applicant INTERVIEW — only the
 * approve-and-send PATCH moves them to OFFER, so a desk that renders "Draft
 * offer" forever dead-ends the pipeline before Hire).
 */
export function interviewActions(hasDraftOffer: boolean): readonly RecruitmentAction[] {
  return hasDraftOffer ? ['approve', 'reject', 'withdraw'] : ['offer', 'reject', 'withdraw'];
}

/** A candidate the desk can no longer act on — history, not buttons. */
export function isTerminalCandidate(status: string): boolean {
  return actionsForStatus(status).length === 0;
}

export type StageTone = 'neutral' | 'progress' | 'offer' | 'hired' | 'rejected' | 'withdrawn';

/**
 * Badge tone per candidate status — one mapping for the pipeline table.
 * WITHDRAWN wears its own slate tone (v2.127.0): neither rejection's rose
 * nor hire's emerald — the candidate left on their own terms.
 */
export function stageBadgeTone(status: string): StageTone {
  switch (status) {
    case 'HIRED':
      return 'hired';
    case 'REJECTED':
      return 'rejected';
    case 'WITHDRAWN':
      return 'withdrawn';
    case 'OFFER':
      return 'offer';
    case 'INTERVIEW':
      return 'progress';
    default:
      return 'neutral';
  }
}

/** Only OPEN jobs may close (schema statuses: DRAFT, OPEN, CLOSED, FILLED). */
export function canCloseJob(status: string): boolean {
  return status === 'OPEN';
}

/**
 * Rejection keeps candidate data 90 days, then the retention window takes
 * over. Withdrawal rides the SAME clock (v2.127.0): leaving the process,
 * whichever direction, starts the same window — one constant, one sweep.
 */
export const REJECTION_RETENTION_DAYS = 90;

/**
 * The stages recordStage accepts — ONE list for the service's validation,
 * the desk's arm select, and the tests (v2.126.0: the desk used to hard-code
 * INTERVIEW_ONE + PASS on a single button; now every stage is recordable).
 */
export const PIPELINE_STAGES = ['SCREENING', 'INTERVIEW_ONE', 'INTERVIEW_TWO', 'TASK', 'REFERENCE', 'OFFER'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_OUTCOMES = ['PENDING', 'PASS', 'FAIL'] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

/**
 * Offer money reads as KES with thousands separators; offers are integer
 * cents (spec rule 16), so whole KES prints bare and odd cents print with
 * two decimals. Unreadable input degrades to an em dash — never a fake 0.
 */
export function formatOfferKes(cents: unknown): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || !Number.isInteger(cents) || cents <= 0) return '—';
  const value = cents / 100;
  const text = Number.isInteger(value)
    ? value.toLocaleString('en-KE')
    : value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `KES ${text}`;
}

export interface OfferChipView {
  status: string;
  sentAt?: string | null;
}

/**
 * A one-line offer chip for the pipeline row — the desk should SEE the terms
 * it sent, not just a status badge. DRAFT offers return null (the approve
 * hinge is the draft's voice); unreadable statuses return null too.
 */
export function offerChipLabel(offer: OfferChipView | null | undefined): string | null {
  if (!offer || typeof offer.status !== 'string') return null;
  switch (offer.status) {
    case 'SENT':
      return `Offer sent${offer.sentAt ? ` ${String(offer.sentAt).slice(0, 10)}` : ''}`;
    case 'ACCEPTED':
      return 'Offer accepted';
    case 'DECLINED':
      return 'Offer declined';
    case 'EXPIRED':
      return 'Offer expired';
    default:
      return null;
  }
}
