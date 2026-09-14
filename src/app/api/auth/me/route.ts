import { NextResponse, type NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me — return the authenticated session principal.
// Middleware (defense layer 1) already rejected anonymous callers; requireAuth
// re-verifies here (defense layer 2) so the route is safe standalone.
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

export const GET = route(async (req) => {
  const user = await requireAuth(req);
  return NextResponse.json({ user });
});
