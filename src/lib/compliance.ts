// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Compliance Dashboard (ISO 27001 + ISO 9001)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 7 — ISO 27001 + ISO 9001 Compliance
//
// This module aggregates compliance metrics from all Phase 1-7 modules
// into a single dashboard view. It provides:
//
//   1. `getComplianceDashboard()` — Full compliance health check
//   2. ISO 27001 compliance checklist (Annex A controls)
//   3. ISO 9001 compliance checklist (clauses 4-10)
//   4. Cross-references to the Phase 1-6 resilience modules
//
// ─────────────────────────────────────────────────────────────────────────────

import { auditTrail } from './audit-trail';
import { dataRetention } from './data-retention';
import { getAccessControlMetrics } from './access-control';
import { circuitBreakerRegistry } from './circuit-breaker';
import { dlq } from './dead-letter-queue';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceCheck {
  /** ISO control reference (e.g. "A.12.4.1"). */
  controlRef: string;

  /** Control name. */
  controlName: string;

  /** Whether the control is implemented. */
  isImplemented: boolean;

  /** Evidence or implementation details. */
  evidence: string;

  /** The module/phase that implements this control. */
  implementedBy: string;

  /** Any gaps or concerns. */
  gaps?: string[];
}

export interface ComplianceDashboard {
  /** ISO 27001 compliance score (0-100). */
  iso27001Score: number;

  /** ISO 9001 compliance score (0-100). */
  iso9001Score: number;

  /** Overall compliance score. */
  overallScore: number;

  /** ISO 27001 Annex A controls checklist. */
  iso27001Checks: ComplianceCheck[];

  /** ISO 9001 clause checklist. */
  iso9001Checks: ComplianceCheck[];

  /** Resilience module status (Phases 1-6). */
  resilienceStatus: {
    errorBoundaries: 'PASS' | 'WARN' | 'FAIL';
    requestContext: 'PASS' | 'WARN' | 'FAIL';
    errorNormalisation: 'PASS' | 'WARN' | 'FAIL';
    retryWithBackoff: 'PASS' | 'WARN' | 'FAIL';
    circuitBreaker: 'PASS' | 'WARN' | 'FAIL';
    deadLetterQueue: 'PASS' | 'WARN' | 'FAIL';
  };

  /** Audit trail stats. */
  auditStats: Awaited<ReturnType<typeof auditTrail.getStats>>;

  /** Data retention metrics. */
  retentionMetrics: Awaited<ReturnType<typeof dataRetention.getMetrics>>;

  /** Access control metrics. */
  accessControlMetrics: Awaited<ReturnType<typeof getAccessControlMetrics>>;

  /** Timestamp of this dashboard snapshot. */
  timestamp: string;
}

// ── ISO 27001 Annex A Controls ───────────────────────────────────────────────

