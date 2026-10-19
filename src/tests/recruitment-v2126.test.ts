import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.126.0 — "the pipeline shows its steps".
 *
 * Task 140's option 1: harden what the hiring round (v2.125.0) exposed.
 *  1. ONE DRAFT PER CANDIDATE — the PATCH approves offers[0], so a stacked
 *     second DRAFT would silently orphan the first. createOffer now refuses
 *     when a DRAFT pends (DUPLICATE_DRAFT → 409); the desk already hides the
 *     button, now the API refuses it outright.
 *  2. THE STAGE ARM — the desk hard-coded INTERVIEW_ONE + PASS on a single
 *     "To interview" button: the desk wrote history it never observed. Now
 *     "Record stage…" arms a sky row with the FULL stage list, the outcome,
 *     and optional notes — sourced from PIPELINE_STAGES in the policy module,
 *     which the service's validation imports too (one list, zero drift).
 *  3. THE OFFER CHIP — the desk sent offers whose terms vanished from view;
 *     the applicants GET now rides the LATEST offer of any status and the row
 *     shows "Offer sent 2026-10-19 · KES 32,000" under the stage badge.
 *  4. CLOSED JOBS SHOW WHEN — the job meta line prints closedAt for CLOSED.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

import {
  formatOfferKes,
  offerChipLabel,
  PIPELINE_STAGES,
  STAGE_OUTCOMES,
} from '@/lib/hr/recruitment-policy';

describe('PIPELINE_STAGES + STAGE_OUTCOMES — the one list', () => {
  it('carries every stage the service validates, in pipeline order', () => {
    expect(PIPELINE_STAGES).toEqual(['SCREENING', 'INTERVIEW_ONE', 'INTERVIEW_TWO', 'TASK', 'REFERENCE', 'OFFER']);
    expect(STAGE_OUTCOMES).toEqual(['PENDING', 'PASS', 'FAIL']);
  });

  it('the service validates against the SAME list — no local copy anymore', () => {
    const service = src('src/lib/hr/recruitment-service.ts');
    expect(service).toContain("import { PIPELINE_STAGES, REJECTION_RETENTION_DAYS } from './recruitment-policy';");
    expect(service).toContain('const STAGES = PIPELINE_STAGES;');
    expect(service).not.toContain("const STAGES = ['SCREENING'");
    expect(service).not.toContain('const REJECTION_RETENTION_DAYS = 90;');
  });
});

describe('formatOfferKes — the terms stay visible', () => {
  it('whole KES prints bare with thousands separators', () => {
    expect(formatOfferKes(3_200_000)).toBe('KES 32,000');
    expect(formatOfferKes(2_500_000)).toBe('KES 25,000');
  });

  it('odd cents print with two decimals; unreadable input degrades to an em dash', () => {
    expect(formatOfferKes(123_456)).toBe('KES 1,234.56');
    expect(formatOfferKes(0)).toBe('—');
    expect(formatOfferKes(-5)).toBe('—');
    expect(formatOfferKes(1.5)).toBe('—');
    expect(formatOfferKes('3200000')).toBe('—');
    expect(formatOfferKes(null)).toBe('—');
  });
});

describe('offerChipLabel — sent terms ride the row', () => {
  it('SENT names its date; terminal offer states speak plainly', () => {
    expect(offerChipLabel({ status: 'SENT', sentAt: '2026-10-19T01:00:00.000Z' })).toBe('Offer sent 2026-10-19');
    expect(offerChipLabel({ status: 'SENT', sentAt: null })).toBe('Offer sent');
    expect(offerChipLabel({ status: 'ACCEPTED' })).toBe('Offer accepted');
    expect(offerChipLabel({ status: 'DECLINED' })).toBe('Offer declined');
    expect(offerChipLabel({ status: 'EXPIRED' })).toBe('Offer expired');
  });

  it('DRAFT stays silent (the approve hinge is its voice); garbage degrades to null', () => {
    expect(offerChipLabel({ status: 'DRAFT' })).toBeNull();
    expect(offerChipLabel(null)).toBeNull();
    expect(offerChipLabel(undefined)).toBeNull();
    expect(offerChipLabel({ status: 42 as unknown as string })).toBeNull();
  });
});

describe('the duplicate-draft guard — one live draft per candidate', () => {
  it('createOffer refuses when a DRAFT pends, naming the DUPLICATE_DRAFT code', () => {
    const service = src('src/lib/hr/recruitment-service.ts');
    expect(service).toContain("where: { applicantId: input.applicantId, status: 'DRAFT' }");
    expect(service).toContain('A DRAFT offer is already pending for this applicant — approve and send it before drafting another (DUPLICATE_DRAFT).');
  });

  it('the offer route maps the guard to 409', () => {
    const route = src('src/app/api/recruitment/applicants/[id]/offer/route.ts');
    expect(route).toContain("message.includes('DUPLICATE_DRAFT') ? 409 : 500");
  });
});

