import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.39.0 governed portal-account linking contracts.
 *
 * Service (db-mocked): linkPortalAccount binds an active, same-store User to
 * an Employee (1:1 by Employee.userId @unique — friendly 409 instead of raw
 * P2002), refuses TERMINATED employees, is idempotent for re-linking the
 * same account, writes a hash-chained hrAudit row with ids/roles only (PII
 * discipline: no emails in metadata), and can be released by
 * unlinkPortalAccount. Every failure surfaces as PortalLinkError with an
 * HTTP-ready status.
 *
 * Route (static contract on POST/DELETE /api/employees/[id]/portal-link):
 * the role gate mirrors hr.employee.update (SUPER_ADMIN / STORE_OWNER /
 * HR_MANAGER), errors map to statuses, and the handler never writes
 * Employee rows directly (spec rule 15).
 */

const db = vi.hoisted(() => ({
  employee: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue('audit-1'),
  HrEntityType: { EMPLOYEE: 'Employee' },
}));

import { hrAudit } from '@/lib/hr/audit';
import {
  linkPortalAccount,
  unlinkPortalAccount,
  PortalLinkError,
} from '@/lib/hr/employee-service';

const employeeLinked = {
  id: 'emp-1',
  storeId: 'store-1',
  status: 'ACTIVE',
  userId: 'user-1',
  user: { id: 'user-1', email: 'linked@mbumah.co.ke', name: 'Linked User', role: 'CASHIER', isActive: true, storeId: 'store-1' },
};

const employeeUnlinked = {
  id: 'emp-2',
  storeId: 'store-1',
  status: 'ACTIVE',
  userId: null,
  user: null,
};

const candidateUser = {
  id: 'user-9',
  email: 'candidate@mbumah.co.ke',
  role: 'CASHIER',
  isActive: true,
  storeId: 'store-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.update.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('linkPortalAccount - happy paths', () => {
  it('links a same-store active user and writes the LINK audit row with ids only', async () => {
    db.employee.findUnique.mockResolvedValue(employeeUnlinked);
    db.user.findUnique.mockResolvedValue(candidateUser);
    db.employee.findFirst.mockResolvedValue(null);

    const result = await linkPortalAccount({
      employeeId: 'emp-2',
      userId: 'user-9',
      actorId: 'actor-1',
      actorRole: 'STORE_OWNER',
    });

    expect(result.linked).toBe(true);
    expect(result.alreadyInPlace).toBe(false);
    expect(result.userId).toBe('user-9');
    expect(db.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-2' },
      data: { userId: 'user-9' },
    });
    expect(hrAudit).toHaveBeenCalledTimes(1);
    const audit = vi.mocked(hrAudit).mock.calls[0][0];
    expect(audit.action).toBe('UPDATE');
    expect(audit.metadata?.portalLink).toBe('LINK');
    expect(audit.metadata?.linkedUserId).toBe('user-9');
    // PII discipline: the user's email never enters audit metadata.
    expect(JSON.stringify(audit.metadata)).not.toContain('candidate@mbumah.co.ke');
  });

  it('is a no-op when the requested binding already exists (no update, no audit)', async () => {
    db.employee.findUnique.mockResolvedValue(employeeLinked);

    const result = await linkPortalAccount({
      employeeId: 'emp-1',
      userId: 'user-1',
      actorId: 'actor-1',
    });

    expect(result.alreadyInPlace).toBe(true);
    expect(db.employee.update).not.toHaveBeenCalled();
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('records a re-link when switching accounts (previousUserId in metadata)', async () => {
    db.employee.findUnique.mockResolvedValue(employeeLinked);
    db.user.findUnique.mockResolvedValue(candidateUser);
    db.employee.findFirst.mockResolvedValue(null);

    const result = await linkPortalAccount({
      employeeId: 'emp-1',
      userId: 'user-9',
      actorId: 'actor-1',
      actorRole: 'HR_MANAGER',
    });

    expect(result.alreadyInPlace).toBe(false);
    const audit = vi.mocked(hrAudit).mock.calls[0][0];
    expect(audit.metadata?.previousUserId).toBe('user-1');
    expect(audit.reason).toContain('re-linked');
  });
});

