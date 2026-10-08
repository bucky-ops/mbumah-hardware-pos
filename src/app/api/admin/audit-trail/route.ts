// GET /api/admin/audit-trail — consolidated audit trail for the Security tab
// (v2.12.6, PR C — Audit Logging consolidation)
//
// Merges TWO durable sources into ONE admin-facing feed:
//
//   1. AuditLog (hash-chained) rows with action IN
//        • 'PERMISSION_DENIED'   — every RBAC denial fed through
//                                  recordPermissionDenied() (discount gates,
//                                  high-risk debt, price guard, role changes…)
//        • 'MANAGER_OVERRIDE'    — a verified managerOverride credential
//                                  consumed by a business gate
//        • 'MANAGER_AUTHORIZED'  — POST /api/auth/manager-authorize step-ups
//
//   2. SecurityEvent rows with eventType IN ('PERMISSION_DENIED',
//      'HIGH_RISK_ATTEMPT') — mirror-reality check: recordPermissionDenied()
//      writes BOTH an AuditLog row AND a SecurityEvent row for every denial,
//      so most SecurityEvent rows have a twin. Rows are deduplicated by
//      nearest-timestamp matching (|Δt| ≤ DEDUP_WINDOW_MS) on the same user +
//      permission so the table shows every denial EXACTLY once. SecurityEvent
//      rows WITHOUT an AuditLog twin (e.g. written by a path that predates the
//      hook, or a hook failure) still appear — the table must never hide a
//      denial.
//
// Roles: SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER. Store scoping:
// AuditLog is in STORE_SCOPED_MODELS so the session tenant context auto-narrows
// it to the caller's branch; SecurityEvent is NOT store-scoped, so a manual
// storeId filter is applied for non-SUPER_ADMIN callers (same posture as
// /api/security/events).
//
// Filters (searchParams): role, userId, dateFrom, dateTo, deniedOnly ('true'),
// search (name / email / permission / reason), page, limit (default 50),
// format=csv → text/csv download (mbumah-audit-trail-YYYYMMDD.csv).
//
// PAGINATION NOTE: rows are merged + filtered in memory from a bounded window
// of the most recent matching rows per source (SOURCE_ROW_CAP_JSON for JSON
// pages, SOURCE_ROW_CAP_CSV for exports). Denial/override volume is low; the
// cap comfortably covers realistic browsing depth and keeps the two-table
// merge deterministic.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withSessionAuth, getSessionFromRequest, type AuthSession } from '@/lib/auth';
import { buildCsv } from '@/lib/data-export-utils';

export const dynamic = 'force-dynamic';

const AUDIT_ACTIONS = ['PERMISSION_DENIED', 'MANAGER_OVERRIDE', 'MANAGER_AUTHORIZED'] as const;
const DENIAL_EVENT_TYPES = ['PERMISSION_DENIED', 'HIGH_RISK_ATTEMPT'] as const;

const SOURCE_ROW_CAP_JSON = 2000;
const SOURCE_ROW_CAP_CSV = 10000;

/** Max |Δt| for pairing a SecurityEvent row with its AuditLog twin. */
const DEDUP_WINDOW_MS = 5_000;

/** Human-readable action labels (mirrored by the UI as a fallback). */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  PERMISSION_DENIED: 'Permission Denied',
  MANAGER_OVERRIDE: 'Manager Override',
  MANAGER_AUTHORIZED: 'Manager Authorized',
  HIGH_RISK_ATTEMPT: 'High-Risk Attempt',
};

/** Unified row shape served to the Audit Trail UI + CSV. */
interface AuditTrailRow {
  id: string;
  source: 'AUDIT_LOG' | 'SECURITY_EVENT';
  timestamp: string;
  userName: string;
  userEmail: string;
  role: string;
  action: string;
  actionLabel: string;
  resource: string;
  result: 'DENIED' | 'SUCCESS';
  branchName: string | null;
  ipAddress: string | null;
  details: string;
}

