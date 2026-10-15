// MBUMAH HARDWARE POS - HR onboarding service (v2.18.6)
//
// Onboarding plans, task completion, and sign-off. Till access gating: a plan
// whose CASH_HANDLING tasks (blocksTillAccess) are incomplete cannot be
// signed off, and isTillAccessGranted() is the single function the POS can
// consult before granting till permissions to a probationary employee.

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';

export async function createPlan(
  employeeId: string,
  storeId: string | null,
  actorId: string,
  actorRole: string,
  templateKey: string,
) {
  const plan = await db.onboardingPlan.create({
    data: {
      employeeId,
      storeId,
      templateKey: templateKey || 'STANDARD',
      status: 'IN_PROGRESS',
      dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      tasks: {
        create: [
          { title: 'Sign employment contract', category: 'DOCUMENTS', blocksTillAccess: true },
          { title: 'Cash handling policy acknowledged', category: 'CASH_HANDLING', blocksTillAccess: true },
          { title: 'Till drawer count training completed', category: 'CASH_HANDLING', blocksTillAccess: true },
          { title: 'POS account created and tested', category: 'SYSTEM_ACCESS', blocksTillAccess: false },
          { title: 'Workplace safety walkthrough', category: 'SAFETY', blocksTillAccess: false },
        ],
      },
    },
    select: { id: true },
  });

  await hrAudit({
    actorId,
    actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.ONBOARDING_PLAN,
    resourceId: plan.id,
    storeId,
    reason: 'Onboarding plan created from template.',
    metadata: { employeeId, templateKey },
  });
  return plan;
}

export async function listPlans(storeId: string) {
  return db.onboardingPlan.findMany({
    where: { storeId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      employee: { select: { firstName: true, lastName: true, employeeCode: true, status: true } },
      tasks: { orderBy: { createdAt: 'asc' } },
    },
  });
}

export async function completeTask(
  planId: string,
  taskId: string,
  storeId: string,
  actorId: string,
  actorRole: string,
) {
  const task = await db.onboardingTask.findFirst({
    where: { id: taskId, planId, plan: { storeId } },
    select: { id: true, isComplete: true, title: true },
  });
  if (!task) throw new Error('Task not found in this plan.');
  if (task.isComplete) return task; // idempotent completion

  await db.onboardingTask.update({
    where: { id: taskId },
    data: { isComplete: true, completedByUserId: actorId, completedAt: new Date() },
  });

  const remaining = await db.onboardingTask.count({ where: { planId, isComplete: false } });
  if (remaining === 0) {
    await db.onboardingPlan.update({ where: { id: planId }, data: { status: 'COMPLETED' } });
  }

  await hrAudit({
    actorId,
    actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.ONBOARDING_TASK,
    resourceId: taskId,
    storeId,
    reason: `Onboarding task completed: ${task.title}.`,
    metadata: { planId, remainingTasks: remaining },
  });
  return task;
}

export async function signoffPlan(planId: string, storeId: string, actorId: string, actorRole: string) {
  const plan = await db.onboardingPlan.findFirst({
    where: { id: planId, storeId, deletedAt: null },
    include: { tasks: { where: { blocksTillAccess: true }, select: { id: true, isComplete: true, title: true } } },
  });
  if (!plan) throw new Error('Plan not found.');
  if (plan.status === 'SIGNED_OFF') return plan; // idempotent

  const blocking = plan.tasks.filter((t) => !t.isComplete);
  if (blocking.length > 0) {
    throw new Error(
      `TILL_ACCESS_BLOCKED: ${blocking.length} cash-handling task(s) must be completed before sign-off: ${blocking.map((t) => t.title).join('; ')}.`,
    );
  }

  const signed = await db.onboardingPlan.update({
    where: { id: planId },
    data: { status: 'SIGNED_OFF', signedOffByUserId: actorId, signedOffAt: new Date() },
  });

  await hrAudit({
    actorId,
    actorRole,
    action: 'APPROVE',
    resourceType: HrEntityType.ONBOARDING_PLAN,
    resourceId: planId,
    storeId,
    reason: 'Onboarding plan signed off; till access may be granted.',
    metadata: { employeeId: plan.employeeId },
  });
  return signed;
}

/** Single source of truth for till access gating (used by POS onboarding checks). */
export async function isTillAccessGranted(employeeId: string): Promise<boolean> {
  const plan = await db.onboardingPlan.findFirst({
    where: { employeeId, deletedAt: null },
    select: { status: true, tasks: { where: { blocksTillAccess: true }, select: { isComplete: true } } },
  });
  if (!plan) return false; // no plan = not onboarded = no till access
  return plan.status === 'SIGNED_OFF' || plan.tasks.every((t) => t.isComplete);
}
