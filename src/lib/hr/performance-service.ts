// MBUMAH HARDWARE POS - HR performance service (v2.19.0, spec Phase 4.7)
//
// Review cycles (DRAFT -> ACTIVE -> CLOSED), performance reviews
// (DRAFT -> SUBMITTED -> ACKNOWLEDGED -> CALIBRATED) and the list-payload
// masking rule from the EMS spec: performance ratings and narratives are
// sensitive, so they NEVER appear in list payloads (single-fetch detail is
// permission-gated instead). Every mutation writes a hash-chained hrAudit
// event with field-name-only metadata.

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { StageGError, employeeScopeWhere, employeeInScope } from './stage-g-shared';
import type { AuthSession } from '@/lib/auth';

export const CYCLE_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export const REVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'CALIBRATED'] as const;
export const MIN_RATING = 1;
export const MAX_RATING = 5;

type Session = AuthSession;

/** Legal cycle transitions. */
const CYCLE_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['CLOSED'],
  CLOSED: [],
};

export interface CycleDto {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  calibrationNotes: string | null;
  reviewCount: number;
  createdAt: string;
}

export interface ReviewListItemDto {
  id: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  employeeName: string;
  jobTitle: string | null;
  reviewerUserId: string | null;
  status: string;
  acknowledgedAt: string | null;
  createdAt: string;
  // NOTE: overallRating / strengths / improvements deliberately absent
  // (spec rule 7: ratings never in list payloads).
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

// ── Cycles ──────────────────────────────────────────────────────────────────

export async function listCycles(session: Session): Promise<CycleDto[]> {
  const cycles = await db.reviewCycle.findMany({
    where: { deletedAt: null, organizationId: session.organizationId },
    orderBy: { periodStart: 'desc' },
    take: 60,
    include: { _count: { select: { reviews: true } } },
  });
  return cycles.map((c) => ({
    id: c.id,
    name: c.name,
    periodStart: c.periodStart.toISOString(),
    periodEnd: c.periodEnd.toISOString(),
    status: c.status,
    calibrationNotes: c.calibrationNotes ?? null,
    reviewCount: c._count.reviews,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function createCycle(
  input: { name?: unknown; periodStart?: unknown; periodEnd?: unknown },
  session: Session,
): Promise<CycleDto> {
  const name = String(input.name ?? '').trim();
  if (name.length < 3 || name.length > 120) {
    throw new StageGError('INVALID_NAME', 'Cycle name must be between 3 and 120 characters.', 400);
  }
  const periodStart = new Date(String(input.periodStart ?? ''));
  const periodEnd = new Date(String(input.periodEnd ?? ''));
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new StageGError('INVALID_PERIOD', 'Cycle periodStart and periodEnd must be valid dates.', 400);
  }
  if (periodEnd.getTime() <= periodStart.getTime()) {
    throw new StageGError('INVALID_PERIOD', 'Cycle periodEnd must be after periodStart.', 400);
  }

  const duplicate = await db.reviewCycle.findFirst({
    where: { organizationId: session.organizationId, name, deletedAt: null },
    select: { id: true },
  });
  if (duplicate) {
    throw new StageGError('CYCLE_EXISTS', 'A review cycle with this name already exists.', 409);
  }

  const cycle = await db.reviewCycle.create({
    data: {
      organizationId: session.organizationId,
      storeId: session.storeId,
      name,
      periodStart,
      periodEnd,
      status: 'DRAFT',
    },
  });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'PERFORMANCE_CYCLE_CREATED',
    resourceType: HrEntityType.REVIEW_CYCLE,
    resourceId: cycle.id,
    storeId: session.storeId,
    metadata: { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
  });

  return {
    id: cycle.id,
    name: cycle.name,
    periodStart: cycle.periodStart.toISOString(),
    periodEnd: cycle.periodEnd.toISOString(),
    status: cycle.status,
    calibrationNotes: cycle.calibrationNotes ?? null,
    reviewCount: 0,
    createdAt: cycle.createdAt.toISOString(),
  };
}

export async function transitionCycle(
  cycleId: string,
  action: 'ACTIVATE' | 'CLOSE',
  session: Session,
): Promise<{ id: string; status: string }> {
  const cycle = await db.reviewCycle.findFirst({
    where: { id: cycleId, deletedAt: null, organizationId: session.organizationId },
  });
  if (!cycle) throw new StageGError('CYCLE_NOT_FOUND', 'Review cycle not found.', 404);

  const target = action === 'ACTIVATE' ? 'ACTIVE' : 'CLOSED';
  if (!CYCLE_TRANSITIONS[cycle.status]?.includes(target)) {
    throw new StageGError(
      'ILLEGAL_TRANSITION',
      `A ${cycle.status} cycle cannot move to ${target}.`,
      409,
    );
  }
  if (action === 'ACTIVATE') {
    const reviewCount = await db.performanceReview.count({
      where: { cycleId, deletedAt: null },
    });
    if (reviewCount === 0) {
      throw new StageGError(
        'EMPTY_CYCLE',
        'Add at least one review before activating the cycle.',
        409,
      );
    }
  }

  const updated = await db.reviewCycle.update({
    where: { id: cycleId },
    data: { status: target },
  });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: action === 'ACTIVATE' ? 'PERFORMANCE_CYCLE_ACTIVATED' : 'PERFORMANCE_CYCLE_CLOSED',
    resourceType: HrEntityType.REVIEW_CYCLE,
    resourceId: cycleId,
    storeId: session.storeId,
    metadata: { from: cycle.status, to: target },
  });

  return { id: updated.id, status: updated.status };
}

// ── Reviews ─────────────────────────────────────────────────────────────────

async function loadScopedEmployee(employeeId: string, session: Session) {
  const employee = await db.employee.findFirst({
    where: { id: employeeId, deletedAt: null, AND: [employeeScopeWhere(session)] },
    select: { id: true, storeId: true, firstName: true, lastName: true, userId: true },
  });
  if (!employee || !employeeInScope(employee, session)) {
    // Safe 404 per spec enforcement rule 5 (no cross-branch existence leak).
    throw new StageGError('EMPLOYEE_NOT_FOUND', 'Employee not found in your scope.', 404);
  }
  return employee;
}

export async function listReviews(
  session: Session,
  filters: { cycleId?: string; employeeId?: string; status?: string } = {},
): Promise<ReviewListItemDto[]> {
  const reviews = await db.performanceReview.findMany({
    where: {
      deletedAt: null,
      ...(filters.cycleId ? { cycleId: filters.cycleId } : {}),
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      employee: employeeScopeWhere(session),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      cycle: { select: { name: true } },
      employee: { select: { firstName: true, lastName: true, jobTitle: true } },
    },
  });
  return reviews.map((r) => ({
    id: r.id,
    cycleId: r.cycleId,
    cycleName: r.cycle.name,
    employeeId: r.employeeId,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    jobTitle: r.employee.jobTitle ?? null,
    reviewerUserId: r.reviewerUserId ?? null,
    status: r.status,
    acknowledgedAt: toIso(r.acknowledgedAt),
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface ReviewDetailDto extends ReviewListItemDto {
  overallRating: number | null;
  strengths: string | null;
  improvements: string | null;
  cycleStatus: string;
  /** Who may act right now (drives UI affordances). */
  canSubmit: boolean;
  canAcknowledge: boolean;
  canCalibrate: boolean;
  isSelf: boolean;
}

async function loadReviewForDetail(reviewId: string, session: Session) {
  const review = await db.performanceReview.findFirst({
    where: { id: reviewId, deletedAt: null },
    include: {
      cycle: { select: { name: true, status: true, organizationId: true } },
      employee: {
        select: {
          id: true,
          storeId: true,
          userId: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
        },
      },
    },
  });
  if (!review || review.cycle.organizationId !== session.organizationId) {
    throw new StageGError('REVIEW_NOT_FOUND', 'Performance review not found.', 404);
  }
  const isSelf = review.employee.userId === session.userId;
  const isSameStore = employeeInScope(review.employee, session);
  // Subject may always read their own review; reviewers/managers need branch
  // scope. A review for a cross-branch employee is a safe 404.
  if (!isSelf && !isSameStore) {
    throw new StageGError('REVIEW_NOT_FOUND', 'Performance review not found.', 404);
  }
  return { review, isSelf, isSameStore };
}

export async function getReviewDetail(reviewId: string, session: Session): Promise<ReviewDetailDto> {
  const { review, isSelf } = await loadReviewForDetail(reviewId, session);
  const canManage = session.role === 'HR_MANAGER' || session.role === 'STORE_OWNER' || session.role === 'SUPER_ADMIN';
  return {
    id: review.id,
    cycleId: review.cycleId,
    cycleName: review.cycle.name,
    cycleStatus: review.cycle.status,
    employeeId: review.employeeId,
    employeeName: `${review.employee.firstName} ${review.employee.lastName}`,
    jobTitle: review.employee.jobTitle ?? null,
    reviewerUserId: review.reviewerUserId ?? null,
    status: review.status,
    acknowledgedAt: toIso(review.acknowledgedAt),
    createdAt: review.createdAt.toISOString(),
    overallRating: review.overallRating ?? null,
    strengths: review.strengths ?? null,
    improvements: review.improvements ?? null,
    canSubmit:
      (canManage || review.reviewerUserId === session.userId) &&
      review.status === 'DRAFT' &&
      review.overallRating !== null,
    canAcknowledge: review.status === 'SUBMITTED' && (isSelf || canManage),
    canCalibrate: canManage && review.status === 'ACKNOWLEDGED' && review.cycle.status === 'ACTIVE',
    isSelf,
  };
}

export async function createReview(
  input: { cycleId?: unknown; employeeId?: unknown },
  session: Session,
): Promise<ReviewListItemDto> {
  const cycleId = String(input.cycleId ?? '');
  const employeeId = String(input.employeeId ?? '');

  const cycle = await db.reviewCycle.findFirst({
    where: { id: cycleId, deletedAt: null, organizationId: session.organizationId },
  });
  if (!cycle) throw new StageGError('CYCLE_NOT_FOUND', 'Review cycle not found.', 404);
  if (cycle.status === 'CLOSED') {
    throw new StageGError('CYCLE_CLOSED', 'Reviews cannot be added to a closed cycle.', 409);
  }

  await loadScopedEmployee(employeeId, session);

  const duplicate = await db.performanceReview.findFirst({
    where: { cycleId, employeeId, deletedAt: null },
    select: { id: true },
  });
  if (duplicate) {
    throw new StageGError(
      'REVIEW_EXISTS',
      'This employee already has a review in the selected cycle.',
      409,
    );
  }

  const review = await db.performanceReview.create({
    data: { cycleId, employeeId, reviewerUserId: session.userId, status: 'DRAFT' },
  });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'PERFORMANCE_REVIEW_CREATED',
    resourceType: HrEntityType.PERFORMANCE_REVIEW,
    resourceId: review.id,
    storeId: session.storeId,
    metadata: { cycleId, employeeId },
  });

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { firstName: true, lastName: true, jobTitle: true },
  });

  return {
    id: review.id,
    cycleId,
    cycleName: cycle.name,
    employeeId,
    employeeName: employee ? `${employee.firstName} ${employee.lastName}` : 'Employee',
    jobTitle: employee?.jobTitle ?? null,
    reviewerUserId: review.reviewerUserId,
    status: review.status,
    acknowledgedAt: null,
    createdAt: review.createdAt.toISOString(),
  };
}

const REVIEW_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['CALIBRATED'],
  CALIBRATED: [],
};

