import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.113.0 — "the panel's dead columns become doors; the HR workspace gains
 * its missing employees page".
 *
 * Three layers:
 *  1. SERVICE (db-mocked): listEmployees' expiringWithinDays filter narrows
 *     to employees holding documents inside [now, now+N], annotates rows with
 *     expiringDocuments + nearestExpiry (counts and dates only — the PII
 *     contract holds), and storeInOrganization fails closed on any miss.
 *     parseExpiringDays clamps 1..365 and ignores everything else.
 *  2. LINK BUILDERS (pure): the panel's two doors — /hr/employees?expiring=
 *     &storeId= and /hr/payroll?run= — encoded, relative, never throwing.
 *  3. SOURCE CONTRACTS (read the bytes): the server joins run.id into
 *     hrPerStore.latestPayroll; the panel renders BOTH doors with honest
 *     degrade paths; /hr/payroll consumes ?run= as a lazy seed and strips it;
 *     the new /hr/employees page reads its seeds, shows the store-scope
 *     notice, and never fabricates an employee.
 */

const db = vi.hoisted(() => ({
  employeeDocument: { groupBy: vi.fn() },
  employee: { findMany: vi.fn() },
  store: { findFirst: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));

import {
  listEmployees,
  parseExpiringDays,
  storeInOrganization,
} from '@/lib/hr/employee-service';
import {
  buildExpiringEmployeesHref,
  buildRunDeepLinkHref,
} from '@/lib/workspace/links';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseExpiringDays — the window is additive, never a surprise', () => {
  it('accepts positive integers and clamps to 1..365', () => {
    expect(parseExpiringDays('90')).toBe(90);
    expect(parseExpiringDays('1')).toBe(1);
    expect(parseExpiringDays('365')).toBe(365);
    expect(parseExpiringDays('400')).toBe(365);
    expect(parseExpiringDays('0.5')).toBe(1);
  });
  it('ignores missing, empty, NaN, and non-positive values', () => {
    expect(parseExpiringDays(null)).toBeNull();
    expect(parseExpiringDays(undefined)).toBeNull();
    expect(parseExpiringDays('')).toBeNull();
    expect(parseExpiringDays('abc')).toBeNull();
    expect(parseExpiringDays('-5')).toBeNull();
    expect(parseExpiringDays('0')).toBeNull();
  });
});

describe('listEmployees — the expiring filter narrows and annotates', () => {
  it('with expiringWithinDays: grouped document query, id-in where, annotated summaries', async () => {
    db.employeeDocument.groupBy.mockResolvedValue([
      { employeeId: 'emp-1', _count: { _all: 2 }, _min: { expiryDate: new Date('2026-11-30T00:00:00Z') } },
      { employeeId: 'emp-3', _count: { _all: 1 }, _min: { expiryDate: new Date('2026-12-15T00:00:00Z') } },
    ]);
    db.employee.findMany.mockResolvedValue([
      { id: 'emp-1', employeeCode: 'MB-001', firstName: 'Ada', lastName: 'One', jobTitle: 'Cashier', role: 'STAFF', employmentType: 'PERMANENT', status: 'ACTIVE', hireDate: new Date('2025-01-10T00:00:00Z'), terminationDate: null, storeId: 'store-1', store: { name: 'Juja Main' }, deletedAt: null },
      { id: 'emp-3', employeeCode: null, firstName: 'Chi', lastName: 'Three', jobTitle: null, role: 'STAFF', employmentType: 'CASUAL', status: 'ACTIVE', hireDate: new Date('2025-02-01T00:00:00Z'), terminationDate: null, storeId: 'store-1', store: { name: 'Juja Main' }, deletedAt: null },
    ]);

    const rows = await listEmployees({ storeId: 'store-1', expiringWithinDays: 90 });

    expect(db.employeeDocument.groupBy).toHaveBeenCalledTimes(1);
    const groupArgs = db.employeeDocument.groupBy.mock.calls[0][0];
    expect(groupArgs.where.storeId).toBe('store-1');
    expect(groupArgs.where.deletedAt).toBeNull();
    expect(groupArgs.where.expiryDate.gte).toBeInstanceOf(Date);
    expect(groupArgs.where.expiryDate.lte).toBeInstanceOf(Date);
    // the 90-day window is ~90 days wide (not instant, not years)
    const spanDays = (groupArgs.where.expiryDate.lte.getTime() - groupArgs.where.expiryDate.gte.getTime()) / 86400000;
    expect(spanDays).toBeGreaterThan(89);
    expect(spanDays).toBeLessThan(91);

    const findArgs = db.employee.findMany.mock.calls[0][0];
    expect(findArgs.where.storeId).toBe('store-1');
    expect(findArgs.where.id).toEqual({ in: ['emp-1', 'emp-3'] });

    expect(rows).toHaveLength(2);
    const ada = rows.find((r: { id: string }) => r.id === 'emp-1');
    const chi = rows.find((r: { id: string }) => r.id === 'emp-3');
    expect(ada?.expiringDocuments).toBe(2);
    expect(ada?.nearestExpiry).toBe('2026-11-30T00:00:00.000Z');
    expect(chi?.expiringDocuments).toBe(1);
    // summaries still carry no statutory PII fields
    expect(ada).not.toHaveProperty('nationalId');
    expect(ada).not.toHaveProperty('kraPin');
  });

  it('without expiringWithinDays: no document query, no annotations', async () => {
    db.employee.findMany.mockResolvedValue([
      { id: 'emp-1', employeeCode: null, firstName: 'Ada', lastName: 'One', jobTitle: null, role: 'STAFF', employmentType: 'PERMANENT', status: 'ACTIVE', hireDate: new Date('2025-01-10T00:00:00Z'), terminationDate: null, storeId: 'store-1', store: { name: 'Juja Main' }, deletedAt: null },
    ]);
    const rows = await listEmployees({ storeId: 'store-1' });
    expect(db.employeeDocument.groupBy).not.toHaveBeenCalled();
    expect(db.employee.findMany.mock.calls[0][0].where.id).toBeUndefined();
    expect(rows[0]).not.toHaveProperty('expiringDocuments');
  });
});

