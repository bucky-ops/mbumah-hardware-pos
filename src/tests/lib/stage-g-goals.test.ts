import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { computePosGoalValue, createGoal, listGoals, recomputeGoal, updateGoal } from '@/lib/hr/goal-service';

/**
 * Phase 4.7 contracts (v2.19.0): POS-sourced goals are COMPUTED from
 * SalesTransaction (never typed), Decimal-only money math, and the
 * ACHIEVED / MISSED auto-status rules.
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
  });
  return {
    goal: model(),
    reviewCycle: model(),
    employee: model(),
    salesTransaction: { ...model(), aggregate: vi.fn(), count: vi.fn() },
  };
});

const hrAudit = vi.hoisted(() => vi.fn().mockResolvedValue('audit-id'));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { GOAL: 'Goal', REVIEW_CYCLE: 'ReviewCycle' },
}));

const session = {
  userId: 'user-1',
  email: 'hr@mbumah.co.ke',
  role: 'HR_MANAGER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as const;

const employee = { id: 'emp-1', storeId: 'store-1', userId: 'user-emp', firstName: 'Asha', lastName: 'Kimani' };

describe('POS goal computation', () => {
  const baseGoal = {
    id: 'goal-1',
    employeeId: 'emp-1',
    cycleId: null,
    title: 'Monthly sales',
    metricSource: 'SALES_TOTAL',
    metricConfig: null,
    targetValue: new Prisma.Decimal(100000),
    currentValue: Prisma.Decimal.ZERO,
    status: 'OPEN',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    dueDate: new Date('2026-06-30T00:00:00Z'),
    updatedAt: new Date(),
    deletedAt: null,
    employee: { id: 'emp-1', storeId: 'store-1', userId: 'user-emp', firstName: 'Asha', lastName: 'Kimani' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.goal.findFirst.mockResolvedValue(baseGoal);
    db.employee.findUnique.mockResolvedValue(employee);
  });

  it('sums completed SALE transaction totals for SALES_TOTAL goals', async () => {
    db.salesTransaction.aggregate.mockResolvedValue({
      _sum: { totalAmount: new Prisma.Decimal('145250.75') },
    });
    db.goal.update.mockResolvedValue({ ...baseGoal, currentValue: new Prisma.Decimal('145250.75'), status: 'ACHIEVED' });

    const dto = await recomputeGoal('goal-1', session);
    const where = db.salesTransaction.aggregate.mock.calls[0][0].where;
    expect(where.cashierId).toBe('user-emp');
    expect(where.storeId).toBe('store-1');
    expect(where.paymentStatus).toBe('COMPLETED');
    expect(where.transactionType).toBe('SALE');
    expect(dto.status).toBe('ACHIEVED');
    expect(dto.currentValue).toBe('145250.75');
    expect(dto.progressPct).toBe(100);
  });

  it('counts transactions for SALES_COUNT goals', async () => {
    const goal = { ...baseGoal, metricSource: 'SALES_COUNT', targetValue: new Prisma.Decimal(50) };
    db.goal.findFirst.mockResolvedValue(goal);
    db.salesTransaction.count.mockResolvedValue(50);
    db.goal.update.mockResolvedValue({ ...goal, currentValue: new Prisma.Decimal(50), status: 'ACHIEVED' });

    const dto = await recomputeGoal('goal-1', session);
    expect(db.salesTransaction.count).toHaveBeenCalled();
    expect(dto.status).toBe('ACHIEVED');
  });

  it('marks a goal MISSED once the window passes without achievement', async () => {
    const goal = { ...baseGoal, dueDate: new Date(Date.now() - 86400000) };
    db.goal.findFirst.mockResolvedValue(goal);
    db.salesTransaction.aggregate.mockResolvedValue({ _sum: { totalAmount: new Prisma.Decimal(25000) } });
    db.goal.update.mockResolvedValue({ ...goal, currentValue: new Prisma.Decimal(25000), status: 'MISSED' });

    const dto = await recomputeGoal('goal-1', session);
    expect(dto.status).toBe('MISSED');
  });

  it('treats employees without a linked user account as zero POS activity', async () => {
    const goal = { ...baseGoal, employee: { ...baseGoal.employee, userId: null } };
    db.goal.findFirst.mockResolvedValue(goal);
    const value = await computePosGoalValue(goal);
    expect(value.toNumber()).toBe(0);
    expect(db.salesTransaction.aggregate).not.toHaveBeenCalled();
  });

  it('honours metricConfig period overrides over createdAt/dueDate', async () => {
    const goal = {
      ...baseGoal,
      metricConfig: JSON.stringify({ periodStart: '2026-03-01T00:00:00.000Z', periodEnd: '2026-03-31T00:00:00.000Z' }),
    };
    await computePosGoalValue(goal);
    const where = db.salesTransaction.aggregate.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(where.createdAt.lte).toEqual(new Date('2026-03-31T00:00:00.000Z'));
  });
});

describe('goal mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.employee.findFirst.mockResolvedValue(employee);
  });

  it('rejects typed values for POS-sourced goals (computed, not typed)', async () => {
    db.goal.findFirst.mockResolvedValue({
      id: 'goal-1',
      employeeId: 'emp-1',
      cycleId: null,
      title: 'Sales',
      metricSource: 'SALES_TOTAL',
      metricConfig: null,
      targetValue: new Prisma.Decimal(100000),
      currentValue: Prisma.Decimal.ZERO,
      status: 'OPEN',
      createdAt: new Date(),
      dueDate: null,
      updatedAt: new Date(),
      deletedAt: null,
      employee,
    });
    await expect(updateGoal('goal-1', { currentValue: '999' }, session)).rejects.toMatchObject({
      code: 'POS_GOAL_READONLY',
      status: 409,
    });
  });

  it('allows MANUAL goals to update their current value', async () => {
    const goal = {
      id: 'goal-2',
      employeeId: 'emp-1',
      cycleId: null,
      title: 'Complete training',
      metricSource: 'MANUAL',
      metricConfig: null,
      targetValue: new Prisma.Decimal(4),
      currentValue: Prisma.Decimal.ZERO,
      status: 'OPEN',
      createdAt: new Date(),
      dueDate: null,
      updatedAt: new Date(),
      deletedAt: null,
      employee,
    };
    db.goal.findFirst.mockResolvedValue(goal);
    db.goal.update.mockResolvedValue({ ...goal, currentValue: new Prisma.Decimal(2) });

    const dto = await updateGoal('goal-2', { currentValue: '2' }, session);
    expect(dto.currentValue).toBe('2.00');
  });

  it('computes the first value immediately when a POS goal is created', async () => {
    db.goal.create.mockResolvedValue({
      id: 'goal-3',
      employeeId: 'emp-1',
      cycleId: null,
      title: 'Q3 sales',
      metricSource: 'SALES_TOTAL',
      metricConfig: null,
      targetValue: new Prisma.Decimal(50000),
      currentValue: Prisma.Decimal.ZERO,
      status: 'OPEN',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      dueDate: null,
      updatedAt: new Date(),
      deletedAt: null,
    });
    db.salesTransaction.aggregate.mockResolvedValue({ _sum: { totalAmount: new Prisma.Decimal(60000) } });
    db.goal.update.mockResolvedValue({ currentValue: new Prisma.Decimal(60000), status: 'ACHIEVED' });
    db.goal.findFirst.mockResolvedValue(null); // duplicate name check n/a

    const dto = await createGoal(
      { employeeId: 'emp-1', title: 'Q3 sales', metricSource: 'SALES_TOTAL', targetValue: '50000' },
      session,
    );
    expect(db.goal.update).toHaveBeenCalled();
    expect(dto.id).toBe('goal-3');
  });

  it('rejects negative targets and invalid sources', async () => {
    await expect(
      createGoal({ employeeId: 'emp-1', title: 'Bad goal', metricSource: 'SALES_TOTAL', targetValue: '-5' }, session),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(
      createGoal({ employeeId: 'emp-1', title: 'Bad goal', metricSource: 'MAGIC', targetValue: '5' }, session),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
  });

  it('scopes goal lists to the session branch', async () => {
    db.goal.findMany.mockResolvedValue([]);
    await listGoals(session, { status: 'OPEN' });
    const where = db.goal.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(JSON.stringify(where.employee)).toContain('store-1');
  });
});
