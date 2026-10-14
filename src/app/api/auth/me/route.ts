import { NextResponse, type NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { db } from "@/lib/db";
import { ensureEngravedAdmin } from "@/lib/engraved-admin";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me — return the authenticated session principal.
// Middleware (defense layer 1) already rejected anonymous callers; requireAuth
// re-verifies here (defense layer 2) so the route is safe standalone.
// v2.18.2: enriches the response with the branch workspace hints
// (slug/subdomain/code) + fire-and-forget engraved-admin self-heal.
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

export const GET = route(async (req) => {
  const user = await requireAuth(req);

  // Self-healing engraved admin (fire-and-forget — never blocks the response).
  void ensureEngravedAdmin().catch(() => undefined);

  const branch = await db.branch.findUnique({
    where: { id: user.branchId },
    select: { code: true, slug: true, subdomain: true, name: true },
  });

  return NextResponse.json({
    user,
    store: branch
      ? { code: branch.code, slug: branch.slug, subdomain: branch.subdomain, name: branch.name }
      : null,
    workspaceModeHint: "path",
  });
});
