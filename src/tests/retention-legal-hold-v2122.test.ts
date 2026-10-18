import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.122.0 — "the hold takes the desk".
 *
 * The retention sweep has run nightly since v2.20.0 and legal holds have
 * always been able to block it — but a hold could only be set by a RAW
 * HrSetting write. No route, no UI, no desk. This round gives the mechanism
 * a surface:
 *  1. THE FOLD (db-mocked): listRetentionPolicies folds the reviewable
 *     policies with their live hold state — presence of a row with value
 *     'true' IS the hold (the same representation getLegalHolds reads),
 *     heldAt rides the setting row, canDecide mirrors the erasure gate.
 *  2. THE DECISIONS: setLegalHold creates the hold row (value 'true') and
 *     RELEASE DELETES it (no dead settings linger) — both refuse honestly
 *     (409 HOLD_ACTIVE / NO_ACTIVE_HOLD), both validate input (400
 *     UNKNOWN_SCOPE with the valid list / INVALID_HELD for non-boolean),
 *     both audit LEGAL_HOLD_SET / LEGAL_HOLD_RELEASED on the HrSetting key.
 *  3. THE PURE WINDOW LABEL: describeRetentionWindow humanises the window
 *     ("3 years after updatedAt", "the row's own expiry (dataRetentionUntil)")
 *     — computed SERVER-side and carried on the DTO so the client page never
 *     imports the service module (it pulls the db client).
 *  4. SOURCE CONTRACTS: the routes (guard + DECISION_FORBIDDEN), the Privacy
 *     tab's third posture card (testids, amber/slate chips, two-step
 *     release, muted non-decider, local note), and the sweep reader stays
 *     `value === 'true'`.
 */

const db = vi.hoisted(() => ({
  hrSetting: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  // v2.123.0: the desk fold now also runs the dry run (previewRetentionSweep)
  store: { findMany: vi.fn() },
  applicant: { count: vi.fn() },
  disciplinaryCase: { count: vi.fn() },
  attendanceRecord: { count: vi.fn() },
}));

const hrAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { HR_SETTING: 'HrSetting', EMPLOYEE: 'Employee', APPLICANT: 'Applicant' },
}));

import {
  listRetentionPolicies,
  setLegalHold,
  describeRetentionWindow,
  HR_RETENTION_POLICIES,
  type RetentionPolicyView,
} from '@/lib/hr/data-protection';
import type { StageGError } from '@/lib/hr/stage-g-shared';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-owner',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof listRetentionPolicies>[0];

const holdRow = (scope: string, at = new Date('2026-10-19T00:00:00Z')) => ({
  key: `legalHold:${scope}`,
  value: 'true',
  updatedAt: at,
});

/** Await a promise that MUST reject, surfacing the StageGError code + status.
 * (Promise.catch's TResult union would make `.code` unreadable — tsc-clean.) */
async function expectReject(p: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await p;
  } catch (e) {
    const err = e as StageGError;
    return { code: err.code, status: err.status };
  }
  throw new Error('expected the promise to reject');
}

beforeEach(() => {
  vi.clearAllMocks();
  db.hrSetting.findMany.mockResolvedValue([]);
  // the dry run rides the fold since v2.123.0 — zero backlog by default
  db.store.findMany.mockResolvedValue([{ id: 'store-1' }]);
  db.applicant.count.mockResolvedValue(0);
  db.disciplinaryCase.count.mockResolvedValue(0);
  db.attendanceRecord.count.mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listRetentionPolicies — the fold tells the truth', () => {
  it('every reviewable policy appears; held scopes carry heldAt; heldCount counts', async () => {
    db.hrSetting.findMany.mockResolvedValue([holdRow('hr_disciplinary_closed')]);
    const desk = await listRetentionPolicies(SESSION);
    expect(desk.policies.map((p) => p.scope)).toEqual(HR_RETENTION_POLICIES.map((p) => p.scope));
    const disciplinary = desk.policies.find((p) => p.scope === 'hr_disciplinary_closed') as RetentionPolicyView;
    expect(disciplinary.held).toBe(true);
    expect(disciplinary.heldAt).toBe('2026-10-19T00:00:00.000Z');
    expect(desk.policies.filter((p) => p.scope !== 'hr_disciplinary_closed').every((p) => !p.held && p.heldAt === null)).toBe(true);
    expect(desk.heldCount).toBe(1);
  });

  it('a stale value=false row is NOT a hold — presence with value true is the hold', async () => {
    db.hrSetting.findMany.mockResolvedValue([
      { key: 'legalHold:hr_attendance_daily', value: 'false', updatedAt: new Date() },
      holdRow('hr_applicant_rejection_data'),
    ]);
    const desk = await listRetentionPolicies(SESSION);
    expect(desk.policies.find((p) => p.scope === 'hr_attendance_daily')?.held).toBe(false);
    expect(desk.policies.find((p) => p.scope === 'hr_applicant_rejection_data')?.held).toBe(true);
    expect(desk.heldCount).toBe(1);
  });

  it('canDecide mirrors the erasure gate (hr.settings.manage = SUPER_ADMIN)', async () => {
    db.hrSetting.findMany.mockResolvedValue([]);
    const owner = await listRetentionPolicies(SESSION);
    expect(owner.canDecide).toBe(false);
    const admin = await listRetentionPolicies({ ...SESSION, role: 'SUPER_ADMIN' } as typeof SESSION);
    expect(admin.canDecide).toBe(true);
  });

  it('windowLabel rides the view (computed server-side from the policy)', async () => {
    db.hrSetting.findMany.mockResolvedValue([]);
    const desk = await listRetentionPolicies(SESSION);
    expect(desk.policies.find((p) => p.scope === 'hr_disciplinary_closed')?.windowLabel).toBe('3 years after updatedAt');
    expect(desk.policies.find((p) => p.scope === 'hr_applicant_rejection_data')?.windowLabel).toBe("the row's own expiry (dataRetentionUntil)");
  });
});

