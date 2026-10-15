import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createErasureRequest,
  executeErasureRequest,
  getLegalHolds,
  HR_RETENTION_POLICIES,
  listErasureRequests,
  rejectErasureRequest,
  runHrRetentionSweep,
} from '@/lib/hr/data-protection';

/**
 * Phase 4.8 contracts (v2.20.0): retention windows per record type, legal
 * hold blocking archival, and erasure handling — honored for non-statutory
 * data, statutory retention recorded with the decision and legal basis.
 */

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn(),
  });
  return {
    hrSetting: model(),
    store: model(),
    applicant: model(),
    disciplinaryCase: model(),
    attendanceRecord: model(),
    erasureRequest: model(),
    employee: model(),
    employeeDocument: model(),
    performanceReview: model(),
    goal: model(),
  };
});

const hrAudit = vi.hoisted(() => vi.fn().mockResolvedValue('audit-id'));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { EMPLOYEE: 'Employee', APPLICANT: 'Applicant', DISCIPLINARY_CASE: 'DisciplinaryCase' },
}));

const admin = {
  userId: 'user-super',
  email: 'admin@mbumah.co.ke',
  role: 'SUPER_ADMIN',
  storeId: null,
  organizationId: 'org-1',
} as const;

describe('retention policies', () => {
  it('defines a documented window for every HR scope (reviewable defaults)', () => {
    expect(HR_RETENTION_POLICIES.length).toBeGreaterThanOrEqual(3);
    for (const policy of HR_RETENTION_POLICIES) {
      expect(policy.scope).toBeTruthy();
      expect(policy.basis).toBeTruthy();
      expect(policy.description).toBeTruthy();
      expect(policy.retentionDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('respects legal holds from HrSetting (legalHold:<scope>=true)', async () => {
    db.hrSetting.findMany.mockResolvedValue([
      { key: 'legalHold:hr_disciplinary_closed', value: 'true' },
      { key: 'legalHold:hr_applicant_rejection_data', value: 'false' },
    ]);
    const holds = await getLegalHolds('org-1');
    expect(holds).toEqual(['hr_disciplinary_closed']);
  });

  it('anonymises expired applicant data and skips held scopes', async () => {
    vi.clearAllMocks();
    db.hrSetting.findMany.mockResolvedValue([{ key: 'legalHold:hr_applicant_rejection_data', value: 'true' }]);
    db.store.findMany.mockResolvedValue([{ id: 'store-1' }]);
    db.disciplinaryCase.findMany.mockResolvedValue([{ id: 'case-1' }]);
    db.attendanceRecord.findMany.mockResolvedValue([]);

    const results = await runHrRetentionSweep('org-1', 'system');
    const applicantScope = results.find((r) => r.scope === 'hr_applicant_rejection_data');
    const disciplineScope = results.find((r) => r.scope === 'hr_disciplinary_closed');

    expect(applicantScope?.held).toBe(true);
    expect(applicantScope?.anonymised).toBe(0);
    expect(db.applicant.findMany).not.toHaveBeenCalled();

    expect(disciplineScope?.held).toBe(false);
    expect(db.disciplinaryCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { description: 'REDACTED (retention)', resolutionNotes: null } }),
    );
    expect(hrAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'RETENTION_DISCIPLINARY_ANONYMISED' }));
  });
});

describe('erasure requests', () => {
  const employee = { id: 'emp-1', storeId: 'store-1', firstName: 'David', lastName: 'Otieno', userId: null };
  const request = {
    id: 'er-1',
    organizationId: 'org-1',
    employeeId: 'emp-1',
    status: 'PENDING',
    deletedAt: null,
    employee,
  };

  beforeEach(() => vi.clearAllMocks());

  it('executes: erases non-statutory fields, records decision + legal basis', async () => {
    db.erasureRequest.findFirst.mockResolvedValue(request);
    db.employeeDocument.findMany.mockResolvedValue([{ id: 'doc-1', fileUrl: 's3://x' }]);
    db.erasureRequest.update.mockResolvedValue({ ...request, status: 'PARTIALLY_EXECUTED', retentionApplies: true });
    db.employee.update.mockResolvedValue(employee);

    const result = await executeErasureRequest('er-1', admin, 'Non-statutory data erased.');
    expect(result.status).toBe('PARTIALLY_EXECUTED');
    expect(result.retentionApplies).toBe(true);
    expect(db.employeeDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fileUrl: null, notes: null }) }),
    );
    expect(db.performanceReview.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1' },
      data: { strengths: 'REDACTED (erasure)', improvements: 'REDACTED (erasure)' },
    });
    expect(db.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: null, phone: null, photoUrl: null }) }),
    );
    expect(db.erasureRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ legalBasis: expect.stringContaining('statutory retention') }),
      }),
    );
    expect(hrAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ERASURE_REQUEST_EXECUTED' }));
  });

  it('blocks double decisions', async () => {
    db.erasureRequest.findFirst.mockResolvedValue({ ...request, status: 'EXECUTED' });
    await expect(executeErasureRequest('er-1', admin, 'x')).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  it('requires reason + legal basis on rejection', async () => {
    db.erasureRequest.findFirst.mockResolvedValue(request);
    await expect(rejectErasureRequest('er-1', admin, 'short', 'basis')).rejects.toMatchObject({ code: 'DECISION_REQUIRED' });
    await expect(rejectErasureRequest('er-1', admin, 'A valid long reason', '')).rejects.toMatchObject({
      code: 'LEGAL_BASIS_REQUIRED',
    });
    db.erasureRequest.update.mockResolvedValue({ ...request, status: 'REJECTED' });
    const result = await rejectErasureRequest('er-1', admin, 'Payroll audit ongoing this year', 'TAX_PROCEDURES_ACT');
    expect(result.status).toBe('REJECTED');
    expect(hrAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ERASURE_REQUEST_REJECTED' }));
  });

  it('blocks a second PENDING request for the same employee', async () => {
    db.employee.findFirst.mockResolvedValue(employee);
    db.erasureRequest.findFirst.mockResolvedValueOnce({ id: 'er-0' }); // pending duplicate check
    await expect(createErasureRequest({ employeeId: 'emp-1' }, admin)).rejects.toMatchObject({
      code: 'REQUEST_PENDING',
    });
  });

  it('lists requests scoped with employeeCode (no raw ids)', async () => {
    db.erasureRequest.findMany.mockResolvedValue([
      {
        id: 'er-1',
        status: 'PENDING',
        decision: null,
        legalBasis: null,
        retentionApplies: false,
        createdAt: new Date('2026-10-15'),
        executedAt: null,
        employee: { employeeCode: 'MBM-JUJ-E001', firstName: 'David', lastName: 'Otieno' },
      },
    ]);
    const rows = (await listErasureRequests(admin)) as Array<Record<string, unknown>>;
    expect(rows[0].employeeCode).toBe('MBM-JUJ-E001');
    expect(rows[0].employeeName).toBe('David Otieno');
  });
});
