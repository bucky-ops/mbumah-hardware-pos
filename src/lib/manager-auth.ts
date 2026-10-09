// MBUMAH HARDWARE POS - Shared Manager Step-up Authorization (v2.12.2, PR B)
//
// ONE credential check shared by BOTH step-up surfaces:
//
//   • POST /api/auth/manager-authorize  (phase-2 Manager PIN modal pre-check)
//   • POST /api/transactions             (managerOverride credential object on
//     the 5-10% discount band + high-risk debt gate)
//
// previously the transactions route had a private verifyManagerPassword and
// the manager-authorization flow didn't exist; extracting it here means the
// bcrypt compare, the role gate, and the brute-force posture can never drift
// between the two callers.
//
// Verifies, in order:
//   1. BRUTE-FORCE WINDOW - 3 failed attempts for the same email+IP within
//      5 minutes → reject with code 'BRUTE_FORCE_PIN' (+ SecurityEvent
//      BRUTE_FORCE row once per trip) until the window ages out.
//   2. USER EXISTS + isActive (unknown email vs wrong password are ONE
//      generic 'INVALID_CREDENTIALS' failure - never reveal which check
//      failed; mirrors the login route and the credit-limit override).
//   3. PASSWORD - bcrypt compare with the legacy "hashed_" fallback, byte-for-
//      byte the same algorithm as src/app/api/auth/login/route.ts's
//      verifyPassword (the transactions route previously duplicated it).
//   4. ROLE - the approver must be MANAGER-or-above (MANAGER_PLUS_ROLES =
//      SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER).
//
// On success: SecurityEvent INFO 'MANAGER_AUTHORIZED' is written by the
// CALLER-facing helper `authorizeManager` (per-authorization record); AuditLog
// entries (MANAGER_OVERRIDE / MANAGER_AUTHORIZED) are written by the routes so
// they can attach business context (receipt, discount %, reason).
//
// SERVERLESS NOTE: the failure window is in-memory per instance (same
// best-effort posture as src/lib/brute-force.ts and the abuse lockout in
// src/lib/auth.ts). The SecurityEvent feed remains the durable record.

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { MANAGER_PLUS_ROLES } from '@/lib/auth';

// Brute-force window (per email+ip)

const FAILURE_WINDOW_MS = 5 * 60 * 1000;  // trailing 5 minutes
const MAX_FAILURES = 3;                    // 3 failures in the window → block

interface FailureStamp {
  count: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
  bruteForceLoggedAt: number; // avoid SecurityEvent spam per window
}

const authorizeFailures = new Map<string, FailureStamp>();

// Sweep so warm instances don't accumulate stale entries.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authorizeFailures) {
    if (now - entry.lastAttemptAt > FAILURE_WINDOW_MS) authorizeFailures.delete(key);
  }
}, FAILURE_WINDOW_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

function failureKey(email: string, ip: string): string {
  return `mgr-auth:${email.trim().toLowerCase()}|${ip}`;
}

// Password verification (identical to the login route)

/**
 * bcrypt compare + the legacy "hashed_" fallback. Kept byte-for-byte
 * equivalent to verifyPassword() in src/app/api/auth/login/route.ts so a
 * manager's stored hash verifies identically on both surfaces.
 */
export async function verifyManagerPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    if (storedHash.startsWith('$2')) {
      return await bcrypt.compare(password, storedHash);
    }
  } catch {
    /* ignore bcrypt errors - falls through to legacy check */
  }
  if (storedHash.startsWith('hashed_')) {
    const plainPart = storedHash.replace('hashed_', '').replace(/_\d+$/, '');
    if (password === plainPart) return true;
  }
  return false;
}

// Public API

export interface AuthorizeManagerInput {
  approverEmail: string;
  approverPassword: string;
}

export interface AuthorizeManagerContext {
  /** Client IP (x-forwarded-for first hop) for the brute-force key + records. */
  ip?: string;
  userAgent?: string;
  /** Optional store scoping - when set, the approver must belong to it. */
  storeId?: string;
  /** Actor whose session is requesting the step-up (for the audit trail). */
  requesterId?: string;
}

export type ManagerAuthResult =
  | {
      ok: true;
      manager: { id: string; name: string; role: string; email: string };
    }
  | {
      ok: false;
      code: 'BRUTE_FORCE_PIN' | 'INVALID_CREDENTIALS' | 'INSUFFICIENT_ROLE';
      /** Friendly message safe to surface in the Manager PIN modal. */
      message: string;
      /** Minutes until the brute-force window clears (BRUTE_FORCE_PIN only). */
      retryAfterMinutes?: number;
    };

/**
 * Verify a manager's credentials for a step-up authorization.
 * Never throws - every failure mode maps to a typed result.
 */
