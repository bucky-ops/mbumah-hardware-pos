import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.129.0 — "the ledger shows its timeline".
 *
 * The re-granted ×N chip (v2.128.0) only COUNTS an employee's append-only
 * consent history; this round the history becomes readable: GET
 * /api/hr/privacy/consent/[employeeId]/history serves one employee's full
 * timeline (oldest → newest, scope-checked, stoodDays computed SERVER-side)
 * and the Privacy tab's drawer renders it as a timeline the desk can read.
 * Reads are view rights — the History door renders for every viewer, never
 * gated by the decision gate; the drawer's footer says what the ledger says:
 * append-only, nothing edited, nothing deleted.
 */

const db = vi.hoisted(() => ({
  employee: { findFirst: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));

import { listConsentHistory } from '@/lib/hr/data-protection';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-owner',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof listConsentHistory>[0];

const cr = (grantedIso: string, withdrawnIso: string | null) => ({
  purpose: 'PAYROLL_PROCESSING',
  policyVersion: 'hr-policy-2026-01',
  grantedAt: new Date(grantedIso),
  withdrawnAt: withdrawnIso === null ? null : new Date(withdrawnIso),
});

const emp = (id: string, code: string, first: string, last: string, crs: ReturnType<typeof cr>[]) => ({
  id,
  employeeCode: code,
  firstName: first,
  lastName: last,
  consentRecords: crs,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listConsentHistory — the timeline reads like a ledger', () => {
  it('events arrive oldest → newest with 1-based cycle numbers', async () => {
    // The DB query orders grantedAt ASC; the mock feeds rows in that order.
    db.employee.findFirst.mockResolvedValue(
      emp('e1', 'EMP-001', 'Ada', 'One', [
        cr('2026-01-01T00:00:00.000Z', '2026-01-20T00:00:00.000Z'),
        cr('2026-02-01T00:00:00.000Z', null),
      ]),
    );
    const h = await listConsentHistory(SESSION, 'e1');
    expect(h.events.map((e) => e.cycle)).toEqual([1, 2]);
    expect(h.events[0].grantedAt < h.events[1].grantedAt).toBe(true);
    // first cycle withdrawn, second standing — the journey reads top to bottom
    expect(h.events[0].withdrawnAt).toBeTruthy();
    expect(h.events[1].withdrawnAt).toBeNull();
  });

  it('stoodDays floors the exact grant→withdraw span, computed server-side', async () => {
    // 28.5 days stood → 28 whole days (the drawer never reimplements the clock)
    db.employee.findFirst.mockResolvedValue(
      emp('e1', 'EMP-001', 'Ada', 'One', [
        cr('2026-01-01T00:00:00.000Z', '2026-01-29T12:00:00.000Z'),
      ]),
    );
    const h = await listConsentHistory(SESSION, 'e1');
    expect(h.events[0].stoodDays).toBe(28);
  });

  it('a standing consent has stoodDays null — only a standing-since date is honest', async () => {
    db.employee.findFirst.mockResolvedValue(
      emp('e1', 'EMP-001', 'Ada', 'One', [cr('2026-02-01T00:00:00.000Z', null)]),
    );
    const h = await listConsentHistory(SESSION, 'e1');
    expect(h.events[0].stoodDays).toBeNull();
    expect(h.standing).toBe(true);
  });

  it('standing flips false when every cycle ended in withdrawal', async () => {
    db.employee.findFirst.mockResolvedValue(
      emp('e1', 'EMP-001', 'Ada', 'One', [
        cr('2026-01-01T00:00:00.000Z', '2026-01-20T00:00:00.000Z'),
        cr('2026-02-01T00:00:00.000Z', '2026-02-10T00:00:00.000Z'),
      ]),
    );
    const h = await listConsentHistory(SESSION, 'e1');
    expect(h.standing).toBe(false);
    // the footer's honesty: the run reports MISSING_CONSENT for this employee
    expect(h.events.every((e) => e.withdrawnAt !== null)).toBe(true);
  });

  it('an empty ledger answers honestly: no events, employee still identified', async () => {
    db.employee.findFirst.mockResolvedValue(
      emp('e2', 'EMP-002', 'Ben', 'Two', []),
    );
    const h = await listConsentHistory(SESSION, 'e2');
    expect(h.events).toEqual([]);
    expect(h.standing).toBe(false);
    expect(h.employee).toEqual({ id: 'e2', code: 'EMP-002', name: 'Ben Two' });
  });

  it('an out-of-scope or missing employee 404s — it does not leak', async () => {
    db.employee.findFirst.mockResolvedValue(null);
    await expect(listConsentHistory(SESSION, 'nope')).rejects.toMatchObject({
      code: 'CONSENT_HISTORY_NOT_FOUND',
      status: 404,
    });
  });

  it('the read is scope-checked and excludes deleted employees', async () => {
    db.employee.findFirst.mockResolvedValue(
      emp('e1', 'EMP-001', 'Ada', 'One', []),
    );
    await listConsentHistory(SESSION, 'e1');
    const where = db.employee.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('e1');
    expect(where.deletedAt).toBeNull();
    expect(where.AND).toBeDefined(); // employeeScopeWhere rides inside
  });
});

describe('the history route is a view right, not a decision right', () => {
  it('guards with the ledger view trio and reads the dynamic param', () => {
    const s = src('src/app/api/hr/privacy/consent/[employeeId]/history/route.ts');
    expect(s).toContain("hrGuard('hr.report.branch', VIEW_ROLES)");
    expect(s).toContain("const VIEW_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;");
    expect(s).toContain('await context?.params');
    expect(s).toContain('toErrorResponse(error)');
  });
});

describe('the drawer shows the journey the chip only counts', () => {
  const page = () => src('src/app/(shell)/hr/reports/page.tsx');

  it('the History door renders for every viewer — never gated by canDecide', () => {
    const s = page();
    expect(s).toContain('data-testid="hr-privacy-consent-history-open"');
    expect(s).toContain('aria-label={`Consent history — ${r.employeeName}`}');
    // the door lives OUTSIDE the canDecide branch: it sits beside it, not inside
    const cell = s.slice(s.indexOf('v2.129.0: the timeline door'), s.indexOf('settings managers decide'));
    expect(cell).toContain('hr-privacy-consent-history-open');
  });

  it('the drawer carries its testids: dialog, timeline, both dots', () => {
    const s = page();
    expect(s).toContain('data-testid="hr-privacy-consent-history"');
    expect(s).toContain('data-testid="hr-privacy-consent-history-timeline"');
    expect(s).toContain("'hr-privacy-consent-history-dot-closed'");
    expect(s).toContain("'hr-privacy-consent-history-dot-standing'");
  });

  it('the footer says what the ledger says: append-only + the run gate', () => {
    const s = page();
    expect(s).toContain('append-only — nothing is edited or deleted.');
    expect(s).toContain('MISSING_CONSENT until a re-grant.');
  });

  it('all drawer state resets on close — one employee\u2019s history never greets the next open', () => {
    const s = page();
    const body = s.slice(s.indexOf('const closeHistory = useCallback'), s.indexOf('// v2.119.0: the consent ledger loads'));
    expect(body).toContain('setHistoryEmp(null)');
    expect(body).toContain('setHistoryPayload(null)');
    expect(body).toContain('setHistoryError(null)');
    expect(body).toContain('setHistoryLoading(false)');
  });

  it('retry reuses the door\u2019s employee through the single loader', () => {
    const s = page();
    expect(s).toContain('onClick={() => historyEmp && openHistory(historyEmp)}');
    expect(s).toContain('aria-label="Retry consent history"');
  });

  it('the timeline wears dark twins — dots, border, and cycle chips included', () => {
    const s = page();
    expect(s).toContain('bg-amber-500 dark:bg-amber-400');
    expect(s).toContain('bg-emerald-500 dark:bg-emerald-400');
    expect(s).toContain('border-l-2 border-slate-200 pl-5 dark:border-slate-700');
    expect(s).toContain('border-background'); // dot rim matches the dialog surface
  });
});
