// GET /api/cron/session-reaper - delete auth sessions whose expiresAt has
// passed (v2.163.0).
//
// WHY: the Session table grew without bound on rows nobody would ever
// present again. The idle contract (v2.162.0) deletes a session only when
// someone PRESENTS it after going idle; a session that is simply abandoned
// (employee left the company, browser discarded, tab never re-opened)
// stayed until this reaper existed. One deleteMany on the indexed
// `expiresAt` column, run from the hourly dispatcher - the same fold
// pattern as etims-retry / debt-reminders / b2c-recovery (Vercel Hobby's
// two-cron limit keeps every scheduled job out of vercel.json).
//
// SCOPE (deliberate): this reaper touches ONLY `expiresAt < now`. Idle
// expiry (lastActiveAt) stays the portal guard's own enforcement path -
// the two contracts share the table, never each other's semantics.
//
// AUTH: copied EXACTLY from /api/cron/etims-retry - Vercel Cron sends
// unauthenticated GETs; we gate on the `x-cron-secret` header against the
// CRON_SECRET env var (fail-open with a WARN systemLog when CRON_SECRET is
// unset so the gap is visible and alertable - deploy with CRON_SECRET set).

import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogComponent, LogSeverity } from '@/lib/types';
import { db, runWithoutTenant } from '@/lib/db';
import {
  SESSION_REAPER_LOG_ACTION,
  sessionReaperSummary,
} from '@/lib/session-reaper';

export const dynamic = 'force-dynamic';
// One deleteMany on an indexed column - the run fits in a fraction of the
// 60s serverless budget even on a cold lambda.
export const maxDuration = 60;

// Shared cron secret gate (verbatim /api/cron/etims-retry pattern).
async function verifyCronSecret(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');

  if (!secret) {
    await systemLog({
      action: 'CRON_SECRET_UNSET',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        'CRON_SECRET env var is not set - /api/cron/session-reaper accepted an unauthenticated request.',
      metadata: { path: '/api/cron/session-reaper' },
    });
    return null;
  }

  if (provided !== secret) {
    return Response.json(
      { success: false, error: 'Forbidden: invalid or missing x-cron-secret header.' },
      { status: 403 },
    );
  }

  return null;
}

async function sessionReaperCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  // Session is a global (tenant-exempt) table - the delete is a genuinely
  // cross-tenant sweep, wrapped in runWithoutTenant like login and session
  // lookup per src/lib/db.ts's own usage note.
  const result = await runWithoutTenant(() =>
    db.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }),
  );
  const summary = sessionReaperSummary(result.count);

  // One INFO row per sweep - the same visibility posture the dispatcher's
  // tick ledger uses (a healthy sweep must still leave a trace).
  await systemLog({
    action: SESSION_REAPER_LOG_ACTION,
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: summary.message,
    metadata: { deleted: result.count, path: '/api/cron/session-reaper' },
  }).catch(() => {});

  return Response.json({ success: true, deleted: result.count, message: summary.message });
}

export const GET = withErrorBoundary(sessionReaperCronHandler, LogComponent.SYSTEM);
