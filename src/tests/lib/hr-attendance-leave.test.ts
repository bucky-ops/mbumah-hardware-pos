import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stage E contracts: replay-safe punches with server-authoritative time,
 * idempotent leave balance recompute, and the timesheet payroll gate.
 */

const db = vi.hoisted(() => ({
  employee: { findFirst: vi.fn() },
  attendanceRecord: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  shift: { findMany: vi.fn() },
  leaveRequest: { aggregate: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  employeeLeaveBalance: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  leaveType: { findMany: vi.fn() },
  auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/audit-trail', () => ({ auditTrail: { log: vi.fn().mockResolvedValue('audit-id') } }));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));

import { punch } from '@/lib/hr/attendance-service';
import { recomputeBalances } from '@/lib/hr/leave-service';

const base = { employeeId: 'emp-1', storeId: 'store-1', actorId: 'user-1', actorRole: 'CASHIER' };

describe('attendance punch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replays the existing record when the idempotency key repeats', async () => {
    const existing = { id: 'att-1', checkIn: new Date('2026-03-02T07:55:00Z'), checkOut: null };
    db.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    db.attendanceRecord.findUnique.mockResolvedValue(existing);

    const result = await punch({ ...base, kind: 'IN', idempotencyKey: 'punch-key-1' });
    expect(result.replayed).toBe(true);
    expect(result.recordId).toBe('att-1');
    expect(db.attendanceRecord.create).not.toHaveBeenCalled();
  });

  it('suppresses a duplicate punch IN on the same day', async () => {
    db.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    db.attendanceRecord.findUnique.mockResolvedValue(null);
    db.attendanceRecord.findFirst.mockResolvedValue({ id: 'att-1', checkIn: new Date(), checkOut: null });

    const result = await punch({ ...base, kind: 'IN' });
    expect(result.replayed).toBe(true);
    expect(db.attendanceRecord.create).not.toHaveBeenCalled();
  });

  it('creates an attendance record for a first punch IN', async () => {
    db.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    db.attendanceRecord.findUnique.mockResolvedValue(null);
    db.attendanceRecord.findFirst.mockResolvedValue(null);
    db.attendanceRecord.create.mockResolvedValue({ id: 'att-2', checkIn: new Date(), checkOut: null });

    const result = await punch({ ...base, kind: 'IN', idempotencyKey: 'punch-key-2' });
    expect(result.replayed).toBe(false);
    expect(db.attendanceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ employeeId: 'emp-1', idempotencyKey: 'punch-key-2' }),
    });
  });

  it('refuses a punch OUT without a prior punch IN', async () => {
    db.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    db.attendanceRecord.findUnique.mockResolvedValue(null);
    db.attendanceRecord.findFirst.mockResolvedValue(null);
    await expect(punch({ ...base, kind: 'OUT' })).rejects.toThrow(/punch IN first/);
  });
});

describe('leave balance recompute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idempotent: recomputing twice yields identical updates', async () => {
    db.leaveRequest.aggregate
      .mockResolvedValueOnce({ _sum: { workingDays: 3 } })
      .mockResolvedValueOnce({ _sum: { workingDays: 1 } })
      .mockResolvedValueOnce({ _sum: { workingDays: 3 } })
      .mockResolvedValueOnce({ _sum: { workingDays: 1 } });
    db.employeeLeaveBalance.findFirst.mockResolvedValue({ id: 'bal-1' });

    const first = await recomputeBalances('emp-1', 'lt-1', 2026);
    const second = await recomputeBalances('emp-1', 'lt-1', 2026);

    expect(first).toEqual(second);
    expect(db.employeeLeaveBalance.update).toHaveBeenCalledTimes(2);
    expect(db.employeeLeaveBalance.update).toHaveBeenLastCalledWith({
      where: { id: 'bal-1' },
      data: { usedDays: 3, pendingDays: 1 },
    });
    expect(db.employeeLeaveBalance.create).not.toHaveBeenCalled();
  });

  it('creates the balance row when missing', async () => {
    db.leaveRequest.aggregate
      .mockResolvedValueOnce({ _sum: { workingDays: 0 } })
      .mockResolvedValueOnce({ _sum: { workingDays: 0 } });
    db.employeeLeaveBalance.findFirst.mockResolvedValue(null);

    await recomputeBalances('emp-1', 'lt-1', 2026);
    expect(db.employeeLeaveBalance.create).toHaveBeenCalledWith({
      data: { employeeId: 'emp-1', leaveTypeId: 'lt-1', leaveYear: 2026, usedDays: 0, pendingDays: 0 },
    });
  });
});
