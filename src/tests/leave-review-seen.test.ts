import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.61.0 review-seen bell contracts.
 *
 * Gap: the v2.59.0 re-check marker + the v2.60.0 portal mirror are both
 * PASSIVE surfaces — the employee only learns their corrected request was
 * read if they happen to open the portal. The desk visit that CLEARS the
 * marker is news ("a person read your fix") and now rings the bell.
 *
 * Covered here:
 *  1. leaveReviewSeenCopy (pure): named reviewer, leave type, range,
 *     SUCCESS completion tone, bell-only (no email surfaces).
 *  2. parseLeaveDecisionExtras: the new 'leave_review_seen' kind + reviewerName.
 *  3. Static route contract on POST /api/leaves/[id]/review: the bell write
 *     exists, is gated by hadPendingCorrection (the dedup — only a visit
 *     that clears a pending correction rings), addresses the employee's
 *     linked user, carries the marker + reviewer name + portal deep link,
 *     and is best-effort (try/catch, never fails the stamp).
 *  4. Static feed wiring: the marker joins the leave OR filter list, the
 *     feed maps the kind to 'leave_review_seen', the NotificationItem union
 *     and the notification-center (icon case + cyan rail + chip) render it.
 */

const ROOT = join(process.cwd(), 'src');

// ── 1. Copy contract (pure) ─────────────────────────────────────────────────

import {
  LEAVE_REVIEW_SEEN_METADATA_MARKER,
  leaveReviewSeenCopy,
  parseLeaveDecisionExtras,
} from '@/lib/hr/leave-notify';

