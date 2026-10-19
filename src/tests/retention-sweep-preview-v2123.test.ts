import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.123.0 — "the sweep shows its hand".
 *
 * The desk could say the sweep runs nightly, but never WHAT it would sweep.
 * This round adds the dry run:
 *  1. THE SINGLE SOURCE OF TRUTH: three pure where-builders (applicant /
 *     disciplinary / attendance) now feed BOTH the executing sweep and the
 *     preview counts — the two can never disagree about what "in scope"
 *     means, and the redaction guard ("REDACTED (retention)") rides every
 *     clause so an already-anonymised row is invisible to both.
 *  2. THE DRY RUN: previewRetentionSweep counts each scope's backlog with
 *     count() — changing nothing. A held scope still reports its backlog
 *     with held: true (the hold freezes the sweep, not the truth).
 *  3. THE PURE HUMANISER: describeSweepPreview ("nothing to sweep" / "3 in
 *     scope" / "3 waiting behind the hold" / "nothing waiting") — computed
 *     SERVER-side like windowLabel, so the client page never imports the
 *     service module (it pulls the db client).
 *  4. THE DESK: the fold carries sweepable + sweepLabel per view,
 *     sweepableTotal sums over NON-held scopes only (what the next run
 *     actually targets), the GET surfaces it, and the Privacy tab renders a
 *     "Next sweep" column + a second counts strip line with honest zero and
 *     pacing (>500) states.
 */

const db = vi.hoisted(() => ({
  hrSetting: { findMany: vi.fn() },
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
  previewRetentionSweep,
  describeSweepPreview,
  applicantSweepWhere,
  disciplinarySweepWhere,
  attendanceSweepWhere,
  HR_RETENTION_POLICIES,
} from '@/lib/hr/data-protection';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-owner',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof listRetentionPolicies>[0];

beforeEach(() => {
  vi.clearAllMocks();
  db.hrSetting.findMany.mockResolvedValue([]);
  db.store.findMany.mockResolvedValue([{ id: 'store-1' }, { id: 'store-2' }]);
  db.applicant.count.mockResolvedValue(0);
  db.disciplinaryCase.count.mockResolvedValue(0);
  db.attendanceRecord.count.mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the where-builders — one source of truth for "in scope"', () => {
  it('applicant: REJECTED/WITHDRAWN past the row expiry, store-scoped, redaction-guarded', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    const where = applicantSweepWhere(now, ['s1', 's2']);
    expect(where.status).toEqual({ in: ['REJECTED', 'WITHDRAWN'] });
    expect(where.dataRetentionUntil).toEqual({ lt: now });
    expect(where.storeId).toEqual({ in: ['s1', 's2'] });
    expect(where.fullName).toEqual({ not: 'REDACTED (retention)' });
  });

  it('disciplinary: three closed statuses past exactly 3 years, redaction-guarded', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    const where = disciplinarySweepWhere(now, 'org-1');
    expect(where.status).toEqual({ in: ['RESOLVED', 'DISMISSED', 'EXPIRED'] });
    expect((where.updatedAt as { lt: Date }).lt.getTime()).toBe(now.getTime() - 3 * 365 * 24 * 3600 * 1000);
    expect(where.employee).toEqual({ store: { organizationId: 'org-1' } });
    expect(where.description).toEqual({ not: 'REDACTED (retention)' });
  });

  it('attendance: past exactly 2 years, device-carrying only (the sweep clears sourceDevice)', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    const where = attendanceSweepWhere(now, 'org-1');
    expect((where.date as { lt: Date }).lt.getTime()).toBe(now.getTime() - 2 * 365 * 24 * 3600 * 1000);
    expect(where.employee).toEqual({ store: { organizationId: 'org-1' } });
    expect(where.sourceDevice).toEqual({ not: null });
  });
});

