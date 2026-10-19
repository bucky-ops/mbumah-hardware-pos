import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.127.0 — "the desk says goodbye".
 *
 * The schema declared WITHDRAWN terminal from day one, but nothing could set
 * it: a candidate who withdrew stayed movable forever. This round opens the
 * WITHDRAWN door —
 *  1. THE POLICY: every live status gains the 'withdraw' action (terminal
 *     states still allow nothing); WITHDRAWN wears its own slate badge tone,
 *     neither rejection's rose nor hire's emerald.
 *  2. THE SERVICE: withdrawApplicant records the candidate's own exit —
 *     HIRED cannot withdraw (offboarding is the employee flow), REJECTED/
 *     WITHDRAWN have already left, and the SAME 90-day retention clock a
 *     rejection starts applies (REJECTION_RETENTION_DAYS, single-sourced).
 *  3. THE ROUTE: POST /withdraw with the same write gate as its siblings;
 *     the note is OPTIONAL (an empty body is a valid withdrawal) and rides
 *     the audit log only — no schema column, no second surface.
 *  4. THE DESK: a violet "Withdraw…" beside Reject…, a violet arm row whose
 *     copy says whose decision this is and what clock it starts, and the
 *     WITHDRAWN row reads as history — muted band, muted name, an italic
 *     explainer line where actions used to live.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

import {
  actionsForStatus,
  interviewActions,
  isTerminalCandidate,
  stageBadgeTone,
  REJECTION_RETENTION_DAYS,
} from '@/lib/hr/recruitment-policy';

describe('policy — every live status lets the candidate leave', () => {
  it('NEW / SCREENING / INTERVIEW / OFFER all carry withdraw beside their existing actions', () => {
    expect(actionsForStatus('NEW')).toContain('withdraw');
    expect(actionsForStatus('SCREENING')).toContain('withdraw');
    expect(actionsForStatus('OFFER')).toContain('withdraw');
    // the pre-existing actions are untouched
    expect(actionsForStatus('NEW')).toContain('interview');
    expect(actionsForStatus('OFFER')).toContain('hire');
  });

  it('interviewActions keeps withdraw in BOTH branches — a pending draft never traps the door', () => {
    expect(interviewActions(false)).toContain('withdraw');
    expect(interviewActions(true)).toContain('withdraw');
    expect(interviewActions(false)).toContain('offer');
    expect(interviewActions(true)).toContain('approve');
  });

  it('terminal states still allow nothing — withdraw included', () => {
    expect(actionsForStatus('HIRED')).toEqual([]);
    expect(actionsForStatus('REJECTED')).toEqual([]);
    expect(actionsForStatus('WITHDRAWN')).toEqual([]);
    expect(isTerminalCandidate('WITHDRAWN')).toBe(true);
  });

  it('WITHDRAWN wears its own slate tone — neither rose nor emerald', () => {
    expect(stageBadgeTone('WITHDRAWN')).toBe('withdrawn');
    expect(stageBadgeTone('REJECTED')).toBe('rejected');
    expect(stageBadgeTone('HIRED')).toBe('hired');
  });

  it('withdrawal rides the SAME retention constant as rejection — one clock, one sweep', () => {
    expect(REJECTION_RETENTION_DAYS).toBe(90);
    const service = src('src/lib/hr/recruitment-service.ts');
    const withdrawBlock = service.slice(service.indexOf('export async function withdrawApplicant'), service.indexOf('Close an OPEN job to new applicants (v2.125.0)'));
    expect(withdrawBlock).toContain('REJECTION_RETENTION_DAYS');
    expect(withdrawBlock).toContain("status: 'WITHDRAWN'");
    expect(withdrawBlock).toContain('dataRetentionUntil: retentionUntil');
  });
});

