import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCycle,
  createReview,
  getReviewDetail,
  listCycles,
  listReviews,
  transitionCycle,
  updateReview,
} from '@/lib/hr/performance-service';
import { StageGError } from '@/lib/hr/stage-g-shared';

/**
 * Phase 4.7 contracts (v2.19.0): cycle state machine, review lifecycle,
 * maker-of-review rules, and the sensitive-data rule that ratings and
 * narratives NEVER appear in list payloads.
 */

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn(),
  });
  return {
    reviewCycle: model(),
    performanceReview: model(),
    employee: model(),
    goal: model(),
    assetAssignment: model(),
    disciplinaryCase: model(),
    user: model(),
  };
});

const hrAudit = vi.hoisted(() => vi.fn().mockResolvedValue('audit-id'));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: {
    REVIEW_CYCLE: 'ReviewCycle',
    PERFORMANCE_REVIEW: 'PerformanceReview',
    GOAL: 'Goal',
    DISCIPLINARY_CASE: 'DisciplinaryCase',
    ASSET_ASSIGNMENT: 'AssetAssignment',
  },
}));

const session = {
  userId: 'user-1',
  email: 'hr@mbumah.co.ke',
  role: 'HR_MANAGER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as const;

describe('review cycles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a DRAFT cycle with audit', async () => {
    db.reviewCycle.findFirst.mockResolvedValue(null);
    db.reviewCycle.create.mockResolvedValue({
      id: 'cycle-1',
      name: 'H2 2026',
      organizationId: 'org-1',
      storeId: 'store-1',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-12-31'),
      status: 'DRAFT',
      calibrationNotes: null,
      createdAt: new Date(),
    });

    const cycle = await createCycle(
      { name: 'H2 2026', periodStart: '2026-07-01', periodEnd: '2026-12-31' },
      session,
    );
    expect(cycle.status).toBe('DRAFT');
    expect(db.reviewCycle.create).toHaveBeenCalledTimes(1);
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PERFORMANCE_CYCLE_CREATED', resourceType: 'ReviewCycle' }),
    );
  });

  it('rejects duplicate cycle names', async () => {
    db.reviewCycle.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      createCycle({ name: 'H2 2026', periodStart: '2026-07-01', periodEnd: '2026-12-31' }, session),
    ).rejects.toMatchObject({ code: 'CYCLE_EXISTS', status: 409 });
  });

  it('enforces the DRAFT -> ACTIVE -> CLOSED chain', async () => {
    db.reviewCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      status: 'DRAFT',
      organizationId: 'org-1',
      deletedAt: null,
    });
    db.performanceReview.count.mockResolvedValue(3);
    db.reviewCycle.update.mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE' });

    const activated = await transitionCycle('cycle-1', 'ACTIVATE', session);
    expect(activated.status).toBe('ACTIVE');

    // An empty cycle cannot activate.
    db.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-2', status: 'DRAFT', organizationId: 'org-1', deletedAt: null });
    db.performanceReview.count.mockResolvedValue(0);
    await expect(transitionCycle('cycle-2', 'ACTIVATE', session)).rejects.toMatchObject({ code: 'EMPTY_CYCLE' });

    // CLOSED is terminal.
    db.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-3', status: 'CLOSED', organizationId: 'org-1', deletedAt: null });
    await expect(transitionCycle('cycle-3', 'ACTIVATE', session)).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });
});