export async function authorizeManager(
  input: AuthorizeManagerInput,
  ctx: AuthorizeManagerContext = {}
): Promise<ManagerAuthResult> {
  const email = input.approverEmail.trim().toLowerCase();
  const ip = ctx.ip ?? 'unknown';
  const key = failureKey(email, ip);
  const now = Date.now();

  // 1. Brute-force window
  const entry = authorizeFailures.get(key);
  if (entry && now - entry.lastAttemptAt <= FAILURE_WINDOW_MS && entry.count >= MAX_FAILURES) {
    const retryAfterMinutes = Math.max(
      1,
      Math.ceil((entry.lastAttemptAt + FAILURE_WINDOW_MS - now) / 60000)
    );
    return {
      ok: false,
      code: 'BRUTE_FORCE_PIN',
      message: `Too many failed authorization attempts. Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? '' : 's'}.`,
      retryAfterMinutes,
    };
  }

  // 2. User lookup
  const manager = await db.user.findUnique({ where: { email } });

  const passwordOk = manager
    ? await verifyManagerPassword(input.approverPassword, manager.passwordHash)
    : false;

  if (!manager || !manager.isActive || !passwordOk) {
    await noteFailure(key, email, ip, ctx);
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Manager authorization failed: invalid credentials or inactive account.',
    };
  }

  // 3. Role gate (manager-or-above)
  if (!MANAGER_PLUS_ROLES.includes(manager.role)) {
    await noteFailure(key, email, ip, ctx);
    await systemLog({
      action: 'MANAGER_AUTHORIZE_DENIED',
      component: LogComponent.AUTH,
      severity: LogSeverity.WARN,
      message: `Manager step-up rejected: ${email} is role ${manager.role}, not manager-level.`,
      userId: ctx.requesterId,
      storeId: ctx.storeId,
      metadata: { approverEmail: email, approverRole: manager.role },
    }).catch(() => {});
    return {
      ok: false,
      code: 'INSUFFICIENT_ROLE',
      message: 'Manager authorization failed: this account is not a Branch Manager or above.',
    };
  }

  // Optional store scoping (used by the transactions path, which is
  // store-bound; the standalone endpoint passes no storeId).
  if (ctx.storeId && manager.storeId !== ctx.storeId) {
    await noteFailure(key, email, ip, ctx);
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Manager authorization failed: invalid credentials or insufficient role.',
    };
  }

  // Success: reset the failure window
  authorizeFailures.delete(key);

  // SecurityEvent INFO - one durable row per successful authorization.
  try {
    await db.securityEvent.create({
      data: {
        eventType: 'MANAGER_AUTHORIZED',
        severity: 'INFO',
        userId: manager.id,
        storeId: manager.storeId || ctx.storeId || undefined,
        action: 'MANAGER_AUTHORIZED',
        details: JSON.stringify({
          approverEmail: manager.email,
          approverRole: manager.role,
          requesterId: ctx.requesterId,
        }),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
        blocked: false,
      },
    });
  } catch {
    /* logging must never block an authorization */
  }

  return {
    ok: true,
    manager: {
      id: manager.id,
      name: manager.name,
      role: manager.role,
      email: manager.email,
    },
  };
}

/** Record one failed authorization attempt; trip the BRUTE_FORCE SecurityEvent once per window. */
async function noteFailure(
  key: string,
  email: string,
  ip: string,
  ctx: AuthorizeManagerContext
): Promise<void> {
  const now = Date.now();
  const entry = authorizeFailures.get(key);

  if (!entry || now - entry.lastAttemptAt > FAILURE_WINDOW_MS) {
    authorizeFailures.set(key, {
      count: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
      bruteForceLoggedAt: 0,
    });
    return;
  }

  entry.count += 1;
  entry.lastAttemptAt = now;

  if (entry.count >= MAX_FAILURES && now - entry.bruteForceLoggedAt > FAILURE_WINDOW_MS) {
    entry.bruteForceLoggedAt = now;
    try {
      await db.securityEvent.create({
        data: {
          eventType: 'BRUTE_FORCE',
          severity: 'WARN',
          userId: ctx.requesterId,
          storeId: ctx.storeId || undefined,
          action: 'MANAGER_AUTHORIZE_BRUTE_FORCE',
          details: JSON.stringify({
            approverEmail: email,
            failedCount: entry.count,
            windowMinutes: FAILURE_WINDOW_MS / 60000,
            surface: 'manager-authorize',
          }),
          userAgent: ctx.userAgent,
          ipAddress: ip,
          blocked: true,
        },
      });
    } catch {
      /* logging must never block the failure path */
    }
    await systemLog({
      action: 'BRUTE_FORCE',
      component: LogComponent.AUTH,
      severity: LogSeverity.WARN,
      message: `${entry.count} failed manager-authorization attempts for ${email} within ${FAILURE_WINDOW_MS / 60000} minutes from IP ${ip}.`,
      userId: ctx.requesterId,
      storeId: ctx.storeId,
      metadata: { approverEmail: email, failedCount: entry.count },
    }).catch(() => {});
  }
}

/** Extract the client IP the same way the auth layer does (first x-forwarded-for hop). */
export function clientIpFromHeaders(headers: Headers): string | undefined {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}
