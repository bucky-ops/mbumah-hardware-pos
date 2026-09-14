// ─────────────────────────────────────────────────────────────────────────────
// auth-utils — consolidated authentication utilities.
//
// SESSION STRATEGY (JWT in HttpOnly cookie):
//  • Tokens are HS256 JWTs signed with AUTH_SECRET, carried in a cookie that
//    JavaScript can NEVER read (HttpOnly) → immune to XSS token theft, which
//    is exactly why localStorage token storage was removed.
//  • SameSite=Strict + Secure (on TLS) round out the CSRF/transport story.
//  • Edge-compatible verification (jose) for use inside src/middleware.ts.
//  • Shape is NextAuth-compatible ({ id, email, name, role, branchId }) so a
//    future migration to next-auth Credentials provider is drop-in.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export { rateLimit, clientIp } from "@/lib/auth/rateLimit";
export { SESSION_COOKIE, sessionCookieOptions };

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h shift-length session

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
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

/** Read + verify the session from an incoming API request. */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// ── Password hashing (scrypt — no native deps) ──────────────────────────────

/** Hash a password → "salt:hash" (hex). scrypt is memory-hard → GPU-hostile. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** Constant-time password verification against "salt:hash" format. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
