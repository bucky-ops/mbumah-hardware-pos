import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.33.0 leave CANCEL notification routing + authorization contracts.
 *
 * Routing (service, db-mocked): notifyLeaveRequestCancelled mirrors the
 * ACTOR's counterpart - a decision-capable manager cancelling writes ONE
 * bell row to the employee's linked user (+ best-effort email), while an
 * employee self-withdrawal fans out to the approvals group (actor excluded,
 * one grouped email). Nobody is ever notified about their own action.
 *
 * Authorization (static contract on PUT /api/leaves): CANCEL used to accept
 * ANY same-store user for ANY request - the ownership gate now restricts
 * non-managers to their own requests before the status transition runs.
 */

const db = vi.hoisted(() => ({
  employee: { findUnique: vi.fn() },
  leaveType: { findUnique: vi.fn() },
  notification: { create: vi.fn(), createMany: vi.fn() },
  user: { findMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ id: 'log-1' }) }));
vi.mock('@/lib/hr/audit', () => ({ hrAudit: vi.fn().mockResolvedValue(undefined), HrEntityType: { EMPLOYEE: 'EMPLOYEE' } }));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));

import { sendEmail } from '@/lib/email-service';
import { notifyLeaveRequestCancelled } from '@/lib/hr/leave-service';

const ROOT = join(process.cwd(), 'src');

const baseEmployee = {
  firstName: 'David',
  lastName: 'Otieno',
  email: 'david.otieno@mbumahhardware.co.ke',
  user: { id: 'linked-user-1', email: 'david.portal@mbumahhardware.co.ke' },
};

const baseParams = {
  leaveRequestId: 'lr-1',
  storeId: 'store-1',
  employeeId: 'emp-1',
  leaveTypeId: 'lt-annual',
  startDate: new Date('2026-11-02T00:00:00.000Z'),
  endDate: new Date('2026-11-03T00:00:00.000Z'),
  workingDays: 2,
  actorUserId: 'actor-1',
  actorEmail: 'owner@mbumahhardware.co.ke',
};

describe('notifyLeaveRequestCancelled - manager cancel routes to the employee', () => {
  beforeEach(() => vi.clearAllMocks());
  beforeAll(() => {
    db.employee.findUnique.mockResolvedValue(baseEmployee);
    db.leaveType.findUnique.mockResolvedValue({ name: 'Annual Leave' });
  });

  it('writes one bell row to the linked user with the portal deep link and cancel metadata', async () => {
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'STORE_OWNER' });

    expect(db.notification.create).toHaveBeenCalledTimes(1);
    const row = db.notification.create.mock.calls[0][0].data;
    expect(row.userId).toBe('linked-user-1');
    expect(row.actionUrl).toBe('/employees/me/leave');
    expect(row.category).toBe('HR');
    const meta = JSON.parse(row.metadata);
    expect(meta.kind).toBe('leave_cancel');
    expect(meta.cancelledByManager).toBe(true);
    expect(meta.leaveRequestId).toBe('lr-1');
  });

  it('sends one LEAVE_CANCEL email to the employee address', async () => {
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'BRANCH_MANAGER' });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe('david.otieno@mbumahhardware.co.ke');
    expect(call.type).toBe('LEAVE_CANCEL');
    expect(call.subject).toContain('cancelled');
  });

  it('addresses the copy to the employee, not to the manager who acted', async () => {
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'SUPER_ADMIN' });

    const row = db.notification.create.mock.calls[0][0].data;
    expect(row.userId).toBe('linked-user-1');
    expect(row.userId).not.toBe(baseParams.actorUserId);
  });

  it('falls back to the linked user email when the employee record has none', async () => {
    db.employee.findUnique.mockResolvedValue({ ...baseEmployee, email: null });
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'STORE_OWNER' });

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe('david.portal@mbumahhardware.co.ke');
  });

  it('skips both legs silently when the employee has no linked user and no email', async () => {
    db.employee.findUnique.mockResolvedValue({ ...baseEmployee, email: null, user: null });
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'ACCOUNTANT' });

    expect(db.notification.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('notifyLeaveRequestCancelled - self-withdrawal fans out to approvers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.employee.findUnique.mockResolvedValue(baseEmployee);
    db.leaveType.findUnique.mockResolvedValue({ name: 'Annual Leave' });
  });

  it('notifies every decision-capable user except the actor', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'owner-1', email: 'owner@mbumahhardware.co.ke' },
      { id: 'manager-1', email: 'manager@mbumahhardware.co.ke' },
    ]);
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'CASHIER' });

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          id: { not: baseParams.actorUserId },
        }),
      }),
    );
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const rows = db.notification.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['owner-1', 'manager-1']);
    const meta = JSON.parse(rows[0].metadata);
    expect(meta.kind).toBe('leave_cancel');
    expect(meta.cancelledByManager).toBe(false);
  });

  it('sends ONE grouped email to all approver addresses', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'owner-1', email: 'owner@mbumahhardware.co.ke' },
      { id: 'manager-1', email: null },
    ]);
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'CASHIER' });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toEqual(['owner@mbumahhardware.co.ke']);
    expect(call.subject).toContain('withdrawn');
  });

  it('is a no-op when no approvers remain', async () => {
    db.user.findMany.mockResolvedValue([]);
    await notifyLeaveRequestCancelled({ ...baseParams, actorRole: 'CASHIER' });

    expect(db.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('PUT /api/leaves CANCEL ownership gate (static contract)', () => {
  const route = readFileSync(join(ROOT, 'app', 'api', 'leaves', 'route.ts'), 'utf8');

  it('restricts non-managers to their own requests before any transition runs', () => {
    const guardIdx = route.indexOf("action === 'CANCEL'") ;
    const ownerIdx = route.indexOf('const isRequestOwner = leaveRequest.employee.user?.id === session.userId');
    const transitionIdx = route.indexOf('newStatus = ');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(ownerIdx).toBeGreaterThan(guardIdx);
    expect(transitionIdx).toBeGreaterThan(ownerIdx);
  });

  it('allows decision-capable roles through the same gate', () => {
    const guard = route.slice(route.indexOf("action === 'CANCEL'"), route.indexOf('newStatus = '));
    for (const role of ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT']) {
      expect(guard).toContain(`'${role}'`);
    }
  });

  it('answers 403 with a self-serviceable message', () => {
    expect(route).toContain('You can only cancel your own leave requests.');
    expect(route).toContain('{ status: 403 }');
  });
});