describe('service — withdrawApplicant refuses what it must', () => {
  const service = src('src/lib/hr/recruitment-service.ts');

  it('a hired applicant cannot be withdrawn — the employee offboarding flow owns that door', () => {
    const block = service.slice(service.indexOf('export async function withdrawApplicant'), service.indexOf('Close an OPEN job to new applicants (v2.125.0)'));
    expect(block).toContain("applicant.status === 'HIRED'");
    expect(block).toContain('cannot be withdrawn');
    expect(block).toContain('offboarding');
  });

  it('REJECTED / WITHDRAWN have already left the pipeline — no double exit', () => {
    const block = service.slice(service.indexOf('export async function withdrawApplicant'), service.indexOf('Close an OPEN job to new applicants (v2.125.0)'));
    expect(block).toContain("applicant.status === 'REJECTED' || applicant.status === 'WITHDRAWN'");
    expect(block).toContain('already left the pipeline');
  });

  it('the note rides the audit log only — no schema column invented', () => {
    expect(service).not.toContain('withdrawalReason');
    expect(service).not.toContain('withdrawalNote');
    const schema = src('prisma/schema.prisma');
    expect(schema).not.toContain('withdrawalNote');
  });

  it('the withdrawal is audited as an APPLICANT UPDATE', () => {
    const block = service.slice(service.indexOf('export async function withdrawApplicant'), service.indexOf('Close an OPEN job to new applicants (v2.125.0)'));
    expect(block).toContain("action: 'UPDATE'");
    expect(block).toContain('HrEntityType.APPLICANT');
    expect(block).toContain('retentionDays');
  });
});

describe('route — same gate, optional note, honest status codes', () => {
  const route = src('src/app/api/recruitment/applicants/[id]/withdraw/route.ts');

  it('rides the identical write gate as reject/stage/offer', () => {
    expect(route).toContain("hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)");
    expect(route).toContain("from '@/lib/hr/recruitment-policy'");
  });

  it('an empty body is a valid withdrawal — the note is optional', () => {
    expect(route).toContain('body = {};');
    expect(route).toContain("body.note === 'string'");
    expect(route).toContain('note || undefined');
    // no required-reason wall like reject has
    expect(route).not.toContain('A rejection reason is required');
  });

  it('404 for the missing, 409 for the already-gone or already-hired', () => {
    expect(route).toContain("'not found'");
    expect(route).toContain("'cannot be withdrawn'");
    expect(route).toContain("'already left'");
  });

  it('delegates to the service — no route-level db writes', () => {
    expect(route).toContain('withdrawApplicant(');
    expect(route).not.toContain('db.applicant');
    expect(route).not.toContain('@prisma/client');
  });
});

describe('desk — the violet door and the history it leaves', () => {
  const desk = src('src/app/(shell)/hr/recruitment/page.tsx');

  it('Withdraw… renders only where the policy allows it, beside Reject…', () => {
    expect(desk).toContain("actions.includes('withdraw')");
    expect(desk).toContain('Withdraw…');
    expect(desk).toContain('hr-recruitment-withdraw-${a.id}');
  });

  it('the arm row copy says whose decision this is and what clock it starts', () => {
    expect(desk).toContain('hr-recruitment-withdraw-arm-${a.id}');
    expect(desk).toContain("candidate&apos;s own exit");
    expect(desk).toContain('{REJECTION_RETENTION_DAYS} days');
  });

  it('disarmAll clears the withdraw arm and its note — cross-disarm intact', () => {
    expect(desk).toContain('setWithdrawArm(null);');
    expect(desk).toContain("setWithdrawNote('');");
  });

  it('the WITHDRAWN row reads as history: muted band, muted name, italic explainer', () => {
    expect(desk).toContain("a.status === 'WITHDRAWN' ? 'bg-slate-50/60 dark:bg-slate-500/5' : ''");
    expect(desk).toContain('hr-recruitment-withdrawn-note-${a.id}');
    expect(desk).toContain('Candidate withdrew from the process');
  });

  it('the withdrawn badge tone is mapped in TONE_CLASS — every StageTone covered', () => {
    expect(desk).toContain('withdrawn:');
    expect(desk).toContain('border-slate-300 bg-slate-100 text-slate-600');
  });

  it('the confirm button posts the trimmed note (undefined when empty) and announces the clock', () => {
    expect(desk).toContain('hr-recruitment-withdraw-confirm');
    expect(desk).toContain('withdrawNote.trim() || undefined');
    expect(desk).toContain('withdrew from the pipeline');
  });
});