describe('previewRetentionSweep — the dry run changes nothing', () => {
  it('counts each scope with the SAME where-builders the sweep executes', async () => {
    db.applicant.count.mockResolvedValue(2);
    db.disciplinaryCase.count.mockResolvedValue(1);
    db.attendanceRecord.count.mockResolvedValue(7);
    const preview = await previewRetentionSweep('org-1');
    expect(preview.map((p) => p.scope)).toEqual(HR_RETENTION_POLICIES.map((p) => p.scope));
    expect(preview.find((p) => p.scope === 'hr_applicant_rejection_data')?.sweepable).toBe(2);
    expect(preview.find((p) => p.scope === 'hr_disciplinary_closed')?.sweepable).toBe(1);
    expect(preview.find((p) => p.scope === 'hr_attendance_daily')?.sweepable).toBe(7);
    // the counts ride the builders (orgStoreIds from the org's stores)
    expect(db.store.findMany).toHaveBeenCalledWith({ where: { organizationId: 'org-1' }, select: { id: true } });
    const YEAR = 365 * 24 * 3600 * 1000;
    const aw = db.applicant.count.mock.calls[0][0].where;
    expect(aw).toEqual(applicantSweepWhere(aw.dataRetentionUntil.lt as Date, ['store-1', 'store-2']));
    const dw = db.disciplinaryCase.count.mock.calls[0][0].where;
    expect(dw).toEqual(disciplinarySweepWhere(new Date((dw.updatedAt as { lt: Date }).lt.getTime() + 3 * YEAR), 'org-1'));
    const vw = db.attendanceRecord.count.mock.calls[0][0].where;
    expect(vw).toEqual(attendanceSweepWhere(new Date((vw.date as { lt: Date }).lt.getTime() + 2 * YEAR), 'org-1'));
  });

  it('held flags ride the SAME reader the sweep obeys (value true IS the hold)', async () => {
    db.hrSetting.findMany.mockResolvedValue([
      { key: 'legalHold:hr_attendance_daily', value: 'true', updatedAt: new Date() },
      { key: 'legalHold:hr_disciplinary_closed', value: 'false', updatedAt: new Date() },
    ]);
    const preview = await previewRetentionSweep('org-1');
    expect(preview.find((p) => p.scope === 'hr_attendance_daily')?.held).toBe(true);
    expect(preview.find((p) => p.scope === 'hr_disciplinary_closed')?.held).toBe(false);
    expect(preview.find((p) => p.scope === 'hr_applicant_rejection_data')?.held).toBe(false);
  });

  it('a held scope still reports its backlog — the hold freezes the sweep, not the truth', async () => {
    db.hrSetting.findMany.mockResolvedValue([{ key: 'legalHold:hr_attendance_daily', value: 'true', updatedAt: new Date() }]);
    db.attendanceRecord.count.mockResolvedValue(4);
    const preview = await previewRetentionSweep('org-1');
    const held = preview.find((p) => p.scope === 'hr_attendance_daily');
    expect(held?.sweepable).toBe(4);
    expect(held?.held).toBe(true);
  });
});

describe('describeSweepPreview — the pure humaniser', () => {
  it('zero states split on the hold; positive states name the backlog plainly', () => {
    expect(describeSweepPreview(0, false)).toBe('nothing to sweep');
    expect(describeSweepPreview(0, true)).toBe('nothing waiting');
    expect(describeSweepPreview(3, false)).toBe('3 in scope');
    expect(describeSweepPreview(12, true)).toBe('12 waiting behind the hold');
  });
});

describe('the desk fold — sweepable rides every view', () => {
  it('sweepable + sweepLabel fold per policy; labels honour the hold state', async () => {
    db.applicant.count.mockResolvedValue(2);
    db.attendanceRecord.count.mockResolvedValue(9);
    db.hrSetting.findMany.mockResolvedValue([{ key: 'legalHold:hr_attendance_daily', value: 'true', updatedAt: new Date() }]);
    const desk = await listRetentionPolicies(SESSION);
    const applicant = desk.policies.find((p) => p.scope === 'hr_applicant_rejection_data');
    const attendance = desk.policies.find((p) => p.scope === 'hr_attendance_daily');
    expect(applicant?.sweepable).toBe(2);
    expect(applicant?.sweepLabel).toBe('2 in scope');
    expect(attendance?.sweepable).toBe(9);
    expect(attendance?.sweepLabel).toBe('9 waiting behind the hold');
  });

  it('sweepableTotal sums over NON-held scopes only — what the next run targets', async () => {
    db.applicant.count.mockResolvedValue(2);
    db.disciplinaryCase.count.mockResolvedValue(5);
    db.attendanceRecord.count.mockResolvedValue(9);
    db.hrSetting.findMany.mockResolvedValue([{ key: 'legalHold:hr_attendance_daily', value: 'true', updatedAt: new Date() }]);
    const desk = await listRetentionPolicies(SESSION);
    expect(desk.sweepableTotal).toBe(7); // 2 + 5; the held 9 stays out
  });
});

