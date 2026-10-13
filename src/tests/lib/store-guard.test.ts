// SECURITY REGRESSION TESTS - v2.17.8 (Task 44) store-scope helpers
//
// Covers the two new authorization primitives in src/lib/auth.ts:
//
//   1. assertBodyStoreScope - the same cross-store policy as assertStoreScope
//      (query params) applied to storeId values supplied in a request BODY.
//      Prisma `create` is not ORM tenant-intercepted, so a body storeId is a
//      real cross-tenant write vector on the mutating routes that accept one.
//
//   2. auditRecordMiss - the [id] 404 policy classifier: a record that is
//      missing OR belongs to another store answers the same 404 (no existence
//      leak), but a FOREIGN-STORE id additionally writes a SecurityEvent +
//      CROSS_TENANT_RESOURCE_DENIED ops log so IDOR probing is visible.
//      Truly-missing ids and same-store misses stay silent.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { storeMembershipFindFirst, securityEventCreate, systemLogMock } = vi.hoisted(() => ({
  storeMembershipFindFirst: vi.fn(),
  securityEventCreate: vi.fn(),
  systemLogMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    storeMembership: { findFirst: storeMembershipFindFirst },
    securityEvent: { create: securityEventCreate },
  },
  runWithTenant: vi.fn(async (_storeId: string, fn: () => unknown) => fn()),
  runWithoutTenant: vi.fn(async (fn: () => unknown) => fn()),
}));

vi.mock('@/lib/logger', () => ({
  systemLog: systemLogMock,
  withErrorBoundary: (fn: unknown) => fn,
  sanitizeForLog: (value: unknown) => value,
  mapErrorToUserMessage: (error: unknown) => String(error),
}));

import {
  assertBodyStoreScope,
  auditRecordMiss,
  type StoreScopeSession,
} from '@/lib/auth';

const OWN = 'store_nakuru';
const OTHER = 'store_juja_main';

function sessionFor(overrides: Partial<StoreScopeSession> = {}): StoreScopeSession {
  return {
    userId: 'user_cashier_1',
    email: 'cashier@mbumahhardware.co.ke',
    role: 'CASHIER',
    storeId: OWN,
    ...overrides,
  };
}

function requestFor(path = '/api/stock-movements'): NextRequest {
  return {
    url: `http://localhost:3000${path}`,
    method: 'POST',
    headers: new Headers({ 'user-agent': 'vitest' }),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMembershipFindFirst.mockResolvedValue(null);
  securityEventCreate.mockResolvedValue({});
  systemLogMock.mockResolvedValue(undefined);
});

describe('assertBodyStoreScope (SECURITY)', () => {
  it('passes when no storeId is supplied (route falls back to the session store)', async () => {
    await expect(
      assertBodyStoreScope(requestFor(), sessionFor(), undefined)
    ).resolves.toBeNull();
    await expect(
      assertBodyStoreScope(requestFor(), sessionFor(), null)
    ).resolves.toBeNull();
    await expect(
      assertBodyStoreScope(requestFor(), sessionFor(), '')
    ).resolves.toBeNull();
    expect(storeMembershipFindFirst).not.toHaveBeenCalled();
  });

  it('passes when the requested store equals the session store', async () => {
    await expect(
      assertBodyStoreScope(requestFor(), sessionFor(), OWN)
    ).resolves.toBeNull();
    expect(storeMembershipFindFirst).not.toHaveBeenCalled();
  });

  it('passes for SUPER_ADMIN with any store (org-wide role)', async () => {
    await expect(
      assertBodyStoreScope(requestFor(), sessionFor({ role: 'SUPER_ADMIN', storeId: OWN }), OTHER)
    ).resolves.toBeNull();
  });

  it('passes for STORE_OWNER with any store (org-wide role)', async () => {
    await expect(
      assertBodyStoreScope(requestFor(), sessionFor({ role: 'STORE_OWNER' }), OTHER)
    ).resolves.toBeNull();
  });

  it('passes for a multi-store member with an ACTIVE membership', async () => {
    storeMembershipFindFirst.mockResolvedValue({ id: 'membership_1' });
    await expect(
      assertBodyStoreScope(
        requestFor(),
        sessionFor({ role: 'WAREHOUSE_MANAGER' }),
        OTHER
      )
    ).resolves.toBeNull();
    expect(storeMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user_cashier_1',
          storeId: OTHER,
          status: 'ACTIVE',
        },
      })
    );
  });

  it('rejects a cross-store body storeId with 403 + SecurityEvent (the Task 44 fix)', async () => {
    const response = await assertBodyStoreScope(
      requestFor('/api/stock-movements'),
      sessionFor({ role: 'BRANCH_MANAGER' }),
      OTHER
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);

    const body = (await response?.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);

    // The probe is recorded in the SecurityEvent feed and the ops log.
    expect(securityEventCreate).toHaveBeenCalledTimes(1);
    expect(securityEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'UNAUTHORIZED_ACCESS',
          blocked: true,
        }),
      })
    );
    expect(systemLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CROSS_STORE_ACCESS_DENIED',
        severity: 'WARN',
      })
    );
  });

  it('rejects a session without a store assignment before probing membership', async () => {
    const response = await assertBodyStoreScope(
      requestFor(),
      sessionFor({ storeId: null }),
      OTHER
    );
    expect(response?.status).toBe(403);
    expect(storeMembershipFindFirst).not.toHaveBeenCalled();
    // No-store assignment is a configuration problem, not a probe: no
    // SecurityEvent is filed (same as assertStoreScope).
    expect(securityEventCreate).not.toHaveBeenCalled();
  });
});

