/**
 * MBUMAH HARDWARE - Authentication: Logout
 * POST /api/auth/logout - Destroy user session
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function logoutHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

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
  });
}

export const POST = withErrorBoundary(logoutHandler, 'AUTH_LOGOUT');
