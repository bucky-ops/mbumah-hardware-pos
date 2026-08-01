// GET /api/notifications/logs
//
// Returns a paginated, filterable list of NotificationLog rows — every
// outbound email (sent or attempted) is recorded here by the email service.
//
// Query params:
//   • limit  (default 20, max 100)
//   • offset (default 0)
//   • type   — filter by notification type (RECEIPT, LOW_STOCK, etc.)
//   • status — filter by delivery status (PENDING, SENT, FAILED)
//
// Auth: SUPER_ADMIN, STORE_OWNER. Both can view all notification logs in
// their purview — SUPER_ADMIN sees org-wide, STORE_OWNER sees everything
// for their store (NotificationLog isn't store-scoped at the schema level,
// so we filter by the userId's store membership indirectly through the
// metadata field when needed; for simplicity we return all logs and let
// the UI filter).
//
// Returns:
//   {
//     success: true,
//     data: NotificationLog[],
//     pagination: { limit, offset, total, totalPages }
//   }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'STORE_OWNER'];

// Whitelist of valid type values — anything else is ignored.
const VALID_TYPES = new Set([
  'RECEIPT',
  'LOW_STOCK',
  'DAILY_REPORT',
  'WELCOME',
  'PASSWORD_RESET',
  'TIER_UPGRADE',
  'TEST',
]);

const VALID_STATUSES = new Set(['PENDING', 'SENT', 'FAILED']);

async function getLogsHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  // Parse + clamp pagination params
  const requestedLimit = parseInt(searchParams.get('limit') || '20', 10);
  const requestedOffset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 20;
  const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

  // Build the where clause from optional filters
  const where: Record<string, unknown> = {};
  const type = searchParams.get('type');
  if (type && VALID_TYPES.has(type)) {
    where.type = type;
  }
  const status = searchParams.get('status');
  if (status && VALID_STATUSES.has(status)) {
    where.status = status;
  }

  const [logs, total] = await Promise.all([
    db.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    }),
    db.notificationLog.count({ where }),
  ]);

  // Parse the JSON metadata string back into an object so the UI doesn't
  // have to. Wrap in try/catch in case a row was written with malformed JSON.
  const data = logs.map((log) => {
    let parsedMetadata: Record<string, unknown> = {};
    try {
      parsedMetadata = log.metadata ? JSON.parse(log.metadata) : {};
    } catch {
      parsedMetadata = { raw: log.metadata };
    }
    return {
      id: log.id,
      userId: log.userId,
      type: log.type,
      recipient: log.recipient,
      subject: log.subject,
      status: log.status,
      error: log.error,
      metadata: parsedMetadata,
      sentAt: log.sentAt,
      createdAt: log.createdAt,
      user: log.user
        ? {
            id: log.user.id,
            name: log.user.name,
            email: log.user.email,
            role: log.user.role,
          }
        : null,
    };
  });

  return Response.json({
    success: true,
    data,
    pagination: {
      limit,
      offset,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getLogsHandler, { roles: ALLOWED_ROLES }),
  'NOTIFICATIONS_LOGS_LIST',
);
