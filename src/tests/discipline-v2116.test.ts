import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.116.0 — "the trail reads back".
 *
 * v2.115.0 made restricted reads WRITE an audit trail; this round makes the
 * desk READ it back, honestly:
 *  1. PURE (buildAccessTrail): audit rows fold into a summary — prior opens,
 *     denied attempts, who/when last — order-independent, unrelated-action-
 *     proof, null when there is no trail.
 *  2. SERVICE (db-mocked): the trail is read BEFORE the current view writes
 *     its own event ("last opened by" is the previous reader, never the
 *     in-flight caller); names resolve for the last viewer only; STANDARD
 *     cases never touch the trail; the list stamps restricted rows with one
     grouped count — honest at zero, absent for STANDARD.
 *  3. SOURCE CONTRACTS: the page's trail block/chips/first-view line, the
 *     CSV's column contract untouched (no trail column, no description).
 */

const db = vi.hoisted(() => ({
  disciplinaryCase: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  employee: { findUnique: vi.fn() },
  auditLog: { findMany: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn() },
}));

const hrAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { DISCIPLINARY_CASE: 'DisciplinaryCase' },
}));

import { getCaseDetail, listCases } from '@/lib/hr/discipline-service';
import { buildAccessTrail, RESTRICTED_TRAIL_ACTIONS } from '@/lib/hr/discipline-ui';
import { StageGError } from '@/lib/hr/stage-g-shared';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-owner',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof getCaseDetail>[1];

const RESTRICTED_CASE = {
  id: 'case-1',
  employeeId: 'emp-1',
  type: 'GRIEVANCE',
  severity: 3,
  status: 'OPEN',
  issuedOn: new Date('2026-10-01T00:00:00Z'),
  expiresOn: null,
  confidentiality: 'RESTRICTED',
  description: 'The confidential description text',
  resolutionNotes: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  employee: { id: 'emp-1', storeId: 'store-1', firstName: 'Ada', lastName: 'One' },
};

const prior = (action: string, userId: string, iso: string) => ({
  action,
  userId,
  timestamp: new Date(iso),
});

beforeEach(() => {
  vi.clearAllMocks();
  db.disciplinaryCase.updateMany.mockResolvedValue({ count: 0 });
  db.employee.findUnique.mockResolvedValue({ firstName: 'Ada', lastName: 'One' });
  db.auditLog.findMany.mockResolvedValue([]);
  db.auditLog.groupBy.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildAccessTrail — the fold is pure and honest', () => {
  const VIEW = 'DISCIPLINARY_RESTRICTED_VIEWED';
  const DENY = 'DISCIPLINARY_RESTRICTED_DENIED';

  it('counts prior opens and denied attempts; last viewed/denied carry their moments', () => {
    const trail = buildAccessTrail([
      prior(VIEW, 'u-1', '2026-10-01T09:00:00Z'),
      prior(DENY, 'u-2', '2026-10-02T09:00:00Z'),
      prior(VIEW, 'u-3', '2026-10-03T09:00:00Z'),
      prior(VIEW, 'u-4', '2026-10-04T09:00:00Z'),
    ]);
    expect(trail).toEqual({
      viewCount: 3,
      deniedCount: 1,
      lastViewedAt: '2026-10-04T09:00:00.000Z',
      lastViewedByUserId: 'u-4',
      lastDeniedAt: '2026-10-02T09:00:00.000Z',
    });
  });

  it('input order does not matter — sorted chronologically before folding', () => {
    const a = buildAccessTrail([prior(VIEW, 'u-1', '2026-10-01T09:00:00Z'), prior(VIEW, 'u-2', '2026-10-05T09:00:00Z')]);
    const b = buildAccessTrail([prior(VIEW, 'u-2', '2026-10-05T09:00:00Z'), prior(VIEW, 'u-1', '2026-10-01T09:00:00Z')]);
    expect(a).toEqual(b);
    expect(a?.lastViewedByUserId).toBe('u-2');
  });

  it('unrelated actions never join the trail', () => {
    expect(
      buildAccessTrail([
        { action: 'DISCIPLINARY_CASE_OPENED', userId: 'u-1', timestamp: new Date('2026-10-01T00:00:00Z') },
        { action: 'LOGIN', userId: 'u-1', timestamp: new Date('2026-10-02T00:00:00Z') },
      ]),
    ).toBeNull();
  });

  it('empty input is honestly null — the desk renders the first-logged-view state', () => {
    expect(buildAccessTrail([])).toBeNull();
  });

  it('a single prior view reads one open, no denied line material is invented', () => {
    const trail = buildAccessTrail([prior(VIEW, 'u-9', '2026-10-01T09:00:00Z')]);
    expect(trail).toMatchObject({ viewCount: 1, deniedCount: 0, lastDeniedAt: null });
  });

  it('only the two trail actions are admitted (the constant is the contract)', () => {
    expect(RESTRICTED_TRAIL_ACTIONS).toEqual(['DISCIPLINARY_RESTRICTED_VIEWED', 'DISCIPLINARY_RESTRICTED_DENIED']);
  });
});

