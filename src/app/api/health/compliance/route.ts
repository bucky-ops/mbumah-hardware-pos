// GET  /api/health/compliance
//
// Phase 7 — ISO 27001 + ISO 9001 Compliance Dashboard endpoint.
//
// GET (public — no auth required for health monitoring):
//   Returns the full compliance dashboard for the MBUMAH HARDWARE POS system.
//   This is the "compliance observability" view — it aggregates data from
//   all Phase 1-7 modules into a single snapshot for auditors, operators,
//   and the health monitoring system.
//
//   The endpoint is intentionally UNAUTHENTICATED because it is used by
//   external health-check probes (e.g. uptime monitoring, load balancer
//   health checks) that cannot present a Bearer token. The response does
//   NOT include any PII or sensitive business data — only aggregate
//   compliance scores, checklist statuses, and resilience indicators.
//
//   Response 200:
//     {
//       "success": true,
//       "data": {
//         "iso27001Score": 100,
//         "iso9001Score": 100,
//         "overallScore": 100,
//         "iso27001Checks": [
//           {
//             "controlRef": "A.5.1.1",
//             "controlName": "Policies for information security",
//             "isImplemented": true,
//             "evidence": "...",
//             "implementedBy": "access-control.ts, data-retention.ts",
//             "gaps": []
//           },
//           ...
//         ],
//         "iso9001Checks": [ ... ],
//         "resilienceStatus": {
//           "errorBoundaries": "PASS",
//           "requestContext": "PASS",
//           "errorNormalisation": "PASS",
//           "retryWithBackoff": "PASS",
//           "circuitBreaker": "PASS",    // WARN if any breaker OPEN
//           "deadLetterQueue": "PASS"    // WARN if dead items exist
//         },
//         "auditStats": { ... },         // from auditTrail.getStats()
//         "retentionMetrics": { ... },   // from dataRetention.getMetrics()
//         "accessControlMetrics": { ... }, // from getAccessControlMetrics()
//         "timestamp": "2026-..."
//       },
//       "requestId": "...",
//       "timestamp": "..."
//     }
//
// ── Why no auth? ──────────────────────────────────────────────────────────────
//
// Health/compliance endpoints are standardised as public across the
// /api/health/* family (see /api/health, /api/health/db, /api/health/env).
// The compliance dashboard is designed for automated monitoring and does
// not expose data that requires access control. If sensitive detail is
// needed, a separate authenticated endpoint should be created.

import { getComplianceDashboard } from '@/lib/compliance';
import { successResponse, errorFromThrown } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// ── GET: full compliance dashboard ──────────────────────────────────────────

export async function GET() {
  try {
    // ── Aggregate all compliance data ────────────────────────────────────
    // getComplianceDashboard() gathers metrics from every Phase 1-7
    // module in parallel (audit trail, data retention, access control,
    // circuit breakers, DLQ) and computes the ISO 27001 + ISO 9001
    // compliance scores.
    const dashboard = await getComplianceDashboard();

    return successResponse(dashboard);
  } catch (err) {
    return errorFromThrown(err, { context: 'COMPLIANCE_DASHBOARD' });
  }
}
