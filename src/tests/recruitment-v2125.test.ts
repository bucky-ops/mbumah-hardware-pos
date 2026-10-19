import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.125.0 — "the desk starts hiring".
 *
 * Task 139's dead-surface discovery: the dev DB held ZERO RecruitmentJobs and
 * zero Applicants — /hr/recruitment was a nav item whose pipeline could never
 * start. This round makes the desk fully operable and honest:
 *  1. THE POLICY — recruitment-policy.ts extracts the role gates hand-copied
 *     across five route files and the status→action map the UI previously
 *     encoded as scattered ternaries. One truth for routes, UI, and tests.
 *  2. THE REJECT DOOR — rejectApplicant existed in the service (90-day
 *     retention window) but NO route exposed it: candidates that go nowhere
 *     were stuck in the pipeline forever. POST .../reject requires a reason
 *     (it rides the audit log) and re-rejection is refused.
 *  3. THE CLOSE DOOR — nothing ever set the schema's CLOSED status; jobs
 *     stayed OPEN forever. POST /jobs/[id]/close closes OPEN jobs (audited).
 *  4. HONEST OFFER TERMS — the old "Draft offer" button hard-coded KES
 *     30,000.00 and a +7-days start date: fabricated data. The desk now arms
 *     an offer row that DEMANDS real terms (salary + date, empty inputs).
 *  5. HONEST READ POSTURE — the jobs GET envelope carries canWrite; readers
 *     (BRANCH_MANAGER) see a read strip instead of buttons that 403.
 *  6. THE COUNTS — open jobs / in pipeline / hired, computed from live data.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

import {
  actionsForStatus,
  canCloseJob,
  interviewActions,
  isTerminalCandidate,
  RECRUITMENT_READ_ROLES,
  RECRUITMENT_WRITE_ROLES,
  stageBadgeTone,
} from '@/lib/hr/recruitment-policy';

describe('recruitment-policy — the pipeline single source of truth', () => {
  it('early statuses move forward and can always be rejected', () => {
    // v2.127.0 re-anchor: every live status also carries 'withdraw' (the
    // candidate's own exit — the WITHDRAWN door).
    expect(actionsForStatus('NEW')).toEqual(['interview', 'reject', 'withdraw']);
    expect(actionsForStatus('SCREENING')).toEqual(['interview', 'reject', 'withdraw']);
    expect(actionsForStatus('INTERVIEW')).toEqual(['offer', 'reject', 'withdraw']);
    expect(actionsForStatus('OFFER')).toEqual(['hire', 'reject', 'withdraw']);
  });

  it('terminal statuses allow nothing — history, not buttons that 403', () => {
    expect(actionsForStatus('HIRED')).toEqual([]);
    expect(actionsForStatus('REJECTED')).toEqual([]);
    expect(actionsForStatus('WITHDRAWN')).toEqual([]);
    expect(actionsForStatus('SOMETHING_NEW')).toEqual([]);
    expect(isTerminalCandidate('HIRED')).toBe(true);
    expect(isTerminalCandidate('REJECTED')).toBe(true);
    expect(isTerminalCandidate('OFFER')).toBe(false);
  });

  it('interview actions hinge on the pending DRAFT offer — the handoff the old desk dead-ended', () => {
    // v2.127.0 re-anchor: every live branch now carries 'withdraw' too (the
    // candidate's own exit) — the DRAFT hinge still decides offer vs approve.
    expect(interviewActions(false)).toEqual(['offer', 'reject', 'withdraw']);
    expect(interviewActions(true)).toEqual(['approve', 'reject', 'withdraw']);
  });

  it('role gates: BRANCH_MANAGER reads, only HR_MANAGER/STORE_OWNER write', () => {
    expect(RECRUITMENT_READ_ROLES).toEqual(['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER']);
    expect(RECRUITMENT_WRITE_ROLES).toEqual(['HR_MANAGER', 'STORE_OWNER']);
  });

  it('badge tones and the close rule', () => {
    expect(stageBadgeTone('HIRED')).toBe('hired');
    expect(stageBadgeTone('REJECTED')).toBe('rejected');
    expect(stageBadgeTone('OFFER')).toBe('offer');
    expect(stageBadgeTone('INTERVIEW')).toBe('progress');
    expect(stageBadgeTone('NEW')).toBe('neutral');
    expect(canCloseJob('OPEN')).toBe(true);
    expect(canCloseJob('DRAFT')).toBe(false);
    expect(canCloseJob('CLOSED')).toBe(false);
    expect(canCloseJob('FILLED')).toBe(false);
  });

  it('the policy is a PURE module — no db import rides along', () => {
    const policy = src('src/lib/hr/recruitment-policy.ts');
    expect(policy).not.toContain('@/lib/db');
    expect(policy).toContain('export function actionsForStatus(');
  });
});

describe('the reject route — the door that never existed', () => {
  const route = src('src/app/api/recruitment/applicants/[id]/reject/route.ts');

  it('write-gated with the policy roles', () => {
    expect(route).toContain("hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)");
    expect(route).toContain("from '@/lib/hr/recruitment-policy'");
  });

  it('requires a reason — it rides the audit log', () => {
    expect(route).toContain("A rejection reason is required — it rides the audit log.");
    expect(route).toContain("body.reason.trim()");
  });

  it('calls the EXISTING service function; re-rejection refuses honestly', () => {
    expect(route).toContain('rejectApplicant(id, session.userId, session.role, reason)');
    expect(route).toContain('retentionUntil: result.retentionUntil.toISOString()');
    const service = src('src/lib/hr/recruitment-service.ts');
    expect(service).toContain("throw new Error('Applicant has already left the pipeline.')");
    expect(service).toContain("throw new Error('A hired applicant cannot be rejected.')");
  });
});