describe('getCaseDetail — the trail reads back before it writes', () => {
  it('a prior trail returns last-viewed with a resolved name and honest counts', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    db.auditLog.findMany.mockResolvedValue([
      { action: 'DISCIPLINARY_RESTRICTED_VIEWED', userId: 'u-hr', timestamp: new Date('2026-10-02T08:00:00Z') },
      { action: 'DISCIPLINARY_RESTRICTED_DENIED', userId: 'u-mgr', timestamp: new Date('2026-10-03T08:00:00Z') },
    ]);
    db.user.findUnique.mockResolvedValue({ name: 'Hr Manager' });
    const detail = await getCaseDetail('case-1', SESSION);
    expect(detail.accessTrail).toEqual({
      viewCount: 1,
      deniedCount: 1,
      lastViewedAt: '2026-10-02T08:00:00.000Z',
      lastViewedByUserId: 'u-hr',
      lastDeniedAt: '2026-10-03T08:00:00.000Z',
      lastViewedByName: 'Hr Manager',
    });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u-hr' },
      select: { name: true },
    });
  });

  it('the trail query happens BEFORE the current VIEWED write (last opened = previous reader)', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    db.auditLog.findMany.mockResolvedValue([
      { action: 'DISCIPLINARY_RESTRICTED_VIEWED', userId: 'u-hr', timestamp: new Date('2026-10-02T08:00:00Z') },
    ]);
    await getCaseDetail('case-1', SESSION);
    expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(hrAudit).toHaveBeenCalledTimes(1);
    expect(db.auditLog.findMany.mock.invocationCallOrder[0]).toBeLessThan(hrAudit.mock.invocationCallOrder[0]);
  });

  it('the trail query only ever asks for the two confidentiality actions', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    await getCaseDetail('case-1', SESSION);
    const where = db.auditLog.findMany.mock.calls[0][0].where;
    expect(where.entityType).toBe('DisciplinaryCase');
    expect(where.entityId).toBe('case-1');
    expect(where.action.in).toEqual(['DISCIPLINARY_RESTRICTED_VIEWED', 'DISCIPLINARY_RESTRICTED_DENIED']);
  });

  it('no prior trail → accessTrail null and the write still happens (first logged view)', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    const detail = await getCaseDetail('case-1', SESSION);
    expect(detail.accessTrail).toBeNull();
    expect(hrAudit).toHaveBeenCalledTimes(1);
  });

  it('a name that cannot resolve degrades to null, never to a fabricated label', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    db.auditLog.findMany.mockResolvedValue([
      { action: 'DISCIPLINARY_RESTRICTED_VIEWED', userId: 'u-gone', timestamp: new Date('2026-10-02T08:00:00Z') },
    ]);
    db.user.findUnique.mockResolvedValue(null);
    const detail = await getCaseDetail('case-1', SESSION);
    expect(detail.accessTrail?.lastViewedByName).toBeNull();
    expect(detail.accessTrail?.lastViewedByUserId).toBe('u-gone');
  });

  it('STANDARD cases never touch the trail and never write a restricted audit', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue({ ...RESTRICTED_CASE, confidentiality: 'STANDARD' });
    const detail = await getCaseDetail('case-1', SESSION);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
    expect(hrAudit).not.toHaveBeenCalled();
    expect(detail.accessTrail).toBeNull();
  });

  it('the deny path is unchanged: audited THEN 403, and no trail rides the error', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    const mgr = { ...SESSION, userId: 'u-mgr', role: 'BRANCH_MANAGER' } as Parameters<typeof getCaseDetail>[1];
    await expect(getCaseDetail('case-1', mgr)).rejects.toBeInstanceOf(StageGError);
    expect(hrAudit.mock.calls[0][0].action).toBe('DISCIPLINARY_RESTRICTED_DENIED');
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe('listCases — the restricted rows wear their trail size', () => {
  const row = (id: string, confidentiality: string) => ({
    id,
    employeeId: 'emp-1',
    type: 'GRIEVANCE',
    severity: 3,
    status: 'OPEN',
    issuedOn: new Date('2026-10-01T00:00:00Z'),
    expiresOn: null,
    confidentiality,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    employee: { firstName: 'Ada', lastName: 'One' },
  });

  it('restricted rows get their grouped count; honest zero when the trail is empty', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue([row('case-1', 'RESTRICTED'), row('case-2', 'RESTRICTED')]);
    db.auditLog.groupBy.mockResolvedValue([{ entityId: 'case-2', _count: { _all: 3 } }]);
    const list = await listCases(SESSION);
    expect(db.auditLog.groupBy).toHaveBeenCalledTimes(1);
    expect(db.auditLog.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['entityId'],
      where: {
        entityType: 'DisciplinaryCase',
        action: 'DISCIPLINARY_RESTRICTED_VIEWED',
      },
    });
    expect(db.auditLog.groupBy.mock.calls[0][0].where.entityId.in).toEqual(['case-1', 'case-2']);
    expect(list.find((c) => c.id === 'case-1')?.restrictedViews).toBe(0);
    expect(list.find((c) => c.id === 'case-2')?.restrictedViews).toBe(3);
  });

  it('STANDARD rows carry no trail field at all', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue([row('case-3', 'STANDARD')]);
    const list = await listCases(SESSION);
    expect(db.auditLog.groupBy).not.toHaveBeenCalled();
    expect(list[0].restrictedViews).toBeUndefined();
  });

  it('the grouped count never asks for anything but VIEWED (denials live in the detail)', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue([row('case-1', 'RESTRICTED')]);
    await listCases(SESSION);
    expect(db.auditLog.groupBy.mock.calls[0][0].where.action).toBe('DISCIPLINARY_RESTRICTED_VIEWED');
  });
});

