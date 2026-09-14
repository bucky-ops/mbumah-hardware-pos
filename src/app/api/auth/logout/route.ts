import { NextResponse, type NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-error-handler";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-utils";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout — session termination.
//
// The session cookie is HttpOnly, so logout MUST happen server-side: JS can
// neither read nor delete it. The middleware (layer 1) still requires a valid
// session on this endpoint; clients with an expired cookie can simply drop it
// locally. Clearing uses the SAME attributes as issuance (path/domain/secure/
// sameSite) with maxAge 0 so the browser removes the cookie in every context
// where it was set.
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

export const POST = route(async (req) => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(req), maxAge: 0 });
  return res;
});