describe('describeRetentionWindow — the pure humaniser', () => {
  it('zero-day windows point at the row expiry; year windows pluralise; odd days stay days', () => {
    expect(describeRetentionWindow({ retentionDays: 0, measuredFrom: 'dataRetentionUntil' })).toBe("the row's own expiry (dataRetentionUntil)");
    expect(describeRetentionWindow({ retentionDays: 3 * 365, measuredFrom: 'updatedAt' })).toBe('3 years after updatedAt');
    expect(describeRetentionWindow({ retentionDays: 365, measuredFrom: 'date' })).toBe('1 year after date');
    expect(describeRetentionWindow({ retentionDays: 180, measuredFrom: 'closedAt' })).toBe('180 days after closedAt');
  });
});

describe('setLegalHold — the decision writes what the sweep obeys', () => {
  it('HOLD: creates the row with value true + updatedBy, audits LEGAL_HOLD_SET on the key', async () => {
    db.hrSetting.findFirst.mockResolvedValue(null);
    db.hrSetting.create.mockResolvedValue(holdRow('hr_applicant_rejection_data'));
    const result = await setLegalHold({ scope: 'hr_applicant_rejection_data', held: true }, SESSION);
    expect(result).toEqual({ scope: 'hr_applicant_rejection_data', held: true, heldAt: '2026-10-19T00:00:00.000Z' });
    expect(db.hrSetting.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        key: 'legalHold:hr_applicant_rejection_data',
        value: 'true',
        updatedByUserId: 'user-owner',
      },
    });
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LEGAL_HOLD_SET',
        resourceType: 'HrSetting',
        resourceId: 'legalHold:hr_applicant_rejection_data',
        metadata: { scope: 'hr_applicant_rejection_data', held: true },
      }),
    );
  });

  it('HOLD refuses 409 HOLD_ACTIVE when a hold already stands', async () => {
    db.hrSetting.findFirst.mockResolvedValue({ id: 'row-1' });
    await expect(setLegalHold({ scope: 'hr_attendance_daily', held: true }, SESSION)).rejects.toMatchObject({ code: 'HOLD_ACTIVE', status: 409 });
    expect(db.hrSetting.create).not.toHaveBeenCalled();
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('RELEASE deletes the row (value true only) and audits LEGAL_HOLD_RELEASED', async () => {
    db.hrSetting.deleteMany.mockResolvedValue({ count: 1 });
    const result = await setLegalHold({ scope: 'hr_disciplinary_closed', held: false }, SESSION);
    expect(result).toEqual({ scope: 'hr_disciplinary_closed', held: false, heldAt: null });
    expect(db.hrSetting.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', key: 'legalHold:hr_disciplinary_closed', value: 'true' },
    });
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LEGAL_HOLD_RELEASED',
        resourceType: 'HrSetting',
        resourceId: 'legalHold:hr_disciplinary_closed',
        metadata: { scope: 'hr_disciplinary_closed', held: false },
      }),
    );
  });

  it('RELEASE refuses 409 NO_ACTIVE_HOLD when nothing is held (delete count 0)', async () => {
    db.hrSetting.deleteMany.mockResolvedValue({ count: 0 });
    await expect(setLegalHold({ scope: 'hr_disciplinary_closed', held: false }, SESSION)).rejects.toMatchObject({ code: 'NO_ACTIVE_HOLD', status: 409 });
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('unknown scope → 400 UNKNOWN_SCOPE naming the valid scopes; held must be a strict boolean', async () => {
    const badScope = await expectReject(setLegalHold({ scope: 'payroll_history', held: true }, SESSION));
    expect(badScope.code).toBe('UNKNOWN_SCOPE');
    expect(badScope.status).toBe(400);
    const message = await setLegalHold({ scope: 'payroll_history', held: true }, SESSION).catch((e) => (e as StageGError).message);
    for (const p of HR_RETENTION_POLICIES) expect(message).toContain(p.scope);
    const badHeld = await expectReject(setLegalHold({ scope: 'hr_attendance_daily', held: 'true' }, SESSION));
    expect(badHeld.code).toBe('INVALID_HELD');
    expect(badHeld.status).toBe(400);
    expect(db.hrSetting.create).not.toHaveBeenCalled();
    expect(db.hrSetting.deleteMany).not.toHaveBeenCalled();
  });
});

