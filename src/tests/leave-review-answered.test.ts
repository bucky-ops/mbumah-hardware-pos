import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.62.0 review-answered contracts — the correction answers to the room.
 *
 * Gap: the v2.43.0 amber "corrected — re-check it" fan-out told the
 * approvals group a request changed under them; nothing ever told them the
 * loop closed. The v2.61.0 bell answered the EMPLOYEE only. The desk visit
 * that clears the marker is news for the APPROVERS too — "the correction
 * you were told about has been seen by {reviewer}, safe to decide".
 *
 * Covered here:
 *  1. leaveReviewAnsweredCopy (pure): names the reviewer + employee + type
 *     + range, SUCCESS green-light tone, bell-only (no email surfaces).
 *  2. parseLeaveDecisionExtras: the new 'leave_review_answered' kind.
 *  3. Static route contract on POST /api/leaves/[id]/review: the fan-out
 *     exists INSIDE the hadPendingCorrection dedup gate, reuses the exported
 *     DECISION_CAPABLE_ROLES (the group can never drift from the correction
 *     fan-out), excludes the reviewer + the employee's linked user, carries
 *     the marker + reviewer name, and is best-effort under its own guard.
 *  4. Static feed wiring: the marker joins the leave OR filter, the feed
 *     maps the kind to 'leave_review_answered' with targetTab 'payroll',
 *     the NotificationItem union and the notification-center (emerald rail,
 *     badge-check icon, "Correction answered" chip) render it.
 *  5. Static desk-dialog contract: the answered state renders the emerald
 *     "Correction answered / Seen by {reviewer}" receipt with the
 *     badge-check + avatar; the amber unanswered state stays intact.
 */

const ROOT = join(process.cwd(), 'src');

// ── 1. Copy contract (pure) ─────────────────────────────────────────────────

import {
  LEAVE_REVIEW_ANSWERED_METADATA_MARKER,
  leaveReviewAnsweredCopy,
  parseLeaveDecisionExtras,
} from '@/lib/hr/leave-notify';

describe('leaveReviewAnsweredCopy - approver-facing review-answered copy', () => {
  it('names the reviewer, the employee, the leave type and the corrected range', () => {
    const copy = leaveReviewAnsweredCopy({
      firstName: 'David',
      lastName: 'Otieno',
      leaveTypeName: 'Annual Leave',
      startDate: '2026-11-02T00:00:00.000Z',
      endDate: '2026-11-04T00:00:00.000Z',
      reviewerName: 'Grace Achieng',
    });
    expect(copy.title).toContain('Correction answered');
    expect(copy.title).toContain('David Otieno');
    expect(copy.message).toContain('Grace Achieng');
    expect(copy.message).toContain("David Otieno's corrected Annual Leave request");
    expect(copy.message).toContain('Nov 2026');
  });

  it('carries the green-light decision framing (safe to decide)', () => {
    const copy = leaveReviewAnsweredCopy({
      firstName: 'David',
      lastName: 'Otieno',
      leaveTypeName: 'Sick Leave',
      startDate: '2026-11-09T00:00:00.000Z',
      endDate: '2026-11-11T00:00:00.000Z',
      reviewerName: 'System Administrator',
    });
    expect(copy.message).toContain('safe to decide on the corrected details');
  });

  it('carries the SUCCESS completion tone (never an alarm or a to-do)', () => {
    const copy = leaveReviewAnsweredCopy({
      firstName: 'David',
      lastName: 'Otieno',
      leaveTypeName: 'Annual Leave',
      startDate: '2026-11-02T00:00:00.000Z',
      endDate: '2026-11-04T00:00:00.000Z',
      reviewerName: 'Grace Achieng',
    });
    expect(copy.notifType).toBe('SUCCESS');
    expect(copy.priority).toBe('NORMAL');
  });

  it('is bell-ONLY by design (no email surfaces on the copy)', () => {
    const copy = leaveReviewAnsweredCopy({
      firstName: 'David',
      lastName: 'Otieno',
      leaveTypeName: 'Annual Leave',
      startDate: '2026-11-02T00:00:00.000Z',
      endDate: '2026-11-04T00:00:00.000Z',
      reviewerName: 'Grace Achieng',
    });
    expect(copy).not.toHaveProperty('emailSubject');
    expect(copy).not.toHaveProperty('emailHtml');
    expect(copy).not.toHaveProperty('emailText');
  });
});

// ── 2. Metadata parser ──────────────────────────────────────────────────────

describe('parseLeaveDecisionExtras - leave_review_answered kind', () => {
  it('accepts the new kind and the reviewer name', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({
        kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER,
        leaveRequestId: 'req-1',
        reviewerName: 'Grace Achieng',
      })
    );
    expect(extras.kind).toBe('leave_review_answered');
    expect(extras.leaveRequestId).toBe('req-1');
    expect(extras.reviewerName).toBe('Grace Achieng');
  });

  it('still rejects unknown kinds', () => {
    const extras = parseLeaveDecisionExtras(JSON.stringify({ kind: 'leave_something_else' }));
    expect(extras.kind).toBeUndefined();
  });
});

// ── 3. Route contract (static) ──────────────────────────────────────────────