describe('routes — the dry run rides the desk read', () => {
  it('retention GET surfaces sweepableTotal alongside the policies', () => {
    const route = src('src/app/api/hr/privacy/retention/route.ts');
    expect(route).toContain('sweepableTotal: desk.sweepableTotal');
    expect(route).toContain('listRetentionPolicies(session)');
    expect(route).toContain("hrGuard('hr.report.branch', VIEW_ROLES)");
  });
});

describe('the Privacy tab — the desk shows its hand', () => {
  const page = src('src/app/(shell)/hr/reports/page.tsx');

  it('a Next sweep column renders the server-computed label per scope', () => {
    expect(page).toContain('data-testid="hr-retention-preview-col"');
    expect(page).toContain('Next sweep');
    expect(page).toContain('hr-retention-sweep-${p.scope}');
    expect(page).toContain('{p.sweepLabel}');
    expect(page).toContain("Dry run — counts rows matching the sweep's own criteria; nothing is changed.");
  });

  it('the held backlog wears the amber vocabulary; the dry run discloses itself in the tooltip', () => {
    expect(page).toContain("p.held && p.sweepable > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'");
    expect(page).toContain('A hold stands — these rows wait until a settings manager releases the scope.');
    expect(page).toContain('Dry-run count — what the next nightly run would anonymise; nothing is changed.');
  });

  it('a second counts strip line answers the backlog with honest zero and pacing states', () => {
    expect(page).toContain('data-testid="hr-privacy-retention-sweep-count"');
    expect(page).toContain('Counting the sweep backlog…');
    expect(page).toContain('would be anonymised on the next nightly run');
    expect(page).toContain("retention.sweepableTotal === 1 ? 'row' : 'rows'");
    expect(page).toContain('the sweep takes up to 500 per night');
    expect(page).toContain('nothing to sweep tonight — every scope sits inside its window');
  });

  it('the page still never imports the service module — labels ride the DTO', () => {
    expect(page).not.toContain("from '@/lib/hr/data-protection'");
    expect(page).toContain('p.windowLabel');
    expect(page).toContain('sweepableTotal: number;');
  });
});

describe('the single source of truth holds in source', () => {
  it('the executing sweep consumes the SAME builders the preview counts', () => {
    const lib = src('src/lib/hr/data-protection.ts');
    expect(lib).toContain('where: applicantSweepWhere(now, orgStoreIds)');
    expect(lib).toContain('where: disciplinarySweepWhere(now, organizationId)');
    expect(lib).toContain('where: attendanceSweepWhere(now, organizationId)');
    expect(lib).toContain('db.applicant.count({ where: applicantSweepWhere(now, orgStoreIds) })');
    // the redaction guard stays the shared marker, not a string scatter
    expect(lib).toContain("const RETENTION_REDACTED = 'REDACTED (retention)';");
    expect(lib).toContain('fullName: { not: RETENTION_REDACTED }');
    expect(lib).toContain('description: { not: RETENTION_REDACTED }');
  });

  it('prior anchors: the three posture cards stand beside the dry run', () => {
    const page = src('src/app/(shell)/hr/reports/page.tsx');
    expect(page).toContain('Consent records (Data Protection Act posture)');
    expect(page).toContain('Erasure requests (Data Protection Act posture)');
    expect(page).toContain('Retention &amp; legal holds (Data Protection Act posture)');
    expect(page).toContain('data-testid="hr-privacy-retention-hold-count"');
  });
});