function safeParse(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

async function getAuditTrailHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const session: AuthSession | null = await getSessionFromRequest(request);
  if (!session) {
    return Response.json({ success: false, error: 'Authentication required.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = (searchParams.get('format') || '').toLowerCase();
  const role = searchParams.get('role') || '';
  const userId = searchParams.get('userId') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const deniedOnly = searchParams.get('deniedOnly') === 'true';
  const search = (searchParams.get('search') || '').trim();
  // v2.12.6: user-scoped search (matches the actor's NAME/EMAIL only) — kept
  // separate from the generic `search` (permission/resource/reason) so the UI's
  // two boxes behave independently.
  const userFilter = (searchParams.get('user') || '').trim();
  const storeIdParam = searchParams.get('storeId') || ''; // SUPER_ADMIN only
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);

  const isSuperAdmin = session.role === 'SUPER_ADMIN';
  const scopeStoreId = isSuperAdmin ? storeIdParam : session.storeId || '';

  const rowCap = format === 'csv' ? SOURCE_ROW_CAP_CSV : SOURCE_ROW_CAP_JSON;

  // ── Shared DB-level filters ─────────────────────────────────────────────────
  const timestampRange: Record<string, Date> = {};
  if (dateFrom) timestampRange.gte = new Date(dateFrom);
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    timestampRange.lte = to;
  }
  const hasRange = Object.keys(timestampRange).length > 0;

  const auditWhere: Record<string, unknown> = {
    action: { in: [...AUDIT_ACTIONS] },
  };
  if (userId) auditWhere.userId = userId;
  if (scopeStoreId) auditWhere.storeId = scopeStoreId;
  if (hasRange) auditWhere.timestamp = timestampRange;

  const seWhere: Record<string, unknown> = {
    eventType: { in: [...DENIAL_EVENT_TYPES] },
  };
  if (userId) seWhere.userId = userId;
  // SecurityEvent is NOT in STORE_SCOPED_MODELS — manual branch scoping
  // (mirrors /api/security/events; a SUPER_ADMIN may pass ?storeId=).
  if (scopeStoreId) seWhere.storeId = scopeStoreId;
  if (hasRange) seWhere.createdAt = timestampRange;

  const [auditRows, seRows] = await Promise.all([
    db.auditLog.findMany({
      where: auditWhere,
      orderBy: { timestamp: 'desc' },
      take: rowCap,
    }),
    db.securityEvent.findMany({
      where: seWhere,
      orderBy: { createdAt: 'desc' },
      take: rowCap,
    }),
  ]);

  // ── Actor + branch lookups (single round-trip per table) ───────────────────
  const userIds = new Set<string>();
  for (const row of auditRows) if (row.userId) userIds.add(row.userId);
  for (const row of seRows) if (row.userId) userIds.add(row.userId);

  const storeIds = new Set<string>();
  for (const row of auditRows) if (row.storeId) storeIds.add(row.storeId);
  for (const row of seRows) if (row.storeId) storeIds.add(row.storeId);

  const [users, stores] = await Promise.all([
    userIds.size > 0
      ? db.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true, role: true },
        })
      : Promise.resolve([] as { id: string; name: string; email: string; role: string }[]),
    storeIds.size > 0
      ? db.store.findMany({ where: { id: { in: [...storeIds] } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const storeMap = new Map(stores.map((s) => [s.id, s.name]));

  // ── Map AuditLog rows → unified shape ───────────────────────────────────────
  // NOTE: the AuditLog table persists entityType/entityId/action/userId/reason/
  // ipAddress — NOT the free-form metadata (that only reaches the SystemLog).
  // Business context is therefore reconstructed from the persisted columns:
  //   • PERMISSION_DENIED → entityId IS the denied permission key
  //   • MANAGER_OVERRIDE / MANAGER_AUTHORIZED → entityId is the approver's User id
  const mappedAudit: AuditTrailRow[] = auditRows.map((row) => {
    const user = row.userId ? userMap.get(row.userId) : undefined;
    const isDenial = row.action === 'PERMISSION_DENIED';

    let resource: string;
    if (isDenial) {
      resource = row.entityId || 'permission';
    } else {
      // MANAGER_OVERRIDE (entityType 'ManagerOverride') and MANAGER_AUTHORIZED
      // (entityType 'User') both point the resourceId at the APPROVER.
      const approver = userMap.get(row.entityId);
      resource = approver
        ? `Manager: ${approver.name || approver.email}`
        : `${row.entityType}/${row.entityId}`;
    }

    return {
      id: row.id,
      source: 'AUDIT_LOG' as const,
      timestamp: row.timestamp.toISOString(),
      userName: user?.name || row.userId || 'System',
      userEmail: user?.email || '',
      role: user?.role || 'UNKNOWN',
      action: row.action,
      actionLabel: AUDIT_ACTION_LABELS[row.action] ?? row.action,
      resource,
      result: isDenial ? ('DENIED' as const) : ('SUCCESS' as const),
      branchName: row.storeId ? storeMap.get(row.storeId) ?? null : null,
      ipAddress: row.ipAddress ?? null,
      details: truncate(row.reason ?? ''),
    };
  });

  // ── Dedup: SecurityEvent rows that already have an AuditLog PERMISSION_DENIED
  // twin are dropped (nearest |Δt| pairing on user + permission). When the twin
  // carries kind HIGH_RISK_ATTEMPT (the AuditLog row itself does not persist the
  // kind), the paired row is upgraded so the trail distinguishes the two. ──────
  const denialAuditByUser = new Map<
    string,
    { row: AuditTrailRow; ts: number; permission: string; taken: boolean }[]
  >();
  for (const row of mappedAudit) {
    if (row.action !== 'PERMISSION_DENIED') continue;
    const userId = auditRows.find((r) => r.id === row.id)?.userId ?? '';
    const list = denialAuditByUser.get(userId) ?? [];
    list.push({
      row,
      ts: new Date(row.timestamp).getTime(),
      permission: row.resource,
      taken: false,
    });
    denialAuditByUser.set(userId, list);
  }

  const mappedSecurity: AuditTrailRow[] = [];
  for (const row of seRows) {
    const details = safeParse(row.details);
    const permission = typeof details.permission === 'string' ? details.permission : '';
    const ts = row.createdAt.getTime();
    const userId = row.userId ?? '';

    const candidates = denialAuditByUser.get(userId) ?? [];
    let best: { row: AuditTrailRow; ts: number; permission: string; taken: boolean } | null = null;
    let bestDelta = Infinity;
    for (const candidate of candidates) {
      if (candidate.taken) continue;
      const delta = Math.abs(candidate.ts - ts);
      if (delta > DEDUP_WINDOW_MS) continue;
      if (permission && candidate.permission && candidate.permission !== permission) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = candidate;
      }
    }
    if (best) {
      best.taken = true; // twin exists — this SecurityEvent adds no new row
      // Carry the SecurityEvent's finer eventType (HIGH_RISK_ATTEMPT) onto the
      // paired AuditLog row — the AuditLog table doesn't persist the kind.
      if (row.eventType === 'HIGH_RISK_ATTEMPT') {
        best.row.action = 'HIGH_RISK_ATTEMPT';
        best.row.actionLabel = AUDIT_ACTION_LABELS.HIGH_RISK_ATTEMPT;
      }
      continue;
    }

    // No twin → surface it (the table must show every denial).
    const user = userId ? userMap.get(userId) : undefined;
    const email = typeof details.email === 'string' ? details.email : '';
    const detailRole = typeof details.role === 'string' ? details.role : '';
    const detailsParts: string[] = [];
    if (permission) detailsParts.push(`permission: ${permission}`);
    if (detailRole) detailsParts.push(`role: ${detailRole}`);

    mappedSecurity.push({
      id: row.id,
      source: 'SECURITY_EVENT',
      timestamp: row.createdAt.toISOString(),
      userName: user?.name || email || row.userId || 'Unknown',
      userEmail: user?.email || email,
      role: user?.role || detailRole || 'UNKNOWN',
      action: row.eventType,
      actionLabel: AUDIT_ACTION_LABELS[row.eventType] ?? row.eventType,
      resource: permission || row.resource || 'permission',
      result: 'DENIED',
      branchName: row.storeId ? storeMap.get(row.storeId) ?? null : null,
      ipAddress: row.ipAddress ?? null,
      details: truncate(detailsParts.join(' — ')),
    });
  }

  // ── In-memory post-filters (role / search / deniedOnly) ────────────────────
  let merged = [...mappedAudit, ...mappedSecurity];

  if (role) merged = merged.filter((row) => row.role === role);
  if (deniedOnly) merged = merged.filter((row) => row.result === 'DENIED');
  if (userFilter) {
    const needle = userFilter.toLowerCase();
    merged = merged.filter((row) =>
      `${row.userName} ${row.userEmail}`.toLowerCase().includes(needle)
    );
  }
  if (search) {
    const needle = search.toLowerCase();
    merged = merged.filter((row) =>
      [row.userName, row.userEmail, row.resource, row.details, row.action]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }

  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // ── CSV export (all matching rows within the export window) ────────────────
  if (format === 'csv') {
    const csv = buildCsv(
      merged.map((row) => ({ ...row })),
      [
        { key: 'timestamp', label: 'Timestamp' },
        { key: 'userName', label: 'User' },
        { key: 'userEmail', label: 'Email' },
        { key: 'role', label: 'Role' },
        { key: 'actionLabel', label: 'Action' },
        { key: 'resource', label: 'Resource' },
        { key: 'result', label: 'Result' },
        { key: 'branchName', label: 'Branch' },
        { key: 'ipAddress', label: 'IP' },
        { key: 'details', label: 'Details' },
      ]
    );
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mbumah-audit-trail-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── Pagination ──────────────────────────────────────────────────────────────
  const total = merged.length;
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const start = (page - 1) * limit;
  const rows = merged.slice(start, start + limit);

  return Response.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, totalPages },
  });
}

export const GET = withErrorBoundary(
  withSessionAuth(getAuditTrailHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'],
  }),
  'ADMIN_AUDIT_TRAIL'
);
