// POST /api/auth/logout

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { buildSessionClearCookie } from '@/lib/workspace/session-cookie';

export const dynamic = 'force-dynamic';

async function logoutHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const authHeader = request.headers.get('authorization');
  // v2.16.0: cookie-only sessions (branch subdomain adoption) can log out too.
  const token = authHeader?.replace('Bearer ', '') || request.cookies.get('mbt_token')?.value || null;

  if (!token) {
    return Response.json(
      { success: false, error: 'No active session.' },
      { status: 400 }
    );
  }

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (session) {
    await db.session.delete({ where: { id: session.id } });

    await systemLog({
      action: 'LOGOUT',
      component: LogComponent.AUTH,
      severity: LogSeverity.INFO,
      message: `User ${session.user.name} logged out`,
      userId: session.userId,
      storeId: session.user.storeId || undefined,
    });
  }

  return Response.json({
    success: true,
    message: 'Logged out successfully.',
  }, {
    // v2.16.0: also clear the shared workspace session cookie so logout
    // ends the session on every subdomain that adopted it.
    headers: { 'Set-Cookie': buildSessionClearCookie() },
  });
}

export const POST = withErrorBoundary(logoutHandler, 'AUTH_LOGOUT');