describe('storeInOrganization — fail-closed scope verification', () => {
  it('true only when the store row exists inside the organization', async () => {
    db.store.findFirst.mockResolvedValue({ id: 'store-2' });
    await expect(storeInOrganization('store-2', 'org-1')).resolves.toBe(true);
    expect(db.store.findFirst).toHaveBeenCalledWith({
      where: { id: 'store-2', organizationId: 'org-1' },
      select: { id: true },
    });
  });
  it('false on a miss, an empty id, or an empty organization', async () => {
    db.store.findFirst.mockResolvedValue(null);
    await expect(storeInOrganization('store-x', 'org-1')).resolves.toBe(false);
    await expect(storeInOrganization('', 'org-1')).resolves.toBe(false);
    await expect(storeInOrganization('store-2', '')).resolves.toBe(false);
    expect(db.store.findFirst).toHaveBeenCalledTimes(1); // the empty guards never hit the db
  });
});

describe('the panel doors — pure link builders', () => {
  it('buildExpiringEmployeesHref: encoded, days default 90, honest zero-guard', () => {
    expect(buildExpiringEmployeesHref('store_juja_main')).toBe('/hr/employees?expiring=90&storeId=store_juja_main');
    expect(buildExpiringEmployeesHref('store a&b', 30)).toBe('/hr/employees?expiring=30&storeId=store+a%26b');
    expect(buildExpiringEmployeesHref('store-1', 0)).toBe('/hr/employees?expiring=90&storeId=store-1');
    expect(buildExpiringEmployeesHref('', 90)).toBe('/hr/employees?expiring=90&storeId=');
  });
  it('buildRunDeepLinkHref: /hr/payroll?run=<id>, encoded, empty-safe', () => {
    expect(buildRunDeepLinkHref('run_abc')).toBe('/hr/payroll?run=run_abc');
    expect(buildRunDeepLinkHref('run 1&2')).toBe('/hr/payroll?run=run+1%262');
    expect(buildRunDeepLinkHref('')).toBe('/hr/payroll?run=');
  });
});

describe('source contracts — the server joins the run id', () => {
  it('hrPerStore selects the latest run id and carries runId in the payload', () => {
    const reports = src('src/lib/hr/reports.ts');
    expect(reports).toContain('select: { id: true, status: true, createdAt: true, payrollPeriod: { select: { name: true } } }');
    expect(reports).toContain('runId: latestRun.id,');
  });
  it('the shared OrgSummaryData type grew runId', () => {
    expect(src('src/components/org/primitives.tsx')).toContain(
      'latestPayroll: { runId: string; periodName: string; status: string; createdAt: string } | null;',
    );
  });
});