describe('performance reviews', () => {
  const cycle = { id: 'cycle-1', name: 'H2 2026', status: 'ACTIVE', organizationId: 'org-1' };
  const employee = {
    id: 'emp-1',
    storeId: 'store-1',
    userId: 'user-emp',
    firstName: 'Asha',
    lastName: 'Kimani',
    jobTitle: 'Cashier',
  };
  const baseReview = {
    id: 'rev-1',
    cycleId: 'cycle-1',
    employeeId: 'emp-1',
    reviewerUserId: 'user-1',
    overallRating: null as number | null,
    strengths: null as string | null,
    improvements: null as string | null,
    status: 'DRAFT',
    acknowledgedAt: null as Date | null,
    createdAt: new Date(),
    deletedAt: null,
    cycle,
    employee,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.reviewCycle.findFirst.mockResolvedValue(cycle);
    db.employee.findFirst.mockResolvedValue(employee);
    db.employee.findUnique.mockResolvedValue(employee);
  });

  it('blocks duplicate reviews for the same (cycle, employee)', async () => {
    db.performanceReview.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(createReview({ cycleId: 'cycle-1', employeeId: 'emp-1' }, session)).rejects.toMatchObject({
      code: 'REVIEW_EXISTS',
    });
  });

  it('validates the rating range on update', async () => {
    db.performanceReview.findFirst.mockResolvedValue(baseReview);
    await expect(
      updateReview('rev-1', { action: 'UPDATE', overallRating: 9 }, session),
    ).rejects.toMatchObject({ code: 'INVALID_RATING', status: 400 });
    await expect(
      updateReview('rev-1', { action: 'UPDATE', overallRating: 3.5 }, session),
    ).rejects.toMatchObject({ code: 'INVALID_RATING' });
  });

  it('requires a rating before submit', async () => {
    db.performanceReview.findFirst.mockResolvedValue({ ...baseReview, overallRating: null });
    await expect(updateReview('rev-1', { action: 'SUBMIT' }, session)).rejects.toMatchObject({
      code: 'RATING_REQUIRED',
    });
  });

  it('submits with a rating and captures the reviewer', async () => {
    const submitted = { ...baseReview, overallRating: 4, status: 'SUBMITTED' };
    db.performanceReview.findFirst.mockResolvedValue({ ...baseReview, overallRating: 4 });
    db.performanceReview.update.mockResolvedValue(submitted);
    // getReviewDetail re-reads the row: return the submitted state.
    db.performanceReview.findFirst.mockResolvedValueOnce({ ...baseReview, overallRating: 4 }).mockResolvedValueOnce(submitted);

    const detail = await updateReview('rev-1', { action: 'SUBMIT' }, session);
    expect(detail.status).toBe('SUBMITTED');
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PERFORMANCE_REVIEW_SUBMITTED' }),
    );
  });

  it('lets only the subject or HR acknowledge', async () => {
    db.performanceReview.findFirst.mockResolvedValue({ ...baseReview, status: 'SUBMITTED', overallRating: 4 });

    // A random reviewer (not subject, not HR) is refused.
    await expect(
      updateReview('rev-1', { action: 'ACKNOWLEDGE' }, { ...session, userId: 'someone-else', role: 'BRANCH_MANAGER' }),
    ).rejects.toMatchObject({ code: 'NOT_THE_SUBJECT', status: 403 });

    // The subject succeeds.
    const acknowledged = { ...baseReview, status: 'ACKNOWLEDGED', acknowledgedAt: new Date() };
    db.performanceReview.findFirst.mockResolvedValue({ ...baseReview, status: 'SUBMITTED', overallRating: 4 });
    db.performanceReview.findFirst.mockResolvedValueOnce({ ...baseReview, status: 'SUBMITTED', overallRating: 4 }).mockResolvedValueOnce(acknowledged);
    db.performanceReview.update.mockResolvedValue(acknowledged);
    const detail = await updateReview(
      'rev-1',
      { action: 'ACKNOWLEDGE' },
      { ...session, userId: 'user-emp', role: 'EMPLOYEE' },
    );
    expect(detail.status).toBe('ACKNOWLEDGED');
  });

  it('calibrates only ACKNOWLEDGED reviews in ACTIVE cycles by HR', async () => {
    const ack = { ...baseReview, status: 'ACKNOWLEDGED', overallRating: 4 };
    const calibrated = { ...ack, status: 'CALIBRATED' };
    db.performanceReview.findFirst.mockResolvedValue(ack);
    db.reviewCycle.findUnique.mockResolvedValue(cycle);

    await expect(
      updateReview('rev-1', { action: 'CALIBRATE' }, { ...session, role: 'BRANCH_MANAGER' }),
    ).rejects.toMatchObject({ code: 'CALIBRATION_FORBIDDEN', status: 403 });

    db.performanceReview.findFirst.mockResolvedValue(ack);
    db.performanceReview.findFirst.mockResolvedValueOnce(ack).mockResolvedValueOnce(calibrated);
    db.performanceReview.update.mockResolvedValue(calibrated);
    const detail = await updateReview('rev-1', { action: 'CALIBRATE' }, session);
    expect(detail.status).toBe('CALIBRATED');

    // Closed cycle blocks calibration.
    db.performanceReview.findFirst.mockResolvedValue(ack);
    db.reviewCycle.findUnique.mockResolvedValue({ ...cycle, status: 'CLOSED' });
    await expect(updateReview('rev-1', { action: 'CALIBRATE' }, session)).rejects.toMatchObject({
      code: 'CYCLE_NOT_ACTIVE',
    });
  });
});

describe('sensitive-data list masking (spec rule 7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never includes rating or narratives in review lists', async () => {
    db.performanceReview.findMany.mockResolvedValue([
      {
        id: 'rev-1',
        cycleId: 'cycle-1',
        employeeId: 'emp-1',
        reviewerUserId: 'user-1',
        overallRating: 5,
        strengths: 'Great with customers',
        improvements: 'Upselling',
        status: 'CALIBRATED',
        acknowledgedAt: new Date(),
        createdAt: new Date(),
        deletedAt: null,
        cycle: { name: 'H2 2026' },
        employee: { firstName: 'Asha', lastName: 'Kimani', jobTitle: 'Cashier' },
      },
    ]);

    const list = await listReviews(session, { cycleId: 'cycle-1' });
    expect(list).toHaveLength(1);
    const json = JSON.stringify(list[0]);
    expect(json).not.toContain('overallRating');
    expect(json).not.toContain('Great with customers');
    expect(json).not.toContain('Upselling');
  });

  it('cycle lists expose counts only', async () => {
    db.reviewCycle.findMany.mockResolvedValue([
      {
        id: 'cycle-1',
        name: 'H2 2026',
        organizationId: 'org-1',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-12-31'),
        status: 'ACTIVE',
        calibrationNotes: 'Aligned ratings on Friday review',
        createdAt: new Date(),
        _count: { reviews: 7 },
      },
    ]);
    const cycles = await listCycles(session);
    expect(cycles[0].reviewCount).toBe(7);
    expect(cycles[0].name).toBe('H2 2026');
  });

  it('returns a safe 404 for cross-organization review reads', async () => {
    db.performanceReview.findFirst.mockResolvedValue(null);
    await expect(getReviewDetail('nope', session)).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      status: 404,
    });
  });
});

describe('StageGError shape', () => {
  it('carries code and status and strips the prefix in messages', () => {
    const err = new StageGError('SOME_CODE', 'plain message', 422);
    expect(err.status).toBe(422);
    expect(err.message).toContain('SOME_CODE: plain message');
  });
});
