import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.43.0 approver-side correction awareness contracts.
 *
 * Gap: the v2.40.0 edit window notified only the EMPLOYEE — the approvals
 * group (notified of the ORIGINAL request via the submission fan-out) could
 * approve on stale dates after an in-place correction silently re-based the
 * request under them.
 *
 * Covered here:
 *  1. leaveCorrectedCopy (pure): amber approver-facing copy carries the
 *     before → after summary, the editor label, the note, and states the
 *     request still awaits a decision.
 *  2. parseLeaveDecisionExtras: the new 'leave_corrected' kind + editedByName.
 *  3. notifyLeaveRequestCorrected (service, db-mocked): fans out to the
 *     store's decision-capable users EXCLUDING the actor and the employee's
 *     linked user, with ONE grouped email.
 *  4. Static wiring: the marker joins BOTH feed filter lists (digest NOT +
 *     leave OR), the NotificationItem union, the notification-center icon
 *     case, and the edit path calls the fan-out.
 *  5. describeLeaveAttachmentMarker: the v2.43.0 row-marker text upgrade.
 */

const ROOT = join(process.cwd(), 'src');

// ── 1. Copy contract (pure) ────────────────────────────────────────────────

import {
  LEAVE_CORRECTED_METADATA_MARKER,
  leaveCorrectedCopy,
  parseLeaveDecisionExtras,
} from '@/lib/hr/leave-notify';
import { describeLeaveAttachmentMarker } from '@/lib/hr/leave-attachment';

const correctedBase = {
  firstName: 'David',
  lastName: 'Otieno',
  leaveTypeName: 'Sick Leave',
  startDate: '2026-11-09T00:00:00.000Z',
  endDate: '2026-11-11T00:00:00.000Z',
  workingDays: 3,
  previousLeaveTypeName: 'Annual Leave',
  previousStartDate: '2026-11-02T00:00:00.000Z',
  previousEndDate: '2026-11-04T00:00:00.000Z',
  previousWorkingDays: 3,
  editedByLabel: 'Grace Achieng',
};

describe('leaveCorrectedCopy - approver-facing correction copy', () => {
  it('carries the employee name, the before → after summary and the editor label', () => {
    const copy = leaveCorrectedCopy(correctedBase);
    expect(copy.title).toContain('David Otieno');
    expect(copy.message).toContain('David Otieno');
    expect(copy.message).toContain('corrected by Grace Achieng');
    expect(copy.message).toContain('Sick Leave');
    expect(copy.message).toContain('Annual Leave'); // the "was" type
    expect(copy.message).toContain('still awaits a decision');
    expect(copy.notifType).toBe('INFO');
    expect(copy.priority).toBe('NORMAL');
  });

  it('marks a type change explicitly and stays silent when the type is unchanged', () => {
    const changed = leaveCorrectedCopy(correctedBase);
    expect(changed.message).toContain('Annual Leave leave request');
    const sameType = leaveCorrectedCopy({ ...correctedBase, previousLeaveTypeName: 'Sick Leave' });
    expect(sameType.message).not.toContain('Annual Leave');
  });

  it('appends the optional edit note to message, email subject rows and text', () => {
    const withNote = leaveCorrectedCopy({ ...correctedBase, editNote: 'Employee asked for a later week' });
    expect(withNote.message).toContain('Note: "Employee asked for a later week"');
    expect(withNote.emailHtml).toContain('Employee asked for a later week');
    expect(withNote.emailText).toContain('Note: Employee asked for a later week');
    const withoutNote = leaveCorrectedCopy(correctedBase);
    expect(withoutNote.message).not.toContain('Note:');
    expect(withoutNote.emailText).not.toContain('Note:');
  });

  it('formats both ranges and day counts into the email surfaces', () => {
    const copy = leaveCorrectedCopy(correctedBase);
    expect(copy.emailSubject).toContain('Corrected: David Otieno');
    expect(copy.emailText).toContain('Dates: 9 Nov 2026 - 11 Nov 2026 (was 2 Nov 2026 - 4 Nov 2026)');
    expect(copy.emailText).toContain('Corrected by Grace Achieng (HR).');
    expect(copy.emailHtml).toContain('review the corrected details on the Leave desk before deciding');
    expect(copy.emailHtml).toContain('#b45309'); // amber accent, distinct from the indigo employee copy
  });
});

// ── 2. Metadata parser ─────────────────────────────────────────────────────

describe('parseLeaveDecisionExtras - leave_corrected kind', () => {
  it('accepts the new kind and the editor label', () => {
    const extras = parseLeaveDecisionExtras(
      JSON.stringify({ kind: LEAVE_CORRECTED_METADATA_MARKER, leaveRequestId: 'lr-9', employeeId: 'emp-2', editedByLabel: 'Grace Achieng' })
    );
    expect(extras.kind).toBe('leave_corrected');
    expect(extras.leaveRequestId).toBe('lr-9');
  });

  it('rejects unknown kinds', () => {
    expect(parseLeaveDecisionExtras(JSON.stringify({ kind: 'leave_gossip' })).kind).toBeUndefined();
  });
});

// ── 3. Fan-out routing (service, db-mocked) ────────────────────────────────

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  notification: { createMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'log-1' }) }));

import { sendEmail } from '@/lib/email-service';
import { notifyLeaveRequestCorrected } from '@/lib/hr/leave-service';