describe('source contracts — the panel renders doors with honest degrade paths', () => {
  const panel = () => src('src/components/finance/people-payroll-by-branch.tsx');
  it('the latest-run cell opens /hr/payroll?run= only when an id exists', () => {
    const p = panel();
    expect(p).toContain('buildRunDeepLinkHref(run.runId)');
    expect(p).toContain('data-testid="people-payroll-run-door"');
    expect(p).toMatch(/if \(run\.runId\) \{[\s\S]*?buildRunDeepLinkHref/);
    // degrade path: the no-id text survives
    expect(p).toContain('no runs yet');
    expect(p).toContain('PAYROLL_RUN_NOT_AVAILABLE');
  });
  it('the expiry cell is a door for documents, text for assets — and gated on roles the list answers', () => {
    const p = panel();
    expect(p).toContain('buildExpiringEmployeesHref(row.storeId)');
    expect(p).toContain('data-testid="people-payroll-expiry-door"');
    // the door never renders for a role the list would 403 (lesson 29)
    expect(p).toContain('EMPLOYEE_LIST_READ_ROLES.includes(role || \'\')');
    // v2.114.0 re-anchor: the gate renamed canOpenExpiry -> canOpenDocs when
    // the assets half grew its own parallel door (canOpenAssets)
    expect(p).toMatch(/if \(docs > 0 && canOpenDocs\) \{/);
    // the assets half never links cross-branch
    expect(p).toContain('Overdue asset assignments: ${assets} — see the Assets page');
    // mobile cards reuse the same cells (one implementation, two surfaces)
    expect(p).toContain('<ExpiryCell row={row} />');
    expect(p.match(/<LatestRunCell run=\{row\.latestPayroll\} storeName=\{row\.storeName\} \/>/g)?.length).toBe(2);
  });
});

describe('source contracts — /hr/payroll consumes ?run= as a lazy seed', () => {
  it('lazy initializer reads the param; a mount effect strips it once', () => {
    const page = src('src/app/(shell)/hr/payroll/page.tsx');
    expect(page).toContain("new URLSearchParams(window.location.search).get('run')");
    expect(page).toMatch(/useState<string \| null>\(\(\) => \{[\s\S]*?get\('run'\)/);
    expect(page).toContain("sp.delete('run')");
    expect(page).toContain('window.history.replaceState(null');
  });
});

describe('source contracts — the employees list answers the roles the spec grants', () => {
  it('the route resolves the read key BY ROLE (owner was 403ing on own_branch)', () => {
    const route = src('src/app/api/hr/employees/route.ts');
    expect(route).toContain('READ_KEY_BY_ROLE');
    expect(route).toContain("STORE_OWNER: 'hr.employee.read.all'");
    expect(route).toContain("BRANCH_MANAGER: 'hr.employee.read.own_branch'");
    // the accountant resolves no key — fail-closed, deny logged
    expect(route).toContain('recordPermissionDenied');
  });
  it('the client-side role list mirrors the route (shared truth in app-config)', () => {
    const cfg = src('src/lib/app-config.ts');
    expect(cfg).toContain("export const EMPLOYEE_LIST_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER', 'BRANCH_MANAGER'];");
    // the accountant is deliberately absent
    expect(cfg).not.toMatch(/EMPLOYEE_LIST_READ_ROLES = \[[^\]]*ACCOUNTANT/);
  });
});

describe('source contracts — the /hr/employees list page exists and is honest', () => {
  const page = () => src('src/app/(shell)/hr/employees/page.tsx');
  it('the file exists with the deep-link seeds and the server-trusting scope', () => {
    const p = page();
    expect(p).toContain("readParam('storeId')");
    expect(p).toContain("readParam('expiring')");
    expect(p).toContain('hr-employees-expiring-toggle');
    expect(p).toContain('from link');
    expect(p).toContain('storeMismatch');
    expect(p).toContain('the server never widens scope on request alone');
  });
  it('rows are doors to the detail record, never fabricated', () => {
    const p = page();
    expect(p).toContain('href={`/hr/employees/${r.id}`}');
    expect(p).toContain('apiGet<EmployeeRow[]>');
  });
});