describe('auditRecordMiss - [id] 404 classification (SECURITY)', () => {
  it('never audits for SUPER_ADMIN (org-wide: a miss is just a miss)', async () => {
    const probe = vi.fn().mockResolvedValue({ storeId: OTHER });
    await auditRecordMiss({
      request: requestFor('/api/products/1'),
      session: sessionFor({ role: 'SUPER_ADMIN' }),
      resourceId: 'prod_1',
      resource: 'product',
      probe,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(securityEventCreate).not.toHaveBeenCalled();
  });

  it('stays silent when the record does not exist at all (stale links are not probes)', async () => {
    const probe = vi.fn().mockResolvedValue(null);
    await auditRecordMiss({
      request: requestFor('/api/products/1'),
      session: sessionFor(),
      resourceId: 'prod_missing',
      resource: 'product',
      probe,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(securityEventCreate).not.toHaveBeenCalled();
    expect(systemLogMock).not.toHaveBeenCalled();
  });

  it('stays silent when the record belongs to the caller store', async () => {
    const probe = vi.fn().mockResolvedValue({ storeId: OWN });
    await auditRecordMiss({
      request: requestFor('/api/products/1'),
      session: sessionFor(),
      resourceId: 'prod_1',
      resource: 'product',
      probe,
    });
    expect(securityEventCreate).not.toHaveBeenCalled();
    expect(systemLogMock).not.toHaveBeenCalled();
  });

  it('writes a SecurityEvent + ops log when the id exists in ANOTHER store (IDOR probe)', async () => {
    const probe = vi.fn().mockResolvedValue({ storeId: OTHER });
    await auditRecordMiss({
      request: requestFor('/api/products/prod_foreign'),
      session: sessionFor({ role: 'CASHIER' }),
      resourceId: 'prod_foreign',
      resource: 'product',
      probe,
    });

    expect(securityEventCreate).toHaveBeenCalledTimes(1);
    const call = securityEventCreate.mock.calls[0][0] as {
      data: { eventType: string; details: string; blocked: boolean };
    };
    expect(call.data.eventType).toBe('UNAUTHORIZED_ACCESS');
    expect(call.data.blocked).toBe(true);
    const details = JSON.parse(call.data.details) as Record<string, unknown>;
    expect(details.type).toBe('CROSS_TENANT_RESOURCE_DENIED');
    expect(details.resource).toBe('product');
    expect(details.resourceId).toBe('prod_foreign');
    expect(details.recordStoreId).toBe(OTHER);

    expect(systemLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CROSS_TENANT_RESOURCE_DENIED',
        severity: 'WARN',
        message: expect.stringContaining('prod_foreign'),
      })
    );
  });

  it('swallows probe failures - auditing must never change the 404 response', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(
      auditRecordMiss({
        request: requestFor('/api/products/1'),
        session: sessionFor(),
        resourceId: 'prod_1',
        resource: 'product',
        probe,
      })
    ).resolves.toBeUndefined();
    expect(securityEventCreate).not.toHaveBeenCalled();
  });
});