const fanoutBase = {
  leaveRequestId: 'lr-1',
  storeId: 'store-1',
  employeeId: 'emp-1',
  employeeName: 'David Otieno',
  leaveTypeName: 'Sick Leave',
  startDate: new Date('2026-11-09T00:00:00.000Z'),
  endDate: new Date('2026-11-11T00:00:00.000Z'),
  workingDays: 3,
  previousLeaveTypeName: 'Annual Leave',
  previousStartDate: new Date('2026-11-02T00:00:00.000Z'),
  previousEndDate: new Date('2026-11-04T00:00:00.000Z'),
  previousWorkingDays: 3,
  actorUserId: 'actor-manager',
  employeeLinkedUserId: 'employee-linked-user',
};

describe('notifyLeaveRequestCorrected - approver fan-out excludes actor and employee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('excludes the actor AND the employee-linked user from the recipient query', async () => {
    db.user.findUnique.mockResolvedValue({ name: 'Grace Achieng', email: 'grace@mbumahhardware.co.ke' });
    db.user.findMany.mockResolvedValue([{ id: 'approver-1', email: 'owner@mbumahhardware.co.ke' }]);
    db.notification.createMany.mockResolvedValue({ count: 1 });

    await notifyLeaveRequestCorrected(fanoutBase);

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const where = db.user.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ notIn: ['actor-manager', 'employee-linked-user'] });
    expect(where.role.in).toContain('BRANCH_MANAGER');
    // One bell row per approver carrying the marker + editor label.
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const rows = db.notification.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].metadata).kind).toBe('leave_corrected');
    expect(JSON.parse(rows[0].metadata).editedByLabel).toBe('Grace Achieng');
    // One grouped email.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].type).toBe('LEAVE_EDIT');
  });

  it('falls back to the actor email then HR when the user row has no name', async () => {
    db.user.findUnique.mockResolvedValue({ name: null, email: 'desk@mbumahhardware.co.ke' });
    db.user.findMany.mockResolvedValue([{ id: 'approver-1', email: 'owner@mbumahhardware.co.ke' }]);
    db.notification.createMany.mockResolvedValue({ count: 1 });

    await notifyLeaveRequestCorrected(fanoutBase);

    const rows = db.notification.createMany.mock.calls[0][0].data;
    expect(JSON.parse(rows[0].metadata).editedByLabel).toBe('desk@mbumahhardware.co.ke');
  });

  it('skips silently when no eligible approver remains', async () => {
    db.user.findUnique.mockResolvedValue({ name: 'Grace Achieng', email: 'g@x.co.ke' });
    db.user.findMany.mockResolvedValue([]);

    await notifyLeaveRequestCorrected(fanoutBase);

    expect(db.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// ── 4. Static wiring contracts ─────────────────────────────────────────────

describe('v2.43.0 static wiring', () => {
  it('the marker joins BOTH feed filter lists (digest NOT + leave OR)', () => {
    const route = readFileSync(join(ROOT, 'app/api/notifications/route.ts'), 'utf8');
    // Import + section-8 NOT + section-9 OR = at least 3 occurrences.
    const occurrences = route.split('LEAVE_CORRECTED_METADATA_MARKER').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    const notSection = route.slice(route.indexOf('NOT: {'), route.indexOf('9. v2.31.0'));
    expect(notSection).toContain('LEAVE_CORRECTED_METADATA_MARKER');
    const orSection = route.split('9. v2.31.0 + v2.32.0: leave notifications')[1] ?? '';
    expect(orSection).toContain('LEAVE_CORRECTED_METADATA_MARKER');
    expect(route).toContain("kind === 'leave_corrected'");
    expect(route).toContain("type: 'leave_corrected'");
  });

  it('the NotificationItem union and the notification-center render the new type', () => {
    const api = readFileSync(join(ROOT, 'lib/api.ts'), 'utf8');
    expect(api).toContain("type: 'out_of_stock' | 'low_stock' | 'overdue_rental' | 'large_debt' | 'new_customer' | 'recent_transaction' | 'security' | 'hr_digest' | 'leave_decision' | 'leave_request' | 'leave_cancel' | 'leave_on_behalf' | 'leave_edited' | 'leave_corrected'");
    const center = readFileSync(join(ROOT, 'components/notification-center.tsx'), 'utf8');
    expect(center).toContain("case 'leave_corrected'");
    expect(center).toContain('Corrected - re-review');
  });

  it('the edit path calls the approver fan-out after the employee notification', () => {
    const service = readFileSync(join(ROOT, 'lib/hr/leave-service.ts'), 'utf8');
    expect(service).toContain('notifyLeaveRequestCorrected({');
    const editedIdx = service.indexOf('leaveEditedCopy({');
    const correctedIdx = service.indexOf('notifyLeaveRequestCorrected({');
    expect(editedIdx).toBeGreaterThan(-1);
    expect(correctedIdx).toBeGreaterThan(editedIdx);
  });
});

// ── 5. Row-marker text (v2.43.0 styling detail) ────────────────────────────

describe('describeLeaveAttachmentMarker', () => {
  it('describes data-URL attachments with kind and size', () => {
    // 70-byte payload → "70 B".
    const png70B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    expect(describeLeaveAttachmentMarker(png70B)).toMatch(/^Image · \d+ B$/);
    expect(describeLeaveAttachmentMarker('data:application/pdf;base64,JVBERi0=')).toMatch(/^PDF · \d+ B$/);
  });

  it('describes links and empty values', () => {
    expect(describeLeaveAttachmentMarker('https://drive.example.com/cert.pdf')).toBe('Link');
    expect(describeLeaveAttachmentMarker(null)).toBeNull();
    expect(describeLeaveAttachmentMarker('   ')).toBeNull();
  });
});