describe('source contracts — the page wears the trail, the CSV stays clean', () => {
  it('the detail dialog reads the trail back and names the first-logged-view state', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    expect(page).toContain('data-testid="hr-discipline-access-trail"');
    expect(page).toContain('data-testid="hr-discipline-trail-first"');
    expect(page).toContain('Access trail');
    expect(page).toContain('Last opened by');
    expect(page).toContain('This is the first logged view of this restricted record.');
    expect(page).toContain('<History className="h-3.5 w-3.5" aria-hidden /> Access trail');
    // denied attempts surface beside granted reads
    expect(page).toContain('denied');
  });

  it('the list rows show the trail chip and honest zero', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    expect(page).toContain('data-testid="hr-discipline-trail-chip"');
    expect(page).toContain('c.restrictedViews ?? 0');
    expect(page).toContain('Prior restricted opens recorded in the audit trail');
  });

  it('the CSV column contract is untouched — no trail column, still no description', () => {
    const csv = src('src/lib/hr/discipline-list-csv.ts');
    expect(csv).not.toContain('restrictedViews');
    expect(csv).not.toContain('accessTrail');
    expect(csv).not.toContain("'description'");
  });

  it('the service reads before it writes (source order pins the intent)', () => {
    const service = src('src/lib/hr/discipline-service.ts');
    const readBack = service.indexOf('db.auditLog.findMany');
    // lastIndexOf: the FIRST "VIEWED" occurrence is the list's groupBy where
    // clause (listCases sits earlier in the file) — the detail write is last.
    const write = service.lastIndexOf("action: 'DISCIPLINARY_RESTRICTED_VIEWED'");
    expect(readBack).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(readBack).toBeLessThan(write);
  });
});