describe('leaveReviewSeenCopy - employee-facing review-seen copy', () => {
  it('names the reviewer, the leave type and the corrected range', () => {
    const copy = leaveReviewSeenCopy({
      leaveTypeName: 'Annual Leave',
      startDate: '2026-11-02T00:00:00.000Z',
      endDate: '2026-11-04T00:00:00.000Z',
      reviewerName: 'Grace Achieng',
    });
    expect(copy.title).toContain('corrected leave request was seen');
    expect(copy.message).toContain('Grace Achieng');
    expect(copy.message).toContain('Annual Leave');
    expect(copy.message).toContain('Nov 2026');
    // The completion story: the marker cleared, nothing to do.
    expect(copy.message).toContain('no action is needed');
  });

  it('carries the SUCCESS completion tone (never an alarm or a to-do)', () => {
    const copy = leaveReviewSeenCopy({
      leaveTypeName: 'Sick Leave',
      startDate: '2026-11-09T00:00:00.000Z',
      endDate: '2026-11-11T00:00:00.000Z',
      reviewerName: 'System Administrator',
    });
    expect(copy.notifType).toBe('SUCCESS');
    expect(copy.priority).toBe('NORMAL');
  });

  it('is bell-ONLY by design (no email surfaces on the copy)', () => {
    const copy = leaveReviewSeenCopy({
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

describe('parseLeaveDecisionExtras - leave_review_seen kind', () => {
  it('accepts the new kind and the reviewer name', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({ kind: LEAVE_REVIEW_SEEN_METADATA_MARKER, leaveRequestId: 'lr-7', reviewerName: 'Grace Achieng' })
    );
    expect(extras.kind).toBe('leave_review_seen');
    expect(extras.leaveRequestId).toBe('lr-7');
    expect(extras.reviewerName).toBe('Grace Achieng');
  });

  it('rejects unknown kinds', () => {
    expect(parseLeaveDecisionExtras(JSON.stringify({ kind: 'leave_spying' })).kind).toBeUndefined();
  });
});

// ── 3. Static route contract on POST /api/leaves/[id]/review ───────────────

describe('POST /api/leaves/[id]/review - the bell answers the correction (static)', () => {
  let source = '';
  it('loads the route source', () => {
    source = readFileSync(join(ROOT, 'app/api/leaves/[id]/review/route.ts'), 'utf8');
    expect(source).toContain('leaveReviewSeenCopy');
  });

  it('the stamp query fetches the copy + recipient inputs (leaveType, employee user, and since v2.62.0 the employee NAME)', () => {
    expect(source).toContain('leaveType: { select: { name: true } }');
    // v2.62.0: the employee select grew the name fields for the answered
    // fan-out — the recipient input (linked user id) is still fetched.
    expect(source).toContain('firstName: true');
    expect(source).toContain('user: { select: { id: true } }');
    expect(source).toContain('startDate: true');
    expect(source).toContain('endDate: true');
  });

  it('the bell write is GATED by hadPendingCorrection (the dedup)', () => {
    // The gate is computed from the PRE-update row and guards the write.
    const gateIdx = source.indexOf('const hadPendingCorrection = needsDeskRecheck(existing.editedAt, existing.deskReviewedAt)');
    const writeIdx = source.indexOf('if (hadPendingCorrection) {');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(gateIdx);
    // The audit metadata reuses the SAME hoisted flag (one rule, one name).
    expect(source).toContain('hadPendingCorrection,\n      reviewerId');
  });

  it('the row addresses the employee\u2019s linked user and carries the marker + reviewer', () => {
    expect(source).toContain('const recipientUserId = existing.employee?.user?.id ?? null;');
    expect(source).toContain('kind: LEAVE_REVIEW_SEEN_METADATA_MARKER');
    expect(source).toContain('leaveRequestId: id');
    expect(source).toContain('reviewerName,\n            }),');
    // Portal deep link — same destination the v2.60.0 badge lives on.
    expect(source).toContain("actionUrl: '/employees/me/leave'");
    expect(source).toContain("actionLabel: 'View my leave'");
  });

  it('the bell write is best-effort (never fails the stamp)', () => {
    const writeIdx = source.indexOf('if (hadPendingCorrection) {');
    const catchBlock = source.indexOf('// Review-seen delivery is best-effort by design.', writeIdx);
    expect(catchBlock).toBeGreaterThan(writeIdx);
    // The write sits AFTER the stamp + audit log — the visit is durable
    // before delivery is attempted.
    const stampIdx = source.indexOf('deskReviewedByName: reviewerName,');
    const logIdx = source.indexOf("action: 'LEAVE_REVIEW_STAMPED'");
    expect(stampIdx).toBeLessThan(logIdx);
    expect(logIdx).toBeLessThan(writeIdx);
  });

  it('the response shape is unchanged (id/timestamp/name/needsRecheck)', () => {
    expect(source).toContain('deskReviewedByName: updated.deskReviewedByName ?? null');
    expect(source).toContain('needsRecheck: needsDeskRecheck(updated.editedAt, updated.deskReviewedAt)');
  });
});

// ── 4. Static feed wiring ───────────────────────────────────────────────────

describe('v2.61.0 static wiring', () => {
  it('the marker joins the feed leave OR filter list and the kind maps to the new type', () => {
    const route = readFileSync(join(ROOT, 'app/api/notifications/route.ts'), 'utf8');
    // Import + OR clause = 2 occurrences (the mapping branch selects by the
    // parsed `kind` string literal, same as the sibling leave kinds).
    const occurrences = route.split('LEAVE_REVIEW_SEEN_METADATA_MARKER').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    const orSection = route.split('9. v2.31.0 + v2.32.0: leave notifications')[1] ?? '';
    expect(orSection).toContain('LEAVE_REVIEW_SEEN_METADATA_MARKER');
    expect(route).toContain("kind === 'leave_review_seen'");
    expect(route).toContain("type: 'leave_review_seen'");
  });

  it('the NotificationItem union carries the new type', () => {
    const api = readFileSync(join(ROOT, 'lib/api.ts'), 'utf8');
    // v2.62.0: the answered type joined the union right after review_seen.
    expect(api).toContain("'leave_corrected' | 'leave_review_seen' | 'leave_review_answered' | 'payroll_approved'");
  });

  it('the notification-center renders the cyan receipt surface', () => {
    const center = readFileSync(join(ROOT, 'components/notification-center.tsx'), 'utf8');
    expect(center).toContain("case 'leave_review_seen'");
    expect(center).toContain("border-l-cyan-400 dark:border-l-cyan-500");
    expect(center).toContain('Correction seen');
  });

  it('the portal waiting badge carries the live pulse dot (styling contract)', () => {
    const view = readFileSync(join(ROOT, 'app/(selfservice)/employees/me/leave/leave-view.tsx'), 'utf8');
    const waitingIdx = view.indexOf('Waiting for a desk review');
    const pingIdx = view.indexOf('animate-ping');
    expect(waitingIdx).toBeGreaterThan(-1);
    expect(pingIdx).toBeGreaterThan(-1);
    expect(pingIdx).toBeLessThan(waitingIdx);
    // A named review earns the scan-eye; anonymous keeps the plain eye.
    expect(view).toContain('<ScanEye className="h-3 w-3" aria-hidden />');
  });

  it('the desk receipt wears the reviewer initial avatar (styling contract)', () => {
    const tab = readFileSync(join(ROOT, 'app/(shell)/tabs/payroll-tab.tsx'), 'utf8');
    expect(tab).toContain('live.deskReviewedByName.trim().charAt(0).toUpperCase()');
    // The amber state pulses in step with the portal badge.
    expect(tab).toContain('animate-ping');
  });
});
