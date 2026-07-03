// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Data Retention Policies (ISO 27001 A.8.3.2 + ISO 9001 7.5.3)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 7 — ISO 27001 + ISO 9001 Compliance
//
// ISO 27001 A.8.3.2 requires that "information shall be disposed of
// using formal procedures" and ISO 9001 7.5.3 requires that documented
// information be "retained for the period required." This module
// provides:
//
//   1. Configurable retention periods per data category
//   2. Auto-purge of expired data (called by the scheduler)
//   3. Retention policy metadata for the compliance dashboard
//   4. Soft-delete before hard-delete (grace period)
//
// ── Data categories ──────────────────────────────────────────────────────────
//
// Each data category has:
//   • retentionDays — how long to keep the data (0 = keep forever)
//   • graceDays — extra days after expiry before hard-delete
//   • description — human-readable reason for the retention period
//   • isoReference — the ISO clause that mandates this period
//
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  /** The data category (e.g. 'system_logs', 'audit_logs'). */
  category: string;

  /** How many days to retain the data. 0 = keep forever. */
  retentionDays: number;

  /** Extra grace days before hard-delete after retention expires. */
  graceDays: number;

  /** Human-readable description of why this period was chosen. */
  description: string;

  /** ISO clause reference. */
  isoReference: string;

  /** Whether this policy can be modified by admins. */
  isConfigurable: boolean;

  /** The Prisma model name for auto-purge. */
  modelName: string;

  /** The date field to check for expiry. */
  dateField: string;
}

export interface RetentionExecutionResult {
  /** The category that was processed. */
  category: string;

  /** Number of records purged. */
  purged: number;

  /** Whether the purge was successful. */
  success: boolean;

  /** Error message if the purge failed. */
  error?: string;
}

export interface RetentionMetrics {
  /** Total policies defined. */
  totalPolicies: number;

  /** Policies with auto-purge enabled. */
  autoPurgeEnabled: number;

  /** Total records that would be purged across all categories. */
  estimatedPurgeableRecords: number;

  /** Details per category. */
  policies: RetentionPolicy[];

  /** Last execution timestamp (ISO). */
  lastExecutionAt: string | null;
}

// ── Default retention policies ───────────────────────────────────────────────

export const RETENTION_POLICIES: RetentionPolicy[] = [
  {
    category: 'system_logs',
    retentionDays: 90,
    graceDays: 7,
    description: 'System logs retained for 90 days for operational debugging and security forensics.',
    isoReference: 'ISO 27001 A.12.4.1',
    isConfigurable: true,
    modelName: 'systemLog',
    dateField: 'createdAt',
  },
  {
    category: 'audit_logs',
    retentionDays: 365 * 3, // 3 years
    graceDays: 30,
    description: 'Audit logs retained for 3 years per Kenyan data protection regulations and ISO 27001 requirements.',
    isoReference: 'ISO 27001 A.12.4.2 / ISO 9001 7.5.3',
    isConfigurable: false, // Audit logs must NOT be deleted early
    modelName: 'auditLog',
    dateField: 'timestamp',
  },
  {
    category: 'dead_letter_queue_completed',
    retentionDays: 30,
    graceDays: 7,
    description: 'Completed DLQ items retained for 30 days for delivery verification.',
    isoReference: 'ISO 9001 7.5.3',
    isConfigurable: true,
    modelName: 'deadLetterQueue',
    dateField: 'resolvedAt',
  },
  {
    category: 'dead_letter_queue_dead',
    retentionDays: 90,
    graceDays: 14,
    description: 'Dead DLQ items retained for 90 days for root-cause analysis.',
    isoReference: 'ISO 27001 A.12.4.1',
    isConfigurable: true,
    modelName: 'deadLetterQueue',
    dateField: 'resolvedAt',
  },
  {
    category: 'security_events',
    retentionDays: 365 * 2, // 2 years
    graceDays: 30,
    description: 'Security events retained for 2 years for incident investigation and compliance audits.',
    isoReference: 'ISO 27001 A.12.4.2',
    isConfigurable: false,
    modelName: 'securityEvent',
    dateField: 'createdAt',
  },
  {
    category: 'sessions',
    retentionDays: 30,
    graceDays: 0,
    description: 'Expired sessions purged after 30 days to manage database size.',
    isoReference: 'ISO 27001 A.9.4.2',
    isConfigurable: true,
    modelName: 'session',
    dateField: 'expiresAt',
  },
];

// ── Data Retention Service ───────────────────────────────────────────────────

let lastExecutionAt: Date | null = null;

