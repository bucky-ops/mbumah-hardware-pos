// GET /api/stores/[storeSlug] (v2.16.0 subdomain workspaces)
//
// Workspace bootstrap for path mode: resolves a store by slug OR subdomain
// and checks the caller's access. Unknown slugs return 404. Access-denied
// callers get a calm 403 that does not leak store data.

import { type NextRequest } from 'next/server';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { resolveStoreContext } from '@/lib/workspace/server';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ storeSlug: string }>;
}

async function getStoreBySlugHandler(request: NextRequest, session: AuthSession, ...args: unknown[]): Promise<Response> {
  const context = args[0] as RouteContext | undefined;
  const routed = context ? (await context.params).storeSlug : undefined;
  const slugParam = decodeURIComponent(routed ?? '').toLowerCase();

  if (!slugParam || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slugParam)) {
    return Response.json({ success: false, error: 'Invalid store slug.' }, { status: 400 });
  }

  const storeContext = await resolveStoreContext({
    host: request.headers.get('host'),
    slug: slugParam,
    session,
  });

  if (storeContext.mode === 'not-found') {
    return Response.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  if (!storeContext.allowed || !storeContext.store) {
    return Response.json(
      { success: false, error: 'You do not have access to this branch.' },
      { status: 403 },
    );
  }

  return Response.json({
    success: true,
    data: { store: storeContext.store, readOnly: storeContext.readOnly ?? false, mode: storeContext.mode },
  });
}

export const GET = withErrorBoundary(requireAuth(getStoreBySlugHandler), 'STORE_BY_SLUG');
