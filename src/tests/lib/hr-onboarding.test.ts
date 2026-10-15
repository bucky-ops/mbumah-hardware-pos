import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isTillAccessGranted, signoffPlan } from '@/lib/hr/onboarding-service';
import { convertApplicantToEmployee } from '@/lib/hr/recruitment-service';

/**
 * Stage D contracts: till access gating, idempotent conversion with
 * provenance, and sign-off refusal while blocking tasks are open.
 */

const db = vi.hoisted(() => ({
  onboardingPlan: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  onboardingTask: {
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  applicant: { findFirst: vi.fn(), update: vi.fn() },
  employee: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn(), update: vi.fn() },
  recruitmentJob: { findFirst: vi.fn() },
  offer: { updateMany: vi.fn() },
  consentRecord: { create: vi.fn() },
  applicationStage: { create: vi.fn() },
  notification: { create: vi.fn().mockResolvedValue({}) },
  auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/audit-trail', () => ({
  auditTrail: { log: vi.fn().mockResolvedValue('audit-id') },
}));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));

describe('till access gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies till access when no onboarding plan exists', async () => {
    db.onboardingPlan.findFirst.mockResolvedValue(null);
    expect(await isTillAccessGranted('emp-1')).toBe(false);
  });

  it('denies till access while blocking tasks are open', async () => {
    db.onboardingPlan.findFirst.mockResolvedValue({
      status: 'IN_PROGRESS',
      tasks: [{ isComplete: true }, { isComplete: false }],
    });
    expect(await isTillAccessGranted('emp-1')).toBe(false);
  });

  it('grants till access when all blocking tasks are complete', async () => {
    db.onboardingPlan.findFirst.mockResolvedValue({
      status: 'IN_PROGRESS',
      tasks: [{ isComplete: true }, { isComplete: true }],
    });
    expect(await isTillAccessGranted('emp-1')).toBe(true);
  });

  it('grants till access on signed-off plans', async () => {
    db.onboardingPlan.findFirst.mockResolvedValue({ status: 'SIGNED_OFF', tasks: [] });
    expect(await isTillAccessGranted('emp-1')).toBe(true);
  });

  it('refuses sign-off while blocking tasks are open (TILL_ACCESS_BLOCKED)', async () => {
    db.onboardingPlan.findFirst.mockResolvedValue({
      id: 'plan-1',
      status: 'IN_PROGRESS',
      employeeId: 'emp-1',
      tasks: [{ id: 't1', isComplete: false, title: 'Cash handling policy' }],
    });
    await expect(signoffPlan('plan-1', 'store-1', 'user-1', 'HR_MANAGER')).rejects.toThrow(/TILL_ACCESS_BLOCKED/);
  });
});

describe('applicant conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is idempotent: a converted applicant returns the existing employee', async () => {
    db.applicant.findFirst.mockResolvedValue({
      id: 'app-1',
      email: 'new.hire@mbumahhardware.co.ke',
      status: 'HIRED',
      deletedAt: null,
      convertedEmployeeId: 'emp-9',
      job: { title: 'Cashier' },
    });
    db.employee.findUnique.mockResolvedValue({ id: 'emp-9', firstName: 'New', lastName: 'Hire' });
    db.onboardingPlan.findFirst.mockResolvedValue({ id: 'plan-9' });

    const result = await convertApplicantToEmployee({
      applicantId: 'app-1',
      storeId: 'store-1',
      actorId: 'user-1',
      actorRole: 'STORE_OWNER',
      data: {},
    });
    expect(result.created).toBe(false);
    expect(db.employee.create).not.toHaveBeenCalled();
  });

  it('blocks duplicate employee creation when the email already exists in the store', async () => {
    db.applicant.findFirst.mockResolvedValue({
      id: 'app-2',
      email: 'dup@mbumahhardware.co.ke',
      status: 'OFFER',
      deletedAt: null,
      convertedEmployeeId: null,
      job: { title: 'Cashier' },
    });
    db.employee.findFirst.mockResolvedValue({ id: 'emp-5' });
    db.employee.findUnique.mockResolvedValue({ id: 'emp-5', firstName: 'Dup', lastName: 'Hire' });
    db.onboardingPlan.findFirst.mockResolvedValue({ id: 'plan-5' });

    const result = await convertApplicantToEmployee({
      applicantId: 'app-2',
      storeId: 'store-1',
      actorId: 'user-1',
      actorRole: 'STORE_OWNER',
      data: {},
    });
    expect(result.created).toBe(false);
    expect(db.employee.create).not.toHaveBeenCalled();
    // Provenance healed.
    expect(db.applicant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-2' } }),
    );
  });

  it('requires consent at registration (service throws MISSING_CONSENT wording)', async () => {
    const { createApplicant } = await import('@/lib/hr/recruitment-service');
    await expect(
      createApplicant({
        jobId: 'job-1',
        storeId: 'store-1',
        actorId: 'user-1',
        actorRole: 'HR_MANAGER',
        data: { fullName: 'A B', email: 'a@b.co', consentGranted: false },
      }),
    ).rejects.toThrow(/MISSING_CONSENT/);
  });
});