describe('routes — the desk guards like its siblings', () => {
  const route = src('src/app/api/hr/privacy/retention/route.ts');
  const action = src('src/app/api/hr/privacy/legal-hold/route.ts');

  it('retention GET: read-guarded hr.report.branch with the VIEW_ROLES trio, canDecide surfaced', () => {
    expect(route).toContain("hrGuard('hr.report.branch', VIEW_ROLES)");
    expect(route).toContain("['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER']");
    expect(route).toContain('canDecideErasure(session.role)');
    expect(route).toContain('listRetentionPolicies(session)');
  });

  it('legal-hold POST: same read key, DECISION_FORBIDDEN 403 for non-deciders, body passed whole', () => {
    expect(action).toContain("hrGuard('hr.report.branch')");
    expect(action).toContain("code: 'DECISION_FORBIDDEN'");
    expect(action).toContain('Only settings managers can set or release legal holds.');
    expect(action).toContain('setLegalHold(body, session)');
    expect(action).not.toContain('withdrawConsent');
  });
});

describe('the Privacy tab card — the desk on the page', () => {
  const page = src('src/app/(shell)/hr/reports/page.tsx');

  it('the third posture card carries its testids, counts strip, and honest chip pair', () => {
    expect(page).toContain('data-testid="hr-privacy-retention"');
    expect(page).toContain('data-testid="hr-privacy-retention-hold-count"');
    expect(page).toContain('scopes on hold');
    expect(page).toContain('the sweep skips them until release');
    expect(page).toContain('the sweep runs nightly');
    expect(page).toContain('hr-retention-row-${p.scope}');
    expect(page).toContain('hr-retention-hold-${p.scope}');
    expect(page).toContain('On hold');
    expect(page).toContain('Sweeping nightly');
    expect(page).toContain('border-amber-200 bg-amber-50');
    expect(page).toContain('border-slate-200 bg-slate-50');
  });

  it('release asks twice — the destructive direction arms a rose confirm row', () => {
    expect(page).toContain('hr-retention-arm-${p.scope}');
    expect(page).toContain('Release…');
    expect(page).toContain('Confirm release');
    expect(page).toContain('Release? The sweep resumes on its next run.');
    expect(page).toContain('setReleaseArm(null)');
  });

  it('hold reports where the action lives (local note, role=status) and the desk refetches', () => {
    expect(page).toContain('data-testid="hr-retention-note"');
    expect(page).toContain('role="status"');
    expect(page).toContain("runHold(p.scope, true)");
    expect(page).toContain("runHold(p.scope, false)");
    expect(page).toContain("apiSend('/api/hr/privacy/legal-hold', 'POST', { scope, held })");
    expect(page).toContain('await loadRetention()');
  });

  it('non-deciders see the muted truth; the page never imports the service module', () => {
    expect(page).toContain('settings managers decide');
    expect(page).not.toContain("from '@/lib/hr/data-protection'");
    expect(page).toContain('p.windowLabel');
  });
});

describe('the sweep reader stays the single truth', () => {
  it('getLegalHolds still reads value === true — the hold row is written exactly for it', () => {
    const lib = src('src/lib/hr/data-protection.ts');
    expect(lib).toContain(".filter((s) => s.value === 'true')");
    expect(lib).toContain("startsWith: 'legalHold:'");
    expect(lib).toContain("action: 'LEGAL_HOLD_SET'");
    expect(lib).toContain("action: 'LEGAL_HOLD_RELEASED'");
  });

  it('prior anchors: the consent and erasure cards stand beside the desk', () => {
    const page = src('src/app/(shell)/hr/reports/page.tsx');
    expect(page).toContain('Consent records (Data Protection Act posture)');
    expect(page).toContain('Erasure requests (Data Protection Act posture)');
    expect(page).toContain('Retention &amp; legal holds (Data Protection Act posture)');
  });
});