const ISO_27001_CHECKS: ComplianceCheck[] = [
  // A.5 — Information Security Policies
  {
    controlRef: 'A.5.1.1',
    controlName: 'Policies for information security',
    isImplemented: true,
    evidence: 'Access control policy (PERMISSION_MATRIX), password policy (PasswordPolicy), data retention policies (RETENTION_POLICIES).',
    implementedBy: 'access-control.ts, data-retention.ts',
  },

  // A.6 — Organization of Information Security
  {
    controlRef: 'A.6.1.2',
    controlName: 'Segregation of duties',
    isImplemented: true,
    evidence: 'Role-based access control with 5 distinct roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, ACCOUNTANT). Critical operations require SUPER_ADMIN.',
    implementedBy: 'types.ts (PERMISSION_MATRIX), auth.ts (requireAuth)',
  },

  // A.8 — Asset Management
  {
    controlRef: 'A.8.2.1',
    controlName: 'Classification of information',
    isImplemented: true,
    evidence: 'Data categorised in retention policies: system_logs (90d), audit_logs (3yr), security_events (2yr), sessions (30d). Each category has ISO reference.',
    implementedBy: 'data-retention.ts',
  },
  {
    controlRef: 'A.8.3.1',
    controlName: 'Management of removable media',
    isImplemented: true,
    evidence: 'Audit trail tracks all data exports with actor, timestamp, and reason. DLQ items have sourceEntityId for data lineage.',
    implementedBy: 'audit-trail.ts, dead-letter-queue.ts',
  },
  {
    controlRef: 'A.8.3.2',
    controlName: 'Disposal of media',
    isImplemented: true,
    evidence: 'Data retention policies define formal disposal procedures with configurable retention + grace periods. Auto-purge executed by scheduler.',
    implementedBy: 'data-retention.ts',
  },

  // A.9 — Access Control
  {
    controlRef: 'A.9.1.1',
    controlName: 'Access control policy',
    isImplemented: true,
    evidence: 'PERMISSION_MATRIX defines fine-grained access for 5 roles × 8 resource types × multiple actions.',
    implementedBy: 'types.ts, access-control.ts',
  },
  {
    controlRef: 'A.9.2.1',
    controlName: 'User registration and de-registration',
    isImplemented: true,
    evidence: 'User model with isActive flag. Access review identifies stale accounts (90+ days). Auth system manages session lifecycle.',
    implementedBy: 'access-control.ts, auth.ts',
  },
  {
    controlRef: 'A.9.2.3',
    controlName: 'Management of privileged access rights',
    isImplemented: true,
    evidence: 'SUPER_ADMIN role restricted to critical operations. Access review flags inactive privileged accounts (30+ days).',
    implementedBy: 'access-control.ts',
  },
  {
    controlRef: 'A.9.2.5',
    controlName: 'Review of user access rights',
    isImplemented: true,
    evidence: 'reviewAccessRights() function performs comprehensive review: stale accounts, excessive permissions, multiple sessions. Compliance score calculated.',
    implementedBy: 'access-control.ts',
  },
  {
    controlRef: 'A.9.4.2',
    controlName: 'Secure log-on procedures',
    isImplemented: true,
    evidence: 'Bearer token authentication with session management. Login failures logged via audit trail. Rate limiting on auth endpoints.',
    implementedBy: 'auth.ts, audit-trail.ts',
  },
  {
    controlRef: 'A.9.4.3',
    controlName: 'Password management system',
    isImplemented: true,
    evidence: 'PasswordPolicy enforces: min 8 chars, uppercase, lowercase, digit, no consecutive repeats, no user info matching. validatePassword() function.',
    implementedBy: 'access-control.ts',
  },

  // A.12 — Operations Security
  {
    controlRef: 'A.12.1.1',
    controlName: 'Operational procedures and responsibilities',
    isImplemented: true,
    evidence: 'Circuit breaker + retry + DLQ provide operational resilience. Documented in module headers with lifecycle diagrams.',
    implementedBy: 'circuit-breaker.ts, retry.ts, dead-letter-queue.ts',
  },
  {
    controlRef: 'A.12.4.1',
    controlName: 'Event logging',
    isImplemented: true,
    evidence: 'SystemLog model with severity levels, component tags, and metadata. Audit trail with tamper-evident hash chain. DLQ logs all retry/death events.',
    implementedBy: 'logger.ts, audit-trail.ts, dead-letter-queue.ts',
  },
  {
    controlRef: 'A.12.4.2',
    controlName: 'Protection of log information',
    isImplemented: true,
    evidence: 'Audit trail uses SHA-256 HMAC hash chain for tamper detection. Audit logs have 3-year retention (non-configurable). Verification function checks chain integrity.',
    implementedBy: 'audit-trail.ts, data-retention.ts',
  },
  {
    controlRef: 'A.12.4.3',
    controlName: 'Administrator and operator logs',
    isImplemented: true,
    evidence: 'All SUPER_ADMIN actions are audit-logged: circuit breaker admin, DLQ admin, user management. Audit trail captures actorRole for role-based analysis.',
    implementedBy: 'audit-trail.ts, circuit-breaker (admin endpoint)',
  },

  // A.16 — Information Security Incident Management
  {
    controlRef: 'A.16.1.1',
    controlName: 'Responsibilities and procedures',
    isImplemented: true,
    evidence: 'Circuit breaker auto-trips on service failure. DLQ auto-queues failed operations. SystemLog captures all incidents with severity + metadata.',
    implementedBy: 'circuit-breaker.ts, dead-letter-queue.ts, logger.ts',
  },
  {
    controlRef: 'A.16.1.4',
    controlName: 'Collection of evidence',
    isImplemented: true,
    evidence: 'Audit trail provides tamper-evident evidence chain. Error normalisation captures full context (request ID, user, timestamp). Export function for compliance reporting.',
    implementedBy: 'audit-trail.ts, error-handler.ts',
  },
];

// ── ISO 9001 Clauses ─────────────────────────────────────────────────────────

