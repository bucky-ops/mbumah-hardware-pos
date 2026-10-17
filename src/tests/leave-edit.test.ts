import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.40.0 leave EDIT window (governed correction of PENDING requests).
 *
 * Service contracts (db-mocked): editLeaveRequest recomputes working days
 * with the same weekend-skipping arithmetic as filing, re-guards the
 * balance (the request's OWN pending days are headroom when the type is
 * unchanged), stamps the editedAt/editedByName/editNote provenance, heals
 * both (type, year) balances via the aggregate recompute, writes the
 * before/after audit and notifies the EMPLOYEE (bell row + LEAVE_EDIT
 * email) — skipped when the actor IS the linked user.
 *
 * Copy contracts (pure): leaveEditedCopy always carries the "was → now"
 * values, the editor label, the optional note and the CORRECTED badge.
 *
 * Static route/UI contracts: PUT /api/leaves accepts EDIT behind the
 * decision-capable role gate; the HR desk sends action 'EDIT'.
 */

const db = vi.hoisted(() => ({
  leaveRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(),
  },
  employeeLeaveBalance: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  user: { findUnique: vi.fn() },
  notification: { create: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'log-1' }) }));
vi.mock('@/lib/hr/audit', () => ({ hrAudit: vi.fn().mockResolvedValue(undefined), HrEntityType: { EMPLOYEE: 'EMPLOYEE' } }));

import { sendEmail } from '@/lib/email-service';
import { hrAudit } from '@/lib/hr/audit';
import { editLeaveRequest } from '@/lib/hr/leave-service';
import { leaveEditedCopy } from '@/lib/hr/leave-notify';

const ROOT = join(process.cwd(), 'src');

const pendingRequest = {
  id: 'lr-edit-1',
  storeId: 'store-1',
  employeeId: 'emp-1',
  leaveTypeId: 'lt-annual',
  status: 'PENDING',
  startDate: new Date('2026-11-02T00:00:00.000Z'), // Monday
  endDate: new Date('2026-11-03T00:00:00.000Z'), // Tuesday
  workingDays: 2,
  halfDay: false,
  reason: 'Family trip upcountry',
  emergencyContact: 'Jane · 0700',
  employee: {
    id: 'emp-1',
    firstName: 'David',
    lastName: 'Otieno',
    email: 'david.otieno@mbumahhardware.co.ke',
    user: { id: 'linked-user-1' },
  },
  leaveType: { id: 'lt-annual', name: 'Annual Leave' },
};

const updatedRow = {
  ...pendingRequest,
  leaveTypeId: 'lt-annual',
  leaveType: { name: 'Annual Leave', code: 'AL' },
};

function mockHappyPath() {
  db.leaveRequest.findUnique.mockResolvedValue(pendingRequest);
  db.leaveRequest.update.mockResolvedValue(updatedRow);
  db.leaveRequest.aggregate.mockResolvedValue({ _sum: { workingDays: null } });
  db.employeeLeaveBalance.findFirst
    .mockResolvedValueOnce({ allocatedDays: 10, carryForwardDays: 0, usedDays: 2, pendingDays: 2 }) // guard read
    .mockResolvedValue(null); // recompute read
  db.employeeLeaveBalance.update.mockResolvedValue({});
  db.user.findUnique.mockResolvedValue({ name: 'System Administrator', email: 'admin@x' });
}

beforeEach(() => vi.clearAllMocks());

