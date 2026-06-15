// GET /api/auth/verify — Validate a Bearer token and return the session data.
// Used by the middleware and other services that need to verify tokens
// without duplicating the DB lookup logic.

import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';

async function verifyHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const session = await getSessionFromRequest(request);

  if (!session) {
    return Response.json(
      { success: false, error: 'Invalid or expired session.' },
      { status: 401 }
    );
  }

  return Response.json({
    success: true,
    data: session,
  });
}

export const GET = withErrorBoundary(verifyHandler, 'AUTH_VERIFY');