describe('the close route — jobs stop living forever', () => {
  const route = src('src/app/api/recruitment/jobs/[id]/close/route.ts');

  it('write-gated with the policy roles and backed by closeJob', () => {
    expect(route).toContain("hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)");
    expect(route).toContain('closeJob({ jobId: id, actorId: session.userId, actorRole: session.role })');
  });

  it('the service closes ONLY OPEN jobs, stamps closedAt, and audits', () => {
    const service = src('src/lib/hr/recruitment-service.ts');
    expect(service).toContain('export async function closeJob(');
    expect(service).toContain("throw new Error(`Job is ${job.status}; only OPEN jobs can be closed.`)");
    expect(service).toContain("data: { status: 'CLOSED', closedAt: new Date() }");
    expect(service).toContain("reason: 'Job closed to new applicants.'");
  });
});

describe('the jobs GET — canWrite rides the envelope', () => {
  const route = src('src/app/api/recruitment/jobs/route.ts');

  it('the envelope carries the writer capability computed server-side', () => {
    expect(route).toContain('(RECRUITMENT_WRITE_ROLES as readonly string[]).includes(session.role)');
    expect(route).not.toContain("const WRITE_ROLES = ['HR_MANAGER'");
    expect(route).not.toContain("const READ_ROLES = ['HR_MANAGER'");
  });
});

describe('the desk — honest terms, honest posture, real counts', () => {
  const page = src('src/app/(shell)/hr/recruitment/page.tsx');

  it('the fabricated offer terms are EXORCISED — no hard-coded salary, no +7-days date', () => {
    expect(page).not.toContain('3_000_000');
    expect(page).not.toContain('86400000');
    expect(page).toContain('the desk never');
    expect(page).toContain('invents them.');
  });

  it('the offer arm demands real terms: salary and start date, empty inputs', () => {
    expect(page).toContain('data-testid="hr-recruitment-offer-salary"');
    expect(page).toContain('data-testid="hr-recruitment-offer-date"');
    expect(page).toContain("useState({ salary: '', startDate: '' })");
    expect(page).toContain('proposedSalaryCents: cents');
  });

  it('readers get the read strip, not buttons that 403', () => {
    expect(page).toContain('data-testid="hr-recruitment-readonly"');
    expect(page).toContain('only HR managers and the store owner open');
    expect(page).toContain('setCanWrite(j.canWrite === true)');
  });

  it('actions render from the policy map, never scattered ternaries', () => {
    expect(page).toContain("from '@/lib/hr/recruitment-policy'");
    expect(page).toContain('actionsForStatus(a.status)');
    expect(page).toContain('isTerminalCandidate(a.status)');
  });

  it('the offer handoff is closed: pending DRAFT offer turns into Approve & send (PATCH)', () => {
    // Re-anchored for 2.126.0: the hinge keys on the LATEST offer's DRAFT status.
    expect(page).toContain("interviewActions(a.offers?.[0]?.status === 'DRAFT')");
    expect(page).toContain('data-testid={`hr-recruitment-approve-${a.id}`}');
    expect(page).toContain('Approve &amp; send');
    expect(page).toContain("?offerId=${draftId}`, {}, 'PATCH')");
    const applicantsRoute = src('src/app/api/recruitment/applicants/route.ts');
    // Re-anchored for 2.126.0: the include carries the LATEST offer of any
    // status (the desk's approve hinge keys on DRAFT; the chip shows SENT).
    expect(applicantsRoute).toContain('offers: {\n          orderBy: { createdAt: \'desc\' },');
    expect(applicantsRoute).toContain('select: { id: true, status: true, proposedSalaryCents: true, sentAt: true, createdAt: true }');
  });

  it('reject and close are two-step arms; arming one disarms the others', () => {
    expect(page).toContain('data-testid={`hr-recruitment-reject-arm-${a.id}`}');
    expect(page).toContain('Confirm reject');
    expect(page).toContain('Reason (rides the audit log)');
    expect(page).toContain('data-testid={`hr-recruitment-close-arm-${j.id}`}');
    expect(page).toContain('Confirm');
    expect(page).toContain('function disarmAll()');
  });

  it('the counts strip and honest empty states', () => {
    expect(page).toContain('data-testid="hr-recruitment-counts"');
    expect(page).toContain('in pipeline');
    expect(page).toContain('No jobs yet — hiring starts with a job.');
    expect(page).toContain('No candidates yet. Register an applicant against an open job to start the pipeline.');
    expect(page).toContain(`kept {REJECTION_RETENTION_DAYS} days`);
  });
});

describe('prior anchors — the pipeline keeps its consent spine', () => {
  it('THE DEAD-SURFACE ROOT CAUSE: read.branch admits the STORE_OWNER (the drift that 403\u2019d everyone)', () => {
    const perms = src('src/lib/hr/permissions.ts');
    expect(perms).toContain(
      "'hr.recruitment.read.branch': ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'],",
    );
    expect(perms).toContain('leaving /hr/recruitment a dead surface no one could open');
  });

  it('consent stays required before any personal data is stored', () => {
    const service = src('src/lib/hr/recruitment-service.ts');
    expect(service).toContain('Applicant consent is required before registering personal data (MISSING_CONSENT).');
    expect(service).toContain("lawfulBasis: 'CONSENT'");
  });

  it('the desk still surfaces the rejection retention window the sweep reads', () => {
    const service = src('src/lib/hr/recruitment-service.ts');
    expect(service).toContain('dataRetentionUntil: retentionUntil');
    // Re-anchored for 2.126.0: the constant is single-sourced in the policy
    // module and the service imports it (no local copy left to drift).
    expect(service).toContain("import { PIPELINE_STAGES, REJECTION_RETENTION_DAYS } from './recruitment-policy';");
  });
});
