// ─────────────────────────────────────────────────────────────────────────────
// Compliance helpers tests
// ─────────────────────────────────────────────────────────────────────────────
//
// Tests for:
//   • Data retention policies (pure data structure verification)
//   • Data retention service (getPolicies, getPolicy)
//   • Audit trail creation and verification (DB-dependent, rollback)
//   • Audit trail query and export (DB read-only)
//   • Compliance dashboard (DB read — skipped if DLQ model absent)
//
// Pure-logic tests are used where possible. DB-dependent tests use the
// rollback pattern to keep the dev database clean.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import { dataRetention, RETENTION_POLICIES } from '@/lib/data-retention';
import { auditTrail } from '@/lib/audit-trail';
import { getComplianceDashboard } from '@/lib/compliance';

// ── Rollback helper ─────────────────────────────────────────────────────────

const ROLLBACK = Symbol('test-rollback');

async function withRollback<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK) return;
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Retention policies — pure data structure
// ─────────────────────────────────────────────────────────────────────────────

describe('Retention policies — structure', () => {
  it('has at least 5 defined policies', () => {
    expect(RETENTION_POLICIES.length).toBeGreaterThanOrEqual(5);
  });

  it('system_logs has 90-day retention', () => {
    const policy = RETENTION_POLICIES.find((p) => p.category === 'system_logs');
    expect(policy).toBeDefined();
    expect(policy!.retentionDays).toBe(90);
    expect(policy!.graceDays).toBe(7);
  });

  it('audit_logs has 3-year retention', () => {
    const policy = RETENTION_POLICIES.find((p) => p.category === 'audit_logs');
    expect(policy).toBeDefined();
    expect(policy!.retentionDays).toBe(365 * 3);
    expect(policy!.isConfigurable).toBe(false); // Must NOT be configurable
  });

  it('security_events has 2-year retention', () => {
    const policy = RETENTION_POLICIES.find((p) => p.category === 'security_events');
    expect(policy).toBeDefined();
    expect(policy!.retentionDays).toBe(365 * 2);
    expect(policy!.isConfigurable).toBe(false);
  });

  it('sessions has 30-day retention', () => {
    const policy = RETENTION_POLICIES.find((p) => p.category === 'sessions');
    expect(policy).toBeDefined();
    expect(policy!.retentionDays).toBe(30);
  });

  it('every policy has required fields', () => {
    for (const policy of RETENTION_POLICIES) {
      expect(policy.category).toBeTruthy();
      expect(typeof policy.retentionDays).toBe('number');
      expect(typeof policy.graceDays).toBe('number');
      expect(policy.description).toBeTruthy();
      expect(policy.isoReference).toBeTruthy();
      expect(typeof policy.isConfigurable).toBe('boolean');
      expect(policy.modelName).toBeTruthy();
      expect(policy.dateField).toBeTruthy();
    }
  });

  it('audit_logs grace period is 30 days', () => {
    const policy = RETENTION_POLICIES.find((p) => p.category === 'audit_logs');
    expect(policy!.graceDays).toBe(30);
  });

  it('all policies have a valid ISO reference (starts with ISO)', () => {
    for (const policy of RETENTION_POLICIES) {
      expect(policy.isoReference).toContain('ISO');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. dataRetention service — getPolicies / getPolicy
// ─────────────────────────────────────────────────────────────────────────────

describe('dataRetention service', () => {
  it('getPolicies returns the full policy list', () => {
    const policies = dataRetention.getPolicies();
    expect(policies).toHaveLength(RETENTION_POLICIES.length);
  });

  it('getPolicy finds a known category', () => {
    const policy = dataRetention.getPolicy('system_logs');
    expect(policy).toBeDefined();
    expect(policy!.category).toBe('system_logs');
  });

  it('getPolicy returns undefined for unknown category', () => {
    const policy = dataRetention.getPolicy('nonexistent_category');
    expect(policy).toBeUndefined();
  });

  it('getPolicy finds each defined category', () => {
    for (const p of RETENTION_POLICIES) {
      const found = dataRetention.getPolicy(p.category);
      expect(found, `Policy ${p.category} should be findable`).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Audit trail creation (DB — rollback)
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit trail — creation (DB rollback)', () => {
  it('creates an audit event with correct fields inside a transaction', async () => {
    await withRollback(async (tx) => {
      const event = await tx.auditLog.create({
        data: {
          entityType: 'Product',
          entityId: 'test-product-compliance',
          action: 'CREATE',
          userId: 'user_super_admin',
          oldValues: null,
          newValues: { name: 'Test Product' },
          storeId: 'store_juja_main',
        },
      });
      expect(event.id).toBeTruthy();
      expect(event.action).toBe('CREATE');
      expect(event.entityType).toBe('Product');

      // Verify it's queryable inside the transaction
      const found = await tx.auditLog.findUnique({ where: { id: event.id } });
      expect(found).not.toBeNull();
      expect(found!.entityType).toBe('Product');
    });
    // Rollback happened — no further assertion needed; the test
    // above already verified the row exists inside the tx.
  });

  it('stores old and new values as JSON', async () => {
    await withRollback(async (tx) => {
      const event = await tx.auditLog.create({
        data: {
          entityType: 'User',
          entityId: 'test-user-compliance',
          action: 'UPDATE',
          oldValues: { role: 'CASHIER' },
          newValues: { role: 'BRANCH_MANAGER' },
        },
      });
      const found = await tx.auditLog.findUnique({ where: { id: event.id } });
      expect(found!.oldValues).toEqual({ role: 'CASHIER' });
      expect(found!.newValues).toEqual({ role: 'BRANCH_MANAGER' });
    });
  });

  it('supports reason field for VOID actions', async () => {
    await withRollback(async (tx) => {
      const event = await tx.auditLog.create({
        data: {
          entityType: 'SalesTransaction',
          entityId: 'test-void-tx',
          action: 'VOID',
          reason: 'Customer returned defective item',
          userId: 'user_super_admin',
        },
      });
      expect(event.reason).toBe('Customer returned defective item');
    });
  });

  it('stores IP address and user agent', async () => {
    await withRollback(async (tx) => {
      const event = await tx.auditLog.create({
        data: {
          entityType: 'Session',
          entityId: 'test-session',
          action: 'LOGIN',
          userId: 'user_super_admin',
          ipAddress: '192.168.1.100',
          userAgent: 'TestBrowser/1.0',
        },
      });
      const found = await tx.auditLog.findUnique({ where: { id: event.id } });
      expect(found!.ipAddress).toBe('192.168.1.100');
      expect(found!.userAgent).toBe('TestBrowser/1.0');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Audit trail query (DB — read-only)
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit trail — query (DB read)', () => {
  it('query returns events and total count', async () => {
    const { events, total } = await auditTrail.query({ limit: 10 });
    expect(Array.isArray(events)).toBe(true);
    expect(typeof total).toBe('number');
    expect(total).toBeGreaterThanOrEqual(0);
    expect(events.length).toBeLessThanOrEqual(10);
  });

  it('query filters by action', async () => {
    const { events } = await auditTrail.query({ action: 'CREATE', limit: 5 });
    for (const event of events) {
      expect(event.action).toBe('CREATE');
    }
  });

  it('query filters by resourceType', async () => {
    const { events } = await auditTrail.query({ resourceType: 'Product', limit: 5 });
    for (const event of events) {
      expect(event.entityType).toBe('Product');
    }
  });

  it('getStats returns correct structure', async () => {
    const stats = await auditTrail.getStats();
    expect(typeof stats.totalEvents).toBe('number');
    expect(typeof stats.eventsByAction).toBe('object');
    expect(typeof stats.eventsByResourceType).toBe('object');
    expect(typeof stats.eventsByActor).toBe('object');
    expect(typeof stats.recentCriticalEvents).toBe('number');
    expect(stats.chainVerification).toBeDefined();
    expect(typeof stats.chainVerification.totalChecked).toBe('number');
    expect(typeof stats.chainVerification.isIntact).toBe('boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Audit trail export (DB — read)
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit trail — export', () => {
  it('exportEvents returns an array of plain objects', async () => {
    const events = await auditTrail.exportEvents({ limit: 5 });
    expect(Array.isArray(events)).toBe(true);
    if (events.length > 0) {
      const event = events[0];
      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeTruthy();
      expect(event.action).toBeTruthy();
      expect(event.resourceType).toBeTruthy();
      expect(event.resourceId).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Compliance dashboard (DB read — requires DLQ model)
// ─────────────────────────────────────────────────────────────────────────────
//
// The full dashboard calls dlq.getMetrics() which needs the DeadLetterQueue
// model. In the SQLite dev DB this model may not exist. We test what we can
// and skip gracefully if the DLQ model is absent.

let dlqAvailable: boolean | null = null;

async function checkDlqAvailable(): Promise<boolean> {
  if (dlqAvailable !== null) return dlqAvailable;
  try {
    // If db.deadLetterQueue exists, this will not throw.
    // @ts-expect-error — checking for model existence at runtime
    if (typeof db.deadLetterQueue?.count !== 'function') {
      dlqAvailable = false;
      return false;
    }
    await db.deadLetterQueue.count();
    dlqAvailable = true;
  } catch {
    dlqAvailable = false;
  }
  return dlqAvailable;
}

describe('getComplianceDashboard', () => {
  it('returns a valid dashboard structure when DLQ model is available', async () => {
    const available = await checkDlqAvailable();
    if (!available) {
      // The SQLite dev DB may not have the DLQ model.
      // Verify the function fails with a clear error rather than silently.
      await expect(getComplianceDashboard()).rejects.toThrow();
      return;
    }

    const dashboard = await getComplianceDashboard();
    expect(typeof dashboard.iso27001Score).toBe('number');
    expect(typeof dashboard.iso9001Score).toBe('number');
    expect(typeof dashboard.overallScore).toBe('number');
    expect(Array.isArray(dashboard.iso27001Checks)).toBe(true);
    expect(Array.isArray(dashboard.iso9001Checks)).toBe(true);
    expect(dashboard.resilienceStatus).toBeDefined();
    expect(dashboard.auditStats).toBeDefined();
    expect(dashboard.retentionMetrics).toBeDefined();
    expect(typeof dashboard.timestamp).toBe('string');
  });

  it('ISO scores are between 0 and 100', async () => {
    const available = await checkDlqAvailable();
    if (!available) return; // Skip when DLQ model absent

    const dashboard = await getComplianceDashboard();
    expect(dashboard.iso27001Score).toBeGreaterThanOrEqual(0);
    expect(dashboard.iso27001Score).toBeLessThanOrEqual(100);
    expect(dashboard.iso9001Score).toBeGreaterThanOrEqual(0);
    expect(dashboard.iso9001Score).toBeLessThanOrEqual(100);
  });

  it('ISO 27001 checks reference known controls', async () => {
    const available = await checkDlqAvailable();
    if (!available) return;

    const dashboard = await getComplianceDashboard();
    const controlRefs = dashboard.iso27001Checks.map((c) => c.controlRef);
    expect(controlRefs).toContain('A.5.1.1');
    expect(controlRefs).toContain('A.9.1.1');
    expect(controlRefs).toContain('A.12.4.1');
  });

  it('ISO 9001 checks reference known clauses', async () => {
    const available = await checkDlqAvailable();
    if (!available) return;

    const dashboard = await getComplianceDashboard();
    const clauseRefs = dashboard.iso9001Checks.map((c) => c.controlRef);
    expect(clauseRefs).toContain('4.4');
    expect(clauseRefs).toContain('8.1');
    expect(clauseRefs).toContain('9.1');
  });

  it('each ISO check has evidence and implementedBy', async () => {
    const available = await checkDlqAvailable();
    if (!available) return;

    const dashboard = await getComplianceDashboard();
    for (const check of [...dashboard.iso27001Checks, ...dashboard.iso9001Checks]) {
      expect(check.controlRef).toBeTruthy();
      expect(check.controlName).toBeTruthy();
      expect(typeof check.isImplemented).toBe('boolean');
      expect(check.evidence).toBeTruthy();
      expect(check.implementedBy).toBeTruthy();
    }
  });

  it('resilience status has all expected phases', async () => {
    const available = await checkDlqAvailable();
    if (!available) return;

    const dashboard = await getComplianceDashboard();
    const rs = dashboard.resilienceStatus;
    expect(rs.errorBoundaries).toMatch(/PASS|WARN|FAIL/);
    expect(rs.requestContext).toMatch(/PASS|WARN|FAIL/);
    expect(rs.errorNormalisation).toMatch(/PASS|WARN|FAIL/);
    expect(rs.retryWithBackoff).toMatch(/PASS|WARN|FAIL/);
    expect(rs.circuitBreaker).toMatch(/PASS|WARN|FAIL/);
    expect(rs.deadLetterQueue).toMatch(/PASS|WARN|FAIL/);
  });

  it('overall score is a weighted average of ISO scores', async () => {
    const available = await checkDlqAvailable();
    if (!available) return;

    const dashboard = await getComplianceDashboard();
    const expected = Math.round(dashboard.iso27001Score * 0.6 + dashboard.iso9001Score * 0.4);
    expect(dashboard.overallScore).toBe(expected);
  });

  it('retention metrics include policy details', async () => {
    const available = await checkDlqAvailable();
    if (!available) return;

    const dashboard = await getComplianceDashboard();
    const rm = dashboard.retentionMetrics;
    expect(typeof rm.totalPolicies).toBe('number');
    expect(typeof rm.autoPurgeEnabled).toBe('number');
    expect(typeof rm.estimatedPurgeableRecords).toBe('number');
    expect(Array.isArray(rm.policies)).toBe(true);
    expect(rm.policies.length).toBeGreaterThanOrEqual(5);
  });

  it('timestamp is a valid ISO date string', async () => {
    const available = await checkDlqAvailable();
    if (!available) return;

    const dashboard = await getComplianceDashboard();
    const date = new Date(dashboard.timestamp);
    expect(!isNaN(date.getTime())).toBe(true);
  });
});
