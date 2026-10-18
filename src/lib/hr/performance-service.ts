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

export interface CycleStatusCounts {
  DRAFT: number;
  SUBMITTED: number;
  ACKNOWLEDGED: number;
  CALIBRATED: number;
}

export interface CycleDto {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  calibrationNotes: string | null;
  reviewCount: number;
  // v2.88.0: the cycle shows its shape — per-status review counts so the
  // console can render a calibration meter. Additive; counts never carry
  // ratings or narratives (spec rule 7 stays intact).
  statusCounts: CycleStatusCounts;
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

// v2.94.0: the per-cycle status counts stopped being listCycles' private
// query — the cycle detail drawer reads the same shape for ONE cycle, so
// the grouped query is shared (one implementation, one semantics: every
// non-deleted review of the cycle, never a role subset).
async function statusCountsFor(cycleIds: string[]): Promise<Map<string, CycleStatusCounts>> {
  const countsByCycle = new Map<string, CycleStatusCounts>();
  if (cycleIds.length === 0) return countsByCycle;
  const grouped = await db.performanceReview.groupBy({
    by: ['cycleId', 'status'],
    _count: { _all: true },
    where: { deletedAt: null, cycleId: { in: cycleIds } },
  });
  for (const row of grouped) {
    const counts =
      countsByCycle.get(row.cycleId) ??
      ({ DRAFT: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 0 } as CycleStatusCounts);
    if (row.status === 'DRAFT' || row.status === 'SUBMITTED' || row.status === 'ACKNOWLEDGED' || row.status === 'CALIBRATED') {
      counts[row.status] = row._count._all;
    }
    countsByCycle.set(row.cycleId, counts);
  }
  return countsByCycle;
}

export async function listCycles(session: Session): Promise<CycleDto[]> {
  const cycles = await db.reviewCycle.findMany({
    where: { deletedAt: null, organizationId: session.organizationId },
    orderBy: { periodStart: 'desc' },
    take: 60,
    include: { _count: { select: { reviews: true } } },
  });
  // v2.88.0: per-cycle status counts for the calibration meter. One grouped
  // query across the listed cycles; unknown statuses fold away (the service
  // only ever writes the four lifecycle values). Counts match reviewCount's
  // semantics — every non-deleted review of the cycle, not a role subset.
  const countsByCycle = await statusCountsFor(cycles.map((c) => c.id));
  return cycles.map((c) => ({
    id: c.id,
    name: c.name,
    periodStart: c.periodStart.toISOString(),
    periodEnd: c.periodEnd.toISOString(),
    status: c.status,
    calibrationNotes: c.calibrationNotes ?? null,
    reviewCount: c._count.reviews,
    statusCounts:
      countsByCycle.get(c.id) ?? { DRAFT: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 0 },
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
    // A fresh cycle has no reviews yet — the meter starts empty.
    statusCounts: { DRAFT: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 0 },
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

// ── v2.94.0 Cycle detail — the cycle opens up ──────────────────────────────

export interface CycleDetailDto extends CycleDto {
  /**
   * The cycle's own reviews in list-item shape — employee, status,
   * acknowledged date. Ratings and narratives are deliberately absent
   * (spec rule 7): the drawer links to the permission-gated review
   * detail dialog instead of smuggling ratings into a list.
   */
  reviews: ReviewListItemDto[];
  /** Notes are writable while the cycle has a future (DRAFT or ACTIVE). */
  canEditNotes: boolean;
  /**
   * v2.95.0: the lifecycle rides inside the drawer — this flag mirrors the
   * manage guard EXACTLY (same three roles), so the drawer never offers an
   * Activate or Close the PATCH route would refuse.
   */
  canManageLifecycle: boolean;
  /**
   * v2.95.0: the EMPTY_CYCLE guard explained BEFORE the attempt. Derived
   * server-side from the same count the guard itself runs, so the disabled
   * state can never drift from what the next PATCH would 409 on. Null when
   * the next move is unblocked (or when there is no next move).
   */
  lifecycleBlock: string | null;
}

async function loadScopedCycle(cycleId: string, session: Session) {
  const cycle = await db.reviewCycle.findFirst({
    where: { id: cycleId, deletedAt: null, organizationId: session.organizationId },
  });
  if (!cycle) throw new StageGError('CYCLE_NOT_FOUND', 'Review cycle not found.', 404);
  return cycle;
}

export async function getCycleDetail(cycleId: string, session: Session): Promise<CycleDetailDto> {
  const cycle = await loadScopedCycle(cycleId, session);
  // v2.95.0: the lifecycle block reads the SAME count the EMPTY_CYCLE guard
  // runs (non-deleted reviews of the cycle, org-wide) — not the viewer's
  // scoped reviews.length — so the inline explanation is the guard's own
  // arithmetic and can never disagree with the next PATCH.
  const [countsByCycle, reviews, guardCount] = await Promise.all([
    statusCountsFor([cycle.id]),
    listReviews(session, { cycleId: cycle.id }),
    db.performanceReview.count({ where: { cycleId: cycle.id, deletedAt: null } }),
  ]);
  const canManage =
    session.role === 'HR_MANAGER' || session.role === 'STORE_OWNER' || session.role === 'SUPER_ADMIN';
  const lifecycleBlock =
    canManage && cycle.status === 'DRAFT' && guardCount === 0
      ? 'Add at least one review before activating — reviews are created from the Reviews tab.'
      : null;
  return {
    id: cycle.id,
    name: cycle.name,
    periodStart: cycle.periodStart.toISOString(),
    periodEnd: cycle.periodEnd.toISOString(),
    status: cycle.status,
    calibrationNotes: cycle.calibrationNotes ?? null,
    reviewCount: reviews.length,
    statusCounts: countsByCycle.get(cycle.id) ?? { DRAFT: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 0 },
    createdAt: cycle.createdAt.toISOString(),
    reviews,
    canEditNotes: canManage && cycle.status !== 'CLOSED',
    canManageLifecycle: canManage,
    lifecycleBlock,
  };
}

export const CALIBRATION_NOTES_MAX = 4000;

export async function updateCycleCalibration(
  cycleId: string,
  input: { calibrationNotes?: unknown },
  session: Session,
): Promise<{ id: string; status: string; calibrationNotes: string | null }> {
  const cycle = await loadScopedCycle(cycleId, session);
  // A CLOSED cycle is history: its meter stopped and its notes stopped with
  // it. Frozen notes stay readable in the detail, never rewritable.
  if (cycle.status === 'CLOSED') {
    throw new StageGError(
      'CYCLE_FROZEN',
      'A closed cycle is history — its calibration notes no longer take ink.',
      409,
    );
  }
  const raw = input.calibrationNotes;
  if (typeof raw !== 'string') {
    throw new StageGError('NOTHING_TO_UPDATE', 'Provide calibrationNotes as text to save.', 400);
  }
  const notes = raw.trim();
  if (notes.length > CALIBRATION_NOTES_MAX) {
    throw new StageGError(
      'TEXT_TOO_LONG',
      `Calibration notes must be at most ${CALIBRATION_NOTES_MAX} characters.`,
      400,
    );
  }
  const updated = await db.reviewCycle.update({
    where: { id: cycle.id },
    data: { calibrationNotes: notes.length > 0 ? notes : null },
  });
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'PERFORMANCE_CYCLE_CALIBRATION_NOTES',
    resourceType: HrEntityType.REVIEW_CYCLE,
    resourceId: cycle.id,
    storeId: session.storeId,
    // Field-name-only metadata — the notes text itself never enters the
    // audit (the same masking rule every performance mutation follows).
    metadata: { fields: ['calibrationNotes'] },
  });
  return { id: updated.id, status: updated.status, calibrationNotes: updated.calibrationNotes ?? null };
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
  /**
   * v2.87.0: the narratives are writable while the review is DRAFT or
   * SUBMITTED and the viewer is the assigned reviewer (or HR) — the same
   * rule updateReview enforces, surfaced so the dialog can offer the form
   * before the rating exists (canSubmit alone would dead-end a fresh
   * draft: it requires a rating nobody has written yet).
   */
  canEdit: boolean;
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
    canEdit:
      (canManage || review.reviewerUserId === session.userId) &&
      (review.status === 'DRAFT' || review.status === 'SUBMITTED'),
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