describe('POST /api/leaves/[id]/review - the correction answers to the room (static)', () => {
  const source = readFileSync(
    join(ROOT, 'app/api/leaves/[id]/review/route.ts'),
    'utf8'
  );

  it('loads the route source', () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it('the answered fan-out is GATED by the same hadPendingCorrection dedup', () => {
    // One gate, two listeners: the employee row (v2.61.0) and the approver
    // fan-out (v2.62.0) both live inside the single `if (hadPendingCorrection)`.
    const gateIdx = source.indexOf('const hadPendingCorrection = needsDeskRecheck(existing.editedAt, existing.deskReviewedAt)');
    const blockIdx = source.indexOf('if (hadPendingCorrection) {');
    const answeredIdx = source.indexOf('kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(blockIdx).toBeGreaterThan(gateIdx);
    expect(answeredIdx).toBeGreaterThan(blockIdx);
    // Exactly ONE gate — the answered fan-out must NOT open its own.
    expect(source.split('if (hadPendingCorrection) {').length - 1).toBe(1);
  });

  it('reuses the exported DECISION_CAPABLE_ROLES (no drift from the correction fan-out)', () => {
    expect(source).toContain("from '@/lib/hr/leave-service'");
    expect(source).toContain('DECISION_CAPABLE_ROLES');
    // The service actually exports it.
    const service = readFileSync(join(ROOT, 'lib/hr/leave-service.ts'), 'utf8');
    expect(service).toContain('export const DECISION_CAPABLE_ROLES');
  });

  it('excludes the reviewer and the employee\u2019s linked user from the fan-out', () => {
    // The reviewer IS the answer; the employee already gets the v2.61.0 row.
    expect(source).toContain('const exclude = [session.userId, ...(employeeLinkedUserId ? [employeeLinkedUserId] : [])];');
    expect(source).toContain('id: { notIn: exclude }');
  });

  it('the fan-out carries the marker + reviewer name and rides createMany', () => {
    expect(source).toContain('kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER');
    expect(source).toContain('leaveRequestId: id');
    expect(source).toContain('leaveReviewAnsweredCopy({');
    expect(source).toContain('db.notification.createMany');
  });

  it('the answered delivery is best-effort under its OWN guard', () => {
    const answeredIdx = source.indexOf("kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER");
    const catchBlock = source.indexOf('// Review-answered delivery is best-effort by design.', answeredIdx);
    expect(catchBlock).toBeGreaterThan(answeredIdx);
  });

  it('the ordering contract holds: stamp < audit log < delivery', () => {
    const stampIdx = source.indexOf('deskReviewedByName: reviewerName,');
    const logIdx = source.indexOf("action: 'LEAVE_REVIEW_STAMPED'");
    const writeIdx = source.indexOf('if (hadPendingCorrection) {');
    expect(stampIdx).toBeLessThan(logIdx);
    expect(logIdx).toBeLessThan(writeIdx);
  });

  it('the stamp query fetches the employee NAME for the answered copy', () => {
    expect(source).toContain('firstName: true');
    expect(source).toContain('lastName: true');
  });
});

// ── 4. Feed wiring (static) ─────────────────────────────────────────────────

describe('v2.62.0 static wiring', () => {
  it('the marker joins the feed leave OR filter list and the kind maps to the new type', () => {
    const route = readFileSync(join(ROOT, 'app/api/notifications/route.ts'), 'utf8');
    expect(route).toContain("LEAVE_REVIEW_ANSWERED_METADATA_MARKER }");
    expect(route).toContain("kind === 'leave_review_answered'");
    expect(route).toContain("type: 'leave_review_answered'");
    // Approver rows route to the desk where the receipt lives.
    const answeredSection = route.split("kind === 'leave_review_answered'")[1] ?? '';
    expect(answeredSection.split("} else if (kind === 'payroll_approved')")[0]).toContain("targetTab: 'payroll'");
  });

  it('the NotificationItem union carries the new type', () => {
    const api = readFileSync(join(ROOT, 'lib/api.ts'), 'utf8');
    expect(api).toContain("'leave_review_answered'");
  });

  it('the notification-center renders the emerald receipt surface', () => {
    const center = readFileSync(join(ROOT, 'components/notification-center.tsx'), 'utf8');
    expect(center).toContain("case 'leave_review_answered':");
    expect(center).toContain('BadgeCheck');
    expect(center).toContain("'leave_review_answered' ? 'border-l-[3px] border-l-emerald-400 dark:border-l-emerald-500'");
    expect(center).toContain('Correction answered');
  });

  it('the desk dialog renders the answered receipt (styling contract)', () => {
    const tab = readFileSync(join(ROOT, 'app/(shell)/tabs/payroll-tab.tsx'), 'utf8');
    // The answered state: emerald rail, badge-check heading, "Seen by" body.
    expect(tab).toContain('answeredCorrection');
    expect(tab).toContain('!live.needsRecheck && live.deskReviewedAt && live.editedAt');
    expect(tab).toContain('Correction answered');
    expect(tab).toContain('border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40');
    expect(tab).toContain('Seen by');
    // The reviewer initial avatar carries over from v2.61.0.
    expect(tab).toContain('live.deskReviewedByName.trim().charAt(0).toUpperCase()');
    // The amber unanswered state stays intact.
    expect(tab).toContain('animate-ping');
    expect(tab).toContain('no desk visit since');
  });
});
