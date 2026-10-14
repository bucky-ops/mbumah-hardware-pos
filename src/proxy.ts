// ─────────────────────────────────────────────────────────────────────────────
// Edge proxy (Next 16 rename of middleware) — defense layer 1.
//
// Responsibilities, in order:
//   0. Branch-subdomain host-header allowlisting (page requests only)
//   1. Public allowlist pass-through (read-only demo surfaces + hard publics)
//   2. Session verification (401) for everything else
//   3. RBAC prefix policy (403)
//   4. BOLA branch-hint check (403)
//   5. Security headers on every response leaving the proxy
//
// EDGE RUNTIME NOTE: this file imports from @/lib/auth/session (jose-only,
// edge-safe) — deliberately NOT from @/lib/auth-utils, which pulls node:crypto
// in for scrypt password hashing and would crash the edge runtime.
//
// SUBDOMAIN WORKSPACES (STEP 3): hostnames of the form
//   {storeCode}.mbumah.co.ke  (or {storeCode}.localhost in local dev)
// are rewritten to /stores/{storeCode}/dashboard when {storeCode} is an
// allowlisted branch code (juja-main | thika | ruiru | nairobi-cbd | nakuru).
// Reserved labels (www/app/api/admin/static/mail) never match. Authorization
// inside the workspace is re-verified server-side (layer 2) against the DB.
//
// PUBLIC READ SURFACES (v2.18.2 console): GET on the console's aggregate/
// directory endpoints is public (PII-masked at the routes). Every mutation on
// those prefixes still falls through to session verification below, and each
// route re-verifies auth + role (defense layer 2).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { ROLE_ROUTE_POLICY, roleAtLeast } from "@/lib/types";

export const config = {
  matcher: ["/api/:path*", "/((?!api|_next|.*\\..*).*)"],
};

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

// v2.18.2 console demo surfaces: GET is public (masked, read-only). Mutations
// on these prefixes are NOT public — they fall through to session checks and
// the routes re-verify auth themselves.
const PUBLIC_READ_PREFIXES: readonly string[] = [
  "/api/dashboard",
  "/api/stores",
  "/api/chat",
  "/api/notifications",
  "/api/system-logs",
  "/api/system-config",
  "/api/audit-logs",
  "/api/categories",
  "/api/products/bundles",
  "/api/transactions",
  "/api/receipts",
  "/api/gift-cards",
  "/api/rentals",
  "/api/debt",
  "/api/stock-movements",
  "/api/purchase-orders",
  "/api/suppliers",
  "/api/expenses",
  "/api/reports/sales",
  "/api/reports/inventory",
  "/api/reports/export",
];

// Branch subdomain allowlist (kept in sync with Branch.code seeds).
const ALLOWED_STORE_CODES: ReadonlySet<string> = new Set([
  "juja-main", "thika", "ruiru", "nairobi-cbd", "nakuru",
]);
const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set(["www", "app", "api", "admin", "static", "mail"]);

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
  "/api/v1/documents", // Document Workflow Engine: branchId hints on list/convert
];

const BODY_METHODS: ReadonlySet<string> = new Set(["POST", "PATCH", "PUT"]);

/** Attach hardening headers to every response leaving the proxy. */
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

/** STEP 3 — branch-subdomain host-header allowlisting → workspace rewrite. */
function storeSubdomainRewrite(req: NextRequest): NextResponse | null {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (!host) return null;
  const parts = host.split(".");
  if (parts.length < 2) return null;
  const label = parts[0];
  const rest = parts.slice(1).join(".");
  const isOrgHost = rest === "mbumah.co.ke" || rest === "mbumahhardware.co.ke" || (rest === "localhost" && parts.length === 2);
  if (!isOrgHost) return null;
  if (RESERVED_SUBDOMAINS.has(label)) return null;
  if (!ALLOWED_STORE_CODES.has(label)) return null;
  const url = req.nextUrl.clone();
  url.pathname = `/stores/${label}/dashboard`;
  const res = NextResponse.rewrite(url);
  res.headers.set("x-mbumah-workspace", label);
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // ── 0. Branch workspace subdomains (page requests only) ─────────────────
  if (!pathname.startsWith("/api/")) {
    const rewritten = storeSubdomainRewrite(req);
    if (rewritten) return withSecurityHeaders(rewritten);
    return withSecurityHeaders(NextResponse.next());
  }

  // ── 1a. Hard public paths ────────────────────────────────────────────────
  if (PUBLIC_PATHS.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── 1b. Public READ surfaces (console demo; mutations still authed) ─────
  const isPublicRead =
    req.method === "GET" &&
    (PUBLIC_READ_PREFIXES.includes(pathname) ||
      PUBLIC_READ_PREFIXES.some((p) => pathname.startsWith(p + "/")));
  if (isPublicRead) {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── 1c. /api/system/* is public in dev only (engraved-admin tooling) ────
  if (pathname.startsWith("/api/system/") && process.env.NODE_ENV !== "production") {
    return withSecurityHeaders(NextResponse.next());
  }

  // ── 1d. Global chat POST is demo-open in dev (route rate-limits + tags
  //     guest authors); production requires a session. ─────────────────────
  if (pathname === "/api/chat" && req.method === "POST" && process.env.NODE_ENV !== "production") {
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

    // Org-level roles (SUPER_ADMIN/STORE_OWNER/OWNER) operate multi-branch;
    // everyone else is fenced to their own branch. NOTE: layer 2 — route-level
    // assertBranchAccess against the PERSISTED row's branchId — remains the
    // authoritative BOLA check.
    if (!roleAtLeast(user.role, "OWNER") && targetBranchId && targetBranchId !== user.branchId) {
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