export interface ReviewUpdateInput {
  action?: unknown; // UPDATE | SUBMIT | ACKNOWLEDGE | CALIBRATE
  overallRating?: unknown;
  strengths?: unknown;
  improvements?: unknown;
}

export async function updateReview(
  reviewId: string,
  input: ReviewUpdateInput,
  session: Session,
): Promise<ReviewDetailDto> {
  const { review, isSelf } = await loadReviewForDetail(reviewId, session);
  const canManage = session.role === 'HR_MANAGER' || session.role === 'STORE_OWNER' || session.role === 'SUPER_ADMIN';
  const action = String(input.action ?? 'UPDATE').toUpperCase();

  // Rating / narrative validation whenever values are being written.
  const writes: { overallRating?: number; strengths?: string; improvements?: string } = {};
  if (input.overallRating !== undefined && input.overallRating !== null && input.overallRating !== '') {
    const rating = Number(input.overallRating);
    if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
      throw new StageGError(
        'INVALID_RATING',
        `Overall rating must be an integer between ${MIN_RATING} and ${MAX_RATING}.`,
        400,
      );
    }
    writes.overallRating = rating;
  }
  if (typeof input.strengths === 'string') {
    if (input.strengths.length > 4000) {
      throw new StageGError('TEXT_TOO_LONG', 'Strengths must be at most 4000 characters.', 400);
    }
    writes.strengths = input.strengths;
  }
  if (typeof input.improvements === 'string') {
    if (input.improvements.length > 4000) {
      throw new StageGError('TEXT_TOO_LONG', 'Improvements must be at most 4000 characters.', 400);
    }
    writes.improvements = input.improvements;
  }

  if (action === 'UPDATE') {
    if (review.status !== 'DRAFT' && review.status !== 'SUBMITTED') {
      throw new StageGError(
        'ILLEGAL_TRANSITION',
        'Narratives can only be edited while the review is DRAFT or SUBMITTED.',
        409,
      );
    }
    if (Object.keys(writes).length === 0) {
      throw new StageGError('NOTHING_TO_UPDATE', 'Provide rating, strengths or improvements to save.', 400);
    }
    // Reviewers edit their own drafts; HR managers edit any.
    if (!canManage && review.reviewerUserId !== session.userId) {
      throw new StageGError('NOT_THE_REVIEWER', 'Only the assigned reviewer or HR can edit this review.', 403);
    }
    const updated = await db.performanceReview.update({ where: { id: reviewId }, data: writes });
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_REVIEW_UPDATED',
      resourceType: HrEntityType.PERFORMANCE_REVIEW,
      resourceId: reviewId,
      storeId: session.storeId,
      metadata: { fields: Object.keys(writes) },
    });
    return getReviewDetail(updated.id, session);
  }

  if (action === 'SUBMIT') {
    if (!REVIEW_TRANSITIONS[review.status].includes('SUBMITTED')) {
      throw new StageGError('ILLEGAL_TRANSITION', `A ${review.status} review cannot be submitted.`, 409);
    }
    const rating = writes.overallRating ?? review.overallRating;
    if (rating === null || rating === undefined) {
      throw new StageGError('RATING_REQUIRED', 'Set an overall rating before submitting.', 400);
    }
    if (!canManage && review.reviewerUserId !== session.userId) {
      throw new StageGError('NOT_THE_REVIEWER', 'Only the assigned reviewer or HR can submit this review.', 403);
    }
    await db.performanceReview.update({
      where: { id: reviewId },
      data: { ...writes, status: 'SUBMITTED', reviewerUserId: session.userId },
    });
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_REVIEW_SUBMITTED',
      resourceType: HrEntityType.PERFORMANCE_REVIEW,
      resourceId: reviewId,
      storeId: session.storeId,
      metadata: { status: 'SUBMITTED' },
    });
    return getReviewDetail(reviewId, session);
  }

  if (action === 'ACKNOWLEDGE') {
    if (review.status !== 'SUBMITTED') {
      throw new StageGError('ILLEGAL_TRANSITION', 'Only a SUBMITTED review can be acknowledged.', 409);
    }
    // Subject acknowledges their own review; HR may acknowledge on behalf.
    if (!isSelf && !canManage) {
      throw new StageGError('NOT_THE_SUBJECT', 'Only the reviewed employee or HR can acknowledge.', 403);
    }
    await db.performanceReview.update({
      where: { id: reviewId },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_REVIEW_ACKNOWLEDGED',
      resourceType: HrEntityType.PERFORMANCE_REVIEW,
      resourceId: reviewId,
      storeId: session.storeId,
      metadata: { acknowledgedBySelf: isSelf },
    });
    return getReviewDetail(reviewId, session);
  }

  if (action === 'CALIBRATE') {
    if (!canManage) {
      throw new StageGError('CALIBRATION_FORBIDDEN', 'Calibration is reserved for HR managers.', 403);
    }
    if (review.status !== 'ACKNOWLEDGED') {
      throw new StageGError('ILLEGAL_TRANSITION', 'Only an ACKNOWLEDGED review can be calibrated.', 409);
    }
    const cycle = await db.reviewCycle.findUnique({ where: { id: review.cycleId }, select: { status: true } });
    if (cycle?.status !== 'ACTIVE') {
      throw new StageGError('CYCLE_NOT_ACTIVE', 'Calibration requires an ACTIVE cycle.', 409);
    }
    await db.performanceReview.update({ where: { id: reviewId }, data: { status: 'CALIBRATED' } });
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_REVIEW_CALIBRATED',
      resourceType: HrEntityType.PERFORMANCE_REVIEW,
      resourceId: reviewId,
      storeId: session.storeId,
      metadata: {},
    });
    return getReviewDetail(reviewId, session);
  }

  throw new StageGError('UNKNOWN_ACTION', `Unsupported review action: ${action}`, 400);
}

/** Self-service: list the signed-in employee's own reviews (own data only). */
export async function listMyReviews(employeeId: string): Promise<ReviewListItemDto[]> {
  const reviews = await db.performanceReview.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 40,
    include: { cycle: { select: { name: true } } },
  });
  return reviews.map((r) => ({
    id: r.id,
    cycleId: r.cycleId,
    cycleName: r.cycle.name,
    employeeId: r.employeeId,
    employeeName: 'You',
    jobTitle: null,
    reviewerUserId: r.reviewerUserId ?? null,
    status: r.status,
    acknowledgedAt: toIso(r.acknowledgedAt),
    createdAt: r.createdAt.toISOString(),
  }));
}
