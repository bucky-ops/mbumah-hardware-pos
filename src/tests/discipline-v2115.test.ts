import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.115.0 — "the restricted read leaves a trace".
 *
 * Four layers:
 *  1. SERVICE (db-mocked): getCaseDetail writes DISCIPLINARY_RESTRICTED_VIEWED
 *     for a granted restricted read and DISCIPLINARY_RESTRICTED_DENIED before
 *     the 403 on the allow-list's deny path — the metadata carries the
 *     confidentiality flag, NEVER the description; a STANDARD read writes
 *     neither. The allow-list itself is unchanged (defence in depth stays).
 *  2. CSV (pure): buildDisciplineListCsv — RFC 4180 escaping, CRLF endings,
 *     and the description-free column contract pinned cell by cell.
 *  3. UI HELPER (pure): expiresSoonLabel — the 14-day window, the OPEN-only
 *     rule, the past-due guard, the same-day label.
 *  4. SOURCE CONTRACTS (read the bytes): the page's search/type-filter/CSV
 *     door/chips/counts line/audit note; the route guard unchanged.
 */

const db = vi.hoisted(() => ({
  disciplinaryCase: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  employee: { findUnique: vi.fn() },
  // v2.116.0: the restricted-read path reads the trail back BEFORE writing
  // its own event — re-anchored with empty defaults (first logged view).
  auditLog: { findMany: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn() },
}));

const hrAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { DISCIPLINARY_CASE: 'DisciplinaryCase' },
}));

import { getCaseDetail } from '@/lib/hr/discipline-service';
import { buildDisciplineListCsv } from '@/lib/hr/discipline-list-csv';
import { expiresSoonLabel } from '@/lib/hr/discipline-ui';
import { StageGError } from '@/lib/hr/stage-g-shared';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-1',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof getCaseDetail>[1];

const BRANCH_SESSION = {
  userId: 'user-2',
  role: 'BRANCH_MANAGER',
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

beforeEach(() => {
  vi.clearAllMocks();
  db.disciplinaryCase.updateMany.mockResolvedValue({ count: 0 });
  db.employee.findUnique.mockResolvedValue({ firstName: 'Ada', lastName: 'One' });
  db.auditLog.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCaseDetail — a granted restricted read leaves a trace', () => {
  it('STORE_OWNER opening a RESTRICTED case writes DISCIPLINARY_RESTRICTED_VIEWED (flag only, no description)', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    const detail = await getCaseDetail('case-1', SESSION);
    expect(detail.description).toBe('The confidential description text');
    expect(hrAudit).toHaveBeenCalledTimes(1);
    const call = hrAudit.mock.calls[0][0];
    expect(call.action).toBe('DISCIPLINARY_RESTRICTED_VIEWED');
    expect(call.resourceId).toBe('case-1');
    expect(call.actorRole).toBe('STORE_OWNER');
    expect(call.metadata).toEqual({ confidentiality: 'RESTRICTED', fieldNames: [] });
    expect(JSON.stringify(call.metadata)).not.toContain('description text');
    // v2.116.0 re-anchor: the trail is read back before the write; an empty
    // prior trail honestly reads null (first logged view).
    expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(detail.accessTrail).toBeNull();
  });

  it('a STANDARD case writes no restricted audit — the trail is for restricted reads only', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue({ ...RESTRICTED_CASE, confidentiality: 'STANDARD' });
    await getCaseDetail('case-1', SESSION);
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('BRANCH_MANAGER (in scope, outside the allow-list) is denied: audited THEN 403', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    await expect(getCaseDetail('case-1', BRANCH_SESSION)).rejects.toMatchObject({
      code: 'CONFIDENTIALITY_RESTRICTED',
      status: 403,
    });
    // the audit MUST be written before the throw — a trailing write never runs
    expect(hrAudit).toHaveBeenCalledTimes(1);
    expect(hrAudit.mock.calls[0][0].action).toBe('DISCIPLINARY_RESTRICTED_DENIED');
    expect(hrAudit.mock.calls[0][0].actorRole).toBe('BRANCH_MANAGER');
    expect(hrAudit.mock.calls[0][0].metadata).toEqual({ confidentiality: 'RESTRICTED', fieldNames: [] });
  });

  it('the denial still never leaks the description through the audit metadata', async () => {
    db.disciplinaryCase.findFirst.mockResolvedValue(RESTRICTED_CASE);
    await expect(getCaseDetail('case-1', BRANCH_SESSION)).rejects.toBeInstanceOf(StageGError);
    expect(JSON.stringify(hrAudit.mock.calls[0][0])).not.toContain('confidential description');
  });
});

