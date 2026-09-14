import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Session management — JWT in an HttpOnly, SameSite=Strict cookie.
//
// SECURITY NOTES
//  • The token is NEVER exposed to JavaScript (HttpOnly) → immune to XSS token
//    theft, unlike the previous localStorage approach.
//  • SameSite=Strict mitigates CSRF on state-changing API calls.
//  • `Secure` is set whenever the request arrives over TLS (preview/prod); on
//    plain http (local dev) it is omitted so the cookie can still be set.
//  • The signing secret lives in AUTH_SECRET (never in source control).
//  • Edge-compatible: verification uses `jose`, not `jsonwebtoken`.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = "mbumah_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h shift-length session

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    // Fail loud in production; dev fallback keeps the sandbox usable.
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set (≥32 chars) in production");
    }
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-123456");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("mbumah-pos")
    .setSubject(user.id)
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: "mbumah-pos" });
    if (!payload.id || !payload.role || !payload.branchId) return null;
    return {
      id: String(payload.id),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: payload.role as SessionUser["role"],
      branchId: String(payload.branchId),
      branchName: payload.branchName ? String(payload.branchName) : undefined,
    };
  } catch {
    return null; // invalid / expired signature → anonymous
  }
}

function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  return proto === "https";
}

export function sessionCookieOptions(req: NextRequest) {
  return {
    httpOnly: true as const,
    secure: isSecureRequest(req),
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Read + verify the session from an incoming API request. */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