export const dataRetention = {
  /**
   * Get all retention policies.
   */
  getPolicies(): RetentionPolicy[] {
    return RETENTION_POLICIES;
  },

  /**
   * Get a specific policy by category.
   */
  getPolicy(category: string): RetentionPolicy | undefined {
    return RETENTION_POLICIES.find((p) => p.category === category);
  },

  /**
   * Execute the retention purge for all categories.
   * This should be called by a scheduler (e.g. daily).
   *
   * @returns Results for each category.
   */
  async executeAll(): Promise<RetentionExecutionResult[]> {
    const results: RetentionExecutionResult[] = [];

    for (const policy of RETENTION_POLICIES) {
      if (policy.retentionDays === 0) continue; // Keep forever

      try {
        const purged = await this.purgeCategory(policy);
        results.push({ category: policy.category, purged, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ category: policy.category, purged: 0, success: false, error: message });
      }
    }

    lastExecutionAt = new Date();

    // Log the execution summary
    const totalPurged = results.reduce((sum, r) => sum + r.purged, 0);
    const failedCount = results.filter((r) => !r.success).length;

    void systemLog({
      action: 'DATA_RETENTION_EXECUTION',
      component: LogComponent.SYSTEM,
      severity: failedCount > 0 ? LogSeverity.WARN : LogSeverity.INFO,
      message:
        `Data retention execution completed: ${totalPurged} records purged across ` +
        `${results.length} categories (${failedCount} failures).`,
      metadata: {
        totalPurged,
        categories: results.length,
        failures: failedCount,
        results: results.map((r) => ({ category: r.category, purged: r.purged, success: r.success })),
      },
    }).catch(() => {});

    return results;
  },

  /**
   * Purge expired records for a specific category.
   */
  async purgeCategory(policy: RetentionPolicy): Promise<number> {
    const totalRetentionDays = policy.retentionDays + policy.graceDays;
    const cutoff = new Date(Date.now() - totalRetentionDays * 24 * 60 * 60 * 1000);

    // Build the where clause based on the model and date field
    // We use a dynamic approach since each model has different fields
    switch (policy.category) {
      case 'system_logs': {
        const result = await db.systemLog.deleteMany({
          where: { createdAt: { lte: cutoff } },
        });
        return result.count;
      }

      case 'audit_logs': {
        // ISO 27001: Audit logs have a LONG retention period and are
        // NOT configurable. We still honour the policy but with the
        // 3-year + 30-day grace period.
        const result = await db.auditLog.deleteMany({
          where: { timestamp: { lte: cutoff } },
        });
        return result.count;
      }

      case 'dead_letter_queue_completed': {
        const result = await db.deadLetterQueue.deleteMany({
          where: {
            status: 'COMPLETED',
            resolvedAt: { lte: cutoff },
          },
        });
        return result.count;
      }

      case 'dead_letter_queue_dead': {
        const result = await db.deadLetterQueue.deleteMany({
          where: {
            status: 'DEAD',
            resolvedAt: { lte: cutoff },
          },
        });
        return result.count;
      }

      case 'security_events': {
        const result = await db.securityEvent.deleteMany({
          where: { createdAt: { lte: cutoff } },
        });
        return result.count;
      }

      case 'sessions': {
        const result = await db.session.deleteMany({
          where: { expiresAt: { lte: cutoff } },
        });
        return result.count;
      }

      default:
        return 0;
    }
  },

  /**
   * Estimate the number of purgeable records across all categories.
   * This is a dry-run — no data is actually deleted.
   */
  async estimatePurgeable(): Promise<Record<string, number>> {
    const estimates: Record<string, number> = {};

    for (const policy of RETENTION_POLICIES) {
      if (policy.retentionDays === 0) {
        estimates[policy.category] = 0;
        continue;
      }

      try {
        const totalRetentionDays = policy.retentionDays + policy.graceDays;
        const cutoff = new Date(Date.now() - totalRetentionDays * 24 * 60 * 60 * 1000);

        switch (policy.category) {
          case 'system_logs':
            estimates[policy.category] = await db.systemLog.count({
              where: { createdAt: { lte: cutoff } },
            });
            break;
          case 'audit_logs':
            estimates[policy.category] = await db.auditLog.count({
              where: { timestamp: { lte: cutoff } },
            });
            break;
          case 'dead_letter_queue_completed':
            estimates[policy.category] = await db.deadLetterQueue.count({
              where: { status: 'COMPLETED', resolvedAt: { lte: cutoff } },
            });
            break;
          case 'dead_letter_queue_dead':
            estimates[policy.category] = await db.deadLetterQueue.count({
              where: { status: 'DEAD', resolvedAt: { lte: cutoff } },
            });
            break;
          case 'security_events':
            estimates[policy.category] = await db.securityEvent.count({
              where: { createdAt: { lte: cutoff } },
            });
            break;
          case 'sessions':
            estimates[policy.category] = await db.session.count({
              where: { expiresAt: { lte: cutoff } },
            });
            break;
          default:
            estimates[policy.category] = 0;
        }
      } catch {
        estimates[policy.category] = -1; // Error indicator
      }
    }

    return estimates;
  },

  /**
   * Get retention metrics for the compliance dashboard.
   */
  async getMetrics(): Promise<RetentionMetrics> {
    const purgeable = await this.estimatePurgeable();
    const totalPurgeable = Object.values(purgeable).reduce((sum, v) => sum + Math.max(0, v), 0);

    return {
      totalPolicies: RETENTION_POLICIES.length,
      autoPurgeEnabled: RETENTION_POLICIES.filter((p) => p.retentionDays > 0).length,
      estimatedPurgeableRecords: totalPurgeable,
      policies: RETENTION_POLICIES,
      lastExecutionAt: lastExecutionAt?.toISOString() ?? null,
    };
  },
};