describe('buildDisciplineListCsv — the export can never carry the sensitive text', () => {
  const ROW = {
    id: 'case-1',
    employeeName: 'Ada One',
    type: 'GRIEVANCE',
    severity: 3,
    status: 'OPEN',
    confidentiality: 'RESTRICTED',
    issuedOn: '2026-10-01T00:00:00.000Z',
    expiresOn: null,
  };

  it('the header is exactly the eight list columns, description-free', () => {
    const csv = buildDisciplineListCsv([ROW]);
    expect(csv.split('\r\n')[0]).toBe('case_id,employee,type,severity,status,confidentiality,issued_on,expires_on');
    expect(csv).not.toContain('description');
  });

  it('escapes RFC 4180: commas, quotes, newlines; nulls stay empty', () => {
    const csv = buildDisciplineListCsv([
      { ...ROW, employeeName: 'Okello, "J." Jr' },
      { ...ROW, id: 'case,2', employeeName: 'Line\nBreak', severity: null },
    ]);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines[1]).toContain('"Okello, ""J."" Jr"');
    expect(lines[2]).toContain('"case,2"');
    expect(lines[2]).toContain('"Line\nBreak"');
    // null severity -> empty cell, null expiresOn -> empty cell (row 2 tail)
    expect(lines[2]).toContain('GRIEVANCE,,OPEN,RESTRICTED,2026-10-01T00:00:00.000Z,');
  });

  it('CRLF endings and a trailing terminator (spreadsheet-safe)', () => {
    const csv = buildDisciplineListCsv([ROW]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3); // header + row + trailing ''
  });

  it('dates serialize as ISO', () => {
    const csv = buildDisciplineListCsv([ROW]);
    expect(csv).toContain('2026-10-01T00:00:00.000Z');
  });
});

describe('expiresSoonLabel — the countdown is pure and guarded', () => {
  afterEach(() => vi.useRealTimers());
  const pin = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };
  // an expiry N calendar days from the pinned "now", at a fixed local hour
  const onDay = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };

  it('calendar-day semantics: today says so, tomorrow is honestly in 1d', () => {
    pin('2026-10-19T08:00:00Z');
    expect(expiresSoonLabel(onDay(0), 'OPEN')).toBe('expires today');
    expect(expiresSoonLabel(onDay(1), 'OPEN')).toBe('in 1d');
    expect(expiresSoonLabel(onDay(10), 'OPEN')).toBe('in 10d');
  });

  it('past-due, beyond-window, non-OPEN, and garbage never label', () => {
    pin('2026-10-19T08:00:00Z');
    expect(expiresSoonLabel(onDay(-1), 'OPEN')).toBeNull();
    expect(expiresSoonLabel(onDay(15), 'OPEN')).toBeNull();
    expect(expiresSoonLabel(onDay(5), 'RESOLVED')).toBeNull();
    expect(expiresSoonLabel(onDay(5), 'EXPIRED')).toBeNull();
    expect(expiresSoonLabel(null, 'OPEN')).toBeNull();
    expect(expiresSoonLabel('not-a-date', 'OPEN')).toBeNull();
  });

  it('the boundary is inclusive at 14 days', () => {
    pin('2026-10-19T08:00:00Z');
    expect(expiresSoonLabel(onDay(14), 'OPEN')).toBe('in 14d');
  });
});

describe('source contracts — the page, the route, the serializer', () => {
  it('the page grows the desk: search, type filter, CSV door, chips, counts, audit note', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    expect(page).toContain('aria-label="Search cases by employee"');
    expect(page).toContain('aria-label="Filter by type"');
    expect(page).toContain('aria-label="Export case list as CSV"');
    expect(page).toContain('data-testid="hr-discipline-counts"');
    expect(page).toContain('data-testid="hr-discipline-restricted-chip"');
    expect(page).toContain('data-testid="hr-discipline-expires-soon"');
    expect(page).toContain('data-testid="hr-discipline-audit-note"');
    expect(page).toContain('Viewing this restricted record is logged to the audit trail.');
    expect(page).toContain('No cases match the current filters.');
    expect(page).toContain('discipline-cases-');
  });

  it('the route guard keeps its key — confidentiality hardened, never widened', () => {
    const route = src('src/app/api/hr/discipline/[id]/route.ts');
    expect(route).toContain("hrGuard('hr.discipline.manage')");
  });

  it('the service audit actions exist beside the untouched 403 contract', () => {
    const service = src('src/lib/hr/discipline-service.ts');
    expect(service).toContain("action: 'DISCIPLINARY_RESTRICTED_VIEWED'");
    expect(service).toContain("action: 'DISCIPLINARY_RESTRICTED_DENIED'");
    expect(service).toContain("'CONFIDENTIALITY_RESTRICTED'");
  });
});
