// GET /api/me/store-context (v2.16.0 subdomain workspaces)
//
// Bootstrap endpoint for every workspace origin (root domain, path workspace,
// branch subdomain). Resolves the current workspace from the Host header or
// an explicit ?slug= and returns whether the authenticated user may use it.
// Denied attempts are audit-logged by resolveStoreContext.

import { type NextRequest } from 'next/server';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { buildStoreContextPayload } from '@/lib/workspace/server';

export const dynamic = 'force-dynamic';

async function storeContextHandler(request: NextRequest, session: AuthSession): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');

  const payload = await buildStoreContextPayload({
    host: request.headers.get('host'),
    slug,
    session,
  });

  return Response.json({ success: true, data: payload });
}

// Any authenticated role may ask for its own workspace context; the answer is
// role- and membership-aware (unauthorized workspaces come back as
// { allowed: false } rather than a 403 so the UI can render the calm
// "no access" state).
export const GET = withErrorBoundary(requireAuth(storeContextHandler), 'STORE_CONTEXT');