describe('linkPortalAccount - governed refusals', () => {
  it('404s for an unknown employee', async () => {
    db.employee.findUnique.mockResolvedValue(null);
    await expect(
      linkPortalAccount({ employeeId: 'nope', userId: 'user-9', actorId: 'a' }),
    ).rejects.toMatchObject({ status: 404, code: 'EMPLOYEE_NOT_FOUND' });
  });

  it('400s for a TERMINATED employee', async () => {
    db.employee.findUnique.mockResolvedValue({ ...employeeUnlinked, status: 'TERMINATED' });
    await expect(
      linkPortalAccount({ employeeId: 'emp-2', userId: 'user-9', actorId: 'a' }),
    ).rejects.toMatchObject({ status: 400, code: 'EMPLOYEE_TERMINATED' });
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  it('404s for an unknown user and 400s for an inactive one', async () => {
    db.employee.findUnique.mockResolvedValue(employeeUnlinked);
    db.user.findUnique.mockResolvedValue(null);
    await expect(
      linkPortalAccount({ employeeId: 'emp-2', userId: 'ghost', actorId: 'a' }),
    ).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });

    db.user.findUnique.mockResolvedValue({ ...candidateUser, isActive: false });
    await expect(
      linkPortalAccount({ employeeId: 'emp-2', userId: 'user-9', actorId: 'a' }),
    ).rejects.toMatchObject({ status: 400, code: 'USER_INACTIVE' });
  });

  it('400s on a cross-store user (governed scope rule)', async () => {
    db.employee.findUnique.mockResolvedValue(employeeUnlinked);
    db.user.findUnique.mockResolvedValue({ ...candidateUser, storeId: 'store-2' });
    await expect(
      linkPortalAccount({ employeeId: 'emp-2', userId: 'user-9', actorId: 'a' }),
    ).rejects.toMatchObject({ status: 400, code: 'STORE_MISMATCH' });
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  it('409s naming the other employee when the user is already linked elsewhere', async () => {
    db.employee.findUnique.mockResolvedValue(employeeUnlinked);
    db.user.findUnique.mockResolvedValue(candidateUser);
    db.employee.findFirst.mockResolvedValue({
      id: 'emp-3',
      firstName: 'Grace',
      lastName: 'Achieng',
      storeId: 'store-1',
    });

    await expect(
      linkPortalAccount({ employeeId: 'emp-2', userId: 'user-9', actorId: 'a' }),
    ).rejects.toSatisfy((e: PortalLinkError) => {
      return e instanceof PortalLinkError && e.status === 409 && e.code === 'USER_LINKED_ELSEWHERE' && e.message.includes('Grace Achieng');
    });
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  it('mentions the cross-store context when the clash is in another store', async () => {
    db.employee.findUnique.mockResolvedValue(employeeUnlinked);
    db.user.findUnique.mockResolvedValue(candidateUser);
    db.employee.findFirst.mockResolvedValue({
      id: 'emp-4',
      firstName: 'Mary',
      lastName: 'Njeri',
      storeId: 'store-2',
    });

    await expect(
      linkPortalAccount({ employeeId: 'emp-2', userId: 'user-9', actorId: 'a' }),
    ).rejects.toSatisfy((e: PortalLinkError) => {
      return e instanceof PortalLinkError && e.status === 409 && e.message.includes('another store');
    });
  });
});

describe('unlinkPortalAccount', () => {
  it('releases the binding and writes the UNLINK audit row', async () => {
    db.employee.findUnique.mockResolvedValue(employeeLinked);

    const result = await unlinkPortalAccount({ employeeId: 'emp-1', actorId: 'actor-1' });

    expect(result.linked).toBe(false);
    expect(db.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { userId: null },
    });
    const audit = vi.mocked(hrAudit).mock.calls[0][0];
    expect(audit.metadata?.portalLink).toBe('UNLINK');
    expect(audit.metadata?.previousUserId).toBe('user-1');
  });

  it('is a no-op when nothing is linked', async () => {
    db.employee.findUnique.mockResolvedValue(employeeUnlinked);

    const result = await unlinkPortalAccount({ employeeId: 'emp-2', actorId: 'actor-1' });

    expect(result.alreadyInPlace).toBe(true);
    expect(db.employee.update).not.toHaveBeenCalled();
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('404s for an unknown employee', async () => {
    db.employee.findUnique.mockResolvedValue(null);
    await expect(
      unlinkPortalAccount({ employeeId: 'nope', actorId: 'a' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('POST/DELETE /api/employees/[id]/portal-link (static contract)', () => {
  const route = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'employees', '[id]', 'portal-link', 'route.ts'), 'utf8');

  it('gates to the hr.employee.update privilege set', () => {
    expect(route).toContain("const PORTAL_LINK_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER'] as const;");
    expect(route).toContain('{ status: 403 }');
    expect(route).toContain('Only store owners, HR managers and super admins can manage portal account links.');
  });

  it('delegates to the service instead of writing Employee rows directly (spec rule 15)', () => {
    expect(route).toContain('linkPortalAccount(');
    expect(route).toContain('unlinkPortalAccount(');
    expect(route).not.toContain('db.employee.update');
    expect(route).not.toContain("from '@/lib/db'");
  });

  it('maps PortalLinkError to HTTP and validates the body', () => {
    expect(route).toContain('e instanceof PortalLinkError');
    expect(route).toContain('userId is required.');
    expect(route).toContain('Request body must be valid JSON.');
  });

  it('writes an action-stamped systemLog mirror for both verbs', () => {
    expect(route).toContain("action: 'EMPLOYEE_PORTAL_LINK'");
    expect(route).toContain("action: 'EMPLOYEE_PORTAL_UNLINK'");
  });
});

describe('v2.39.0 HR desk surfaces (static contract on payroll-tab)', () => {
  const tab = readFileSync(join(process.cwd(), 'src', 'app', '(shell)', 'tabs', 'payroll-tab.tsx'), 'utf8');

  beforeAll(() => {
    // payroll-tab.tsx is read-only here; this hook keeps the describe balanced.
  });

  it('links through the dedicated endpoint from the dialog', () => {
    expect(tab).toContain('`/api/employees/${employee?.id}/portal-link`');
    expect(tab).toContain("method: 'POST'");
    expect(tab).toContain("method: 'DELETE'");
  });

  it('renders the portal column, coverage badge and stat card', () => {
    expect(tab).toContain('>Portal</th>');
    expect(tab).toContain('{portalLinkedCount}/{employees.length} portal');
    expect(tab).toContain('label="Portal Linked"');
    expect(tab).toContain('No portal');
  });

  it('warns at filing time when the picked employee has no linked account', () => {
    expect(tab).toContain('has no linked portal account — no in-app bell will be sent');
    expect(tab).toContain('portal linked');
  });
});
