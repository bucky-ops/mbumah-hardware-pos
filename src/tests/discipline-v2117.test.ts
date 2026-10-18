import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.117.0 — "the ledger reads the room".
 *
 * The cross-case restricted-access ledger: the same audit events the trail
 * writes, read back ACROSS cases in a clamped window.
 *  1. PURE: relativeTimeLabel (calendar-day honesty, skew clamp, garbage →
 *     null), clampLedgerWindow (default fallback + hard cap), foldAccessLedger
 *     (name joins, denied flag, unrelated-action filter, order preserved).
 *  2. SERVICE (db-mocked): the SAME employee scope as listCases answers the
 *     query (fail-closed), zero visible cases short-circuits to [], the
 *     window rides the clamped `since`, names resolve in batch, the payload
 *     is content-free (who/when/which employee — never the description).
 *  3. SOURCE CONTRACTS: the ledger card's testids/filters/empty states/deep
 *     link; the route guard keeps its key; the trail block of v2.116.0
 *     coexists with the ledger (two read-backs, one trail).
 */

const db = vi.hoisted(() => ({
  disciplinaryCase: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  employee: { findUnique: vi.fn() },
  auditLog: { findMany: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
}));

const hrAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { DISCIPLINARY_CASE: 'DisciplinaryCase' },
}));

import { listRestrictedAccess } from '@/lib/hr/discipline-service';
import {
  relativeTimeLabel,
  clampLedgerWindow,
  foldAccessLedger,
  ACCESS_LEDGER_MAX_DAYS,
  ACCESS_LEDGER_LIMIT,
} from '@/lib/hr/discipline-ui';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-owner',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof listRestrictedAccess>[0];

const VIEW = 'DISCIPLINARY_RESTRICTED_VIEWED';
const DENY = 'DISCIPLINARY_RESTRICTED_DENIED';

