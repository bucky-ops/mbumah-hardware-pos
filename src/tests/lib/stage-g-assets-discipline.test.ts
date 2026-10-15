import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listAssets, updateAsset } from '@/lib/hr/asset-service';
import { listCases, openCase, sweepExpiredCases, updateCase } from '@/lib/hr/discipline-service';

/**
 * Phase 4.7 contracts (v2.19.0): authorization-gated asset recovery
 * (LOST/DAMAGED need a named, eligible, non-self authorizer), disciplinary
 * warning expiry, and grievance confidentiality (description never in lists;
 * RESTRICTED detail is role-gated).
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
  });
  return {
    assetAssignment: model(),
    disciplinaryCase: model(),
    employee: model(),
    user: model(),
  };
});

const hrAudit = vi.hoisted(() => vi.fn().mockResolvedValue('audit-id'));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { ASSET_ASSIGNMENT: 'AssetAssignment', DISCIPLINARY_CASE: 'DisciplinaryCase' },
}));

const session = {
  userId: 'user-1',
  email: 'hr@mbumah.co.ke',
  role: 'HR_MANAGER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as const;

const employee = { id: 'emp-1', storeId: 'store-1', userId: null, firstName: 'Asha', lastName: 'Kimani' };

describe('asset recovery authorization', () => {
  const assigned = {
    id: 'asset-1',
    employeeId: 'emp-1',
    storeId: 'store-1',
    assetName: 'Barcode scanner',
    assetTag: 'MBM-AST-014',
    serialNumber: 'SN-1',
    assignedOn: new Date('2026-01-10'),
    dueReturnOn: null,
    returnedOn: null,
    conditionOut: 'New',
    conditionIn: null,
    recoveryAuthorizedByUserId: null,
    status: 'ASSIGNED',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    employee,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.assetAssignment.findFirst.mockResolvedValue(assigned);
    db.employee.findUnique.mockResolvedValue(employee);
  });

  it('records a plain RETURN with conditionIn and no authorizer', async () => {
    db.assetAssignment.update.mockResolvedValue({ ...assigned, status: 'RETURNED', conditionIn: 'Good', returnedOn: new Date() });

    const dto = await updateAsset('asset-1', { status: 'RETURNED', conditionIn: 'Good' }, session);
    expect(dto.status).toBe('RETURNED');
    expect(db.assetAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RETURNED', conditionIn: 'Good' }) }),
    );
  });

  it('blocks RETURN without a condition record', async () => {
    await expect(updateAsset('asset-1', { status: 'RETURNED' }, session)).rejects.toMatchObject({
      code: 'CONDITION_REQUIRED',
    });
  });

  it('refuses LOST without a named recovery authorizer', async () => {
    await expect(updateAsset('asset-1', { status: 'LOST', notes: 'Dropped in yard' }, session)).rejects.toMatchObject({
      code: 'RECOVERY_NOT_AUTHORIZED',
      status: 403,
    });
  });

  it('refuses self-authorization for LOST/DAMAGED', async () => {
    await expect(
      updateAsset('asset-1', { status: 'DAMAGED', recoveryAuthorizedByUserId: 'user-1', notes: 'Screen cracked' }, session),
    ).rejects.toMatchObject({ code: 'RECOVERY_SELF_AUTHORIZATION', status: 403 });
  });

  it('refuses authorizers who are not active asset-manage holders', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'user-2', isActive: false, role: 'CASHIER' });
    await expect(
      updateAsset('asset-1', { status: 'LOST', recoveryAuthorizedByUserId: 'user-2', notes: 'Gone' }, session),
    ).rejects.toMatchObject({ code: 'RECOVERY_AUTHORIZER_INVALID' });

    db.user.findUnique.mockResolvedValue(null);
    await expect(
      updateAsset('asset-1', { status: 'LOST', recoveryAuthorizedByUserId: 'ghost', notes: 'Gone' }, session),
    ).rejects.toMatchObject({ code: 'RECOVERY_AUTHORIZER_INVALID' });
  });

  it('accepts a valid distinct authorizer and stamps the row', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'user-2', isActive: true, role: 'STORE_OWNER' });
    db.assetAssignment.update.mockResolvedValue({
      ...assigned,
      status: 'LOST',
      recoveryAuthorizedByUserId: 'user-2',
      notes: 'Cannot locate after stock take',
      returnedOn: new Date(),
    });

    const dto = await updateAsset(
      'asset-1',
      { status: 'LOST', recoveryAuthorizedByUserId: 'user-2', notes: 'Cannot locate after stock take' },
      session,
    );
    expect(dto.status).toBe('LOST');
    expect(db.assetAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recoveryAuthorizedByUserId: 'user-2', status: 'LOST' }),
      }),
    );
  });

  it('blocks transitions on already-closed assignments', async () => {
    db.assetAssignment.findFirst.mockResolvedValue({ ...assigned, status: 'RETURNED' });
    await expect(updateAsset('asset-1', { status: 'LOST', notes: 'x' }, session)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('marks overdue ASSIGNED assets in list payloads', async () => {
    db.assetAssignment.findMany.mockResolvedValue([
      { ...assigned, dueReturnOn: new Date(Date.now() - 86400000) },
      { ...assigned, id: 'asset-2', dueReturnOn: new Date(Date.now() + 86400000) },
    ]);
    const list = await listAssets(session);
    expect(list[0].overdue).toBe(true);
    expect(list[1].overdue).toBe(false);
  });
});

describe('disciplinary cases', () => {
  const warning = {
    id: 'case-1',
    employeeId: 'emp-1',
    storeId: 'store-1',
    type: 'WARNING',
    severity: 2,
    description: 'Late three times in one week without notice.',
    status: 'OPEN',
    issuedOn: new Date('2026-05-01'),
    expiresOn: new Date(Date.now() - 86400000), // already past
    resolutionNotes: null,
    confidentiality: 'STANDARD',
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    employee,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.disciplinaryCase.findFirst.mockResolvedValue(warning);
    db.employee.findUnique.mockResolvedValue(employee);
  });

  it('expires due OPEN warnings via the sweep with one batch audit event', async () => {
    db.disciplinaryCase.updateMany.mockResolvedValue({ count: 3 });

    const expired = await sweepExpiredCases(session);
    expect(expired).toBe(3);
    expect(db.disciplinaryCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN', type: 'WARNING' }),
        data: { status: 'EXPIRED' },
      }),
    );
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISCIPLINARY_WARNINGS_EXPIRED', metadata: expect.objectContaining({ count: 3 }) }),
    );
  });

  it('runs the expiry sweep lazily on list reads', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue([]);
    await listCases(session);
    expect(db.disciplinaryCase.updateMany).toHaveBeenCalled();
  });

  it('never includes descriptions in list payloads', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue([warning]);
    const list = await listCases(session);
    const json = JSON.stringify(list[0]);
    expect(json).not.toContain('Late three times');
  });

  it('gates RESTRICTED grievance detail to HR roles', async () => {
    const grievance = { ...warning, id: 'case-2', type: 'GRIEVANCE', confidentiality: 'RESTRICTED' };
    db.disciplinaryCase.findFirst.mockResolvedValue(grievance);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('@/lib/hr/discipline-service')).getCaseDetail('case-2', { ...session, role: 'BRANCH_MANAGER' } as any),
    ).rejects.toMatchObject({ code: 'CONFIDENTIALITY_RESTRICTED', status: 403 });

    const detail = await import('@/lib/hr/discipline-service').then((m) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      m.getCaseDetail('case-2', session as any),
    );
    expect(detail.description).toContain('Late three times');
  });

  it('defaults grievances to RESTRICTED on open', async () => {
    db.employee.findFirst.mockResolvedValue(employee);
    db.disciplinaryCase.create.mockResolvedValue({
      ...warning,
      type: 'GRIEVANCE',
      confidentiality: 'RESTRICTED',
    });

    await openCase({ employeeId: 'emp-1', type: 'GRIEVANCE', description: 'Pay dispute raised with supervisor.' }, session);
    expect(db.disciplinaryCase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ confidentiality: 'RESTRICTED' }) }),
    );
  });

  it('requires resolution notes on RESOLVE and blocks double-closing', async () => {
    await expect(updateCase('case-1', { action: 'RESOLVE', resolutionNotes: 'ok' }, session)).rejects.toMatchObject({
      code: 'RESOLUTION_REQUIRED',
    });

    db.disciplinaryCase.update.mockResolvedValue({ ...warning, status: 'RESOLVED', resolutionNotes: 'Acknowledged and closed.' });
    const dto = await updateCase('case-1', { action: 'RESOLVE', resolutionNotes: 'Acknowledged and closed.' }, session);
    expect(dto.status).toBe('RESOLVED');

    db.disciplinaryCase.findFirst.mockResolvedValue({ ...warning, status: 'RESOLVED' });
    await expect(updateCase('case-1', { action: 'DISMISS' }, session)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
  });
});
