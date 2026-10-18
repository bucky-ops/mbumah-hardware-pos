import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.119.0 — "consent works".
 *
 * The consent ledger (spec Phase 4.8 acceptance 6): until now ConsentRecord
 * was write-only at intake and read by one gate — the payroll run's
 * MISSING_CONSENT guardrail. No surface could GRANT, WITHDRAW, or even SEE
 * an employee's consent.
 *  1. READ-BACK (db-mocked): listConsentRecords folds every in-scope
 *     employee's records into ACTIVE / WITHDRAWN / NONE — status folds ALL
 *     records (the payroll gate does not filter by purpose), the summary
 *     counts, one batched query (no N+1), scope rides employeeScopeWhere.
 *  2. DECISIONS: grantConsent (append-only — a NEW record, refuses when an
 *     active one stands) and withdrawConsent (updateMany withdrawnAt, refuses
 *     when nothing active) — both scope-checked 404s, both audit-logged.
 *  3. SOURCE CONTRACTS: the routes (guard keys + DECISION_FORBIDDEN), the
 *     Privacy tab's consent card (testids, honest chips, the MISSING_CONSENT
 *     hint), and the payroll gate's read stays `withdrawnAt: null`.
 */

const db = vi.hoisted(() => ({
  employee: { findFirst: vi.fn(), findMany: vi.fn() },
  consentRecord: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));

const hrAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { EMPLOYEE: 'Employee', APPLICANT: 'Applicant' },
}));

import {
  listConsentRecords,
  grantConsent,
  withdrawConsent,
  canDecideErasure,
  PAYROLL_CONSENT_PURPOSE,
  PAYROLL_CONSENT_SCOPE,
  PAYROLL_CONSENT_POLICY_VERSION,
  type ConsentRow,
} from '@/lib/hr/data-protection';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-owner',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof listConsentRecords>[0];

const emp = (id: string, code: string, first: string, last: string, crs: Array<{ purpose: string; policyVersion: string; grantedAt: Date; withdrawnAt: Date | null }>) => ({
  id,
  employeeCode: code,
  firstName: first,
  lastName: last,
  consentRecords: crs,
});

const rowOf = (r: ConsentRow) => `${r.employeeCode}:${r.status}`;

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listConsentRecords — the read-back folds honestly', () => {
  it('ACTIVE / WITHDRAWN / NONE per employee; summary counts', async () => {
    const day = 86_400_000;
    db.employee.findMany.mockResolvedValue([
      emp('e1', 'EMP-001', 'Ada', 'One', [
        { purpose: PAYROLL_CONSENT_PURPOSE, policyVersion: 'v1', grantedAt: new Date(Date.now() - 5 * day), withdrawnAt: null },
      ]),
      emp('e2', 'EMP-002', 'Ben', 'Two', [
        { purpose: PAYROLL_CONSENT_PURPOSE, policyVersion: 'v1', grantedAt: new Date(Date.now() - 9 * day), withdrawnAt: new Date(Date.now() - 2 * day) },
      ]),
      emp('e3', 'EMP-003', 'Cara', 'Three', []),
    ]);
    const ledger = await listConsentRecords(SESSION);
    expect(ledger.records.map(rowOf)).toEqual(['EMP-001:ACTIVE', 'EMP-002:WITHDRAWN', 'EMP-003:NONE']);
    expect(ledger.summary).toEqual({ active: 1, withdrawn: 1, none: 1 });
    // the withdrawn row keeps its dates; the active row has none
    expect(ledger.records[1].withdrawnAt).toBeTruthy();
    expect(ledger.records[1].grantedAt).toBeTruthy();
    expect(ledger.records[0].withdrawnAt).toBeNull();
    // NONE is honestly empty on every date field
    expect(ledger.records[2].grantedAt).toBeNull();
    expect(ledger.records[2].latestPurpose).toBeNull();
  });

  it('status folds ALL records — the payroll gate does not filter by purpose', async () => {
    db.employee.findMany.mockResolvedValue([
      emp('e1', 'EMP-001', 'Ada', 'One', [
        { purpose: 'MARKETING', policyVersion: 'v1', grantedAt: new Date(), withdrawnAt: null },
      ]),
    ]);
    const ledger = await listConsentRecords(SESSION);
    // any active record passes the payroll gate (findFirst withdrawnAt: null)
    expect(ledger.records[0].status).toBe('ACTIVE');
    expect(ledger.records[0].latestPurpose).toBe('MARKETING');
  });

  it('one batched query rides the scope (no N+1); capped and ordered', async () => {
    db.employee.findMany.mockResolvedValue([]);
    await listConsentRecords(SESSION);
    expect(db.employee.findMany).toHaveBeenCalledTimes(1);
    const arg = db.employee.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ deletedAt: null, AND: [{ storeId: 'store-1' }] });
    expect(arg.take).toBe(200);
    expect(arg.orderBy).toEqual([{ lastName: 'asc' }, { firstName: 'asc' }]);
    expect(arg.select.consentRecords.orderBy).toEqual({ grantedAt: 'desc' });
  });

  it('an org-wide session scopes by organization (no storeId)', async () => {
    db.employee.findMany.mockResolvedValue([]);
    await listConsentRecords({ ...SESSION, storeId: null } as typeof SESSION);
    expect(db.employee.findMany.mock.calls[0][0].where.AND).toEqual([{ store: { organizationId: 'org-1' } }]);
  });
});

