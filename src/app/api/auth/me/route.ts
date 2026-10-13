// GET /api/auth/me

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
// v2.14.0: fire-and-forget self-heal of the engraved bootstrap admin.
import { ensureEngravedAdminExists } from '@/lib/engraved-admin';

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
  // v2.16.0: cookie fallback for branch-subdomain session adoption.
  const token = authHeader?.replace('Bearer ', '') || request.cookies.get('mbt_token')?.value || null;

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

  // v2.14.0: every authenticated app load re-ensures the engraved bootstrap
  // admin (fire-and-forget - it must never block or fail this response).
  void ensureEngravedAdminExists().catch(() => {});

  const user = session.user;

  // v2.16.0 WORKSPACES: multi-store memberships (e.g. WAREHOUSE_MANAGER with
  // two assigned branches) plus the workspace identity of the primary store.
  const memberships = await db.storeMembership.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    select: { storeId: true },
  });
  const membershipStoreIds = Array.from(
    new Set([...memberships.map((m) => m.storeId), user.storeId].filter(Boolean) as string[]),
  );

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
        slug: user.store.slug,
        subdomain: user.store.subdomain,
        brandingColor: user.store.brandingColor,
      } : null,
      memberships: membershipStoreIds,
    },
  });
}

export const GET = withErrorBoundary(getMeHandler, 'AUTH_ME');
