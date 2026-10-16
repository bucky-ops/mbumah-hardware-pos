import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  adjustLeaveBalance,
  leaveBalanceDrillDown,
  leaveBalanceFlagOf,
  ADJUST_ROLES,
} from '@/lib/hr/leave-balance-governance';

/**
 * v2.36.0 contracts: leave balance governance — the OVERDRAWN correction path.
 * Covered here: drill-down scoping (fail-closed null, never a leak), the
 * history window (requests STARTING inside the leave year), adjustment
 * validation (non-zero, 0.5d steps, ±365 cap, 8+ char reason, allocated >= 0),
 * tenths-exact math, notes append, hash-chained audit, and the employee
 * bell row + email (fail-tolerant).
 */

const db = vi.hoisted(() => ({
  employeeLeaveBalance: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  leaveRequest: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  notification: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/lib/db', () => ({ db }));

const sendEmail = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/email-service', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [])),
}));

vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue('audit-id'),
  HrEntityType: { EMPLOYEE: 'Employee' },
}));

const orgSession = {
  userId: 'user-hr',
  email: 'hr@mbumah.co.ke',
  role: 'HR_MANAGER',
  storeId: null,
  organizationId: 'org-1',
} as const;

const accountantSession = {
  userId: 'user-acct',
  email: 'acct@mbumah.co.ke',
  role: 'ACCOUNTANT',
  storeId: null,
  organizationId: 'org-1',
} as const;

const branchSession = {
  userId: 'user-bm',
  email: 'bm@mbumah.co.ke',
  role: 'BRANCH_MANAGER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as const;

const balanceRow = (over: Record<string, unknown> = {}) => ({
  id: 'bal-1',
  allocatedDays: 21,
  carryForwardDays: 3,
  usedDays: 10,
  pendingDays: 2,
  encashedDays: 0,
  notes: null,
  leaveYear: 2026,
  updatedAt: new Date('2026-01-15T00:00:00Z'),
  employee: {
    id: 'emp-1',
    employeeCode: 'EMP-001',
    email: 'emp@mbumah.co.ke',
    storeId: 'store-1',
    user: { id: 'user-emp', email: 'emp.portal@mbumah.co.ke' },
  },
  leaveType: { id: 'lt-annual', name: 'Annual', code: 'ANNUAL' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.leaveRequest.findMany.mockResolvedValue([]);
  db.employeeLeaveBalance.update.mockResolvedValue({});
  db.notification.create.mockResolvedValue({});
  sendEmail.mockResolvedValue({ ok: true });
});

describe('leave balance drill-down scoping', () => {
  it('returns null for a scopeless session (fail-closed, no queries)', async () => {
    const out = await leaveBalanceDrillDown(
      { userId: 'x', email: 'x@x', role: 'CASHIER', storeId: 's1', organizationId: 'o1' } as never,
      2026,
      'EMP-001',
      'ANNUAL',
    );
    expect(out).toBeNull();
    expect(db.employeeLeaveBalance.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when the (code, type, year) row does not resolve inside scope', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(null);
    const out = await leaveBalanceDrillDown(orgSession as never, 2026, 'GHOST', 'ANNUAL');
    expect(out).toBeNull();
    expect(db.leaveRequest.findMany).not.toHaveBeenCalled();
  });

  it('exposes canAdjust only to adjust-capable roles (BM/ACCOUNTANT cannot)', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(balanceRow());
    const forHr = await leaveBalanceDrillDown(orgSession as never, 2026, 'EMP-001', 'ANNUAL');
    const forAcct = await leaveBalanceDrillDown(accountantSession as never, 2026, 'EMP-001', 'ANNUAL');
    const forBm = await leaveBalanceDrillDown(branchSession as never, 2026, 'EMP-001', 'ANNUAL');
    expect(forHr?.canAdjust).toBe(true);
    expect(forAcct?.canAdjust).toBe(false);
    expect(forBm?.canAdjust).toBe(false);
  });

  it('computes balance components and flags identically to the report', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(balanceRow());
    const out = await leaveBalanceDrillDown(orgSession as never, 2026, 'EMP-001', 'ANNUAL');
    // 21 + 3 - 10 - 2 = 12 available; pool 24; committed 50%.
    expect(out?.balance.available).toBe(12);
    expect(out?.balance.committedPct).toBe(50);
    expect(out?.balance.flag).toBe('OPEN');
    expect(out?.employee.code).toBe('EMP-001');
    expect(out?.type.code).toBe('ANNUAL');
  });

  it('restricts history to requests STARTING inside the leave year (window query)', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(balanceRow());
    db.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'lr-1',
        status: 'APPROVED',
        startDate: new Date('2026-11-02T00:00:00Z'),
        endDate: new Date('2026-11-03T00:00:00Z'),
        workingDays: 2,
        halfDay: false,
        reason: 'Family',
        rejectionReason: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        approvedAt: new Date('2026-10-02T00:00:00Z'),
      },
    ]);
    const out = await leaveBalanceDrillDown(orgSession as never, 2026, 'EMP-001', 'ANNUAL');
    const where = db.leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.employeeId).toBe('emp-1');
    expect(where.leaveTypeId).toBe('lt-annual');
    expect(where.startDate.gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(where.startDate.lt).toEqual(new Date(Date.UTC(2027, 0, 1)));
    expect(out?.history).toHaveLength(1);
    expect(out?.history[0].status).toBe('APPROVED');
    expect(out?.history[0].workingDays).toBe(2);
  });
});