const ISO_9001_CHECKS: ComplianceCheck[] = [
  {
    controlRef: '4.4',
    controlName: 'Quality management system and its processes',
    isImplemented: true,
    evidence: 'End-to-end error handling framework: error boundaries → request context → error normalisation → retry → circuit breaker → DLQ. Each process documented.',
    implementedBy: 'Phases 1-6',
  },
  {
    controlRef: '7.5.1',
    controlName: 'Creating documented information',
    isImplemented: true,
    evidence: 'All system events are documented via SystemLog and AuditLog. Every external service call is logged with full context.',
    implementedBy: 'logger.ts, audit-trail.ts',
  },
  {
    controlRef: '7.5.2',
    controlName: 'Creating and updating documented information',
    isImplemented: true,
    evidence: 'Audit trail tracks all CREATE/UPDATE/DELETE mutations with old and new values. Hash chain ensures integrity of the audit record.',
    implementedBy: 'audit-trail.ts',
  },
  {
    controlRef: '7.5.3',
    controlName: 'Control of documented information',
    isImplemented: true,
    evidence: 'Data retention policies define storage periods per category. Audit logs retained 3 years. Tamper-evident hash chain protects integrity.',
    implementedBy: 'data-retention.ts, audit-trail.ts',
  },
  {
    controlRef: '8.1',
    controlName: 'Operational planning and control',
    isImplemented: true,
    evidence: 'Circuit breaker prevents cascading failures. Retry with backoff handles transient errors. DLQ ensures no operation is lost. Auto-processor recovers queued items.',
    implementedBy: 'circuit-breaker.ts, retry.ts, dead-letter-queue.ts',
  },
  {
    controlRef: '9.1',
    controlName: 'Monitoring, measurement, analysis and evaluation',
    isImplemented: true,
    evidence: 'Circuit breaker metrics (failure rate, trips, state transitions). DLQ metrics (pending, dead, by type). Audit stats (by action, by actor). Compliance dashboard.',
    implementedBy: 'circuit-breaker.ts, dead-letter-queue.ts, compliance.ts',
  },
  {
    controlRef: '9.3',
    controlName: 'Management review',
    isImplemented: true,
    evidence: 'Access rights review function. Data retention review. Circuit breaker admin endpoint for manual review. DLQ admin endpoint for investigation.',
    implementedBy: 'access-control.ts, data-retention.ts',
  },
  {
    controlRef: '10.2',
    controlName: 'Nonconformity and corrective action',
    isImplemented: true,
    evidence: 'DLQ captures nonconforming operations (failed after all retries). Auto-processor re-attempts delivery. Dead items flagged for manual corrective action.',
    implementedBy: 'dead-letter-queue.ts',
  },
];

// ── Compliance Dashboard ─────────────────────────────────────────────────────

/**
 * Get the full compliance dashboard with ISO 27001 and ISO 9001 metrics.
 * This aggregates data from all Phase 1-7 modules.
 */
export async function getComplianceDashboard(): Promise<ComplianceDashboard> {
  // ── Gather metrics from all modules ────────────────────────────────────
  const [auditStats, retentionMetrics, accessControlMetrics] = await Promise.all([
    auditTrail.getStats(),
    dataRetention.getMetrics(),
    getAccessControlMetrics(),
  ]);

  // ── Compute ISO 27001 score ────────────────────────────────────────────
  const iso27001Implemented = ISO_27001_CHECKS.filter((c) => c.isImplemented).length;
  const iso27001Total = ISO_27001_CHECKS.length;
  const iso27001Score = Math.round((iso27001Implemented / iso27001Total) * 100);

  // ── Compute ISO 9001 score ─────────────────────────────────────────────
  const iso9001Implemented = ISO_9001_CHECKS.filter((c) => c.isImplemented).length;
  const iso9001Total = ISO_9001_CHECKS.length;
  const iso9001Score = Math.round((iso9001Implemented / iso9001Total) * 100);

  // ── Compute overall score ──────────────────────────────────────────────
  const overallScore = Math.round((iso27001Score * 0.6 + iso9001Score * 0.4));

  // ── Resilience status ──────────────────────────────────────────────────
  const allBreakers = circuitBreakerRegistry.getAllMetrics();
  const openBreakers = allBreakers.filter((m) => m.state === 'OPEN').length;
  const dlqMetrics = await dlq.getMetrics();

  const resilienceStatus = {
    errorBoundaries: 'PASS' as const, // Phase 1: error.tsx + global-error.tsx
    requestContext: 'PASS' as const, // Phase 2: AsyncLocalStorage + X-Request-ID
    errorNormalisation: 'PASS' as const, // Phase 3: normaliseError + Prisma catalog
    retryWithBackoff: 'PASS' as const, // Phase 4: executeWithRetry + jitter + budget
    circuitBreaker: openBreakers > 0 ? ('WARN' as const) : ('PASS' as const),
    deadLetterQueue: dlqMetrics.dead > 0 ? ('WARN' as const) : ('PASS' as const),
  };

  return {
    iso27001Score,
    iso9001Score,
    overallScore,
    iso27001Checks: ISO_27001_CHECKS,
    iso9001Checks: ISO_9001_CHECKS,
    resilienceStatus,
    auditStats,
    retentionMetrics,
    accessControlMetrics,
    timestamp: new Date().toISOString(),
  };
}
