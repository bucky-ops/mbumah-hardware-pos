import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ApiError, withErrorHandler } from "@/lib/api-error-handler";
import {
  clientIp,
  hashPassword,
  rateLimit,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifyPassword,
} from "@/lib/auth-utils";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { Role, SessionUser } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login — credential exchange (public; allowlisted in middleware).
//
// Order of operations is deliberate:
//   1. RATE LIMIT FIRST — brute-force/credential-stuffing is blunted before
//      any DB read or scrypt run happens.
//   2. Validate the payload (zod, safeParse).
//   3. Constant-shape failure path: unknown email and wrong password produce
//      the SAME message and near-identical timing (throwaway scrypt verify) →
//      no account enumeration.
// ─────────────────────────────────────────────────────────────────────────────

// withErrorHandler's Handler<Ctx> declares `(req: Request, …)`; under
// strictFunctionTypes a `(req: NextRequest) => …` handler is not assignable to
// it. App Router always passes a NextRequest to route handlers, so downcast
// once at this boundary (the foundation file is read-only per task rules).
function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

const loginSchema = z.object({
  email: z.email().max(160),
  password: z.string().min(8).max(128),
});

// Precomputed scrypt hash used to equalize timing when the email is unknown.
// Without it, "unknown email" (no scrypt run) is measurably faster than "wrong
// password" (scrypt run) — a timing oracle for account enumeration.
const DUMMY_HASH = hashPassword("mbumah-timing-equalizer-not-a-real-password");

export const POST = route(async (req) => {
  // 1) Rate limit FIRST — 5 attempts / 15 min per client IP.
  const rl = rateLimit(`login:${clientIp(req)}`, { limit: 5, windowMs: 15 * 60_000 });
  if (!rl.allowed) {
    throw ApiError.tooMany("Too many login attempts. Try again later.", rl.retryAfterSeconds);
  }

  // 2) Payload validation (zod v4: safeParse + err.issues → 400 via mapper).
  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw parsed.error;
  const { email, password } = parsed.data;

  // 3) Lookup + scrypt verify (constant-time comparison inside).
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { branch: true },
  });

  let valid = false;
  if (user) {
    valid = user.isActive && verifyPassword(password, user.passwordHash);
  } else {
    // Unknown email → burn the same scrypt cost so both failure modes take
    // the same wall-clock time.
    verifyPassword(password, DUMMY_HASH);
  }

  if (!valid || !user) {
    await audit({
      userId: user?.id ?? null,
      action: "LOGIN_FAILED",
      entity: "User",
      entityId: user?.id ?? null,
      meta: { email: email.toLowerCase() },
      ip: clientIp(req),
    });
    // Identical message for unknown email vs wrong password — no enumeration.
    throw ApiError.unauthorized("Invalid email or password");
  }

  // 4) Success — audit, sign the HttpOnly session cookie, return the principal.
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    branchId: user.branchId,
    branchName: user.branch?.name,
  };

  await audit({
    userId: user.id,
    action: "LOGIN_SUCCESS",
    entity: "User",
    entityId: user.id,
    meta: { role: sessionUser.role, branch: user.branch?.name ?? user.branchId },
    ip: clientIp(req),
  });

  const token = await signSession(sessionUser);
  const res = NextResponse.json({ user: sessionUser });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  return res;
});