describe('the stage arm — the desk records what it observed', () => {
  const page = src('src/app/(shell)/hr/recruitment/page.tsx');

  it('the hard-coded jump is EXORCISED — no INTERVIEW_ONE+PASS auto-post', () => {
    expect(page).not.toContain("stage: 'INTERVIEW_ONE', outcome: 'PASS'");
    expect(page).not.toContain('To interview');
  });

  it('Record stage… arms a sky row with the full stage + outcome selects and optional notes', () => {
    expect(page).toContain('data-testid={`hr-recruitment-stage-arm-${a.id}`}');
    expect(page).toContain('data-testid="hr-recruitment-stage-select"');
    expect(page).toContain('data-testid="hr-recruitment-outcome-select"');
    expect(page).toContain('data-testid="hr-recruitment-stage-notes"');
    expect(page).toContain('data-testid="hr-recruitment-stage-confirm"');
    expect(page).toContain('Confirm stage');
    expect(page).toContain('the desk writes the step');
    expect(page).toContain('it never skips ahead for you.');
  });

  it('the arm renders from the policy lists, never a local copy', () => {
    expect(page).toContain('PIPELINE_STAGES.map((s) =>');
    expect(page).toContain('STAGE_OUTCOMES.map((o) =>');
  });

  it('the note names the step and its outcome; blank notes ride as undefined', () => {
    expect(page).toContain('${stageForm.stage} recorded — ${stageForm.outcome} for ${a.fullName}.');
    expect(page).toContain('notes: stageForm.notes.trim() || undefined');
  });

  it('the button opens the arm instead of posting — and arms cross-disarm', () => {
    expect(page).toContain('data-testid={`hr-recruitment-stage-${a.id}`}');
    expect(page).toContain('Record stage…');
    expect(page).toContain('setStageArm(null);');
    expect(page).toContain("setStageForm({ stage: 'SCREENING', outcome: 'PENDING', notes: '' });");
  });
});

describe('the offer chip + the closed date — history stays visible', () => {
  const page = src('src/app/(shell)/hr/recruitment/page.tsx');

  it('the chip renders under the stage badge with the KES terms', () => {
    expect(page).toContain('data-testid={`hr-recruitment-offer-chip-${a.id}`}');
    expect(page).toContain('offerChipLabel(a.offers?.[0])');
    expect(page).toContain('formatOfferKes(a.offers?.[0]?.proposedSalaryCents)');
  });

  it('the approve hinge keys on the LATEST offer being DRAFT', () => {
    expect(page).toContain("interviewActions(a.offers?.[0]?.status === 'DRAFT')");
  });

  it('CLOSED jobs print when they closed', () => {
    expect(page).toContain("j.status === 'CLOSED' && j.closedAt");
    expect(page).toContain('closed ${j.closedAt.slice(0, 10)}');
  });

  it('the applicants GET rides the latest offer of any status', () => {
    const route = src('src/app/api/recruitment/applicants/route.ts');
    expect(route).toContain('orderBy: { createdAt: \'desc\' },\n          take: 1,');
    expect(route).toContain('select: { id: true, status: true, proposedSalaryCents: true, sentAt: true, createdAt: true }');
  });
});

describe('prior anchors — the doors from v2.125.0 all stay', () => {
  it('reject, close, honest offer terms, and the read posture stand', () => {
    const page = src('src/app/(shell)/hr/recruitment/page.tsx');
    expect(page).toContain('data-testid={`hr-recruitment-reject-arm-${a.id}`}');
    expect(page).toContain('Confirm reject');
    expect(page).toContain('data-testid={`hr-recruitment-close-arm-${j.id}`}');
    expect(page).toContain('data-testid="hr-recruitment-readonly"');
    expect(page).toContain('data-testid="hr-recruitment-counts"');
    expect(page).not.toContain('3_000_000');
    expect(page).not.toContain('86400000');
  });

  it('the consent spine and the retention window stay single-sourced', () => {
    const service = src('src/lib/hr/recruitment-service.ts');
    expect(service).toContain('Applicant consent is required before registering personal data (MISSING_CONSENT).');
    expect(service).toContain('dataRetentionUntil: retentionUntil');
    const policy = src('src/lib/hr/recruitment-policy.ts');
    expect(policy).toContain('REJECTION_RETENTION_DAYS = 90');
  });
});
