// GET /api/auth/verify — Validate a Bearer token and return the session data.
// Used by the middleware and other services that need to verify tokens
// without duplicating the DB lookup logic.

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function verifyHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }

  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          storeId: true,
          organizationId: true,
          isActive: true,
        },
      },
    },
  });

  if (!session || !session.user || !session.user.isActive) {
    return Response.json(
      { success: false, error: 'Invalid or expired session.' },
      { status: 401 }
    );
  }

  // Check absolute expiry
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return Response.json(
      { success: false, error: 'Session expired. Please login again.' },
      { status: 401 }
    );
  }

  // M-09: Check idle timeout — if lastActiveAt is more than 30 minutes ago, invalidate
  const now = new Date();
  if (session.lastActiveAt && (now.getTime() - new Date(session.lastActiveAt).getTime()) > IDLE_TIMEOUT_MS) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return Response.json(
      { success: false, error: 'Session timed out due to inactivity. Please login again.' },
      { status: 401 }
    );
  }

  // M-09: Update session activity timestamp
  await db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: now },
  }).catch(() => {});

  return Response.json({
    success: true,
    data: {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
      storeId: session.user.storeId,
      organizationId: session.user.organizationId,
    },
  });
}

export const GET = withErrorBoundary(verifyHandler, 'AUTH_VERIFY');
