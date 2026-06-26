// GET /api/auth/me

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

// Force this route to be dynamically rendered at request time.
// This prevents Next.js from attempting to collect page data / statically
// pre-render this route during `next build`, which would trigger the eager
// env validation (and crash the Vercel build when runtime secrets aren't
// injected at build time). The /me route reads the Bearer token from the
// request header, so it is inherently request-scoped.
export const dynamic = 'force-dynamic';

async function getMeHandler(...args: unknown[]): Promise<Response> {
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
        include: {
          organization: true,
          store: true,
        },
      },
    },
  });

  if (!session) {
    return Response.json(
      { success: false, error: 'Invalid or expired session.' },
      { status: 401 }
    );
  }

  if (new Date(session.expiresAt) < new Date()) {
    await db.session.delete({ where: { id: session.id } });
    return Response.json(
      { success: false, error: 'Session expired. Please login again.' },
      { status: 401 }
    );
  }

  if (!session.user.isActive) {
    return Response.json(
      { success: false, error: 'User account is deactivated.' },
      { status: 403 }
    );
  }

  const user = session.user;

  return Response.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      storeId: user.storeId,
      isActive: user.isActive,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      lastLoginAt: user.lastLoginAt,
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        taxPin: user.organization.taxPin,
      },
      store: user.store ? {
        id: user.store.id,
        name: user.store.name,
        location: user.store.location,
        phone: user.store.phone,
        email: user.store.email,
      } : null,
    },
  });
}

export const GET = withErrorBoundary(getMeHandler, 'AUTH_ME');
