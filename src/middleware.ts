// ─────────────────────────────────────────────────────────────────────────────
// Edge middleware — defense layer 1 for every /api/* request.
//
// Responsibilities, in order:
//   1. Public allowlist pass-through
//   2. Session verification (401)
//   3. RBAC prefix policy (403)
//   4. BOLA branch-hint check (403)
//   5. Security headers on every response leaving the middleware
//
// EDGE RUNTIME NOTE: this file imports from @/lib/auth/session (jose-only,
// edge-safe) — deliberately NOT from @/lib/auth-utils, which pulls node:crypto
// in for scrypt password hashing and would crash the edge runtime.
//
// DEFENSE IN DEPTH: everything here is a cheap, coarse pre-filter. The
// AUTHORITATIVE checks are per-route (requireAuth/requireRole +
// assertBranchAccess/assertTargetBranch against persisted rows — layer 2),
// because middleware can only see URL/body hints, never database state.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { ROLE_ROUTE_POLICY, roleAtLeast } from "@/lib/types";

export const config = { matcher: ["/api/:path*"] };

// Endpoints that must be reachable without a session cookie:
//  • /api/health                      — liveness probes / uptime monitors.
//  • /api/auth/login                  — the credential exchange itself (rate
//                                       limited inside the route).
//  • /api/v1/payments/mpesa/callback  — Safaricom Daraja server-to-server push;
//                                       the caller cannot carry our cookie, and
//                                       the route verifies authenticity itself.
//  • /api/v1/cron/process-penalties   — scheduler entrypoint; it performs its
//                                       own x-cron-secret header check (route
//                                       layer) before doing any work.
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/v1/payments/mpesa/callback",
  "/api/v1/cron/process-penalties",
]);

// BOLA layer 1: prefixes whose requests may carry a branchId hint (query or
// JSON body). A non-OWNER session targeting a different branch than its own is
// rejected here, before any database work is paid for. Layer 2 (route-level
// assertBranchAccess against the persisted row) remains authoritative.
const BOLA_PREFIXES: readonly string[] = [
  "/api/products",
  "/api/transactions",
  "/api/customers",
  "/api/debts",
  "/api/reports",
  "/api/inventory",
  "/api/v1/sales",
  "/api/v1/credit",
  "/api/v1/reports",
];

const BODY_METHODS: ReadonlySet<string> = new Set(["POST", "PATCH", "PUT"]);

/** Attach hardening headers to every response leaving the middleware. */
function withSecurityHeaders(res: NextResponse): NextResponse {
  // nosniff → browsers must honor the declared Content-Type; blocks the
  // classic "user content re-interpreted as JS/HTML" MIME-sniffing attack.
  res.headers.set("X-Content-Type-Options", "nosniff");
  // DENY → API surfaces can never be framed; kills clickjacking against any
  // HTML error/debug page served from this origin.
  res.headers.set("X-Frame-Options", "DENY");
  // Don't leak full URLs — which may embed ?branchId=… or customer search
  // terms — to cross-origin destinations via the Referer header.
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // POS frontends use the camera for barcode scanning (same-origin only);
  // everything else (microphone, geolocation, …) is denied by omission.
  res.headers.set("Permissions-Policy", "camera=(self), microphone=()");
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // ── 1. Public allowlist ─────────────────────────────────────────────────
  if (PUBLIC_PATHS.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── 2. Session verification ─────────────────────────────────────────────
  // HS256 JWT from the HttpOnly cookie; missing/expired/invalid → anonymous.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifySessionToken(token) : null;
  if (!user) {
    return withSecurityHeaders(
      NextResponse.json({ error: "Authentication required" }, { status: 401 })
    );
  }

  // ── 3. RBAC layer 1 (prefix policy) ─────────────────────────────────────
  // e.g. cashiers are blocked from /api/users, /api/branches, /api/reports
  // and /api/audit before those routes ever touch the database.
  for (const rule of ROLE_ROUTE_POLICY) {
    if (pathname.startsWith(rule.prefix) && !roleAtLeast(user.role, rule.minRole)) {
      return withSecurityHeaders(
        NextResponse.json(
          { error: `Forbidden: requires ${rule.minRole} role` },
          { status: 403 }
        )
      );
    }
  }

  // ── 4. BOLA layer 1 (branch hint) ───────────────────────────────────────
  if (BOLA_PREFIXES.some((p) => pathname.startsWith(p))) {
    let targetBranchId = req.nextUrl.searchParams.get("branchId");

    // POST/PATCH/PUT may carry the branch inside a JSON body. Read a CLONE so
    // the original request (and its body stream) stays fully consumable by
    // the downstream route handler. Non-JSON bodies pass through untouched.
    if (!targetBranchId && BODY_METHODS.has(req.method.toUpperCase())) {
      try {
        const body: unknown = await req.clone().json();
        if (
          typeof body === "object" &&
          body !== null &&
          typeof (body as { branchId?: unknown }).branchId === "string"
        ) {
          targetBranchId = (body as { branchId: string }).branchId;
        }
      } catch {
        // Empty/non-JSON body → no branch hint; fall through to layer 2.
      }
    }

    // OWNERs operate multi-branch; everyone else is fenced to their own
    // branch. NOTE: layer 2 — route-level assertBranchAccess/assertTargetBranch
    // against the PERSISTED row's branchId — is the authoritative BOLA check;
    // middleware can only inspect client-supplied hints, not database state.
    if (user.role !== "OWNER" && targetBranchId && targetBranchId !== user.branchId) {
      return withSecurityHeaders(
        NextResponse.json(
          { error: "Branch mismatch (BOLA protection)" },
          { status: 403 }
        )
      );
    }
  }

  // ── 5. Authenticated pass-through (hardening headers attached) ──────────
  return withSecurityHeaders(NextResponse.next());
}