describe('grantConsent — append-only decisions', () => {
  it('out-of-scope / missing employee is a 404', async () => {
    db.employee.findFirst.mockResolvedValue(null);
    await expect(grantConsent({ employeeId: 'e-gone' }, SESSION)).rejects.toMatchObject({
      code: 'EMPLOYEE_NOT_FOUND',
      status: 404,
    });
  });

  it('an active consent already standing is a 409 — nothing is written', async () => {
    db.employee.findFirst.mockResolvedValue({ id: 'e1', storeId: 'store-1' });
    db.consentRecord.findFirst.mockResolvedValue({ id: 'c1', purpose: PAYROLL_CONSENT_PURPOSE });
    await expect(grantConsent({ employeeId: 'e1' }, SESSION)).rejects.toMatchObject({
      code: 'CONSENT_ACTIVE',
      status: 409,
    });
    expect(db.consentRecord.create).not.toHaveBeenCalled();
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('creates a NEW record with the pinned vocabulary and audits the grant', async () => {
    db.employee.findFirst.mockResolvedValue({ id: 'e1', storeId: 'store-1' });
    db.consentRecord.findFirst.mockResolvedValue(null);
    db.consentRecord.create.mockResolvedValue({
      id: 'c2',
      purpose: PAYROLL_CONSENT_PURPOSE,
      policyVersion: PAYROLL_CONSENT_POLICY_VERSION,
      grantedAt: new Date('2026-10-19T04:30:00Z'),
    });
    const out = await grantConsent({ employeeId: 'e1' }, SESSION);
    expect(db.consentRecord.create).toHaveBeenCalledWith({
      data: {
        employeeId: 'e1',
        purpose: PAYROLL_CONSENT_PURPOSE,
        scope: PAYROLL_CONSENT_SCOPE,
        policyVersion: PAYROLL_CONSENT_POLICY_VERSION,
        lawfulBasis: 'CONSENT',
      },
    });
    expect(out.consentId).toBe('c2');
    expect(hrAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'user-owner',
      actorRole: 'STORE_OWNER',
      action: 'PRIVACY_CONSENT_GRANTED',
      resourceType: 'Employee',
      resourceId: 'e1',
    }));
  });

  it('the pinned vocabulary matches what the payroll gate reads', () => {
    expect(PAYROLL_CONSENT_PURPOSE).toBe('PAYROLL_PROCESSING');
    expect(PAYROLL_CONSENT_POLICY_VERSION).toBe('hr-policy-2026-01');
    // append-only: the write path is create, never update
    const lib = src('src/lib/hr/data-protection.ts');
    const grantFn = lib.slice(lib.indexOf('export async function grantConsent'), lib.indexOf('export async function withdrawConsent'));
    expect(grantFn).toContain('consentRecord.create');
    expect(grantFn).not.toContain('consentRecord.update');
  });
});