beforeEach(() => {
  vi.clearAllMocks();
  db.disciplinaryCase.findMany.mockResolvedValue([]);
  db.auditLog.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('relativeTimeLabel — calendar-day honesty with a skew clamp', () => {
  const pin = (iso: string) => new Date(iso);

  it('just now / minutes / hours', () => {
    const now = pin('2026-10-19T10:00:00Z');
    expect(relativeTimeLabel('2026-10-19T09:59:40Z', now)).toBe('just now');
    expect(relativeTimeLabel('2026-10-19T09:54:00Z', now)).toBe('6m ago');
    expect(relativeTimeLabel('2026-10-19T08:00:00Z', now)).toBe('2h ago');
  });

  it('beyond a day reads CALENDAR days (not ms ceilings); hours stay honest', () => {
    const now = pin('2026-10-19T10:00:00Z');
    // 23h ago is still hours, not "1d"
    expect(relativeTimeLabel('2026-10-18T11:00:00Z', now)).toBe('23h ago');
    // 00:30 today (9.5h ago) — the hours branch wins, hours ARE the honest unit
    expect(relativeTimeLabel('2026-10-19T00:30:00Z', now)).toBe('9h ago');
    // 25h ago crosses midnight into yesterday: calendar day = 1
    expect(relativeTimeLabel('2026-10-18T09:00:00Z', now)).toBe('1d ago');
  });

  it('a future timestamp (clock skew) clamps to just now; garbage is null', () => {
    const now = pin('2026-10-19T10:00:00Z');
    expect(relativeTimeLabel('2026-10-19T10:00:01Z', now)).toBe('just now');
    expect(relativeTimeLabel('not-a-date', now)).toBeNull();
    expect(relativeTimeLabel(null, now)).toBeNull();
  });
});

describe('clampLedgerWindow — the window cannot become an unbounded scan', () => {
  it('non-positive / non-numeric / missing falls back to the default', () => {
    expect(clampLedgerWindow(undefined)).toBe(30);
    expect(clampLedgerWindow(null)).toBe(30);
    expect(clampLedgerWindow(0)).toBe(30);
    expect(clampLedgerWindow(-5)).toBe(30);
    expect(clampLedgerWindow('abc')).toBe(30);
  });

  it('above the cap is capped; fractions floor; in-range passes through', () => {
    expect(clampLedgerWindow(9999)).toBe(ACCESS_LEDGER_MAX_DAYS);
    expect(clampLedgerWindow('90')).toBe(90);
    expect(clampLedgerWindow(7.9)).toBe(7);
  });

  it('the row cap is a contract, not a suggestion', () => {
    expect(ACCESS_LEDGER_LIMIT).toBe(200);
  });
});

describe('foldAccessLedger — the fold joins names and flags denials', () => {
  const evt = (entityId: string, action: string, userId: string | null, iso: string) => ({
    entityId,
    action,
    userId,
    timestamp: new Date(iso),
  });

  it('joins case and user names, flags denied, preserves newest-first order', () => {
    const rows = foldAccessLedger(
      [
        evt('case-2', DENY, 'u-mgr', '2026-10-19T09:00:00Z'),
        evt('case-1', VIEW, 'u-hr', '2026-10-19T08:00:00Z'),
      ],
      { 'case-1': 'Ada One', 'case-2': 'Ben Two' },
      { 'u-hr': 'Hr Manager', 'u-mgr': 'Branch Manager' },
    );
    expect(rows).toEqual([
      { caseId: 'case-2', employeeName: 'Ben Two', action: DENY, denied: true, userId: 'u-mgr', userName: 'Branch Manager', timestamp: '2026-10-19T09:00:00.000Z' },
      { caseId: 'case-1', employeeName: 'Ada One', action: VIEW, denied: false, userId: 'u-hr', userName: 'Hr Manager', timestamp: '2026-10-19T08:00:00.000Z' },
    ]);
  });

  it('unrelated actions never join; missing names degrade to null honestly', () => {
    const rows = foldAccessLedger(
      [
        evt('case-1', 'DISCIPLINARY_CASE_OPENED', 'u-1', '2026-10-19T09:00:00Z'),
        evt('case-3', VIEW, 'u-gone', '2026-10-19T08:00:00Z'),
      ],
      { 'case-1': 'Ada One' },
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ caseId: 'case-3', employeeName: null, userName: null, denied: false });
  });

  it('a null userId folds to a null user (the UI says "an unknown user")', () => {
    const rows = foldAccessLedger([evt('case-1', VIEW, null, '2026-10-19T08:00:00Z')], { 'case-1': 'Ada One' }, { 'u-hr': 'Hr Manager' });
    expect(rows[0].userId).toBeNull();
    expect(rows[0].userName).toBeNull();
  });
});

describe('listRestrictedAccess — the ledger answers the SAME scope as the list', () => {
  const CASES = [
    { id: 'case-1', employee: { firstName: 'Ada', lastName: 'One' } },
    { id: 'case-2', employee: { firstName: 'Ben', lastName: 'Two' } },
  ];

  it('zero visible cases short-circuits — no audit query runs at all', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue([]);
    const rows = await listRestrictedAccess(SESSION, { days: '30' });
    expect(rows).toEqual([]);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('the window rides the clamped since; the actions and entity set are exact', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue(CASES);
    await listRestrictedAccess(SESSION, { days: '9999' });
    const where = db.auditLog.findMany.mock.calls[0][0].where;
    expect(where.entityType).toBe('DisciplinaryCase');
    expect(where.entityId.in).toEqual(['case-1', 'case-2']);
    expect(where.action.in).toEqual([VIEW, DENY]);
    const expectedSince = Date.now() - ACCESS_LEDGER_MAX_DAYS * 86_400_000;
    expect(where.timestamp.gte.getTime()).toBeGreaterThanOrEqual(expectedSince - 1000);
    expect(where.timestamp.gte.getTime()).toBeLessThanOrEqual(expectedSince + 1000);
    expect(db.auditLog.findMany.mock.calls[0][0].take).toBe(ACCESS_LEDGER_LIMIT);
  });

  it('rows come back newest-first with batch-resolved names (no description)', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue(CASES);
    db.auditLog.findMany.mockResolvedValue([
      { entityId: 'case-2', action: DENY, userId: 'u-mgr', timestamp: new Date('2026-10-19T09:00:00Z') },
      { entityId: 'case-1', action: VIEW, userId: 'u-hr', timestamp: new Date('2026-10-19T08:00:00Z') },
    ]);
    db.user.findMany.mockResolvedValue([{ id: 'u-mgr', name: 'Branch Manager' }, { id: 'u-hr', name: 'Hr Manager' }]);
    const rows = await listRestrictedAccess(SESSION, { days: '30' });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-mgr', 'u-hr'] } },
      select: { id: true, name: true },
    });
    expect(rows[0]).toMatchObject({ caseId: 'case-2', userName: 'Branch Manager', denied: true });
    expect(rows[1]).toMatchObject({ caseId: 'case-1', userName: 'Hr Manager', denied: false });
    // content-free contract: the serialized payload names no description
    expect(JSON.stringify(rows)).not.toContain('description');
    expect(JSON.stringify(rows)).not.toContain('resolutionNotes');
  });

  it('an empty event set skips the user query entirely', async () => {
    db.disciplinaryCase.findMany.mockResolvedValue(CASES);
    const rows = await listRestrictedAccess(SESSION, {});
    expect(rows).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
    // default window rides when days is absent
    const where = db.auditLog.findMany.mock.calls[0][0].where;
    expect(clampLedgerWindow(undefined)).toBe(30);
    expect(where.timestamp.gte.getTime()).toBeLessThanOrEqual(Date.now() - 30 * 86_400_000 + 1000);
  });
});

describe('source contracts — the ledger card, the route, the guard', () => {
  it('the desk wears the ledger: card, counts, filters, chips, empty states, deep link', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    expect(page).toContain('data-testid="hr-discipline-ledger"');
    expect(page).toContain('data-testid="hr-discipline-ledger-counts"');
    expect(page).toContain('data-testid="hr-discipline-ledger-open-chip"');
    expect(page).toContain('data-testid="hr-discipline-ledger-denied-chip"');
    expect(page).toContain('aria-label="Ledger window"');
    expect(page).toContain('aria-label="Filter ledger by action"');
    expect(page).toContain('aria-label="Refresh access ledger"');
    expect(page).toContain('No restricted access recorded in this window.');
    expect(page).toContain('No events match the current filter.');
    expect(page).toContain('Open case from ledger');
    expect(page).toContain('restricted-access?days=');
  });

  it('the ledger route keeps the discipline guard key (no widening)', () => {
    const route = src('src/app/api/hr/discipline/restricted-access/route.ts');
    expect(route).toContain("hrGuard('hr.discipline.manage')");
    expect(route).toContain('listRestrictedAccess');
  });

  it('both read-backs coexist: the single-case trail and the cross-case ledger', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    expect(page).toContain('data-testid="hr-discipline-access-trail"');
    expect(page).toContain('data-testid="hr-discipline-ledger"');
    const service = src('src/lib/hr/discipline-service.ts');
    expect(service).toContain('buildAccessTrail');
    expect(service).toContain('foldAccessLedger');
    expect(service).toContain('employeeScopeWhere(session)');
  });
});
