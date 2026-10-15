// MBUMAH HARDWARE POS - HR goal service (v2.19.0, spec Phase 4.7)
//
// Acceptance rule 2: "Goals sourced from POS data are computed, not typed."
// SALES_TOTAL / SALES_COUNT goals aggregate SalesTransaction rows through the
// employee's linked User account (cashierId) — the value is never hand-typed.
// All money math runs on Prisma.Decimal (no floats anywhere in the pipeline).

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import {
  StageGError,
  employeeScopeWhere,
  employeeInScope,
  parseMetricConfig,
  decimalToMoney,
  toDecimal,
} from './stage-g-shared';
import type { AuthSession } from '@/lib/auth';

export const GOAL_SOURCES = ['MANUAL', 'SALES_TOTAL', 'SALES_COUNT', 'CUSTOM'] as const;
export const GOAL_STATUSES = ['OPEN', 'ACHIEVED', 'MISSED', 'CLOSED'] as const;

type Session = AuthSession;

export interface GoalDto {
  id: string;
  employeeId: string;
  employeeName: string | null;
  cycleId: string | null;
  title: string;
  metricSource: string;
  targetValue: string;
  currentValue: string;
  progressPct: number;
  status: string;
  dueDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  updatedAt: string;
}

interface GoalRow {
  id: string;
  employeeId: string;
  cycleId: string | null;
  title: string;
  metricSource: string;
  metricConfig: string | null;
  targetValue: Prisma.Decimal | null;
  currentValue: Prisma.Decimal | null;
  status: string;
  createdAt: Date;
  dueDate: Date | null;
  updatedAt: Date;
  employee?: { firstName: string; lastName: string };
}

function goalWindow(goal: {
  metricConfig: string | null;
  createdAt: Date;
  dueDate: Date | null;
}): { start: Date; end: Date } {
  const cfg = parseMetricConfig(goal.metricConfig);
  const start = cfg.periodStart ? new Date(String(cfg.periodStart)) : goal.createdAt;
  const endCandidate = cfg.periodEnd ? new Date(String(cfg.periodEnd)) : goal.dueDate;
  const end = endCandidate && !Number.isNaN(endCandidate.getTime()) ? endCandidate : new Date();
  return {
    start: Number.isNaN(start.getTime()) ? goal.createdAt : start,
    end,
  };
}

function progressPct(current: Prisma.Decimal, target: Prisma.Decimal): number {
  if (target.lte(new Prisma.Decimal(0))) return 0;
  const pct = current.div(target).mul(100).toDecimalPlaces(1).toNumber();
  return Math.max(0, Math.min(100, pct));
}

