import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMyPayslip,
  listMyAttendance,
  listMyDocuments,
  listMyLeave,
  listMyPayslips,
  requestMyLeave,
  resolveSelfEmployee,
  selfServiceGuard,
} from '@/lib/hr/self-service';
import { StageGError } from '@/lib/hr/stage-g-shared';

/**
 * Phase 4.7 contracts (v2.19.0): the self-service portal resolves the
 * Employee row through the signed-in User, ignores client-supplied identity
 * parameters entirely (cross-employee denial by construction), and serves
 * masked statutory ids unless the caller holds the unmask permission.
 */

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  });
  return {
    employee: model(),
    payrollDetail: model(),
    payrollRun: model(),
    employeeLeaveBalance: model(),
    leaveRequest: model(),
    leaveType: model(),
    attendanceRecord: model(),
    employeeDocument: model(),
    hrSetting: model(),
    salesTransaction: model(),
    goal: model(),
    performanceReview: model(),
    reviewCycle: model(),
  };
});

const hrAudit = vi.hoisted(() => vi.fn().mockResolvedValue('audit-id'));
const getSessionFromRequest = vi.hoisted(() => vi.fn());
const recordPermissionDenied = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const isHrModuleEnabled = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const requestLeaveMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/auth', () => ({ getSessionFromRequest, recordPermissionDenied }));
vi.mock('@/lib/hr/feature-flag', () => ({ isHrModuleEnabled }));
vi.mock('@/lib/hr/leave-service', () => ({ requestLeave: requestLeaveMock }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { EMPLOYEE: 'Employee', GOAL: 'Goal', PERFORMANCE_REVIEW: 'PerformanceReview' },
}));

const session = {
  userId: 'user-emp',
  email: 'asha@mbumah.co.ke',
  role: 'CASHIER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as const;

const selfEmployee = {
  id: 'emp-1',
  storeId: 'store-1',
  firstName: 'Asha',
  lastName: 'Kimani',
  employeeCode: 'MBM-JUJ-E001',
  jobTitle: 'Cashier',
  role: 'STAFF',
  employmentType: 'PERMANENT',
  status: 'ACTIVE',
  hireDate: new Date('2024-03-01'),
  photoUrl: null,
};

describe('guard composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isHrModuleEnabled.mockResolvedValue(true);
  });

  it('401s without a session', async () => {
    getSessionFromRequest.mockResolvedValue(null);
    const handler = vi.fn();
    const guarded = selfServiceGuard('hr.payroll.read.own')(handler);
    const res = await guarded(new Request('http://x/api/self-service/me') as never);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('403s with NO_EMPLOYEE_PROFILE when no Employee is linked', async () => {
    getSessionFromRequest.mockResolvedValue(session);
    db.employee.findFirst.mockResolvedValue(null);
    const handler = vi.fn();
    const guarded = selfServiceGuard('hr.payroll.read.own')(handler);
    const res = await guarded(new Request('http://x/api/self-service/me') as never);
    const json = (await res.json()) as { code: string };
    expect(res.status).toBe(403);
    expect(json.code).toBe('NO_EMPLOYEE_PROFILE');
    expect(handler).not.toHaveBeenCalled();
  });

  it('denies and logs when the hr permission is missing', async () => {
    getSessionFromRequest.mockResolvedValue({ ...session, role: 'EMPLOYEE' });
    db.employee.findFirst.mockResolvedValue(selfEmployee);
    const handler = vi.fn();
    const guarded = selfServiceGuard('hr.discipline.manage' as never)(handler);
    const res = await guarded(new Request('http://x/api/self-service/me') as never);
    expect(res.status).toBe(403);
    expect(recordPermissionDenied).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes the resolved employee to the handler', async () => {
    getSessionFromRequest.mockResolvedValue(session);
    db.employee.findFirst.mockResolvedValue(selfEmployee);
    const handler = vi.fn().mockResolvedValue(new Response('{}'));
    const guarded = selfServiceGuard('hr.payroll.read.own')(handler);
    await guarded(new Request('http://x/api/self-service/me') as never);
    expect(handler).toHaveBeenCalledWith(expect.anything(), session, selfEmployee, undefined);
  });
});

