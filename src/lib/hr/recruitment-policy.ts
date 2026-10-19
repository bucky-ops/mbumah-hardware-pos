// MBUMAH HARDWARE POS - recruitment pipeline policy (v2.125.0)
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

export type RecruitmentAction = 'interview' | 'offer' | 'approve' | 'hire' | 'reject';

/**
 * The pipeline's honest map: which actions a status allows. Terminal states
 * (HIRED, REJECTED, WITHDRAWN) allow nothing — the desk shows history, not
 * buttons that 403. Rejection rides the 90-day retention window set by
 * rejectApplicant, so it stays available until a terminal state is reached.
 */
const PIPELINE_ACTIONS: Record<string, readonly RecruitmentAction[]> = {
  NEW: ['interview', 'reject'],
  SCREENING: ['interview', 'reject'],
  INTERVIEW: ['offer', 'reject'],
  OFFER: ['hire', 'reject'],
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
  return hasDraftOffer ? ['approve', 'reject'] : ['offer', 'reject'];
}

/** A candidate the desk can no longer act on — history, not buttons. */
export function isTerminalCandidate(status: string): boolean {
  return actionsForStatus(status).length === 0;
}

export type StageTone = 'neutral' | 'progress' | 'offer' | 'hired' | 'rejected';

/** Badge tone per candidate status — one mapping for the pipeline table. */
export function stageBadgeTone(status: string): StageTone {
  switch (status) {
    case 'HIRED':
      return 'hired';
    case 'REJECTED':
      return 'rejected';
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

/** Rejection keeps candidate data 90 days, then the retention window takes over. */
export const REJECTION_RETENTION_DAYS = 90;