function toDto(goal: GoalRow, employeeName: string | null): GoalDto {
  const current = goal.currentValue ?? new Prisma.Decimal(0);
  const target = goal.targetValue ?? new Prisma.Decimal(0);
  const window = goalWindow(goal);
  return {
    id: goal.id,
    employeeId: goal.employeeId,
    employeeName,
    cycleId: goal.cycleId ?? null,
    title: goal.title,
    metricSource: goal.metricSource,
    targetValue: target.toFixed(2),
    currentValue: current.toFixed(2),
    progressPct: progressPct(current, target),
    status: goal.status,
    dueDate: goal.dueDate ? goal.dueDate.toISOString() : null,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

async function loadGoal(goalId: string, session: Session) {
  const goal = await db.goal.findFirst({
    where: { id: goalId, deletedAt: null },
    include: {
      employee: {
        select: { id: true, storeId: true, firstName: true, lastName: true, userId: true },
      },
    },
  });
  if (!goal || !employeeInScope(goal.employee, session)) {
    throw new StageGError('GOAL_NOT_FOUND', 'Goal not found in your scope.', 404);
  }
  return goal;
}

async function employeeNameFor(employeeId: string): Promise<string | null> {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { firstName: true, lastName: true },
  });
  return e ? `${e.firstName} ${e.lastName}` : null;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function listGoals(
  session: Session,
  filters: { employeeId?: string; cycleId?: string; status?: string } = {},
): Promise<GoalDto[]> {
  const goals = await db.goal.findMany({
    where: {
      deletedAt: null,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.cycleId ? { cycleId: filters.cycleId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      employee: employeeScopeWhere(session),
    },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: 200,
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  return goals.map((g) => toDto(g, `${g.employee.firstName} ${g.employee.lastName}`));
}

// ── POS computation (spec acceptance rule 2) ────────────────────────────────

/**
 * Aggregate the POS figure for a POS-sourced goal. SALES_TOTAL sums
 * completed SALE transaction totals; SALES_COUNT counts them. Both resolve
 * the seller through Employee.userId (cashierId). Employees without a linked
 * user account have no POS activity by definition -> 0.
 */
export async function computePosGoalValue(
  goal: {
    metricSource: string;
    metricConfig: string | null;
    createdAt: Date;
    dueDate: Date | null;
    employee: { userId: string | null; storeId: string };
  },
): Promise<Prisma.Decimal> {
  if (goal.metricSource !== 'SALES_TOTAL' && goal.metricSource !== 'SALES_COUNT') {
    throw new StageGError('NOT_POS_SOURCED', 'Only SALES_TOTAL and SALES_COUNT goals are computed.', 400);
  }
  if (!goal.employee.userId) return new Prisma.Decimal(0);

  const window = goalWindow(goal);
  const where: Prisma.SalesTransactionWhereInput = {
    cashierId: goal.employee.userId,
    storeId: goal.employee.storeId,
    paymentStatus: 'COMPLETED',
    transactionType: 'SALE',
    createdAt: { gte: window.start, lte: window.end },
  };

  if (goal.metricSource === 'SALES_COUNT') {
    const count = await db.salesTransaction.count({ where });
    return new Prisma.Decimal(count);
  }
  const agg = await db.salesTransaction.aggregate({ where, _sum: { totalAmount: true } });
  return agg._sum.totalAmount ?? new Prisma.Decimal(0);
}

/**
 * Recompute a POS-sourced goal, persist the value, and auto-flip status:
 * ACHIEVED when currentValue >= targetValue (target > 0); MISSED when the
 * window has ended without achievement. MANUAL goals are untouched here.
 */
export async function recomputeGoal(goalId: string, session: Session): Promise<GoalDto> {
  const goal = await loadGoal(goalId, session);
  if (goal.metricSource !== 'SALES_TOTAL' && goal.metricSource !== 'SALES_COUNT') {
    throw new StageGError('NOT_POS_SOURCED', 'Only POS-sourced goals can be recomputed.', 400);
  }

  const value = await computePosGoalValue(goal);
  const target = goal.targetValue ?? new Prisma.Decimal(0);
  let status = goal.status;
  if (goal.status !== 'CLOSED') {
    if (target.gt(0) && value.gte(target)) status = 'ACHIEVED';
    else if (goal.dueDate && goal.dueDate.getTime() < Date.now()) status = 'MISSED';
    else status = 'OPEN';
  }

  const updated = await db.goal.update({
    where: { id: goalId },
    data: { currentValue: value, status },
  });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'GOAL_RECOMPUTED',
    resourceType: HrEntityType.GOAL,
    resourceId: goalId,
    storeId: session.storeId,
    metadata: { metricSource: goal.metricSource, status },
  });

  return toDto(
    { ...goal, currentValue: updated.currentValue, status: updated.status, updatedAt: updated.updatedAt },
    await employeeNameFor(goal.employeeId),
  );
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createGoal(
  input: {
    employeeId?: unknown;
    cycleId?: unknown;
    title?: unknown;
    metricSource?: unknown;
    metricConfig?: unknown;
    targetValue?: unknown;
    dueDate?: unknown;
  },
  session: Session,
): Promise<GoalDto> {
  const title = String(input.title ?? '').trim();
  if (title.length < 3 || title.length > 160) {
    throw new StageGError('INVALID_TITLE', 'Goal title must be between 3 and 160 characters.', 400);
  }
  const metricSource = String(input.metricSource ?? 'MANUAL').toUpperCase();
  if (!(GOAL_SOURCES as readonly string[]).includes(metricSource)) {
    throw new StageGError('INVALID_SOURCE', `metricSource must be one of ${GOAL_SOURCES.join(', ')}.`, 400);
  }

  const employee = await db.employee.findFirst({
    where: { id: String(input.employeeId ?? ''), deletedAt: null, AND: [employeeScopeWhere(session)] },
    select: { id: true, storeId: true, userId: true },
  });
  if (!employee || !employeeInScope(employee, session)) {
    throw new StageGError('EMPLOYEE_NOT_FOUND', 'Employee not found in your scope.', 404);
  }

  let cycleId: string | null = null;
  if (input.cycleId) {
    const cycle = await db.reviewCycle.findFirst({
      where: { id: String(input.cycleId), deletedAt: null, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!cycle) throw new StageGError('CYCLE_NOT_FOUND', 'Review cycle not found.', 404);
    cycleId = cycle.id;
  }

  let metricConfig: string | null = null;
  if (input.metricConfig !== undefined && input.metricConfig !== null && input.metricConfig !== '') {
    if (typeof input.metricConfig !== 'object') {
      throw new StageGError('INVALID_METRIC_CONFIG', 'metricConfig must be an object.', 400);
    }
    // Persisted as JSON string for SQLite parity (schema convention).
    metricConfig = JSON.stringify(input.metricConfig);
  }

  const target = toDecimal(input.targetValue ?? 0);
  if (target.lt(0)) {
    throw new StageGError('INVALID_TARGET', 'Target value cannot be negative.', 400);
  }

  const dueDate =
    input.dueDate ? new Date(String(input.dueDate)) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    throw new StageGError('INVALID_DATE', 'dueDate must be a valid ISO date.', 400);
  }

  const goal = await db.goal.create({
    data: {
      employeeId: employee.id,
      cycleId,
      title,
      metricSource,
      metricConfig,
      targetValue: target,
      currentValue: new Prisma.Decimal(0),
      status: 'OPEN',
      dueDate,
    },
  });

  // POS-sourced goals get their first computation immediately.
  if (metricSource === 'SALES_TOTAL' || metricSource === 'SALES_COUNT') {
    const value = await computePosGoalValue({
      metricSource,
      metricConfig,
      createdAt: goal.createdAt,
      dueDate,
      employee: { userId: employee.userId, storeId: employee.storeId },
    });
    const status = target.gt(0) && value.gte(target) ? 'ACHIEVED' : 'OPEN';
    await db.goal.update({ where: { id: goal.id }, data: { currentValue: value, status } });
  }

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'GOAL_CREATED',
    resourceType: HrEntityType.GOAL,
    resourceId: goal.id,
    storeId: session.storeId,
    metadata: { metricSource, fields: ['title', 'targetValue', 'dueDate'] },
  });

  return toDto({ ...goal, currentValue: new Prisma.Decimal(0) }, await employeeNameFor(employee.id));
}

export interface GoalUpdateInput {
  title?: unknown;
  targetValue?: unknown;
  dueDate?: unknown;
  status?: unknown; // OPEN | CLOSED (manual close/reopen)
  currentValue?: unknown; // MANUAL / CUSTOM sources only
}

export async function updateGoal(
  goalId: string,
  input: GoalUpdateInput,
  session: Session,
): Promise<GoalDto> {
  const goal = await loadGoal(goalId, session);
  const isPosSourced = goal.metricSource === 'SALES_TOTAL' || goal.metricSource === 'SALES_COUNT';

  const data: {
    title?: string;
    targetValue?: Prisma.Decimal;
    dueDate?: Date | null;
    status?: string;
    currentValue?: Prisma.Decimal;
  } = {};

  if (typeof input.title === 'string') {
    const title = input.title.trim();
    if (title.length < 3 || title.length > 160) {
      throw new StageGError('INVALID_TITLE', 'Goal title must be between 3 and 160 characters.', 400);
    }
    data.title = title;
  }
  if (input.targetValue !== undefined && input.targetValue !== null && input.targetValue !== '') {
    const target = toDecimal(input.targetValue);
    if (target.lt(0)) throw new StageGError('INVALID_TARGET', 'Target value cannot be negative.', 400);
    data.targetValue = target;
  }
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate === null || input.dueDate === '' ? null : new Date(String(input.dueDate));
  }
  if (input.status !== undefined && input.status !== '') {
    const status = String(input.status).toUpperCase();
    if (status !== 'OPEN' && status !== 'CLOSED') {
      throw new StageGError(
        'INVALID_STATUS_TRANSITION',
        'Manual status changes support OPEN and CLOSED only (ACHIEVED/MISSED are computed).',
        409,
      );
    }
    data.status = status;
  }
  if (input.currentValue !== undefined && input.currentValue !== null && input.currentValue !== '') {
    if (isPosSourced) {
      // Spec acceptance rule 2: POS-sourced values are computed, never typed.
      throw new StageGError(
        'POS_GOAL_READONLY',
        'This goal is sourced from POS sales. Use recompute instead of typing a value.',
        409,
      );
    }
    data.currentValue = toDecimal(input.currentValue);
  }

  if (Object.keys(data).length === 0) {
    throw new StageGError('NOTHING_TO_UPDATE', 'Provide a field to update.', 400);
  }

  const updated = await db.goal.update({ where: { id: goalId }, data });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'GOAL_UPDATED',
    resourceType: HrEntityType.GOAL,
    resourceId: goalId,
    storeId: session.storeId,
    metadata: { fields: Object.keys(data) },
  });

  return toDto(
    { ...goal, ...updated, currentValue: updated.currentValue, status: updated.status, updatedAt: updated.updatedAt },
    await employeeNameFor(goal.employeeId),
  );
}

/**
 * Self-service read: the employee's own goals with on-the-fly POS progress
 * (never persisted from the self-service path) plus manual values.
 */
export async function listMyGoals(employeeId: string): Promise<GoalDto[]> {
  const goals = await db.goal.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: 40,
    include: { employee: { select: { userId: true, storeId: true } } },
  });
  const result: GoalDto[] = [];
  for (const goal of goals) {
    let current = goal.currentValue ?? new Prisma.Decimal(0);
    let status = goal.status;
    if (goal.metricSource === 'SALES_TOTAL' || goal.metricSource === 'SALES_COUNT') {
      current = await computePosGoalValue(goal);
      const target = goal.targetValue ?? new Prisma.Decimal(0);
      if (goal.status !== 'CLOSED') {
        if (target.gt(0) && current.gte(target)) status = 'ACHIEVED';
        else if (goal.dueDate && goal.dueDate.getTime() < Date.now()) status = 'MISSED';
        else status = 'OPEN';
      }
    }
    result.push(toDto({ ...goal, employee: undefined, currentValue: current, status }, null));
  }
  return result;
}

export { decimalToMoney };