describe('own-data scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.employee.findFirst.mockResolvedValue(selfEmployee);
  });

  it('resolveSelfEmployee matches on the session userId only', async () => {
    await resolveSelfEmployee(session);
    expect(db.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-emp', deletedAt: null } }),
    );
  });

  it('listMyPayslips hard-scopes to the self employee id', async () => {
    db.payrollDetail.findMany.mockResolvedValue([]);
    await listMyPayslips(selfEmployee, 2026);
    expect(db.payrollDetail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId: 'emp-1' }) }),
    );
  });

  it('getMyPayslip 404s for any payslip not owned by the caller', async () => {
    db.payrollDetail.findFirst.mockResolvedValue(null);
    const result = await getMyPayslip(selfEmployee, 'someone-elses', false);
    expect(result).toBeNull();
  });

  it('masks statutory ids without the unmask permission and omits them with it', async () => {
    db.payrollDetail.findFirst.mockResolvedValue({
      id: 'ps-1',
      createdAt: new Date(),
      payslipIssuedAt: null,
      payslipNumber: 'PS-1',
      basicSalary: 20000,
      grossPay: 25000,
      totalDeductions: 5000,
      netPay: 20000,
      deductionsBreakdown: null,
      daysWorked: 22,
      daysPresent: 20,
      daysAbsent: 1,
      daysOnLeave: 1,
      overtimeHours: 0,
      payrollRun: {
        status: 'POSTED',
        runType: 'STANDARD',
        payrollPeriod: { name: 'June 2026', startDate: new Date(), endDate: new Date() },
      },
    });

    const masked = (await getMyPayslip(selfEmployee, 'ps-1', false)) as { statutoryIds: Record<string, string> };
    expect(Object.values(masked.statutoryIds ?? {})).toContain('[REDACTED]');

    const unmasked = (await getMyPayslip(selfEmployee, 'ps-1', true)) as { statutoryIds: Record<string, string> | null };
    expect(unmasked.statutoryIds).toBeNull();
  });

  it('listMyLeave and listMyDocuments never leak other employees or HR notes', async () => {
    db.employeeLeaveBalance.findMany.mockResolvedValue([]);
    db.leaveRequest.findMany.mockResolvedValue([]);
    db.employeeDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        type: 'CONTRACT',
        fileName: 'contract.pdf',
        verificationStatus: 'VERIFIED',
        issueDate: new Date(),
        expiryDate: null,
        fileUrl: 's3://x',
        notes: 'HR internal note',
        createdAt: new Date(),
      },
    ]);

    const leave = await listMyLeave(selfEmployee);
    expect(leave.requests).toHaveLength(0);
    expect(db.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'emp-1' } }),
    );

    const docs = (await listMyDocuments(selfEmployee)) as Array<Record<string, unknown>>;
    const json = JSON.stringify(docs);
    expect(json).not.toContain('HR internal note');
    expect(docs[0].hasFile).toBe(true);
  });

  it('listMyAttendance aggregates only the caller rows', async () => {
    db.attendanceRecord.findMany.mockResolvedValue([]);
    db.attendanceRecord.groupBy.mockResolvedValue([]);
    const data = await listMyAttendance(selfEmployee, { limit: 10 });
    expect(db.attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'emp-1' } }),
    );
    expect(data.summary.monthHours).toBe('0.0');
  });
});

describe('self-service leave requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.employee.findFirst.mockResolvedValue(selfEmployee);
  });

  it('forces employeeId/storeId to the session employee (client values ignored)', async () => {
    requestLeaveMock.mockResolvedValue({
      id: 'lr-1',
      status: 'PENDING',
      startDate: new Date('2026-07-06'),
      endDate: new Date('2026-07-07'),
      workingDays: 2,
    });

    const result = await requestMyLeave(
      selfEmployee,
      session,
      { leaveTypeId: 'lt-annual', startDate: '2026-07-06', endDate: '2026-07-07' },
    );

    expect(requestLeaveMock).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-1', storeId: 'store-1', actorId: 'user-emp' }),
    );
    expect(result.status).toBe('PENDING');
  });

  it('rejects missing leave type with a 400', async () => {
    await expect(requestMyLeave(selfEmployee, session, {})).rejects.toMatchObject({
      code: 'LEAVE_TYPE_REQUIRED',
      status: 400,
    });
  });

  it('maps leave-service rejection codes onto safe JSON errors', async () => {
    requestLeaveMock.mockRejectedValue(new Error('INSUFFICIENT_LEAVE_BALANCE: requested 3 day(s), available 1.'));
    await expect(
      requestMyLeave(selfEmployee, session, { leaveTypeId: 'lt-annual', startDate: '2026-07-06', endDate: '2026-07-08' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_LEAVE_BALANCE' });

    requestLeaveMock.mockRejectedValue(new Error('totally unexpected'));
    await expect(
      requestMyLeave(selfEmployee, session, { leaveTypeId: 'lt-annual', startDate: '2026-07-06', endDate: '2026-07-08' }),
    ).rejects.not.toBeInstanceOf(StageGError); // bubbles to the 500 mapper
  });
});