describe('withdrawConsent — the withdrawal the gate honors', () => {
  it('out-of-scope employee is a 404', async () => {
    db.employee.findFirst.mockResolvedValue(null);
    await expect(withdrawConsent({ employeeId: 'e-gone' }, SESSION)).rejects.toMatchObject({
      code: 'EMPLOYEE_NOT_FOUND',
      status: 404,
    });
  });

  it('nothing active to withdraw is a 409 — no audit event', async () => {
    db.employee.findFirst.mockResolvedValue({ id: 'e1', storeId: 'store-1' });
    db.consentRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(withdrawConsent({ employeeId: 'e1' }, SESSION)).rejects.toMatchObject({
      code: 'NO_ACTIVE_CONSENT',
      status: 409,
    });
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('sets withdrawnAt on the active records and audits the count', async () => {
    db.employee.findFirst.mockResolvedValue({ id: 'e1', storeId: 'store-1' });
    db.consentRecord.updateMany.mockResolvedValue({ count: 2 });
    const out = await withdrawConsent({ employeeId: 'e1' }, SESSION);
    expect(db.consentRecord.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 'e1', withdrawnAt: null },
      data: { withdrawnAt: expect.any(Date) },
    });
    expect(out.withdrawn).toBe(2);
    expect(hrAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PRIVACY_CONSENT_WITHDRAWN',
      resourceId: 'e1',
      metadata: { employeeId: 'e1', withdrawn: 2 },
    }));
  });
});

describe('source contracts — routes, decisions, the card, the gate', () => {
  it('routes: the ledger reads on hr.report.branch; decisions re-check canDecideErasure', () => {
    const get = src('src/app/api/hr/privacy/consent/route.ts');
    expect(get).toContain("hrGuard('hr.report.branch'");
    expect(get).toContain('listConsentRecords');
    expect(get).toContain('canDecide');
    for (const verb of ['grant', 'withdraw']) {
      const route = src(`src/app/api/hr/privacy/consent/${verb}/route.ts`);
      expect(route).toContain("hrGuard('hr.report.branch')");
      expect(route).toContain('canDecideErasure(session.role)');
      expect(route).toContain('DECISION_FORBIDDEN');
      expect(route).toContain('{ status: 403 }');
    }
    expect(canDecideErasure('SUPER_ADMIN')).toBe(true);
    expect(canDecideErasure('STORE_OWNER')).toBe(false);
  });

  it('the Privacy tab wears the consent card with honest manners', () => {
    const page = src('src/app/(shell)/hr/reports/page.tsx');
    for (const tid of [
      'hr-privacy-consent',
      'hr-privacy-consent-counts',
      'hr-privacy-consent-none-count',
      'hr-privacy-consent-chip-active',
      'hr-privacy-consent-chip-withdrawn',
      'hr-privacy-consent-chip-none',
      'hr-privacy-consent-withdraw',
      'hr-privacy-consent-grant',
    ]) {
      expect(page).toContain(`data-testid="${tid}"`);
    }
    expect(page).toContain('MISSING_CONSENT');
    expect(page).toContain('No employees in scope.');
    expect(page).toContain('aria-label="Refresh consent records"');
    // the erasure card coexists
    expect(page).toContain('Erasure requests (Data Protection Act posture)');
  });

  it('the payroll gate still reads withdrawnAt: null (untouched by this round)', () => {
    const svc = src('src/lib/hr/payroll/run-service.ts');
    expect(svc).toContain('withdrawnAt: null');
    expect(svc).toContain("code: 'MISSING_CONSENT'");
  });
});