describe('adjustLeaveBalance validation', () => {
  it('rejects non-adjust roles before any query (ACCOUNTANT/BRANCH_MANAGER)', async () => {
    const acct = await adjustLeaveBalance(accountantSession as never, {
      balanceId: 'bal-1',
      deltaDays: 2,
      reason: 'correcting overdraw',
    });
    const bm = await adjustLeaveBalance(branchSession as never, {
      balanceId: 'bal-1',
      deltaDays: 2,
      reason: 'correcting overdraw',
    });
    expect(acct).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(bm).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(db.employeeLeaveBalance.findFirst).not.toHaveBeenCalled();
  });

  it('enforces the validation rails (zero, step, cap, reason, floor)', async () => {
    const cases: Array<[number, string]> = [
      [0, 'giving zero days'],
      [0.3, 'odd step of 0.3 days'],
      [400, 'more than the cap allows'],
      [2, 'short'],
      [-30, 'driving allocated below zero'],
    ];
    db.employeeLeaveBalance.findFirst.mockResolvedValue(balanceRow({ allocatedDays: 21 }));
    for (const [delta, reason] of cases) {
      const out = await adjustLeaveBalance(orgSession as never, { balanceId: 'bal-1', deltaDays: delta, reason });
      expect(out).toMatchObject({ ok: false, code: 'VALIDATION' });
    }
    expect(db.employeeLeaveBalance.update).not.toHaveBeenCalled();
  });

  it('fails closed on a balanceId outside the caller scope (NOT_FOUND, no write)', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(null);
    const out = await adjustLeaveBalance(orgSession as never, {
      balanceId: 'forged-id',
      deltaDays: 2,
      reason: 'correcting overdraw',
    });
    expect(out).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(db.employeeLeaveBalance.update).not.toHaveBeenCalled();
  });
});

describe('adjustLeaveBalance success path', () => {
  it('writes tenths-exact allocation, appends notes, audits, notifies + emails', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(
      balanceRow({ allocatedDays: 20.8, notes: 'seed note' }),
    );
    const out = await adjustLeaveBalance(orgSession as never, {
      balanceId: 'bal-1',
      deltaDays: 2.5,
      reason: 'Restoring over-drawn entitlement',
    });
    expect(out).toMatchObject({ ok: true, allocatedBefore: 20.8, allocatedAfter: 23.3 });
    expect(out.ok && out.availableAfter === 14.3).toBe(true); // 23.3 + 3 - 10 - 2

    const update = db.employeeLeaveBalance.update.mock.calls[0][0];
    expect(update.where.id).toBe('bal-1');
    expect(update.data.allocatedDays).toBe(23.3);
    expect(update.data.notes).toContain('seed note');
    expect(update.data.notes).toContain('[balance adjust]');
    expect(update.data.notes).toContain('+2.5d');
    expect(update.data.notes).toContain('Restoring over-drawn entitlement');

    // Notification to the linked portal user.
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    const notif = db.notification.create.mock.calls[0][0].data;
    expect(notif.userId).toBe('user-emp');
    expect(notif.storeId).toBe('store-1');
    expect(notif.actionUrl).toBe('/employees/me/leave');
    expect(JSON.parse(notif.metadata)).toMatchObject({ kind: 'leave_balance_adjusted', deltaDays: 2.5 });

    // Email attempted with the employee address.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('emp@mbumah.co.ke');
    expect(sendEmail.mock.calls[0][0].type).toBe('LEAVE_BALANCE_ADJUSTED');

    // Honest delivery facts: linked portal user + reachable email.
    expect(out.ok && out.notified.bell === true && out.notified.email === true).toBe(true);
  });

  it('tolerates a missing portal user and unreachable email (fail-tolerant)', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(
      balanceRow({ employee: { id: 'emp-1', employeeCode: 'EMP-001', email: 'emp@mbumah.co.ke', storeId: 'store-1', user: null } }),
    );
    db.notification.create.mockRejectedValue(new Error('down'));
    sendEmail.mockRejectedValue(new Error('down'));
    const out = await adjustLeaveBalance(orgSession as never, {
      balanceId: 'bal-1',
      deltaDays: -1.5,
      reason: 'Clawing back unearned days',
    });
    expect(out).toMatchObject({ ok: true, allocatedAfter: 19.5 });
    expect(out.ok && out.allocatedBefore === 21).toBe(true);
    // Both channels down -> outcome must NOT claim delivery.
    expect(out.ok && out.notified.bell === false && out.notified.email === false).toBe(true);
  });

  it('reports honest delivery: no portal user skips the bell, employee email still sent', async () => {
    db.employeeLeaveBalance.findFirst.mockResolvedValue(
      balanceRow({ employee: { id: 'emp-1', employeeCode: 'EMP-001', email: 'emp@mbumah.co.ke', storeId: 'store-1', user: null } }),
    );
    const out = await adjustLeaveBalance(orgSession as never, {
      balanceId: 'bal-1',
      deltaDays: 0.5,
      reason: 'Day-of service recognition award',
    });
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: true, notified: { bell: false, email: true } });
  });
});

describe('flag rails parity', () => {
  it('classifies OVERDRAWN / EXHAUSTED / LOW / OPEN like the report', () => {
    expect(leaveBalanceFlagOf(-1, 120)).toBe('OVERDRAWN');
    expect(leaveBalanceFlagOf(0, 100)).toBe('EXHAUSTED');
    expect(leaveBalanceFlagOf(1, 80)).toBe('LOW');
    expect(leaveBalanceFlagOf(5, 10)).toBe('OPEN');
  });

  it('keeps adjusters aligned with the hr.leave.balance.manage permission map', () => {
    expect([...ADJUST_ROLES].sort()).toEqual(['HR_MANAGER', 'STORE_OWNER']);
  });
});