describe('editLeaveRequest - validation', () => {
  it('rejects a request that is not PENDING (frozen history)', async () => {
    db.leaveRequest.findUnique.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
    await expect(
      editLeaveRequest({
        requestId: 'lr-edit-1',
        actorId: 'actor-1',
        actorRole: 'STORE_OWNER',
        startDate: new Date('2026-11-09T00:00:00.000Z'),
        endDate: new Date('2026-11-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/NOT_EDITABLE/);
    expect(db.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('rejects an inverted range', async () => {
    db.leaveRequest.findUnique.mockResolvedValue(pendingRequest);
    await expect(
      editLeaveRequest({
        requestId: 'lr-edit-1',
        actorId: 'actor-1',
        actorRole: 'STORE_OWNER',
        startDate: new Date('2026-11-10T00:00:00.000Z'),
        endDate: new Date('2026-11-09T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/PERIOD_MISMATCH/);
  });

  it('rejects a range with zero working days (a weekend)', async () => {
    db.leaveRequest.findUnique.mockResolvedValue(pendingRequest);
    await expect(
      editLeaveRequest({
        requestId: 'lr-edit-1',
        actorId: 'actor-1',
        actorRole: 'STORE_OWNER',
        startDate: new Date('2026-11-07T00:00:00.000Z'), // Saturday
        endDate: new Date('2026-11-08T00:00:00.000Z'), // Sunday
      }),
    ).rejects.toThrow(/PERIOD_MISMATCH/);
  });

  it('throws when the request does not exist', async () => {
    db.leaveRequest.findUnique.mockResolvedValue(null);
    await expect(
      editLeaveRequest({
        requestId: 'nope',
        actorId: 'actor-1',
        actorRole: 'STORE_OWNER',
        startDate: new Date('2026-11-09T00:00:00.000Z'),
        endDate: new Date('2026-11-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('editLeaveRequest - balance guard', () => {
  it('counts the request OWN pending days as headroom when the type is unchanged', async () => {
    mockHappyPath();
    // balance: 10 + 0 - 2 used - 2 pending = 4 available; the request itself
    // holds 2 of those pending days → headroom 6 for the corrected range.
    db.employeeLeaveBalance.findFirst
      .mockResolvedValueOnce({ allocatedDays: 10, carryForwardDays: 0, usedDays: 2, pendingDays: 2 })
      .mockResolvedValue(null);
    await expect(
      editLeaveRequest({
        requestId: 'lr-edit-1',
        actorId: 'actor-1',
        actorRole: 'STORE_OWNER',
        startDate: new Date('2026-11-09T00:00:00.000Z'), // Mon
        endDate: new Date('2026-11-13T00:00:00.000Z'), // Fri = 5 days
      }),
    ).resolves.toMatchObject({ id: 'lr-edit-1' });
  });

  it('rejects a corrected range that exceeds the available balance', async () => {
    mockHappyPath();
    db.employeeLeaveBalance.findFirst
      .mockResolvedValueOnce({ allocatedDays: 10, carryForwardDays: 0, usedDays: 2, pendingDays: 2 })
      .mockResolvedValue(null);
    // 10 - 2 - 2 + 2 headroom = 8 available; 2 full weeks = 10 days > 8.
    await expect(
      editLeaveRequest({
        requestId: 'lr-edit-1',
        actorId: 'actor-1',
        actorRole: 'STORE_OWNER',
        startDate: new Date('2026-11-09T00:00:00.000Z'),
        endDate: new Date('2026-11-20T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/INSUFFICIENT_LEAVE_BALANCE/);
    expect(db.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('gives NO self headroom when the leave type changes', async () => {
    mockHappyPath();
    db.employeeLeaveBalance.findFirst
      .mockResolvedValueOnce({ allocatedDays: 5, carryForwardDays: 0, usedDays: 0, pendingDays: 0 }) // new type: 5 available
      .mockResolvedValue(null);
    const changed = { ...updatedRow, leaveTypeId: 'lt-sick', leaveType: { name: 'Sick Leave', code: 'SL' } };
    db.leaveRequest.update.mockResolvedValue(changed);
    // Requesting 5 of the new type fits exactly; the old request's 2 pending
    // days on lt-annual must NOT be headroom here.
    await expect(
      editLeaveRequest({
        requestId: 'lr-edit-1',
        actorId: 'actor-1',
        actorRole: 'STORE_OWNER',
        leaveTypeId: 'lt-sick',
        startDate: new Date('2026-11-09T00:00:00.000Z'),
        endDate: new Date('2026-11-13T00:00:00.000Z'), // 5 days
      }),
    ).resolves.toMatchObject({ leaveTypeId: 'lt-sick' });
  });
});

describe('editLeaveRequest - correction semantics', () => {
  it('recomputes working days (weekends skipped), stamps provenance and keeps PENDING', async () => {
    mockHappyPath();
    await editLeaveRequest({
      requestId: 'lr-edit-1',
      actorId: 'actor-1',
      actorRole: 'STORE_OWNER',
      startDate: new Date('2026-11-06T00:00:00.000Z'), // Friday
      endDate: new Date('2026-11-10T00:00:00.000Z'), // Tuesday → Fri+Mon+Tue = 3
      reason: 'Updated family trip dates',
      editedByName: 'System Administrator',
      editNote: 'Clashes with month-end stock take',
    });

    const data = db.leaveRequest.update.mock.calls[0][0].data;
    expect(data.workingDays).toBe(3);
    expect(data.startDate).toEqual(new Date('2026-11-06T00:00:00.000Z'));
    expect(data.endDate).toEqual(new Date('2026-11-10T00:00:00.000Z'));
    expect(data.returnDate).toEqual(new Date('2026-11-11T00:00:00.000Z'));
    expect(data.editedAt).toBeInstanceOf(Date);
    expect(data.editedByName).toBe('System Administrator');
    expect(data.editNote).toBe('Clashes with month-end stock take');
    expect(data.status).toBeUndefined(); // no status transition — PENDING stays
    expect(data.approvedBy).toBeUndefined(); // never stamps a decision
    expect(data.reason).toBe('Updated family trip dates');
  });

  it('writes a before/after audit entry', async () => {
    mockHappyPath();
    await editLeaveRequest({
      requestId: 'lr-edit-1',
      actorId: 'actor-1',
      actorRole: 'STORE_OWNER',
      startDate: new Date('2026-11-09T00:00:00.000Z'),
      endDate: new Date('2026-11-13T00:00:00.000Z'),
      editedByName: 'System Administrator',
    });
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        resourceId: 'lr-edit-1',
        metadata: expect.objectContaining({
          before: expect.objectContaining({ workingDays: 2 }),
          after: expect.objectContaining({ workingDays: 5 }),
        }),
      }),
    );
  });

  it('heals both (type, year) balances on a type change', async () => {
    mockHappyPath();
    db.leaveRequest.update.mockResolvedValue({
      ...updatedRow,
      leaveTypeId: 'lt-sick',
      leaveType: { name: 'Sick Leave', code: 'SL' },
    });
    await editLeaveRequest({
      requestId: 'lr-edit-1',
      actorId: 'actor-1',
      actorRole: 'STORE_OWNER',
      leaveTypeId: 'lt-sick',
      startDate: new Date('2026-11-09T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
    });
    // aggregate is called twice per recompute; two recomputes = 4 calls.
    expect(db.leaveRequest.aggregate).toHaveBeenCalledTimes(4);
  });
});

describe('editLeaveRequest - employee notification routing', () => {
  it('writes one bell row to the linked user with edit metadata + portal deep link', async () => {
    mockHappyPath();
    await editLeaveRequest({
      requestId: 'lr-edit-1',
      actorId: 'actor-1',
      actorRole: 'STORE_OWNER',
      startDate: new Date('2026-11-09T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
      editedByName: 'System Administrator',
      editNote: 'Dates adjusted',
    });

    expect(db.notification.create).toHaveBeenCalledTimes(1);
    const row = db.notification.create.mock.calls[0][0].data;
    expect(row.userId).toBe('linked-user-1');
    expect(row.actionUrl).toBe('/employees/me/leave');
    expect(row.category).toBe('HR');
    const meta = JSON.parse(row.metadata);
    expect(meta.kind).toBe('leave_edited');
    expect(meta.editedByName).toBe('System Administrator');
    expect(meta.leaveRequestId).toBe('lr-edit-1');
  });

  it('sends one LEAVE_EDIT email to the employee address', async () => {
    mockHappyPath();
    await editLeaveRequest({
      requestId: 'lr-edit-1',
      actorId: 'actor-1',
      actorRole: 'BRANCH_MANAGER',
      startDate: new Date('2026-11-09T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
      editedByName: 'System Administrator',
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe('david.otieno@mbumahhardware.co.ke');
    expect(call.type).toBe('LEAVE_EDIT');
    expect(call.subject).toContain('corrected');
  });

  it('stays silent when the actor IS the linked user', async () => {
    mockHappyPath();
    await editLeaveRequest({
      requestId: 'lr-edit-1',
      actorId: 'linked-user-1',
      actorRole: 'STORE_OWNER',
      startDate: new Date('2026-11-09T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
    });
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to the actor user record for the editor label', async () => {
    mockHappyPath();
    await editLeaveRequest({
      requestId: 'lr-edit-1',
      actorId: 'actor-1',
      actorRole: 'ACCOUNTANT',
      startDate: new Date('2026-11-09T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
    });
    const row = db.notification.create.mock.calls[0][0].data;
    expect(JSON.parse(row.metadata).editedByName).toBe('System Administrator');
  });
});

describe('leaveEditedCopy - copy contracts', () => {
  const base = {
    firstName: 'David',
    lastName: 'Otieno',
    leaveTypeName: 'Annual Leave',
    startDate: '2026-11-09T00:00:00.000Z',
    endDate: '2026-11-10T00:00:00.000Z',
    workingDays: 2,
    previousLeaveTypeName: 'Annual Leave',
    previousStartDate: '2026-11-02T00:00:00.000Z',
    previousEndDate: '2026-11-03T00:00:00.000Z',
    previousWorkingDays: 2,
    editedByLabel: 'System Administrator',
  };

  it('carries the was → now values, the editor and the CORRECTED badge', () => {
    const copy = leaveEditedCopy({ ...base, editNote: 'Clashes with stock take' });
    expect(copy.title).toContain('corrected');
    expect(copy.message).toContain('2 days (2 Nov 2026 - 3 Nov 2026)'); // was
    expect(copy.message).toContain('2 days (9 Nov 2026 - 10 Nov 2026)'); // now
    expect(copy.message).toContain('Note: "Clashes with stock take"');
    expect(copy.emailHtml).toContain('CORRECTED');
    expect(copy.emailHtml).toContain('Corrected by System Administrator');
    expect(copy.emailHtml).toContain('was 2 Nov 2026 - 3 Nov 2026');
  });

  it('names the OLD type when the leave type changed', () => {
    const copy = leaveEditedCopy({ ...base, previousLeaveTypeName: 'Sick Leave' });
    expect(copy.message).toContain('Sick Leave leave request was corrected');
    expect(copy.emailHtml).toContain('(was Sick Leave)');
  });

  it('renders the pending-status reassurance in every surface', () => {
    const copy = leaveEditedCopy(base);
    expect(copy.message).toContain('stays pending manager review');
    expect(copy.emailText).toContain('keeps its pending status');
  });
});

describe('v2.40.0 static contracts', () => {
  it('PUT /api/leaves validates EDIT behind the owner-or-decision-capable split (v2.45.0)', () => {
    const route = readFileSync(join(ROOT, 'app/api/leaves/route.ts'), 'utf8');
    expect(route).toContain("'APPROVE', 'REJECT', 'CANCEL', 'EDIT'");
    // v2.45.0: EDIT left the decision-capable requireRole gate — the request
    // OWNER may now correct their own PENDING request from the portal.
    expect(route).toContain("action === 'APPROVE' || action === 'REJECT')");
    const editBlock = route.split("if (action === 'EDIT')")[1] ?? '';
    expect(editBlock).toContain('leaveRequest.employee.user?.id === session.userId');
    expect(editBlock).toContain('status: 403');
    expect(route).toContain("action: 'LEAVE_REQUEST_EDITED'");
    expect(route).toContain('NOT_EDITABLE');
  });

  it('the HR desk correction dialog sends action EDIT with the balance preview', () => {
    const tab = readFileSync(join(ROOT, 'app/(shell)/tabs/payroll-tab.tsx'), 'utf8');
    expect(tab).toContain("action: 'EDIT'");
    expect(tab).toContain('editSelfHeadroom');
    expect(tab).toContain('data-testid="edit-days-preview"');
    expect(tab).toContain('bg-amber-600');
  });

  it('the portal card and feed surface the correction', () => {
    const view = readFileSync(join(ROOT, 'app/(selfservice)/employees/me/leave/leave-view.tsx'), 'utf8');
    expect(view).toContain('Corrected by HR');
    const center = readFileSync(join(ROOT, 'components/notification-center.tsx'), 'utf8');
    expect(center).toContain("case 'leave_edited'");
    expect(center).toContain('Corrected by HR');
    const feed = readFileSync(join(ROOT, 'app/api/notifications/route.ts'), 'utf8');
    expect(feed).toContain("'leave_edited'");
  });
});
