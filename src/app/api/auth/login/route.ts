// POST /api/auth/login
//
// Authentication endpoint for the Mbumah Hardware POS system.
//
// ERROR-HANDLING ARCHITECTURE:
//   This route has THREE layers of error handling to ensure that NO failure
//   mode produces an opaque 500 HTML page:
//
//   1. Module-load guard: importing `@/lib/env` is now lazy (non-throwing),
//      so the route module always loads successfully even if env vars are
//      malformed. (Previously, a bad NEXTAUTH_URL crashed module init → 500.)
//
//   2. Inner try/catch (DB query): wraps the first `db.user.findUnique` call
//      so DB-level failures (missing table, connection timeout, wrong
//      provider, exhausted pool) return a CLEAR JSON error with the Prisma
//      error code + a remediation hint — visible in the browser Network tab
//      when EXPOSE_ERRORS=true.
//
//   3. Outer try/catch (withErrorBoundary): wraps the ENTIRE handler so any
//      uncaught error (env validation, bcrypt, session creation, etc.) is
//      caught and returned as a JSON 500 with `error.stack` + `error.message`
//      logged to Vercel function logs via console.error.
//
//   The outer withErrorBoundary also logs the full error to the SystemLog
//   table (best-effort) and includes the full stack trace in the response
//   when EXPOSE_ERRORS=true.

import { type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { env } from '@/lib/env'; // Lazy env validation — fails at call site, not import
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { isRateLimited } from '@/lib/rate-limit';
import { loginSchema, validateInput } from '@/lib/validations';
import { checkBruteForce, recordFailedAttempt, recordSuccessfulLogin } from '@/lib/brute-force';
import { sanitizeInput, getClientIp } from '@/lib/security';

// Force this route to be dynamically rendered at request time.
// This prevents Next.js from attempting to collect page data / statically
// pre-render this route during `next build`, which would trigger the eager
// env validation (and crash the Vercel build when runtime secrets aren't
// injected at build time). Auth routes are inherently request-scoped.
export const dynamic = 'force-dynamic';

// Reference `env` so the import isn't tree-shaken. The env module uses LAZY
// validation (Proxy), so this import NEVER throws — validation runs on first
// `env.X` property access inside the handler, where withErrorBoundary catches it.
void env;

// Verify password with support for both bcrypt hashes and legacy "hashed_" format
async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // First try bcrypt compare (for new passwords)
  try {
    if (storedHash.startsWith('$2')) {
      return await bcrypt.compare(password, storedHash);
    }
  } catch { /* ignore bcrypt errors */ }

  // Fallback: support legacy "hashed_" format for existing users during migration
  if (storedHash.startsWith('hashed_')) {
    const plainPart = storedHash.replace('hashed_', '').replace(/_\d+$/, '');
    if (password === plainPart) return true;
  }

  return false;
}

// Generate a cryptographically secure token using only crypto.getRandomValues
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loginHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const requestStartTime = Date.now();

  // ── OUTER try/catch: catches ALL errors (env validation, DB, bcrypt, etc.) ──
  // The withErrorBoundary wrapper provides this, but we ALSO add an explicit
  // console.error here so the FULL error object (name, message, stack, code)
  // is guaranteed to appear in Vercel function logs — even if the withErrorBoundary's
  // systemLog() call fails (e.g. DB is down).
  try {
    // ── Touch env to trigger lazy validation EARLY ──
    // This ensures any EnvValidationError is thrown HERE (inside the try/catch),
    // not deeper in the handler where it might be harder to diagnose.
    // We access DATABASE_URL because it's the only REQUIRED var.
    // If it's missing/malformed, EnvValidationError is thrown and caught below.
    void env.DATABASE_URL;

    const body = await request.json();

    // 1. Parse and validate input
    const validation = validateInput(loginSchema, body);
    if (!validation.success) {
      return Response.json({ success: false, error: validation.error }, { status: 400 });
    }
    const { email: rawEmail, password } = validation.data;

    // 2. Sanitize email
    const email = sanitizeInput(rawEmail.toLowerCase().trim());

    // 3. Get client IP
    const ip = getClientIp(request);

    // 4. Check brute force lockout
    const bruteForceResult = checkBruteForce(email, ip);
    if (!bruteForceResult.allowed) {
      return Response.json(
        { success: false, error: bruteForceResult.message || 'Account temporarily locked. Please try again later.' },
        {
          status: 423,
          headers: {
            'Retry-After': String(bruteForceResult.retryAfter || 300),
          },
        }
      );
    }

    // 5. Check rate limit (secondary check using tier system)
    const rateLimit = isRateLimited(ip, 'AUTH');
    if (rateLimit.limited) {
      return Response.json(
        { success: false, error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateLimit.resetAt),
          },
        }
      );
    }

    // 6. Look up user in DB
    //
    // Dedicated try/catch around the FIRST database call so that DB-level
    // failures (missing `User` table, connection timeout, wrong provider,
    // exhausted connection pool) produce a CLEAR, DISTINCT error response
    // instead of being caught by the generic withErrorBoundary and masked
    // as "An unexpected error occurred".
    //
    // When EXPOSE_ERRORS=true is set in the environment, the full Prisma error
    // message + code (e.g. P1003 "table does not exist", P1001 "connection
    // lost", P1009 "database does not exist") is included in the response body
    // so you can see EXACTLY what's wrong from the browser Network tab — no
    // need to dig through Vercel logs.
    let user;
    try {
      user = await db.user.findUnique({
        where: { email },
        include: {
          organization: true,
          store: true,
        },
      });
    } catch (dbError) {
      // Log the FULL DB error to Vercel function logs — this is critical for
      // diagnosing production DB issues that don't surface in the HTTP response.
      console.error('[AUTH_LOGIN_DB_ERROR]', {
        name: dbError instanceof Error ? dbError.name : typeof dbError,
        message: dbError instanceof Error ? dbError.message : 'Unknown DB error',
        code: (dbError as { code?: string } | null)?.code,
        stack: dbError instanceof Error ? dbError.stack : undefined,
        email,
        durationMs: Date.now() - requestStartTime,
      });

      const exposeErrors =
        process.env.NODE_ENV === 'development' ||
        process.env.EXPOSE_ERRORS === 'true' ||
        process.env.EXPOSE_ERRORS === '1' ||
        process.env.EXPOSE_ERRORS === 'yes';

      const dbErrName = dbError instanceof Error ? dbError.name : typeof dbError;
      const dbErrMsg = dbError instanceof Error ? dbError.message : 'Unknown DB error';
      const dbErrCode = (dbError as { code?: string } | null)?.code;
      const dbErrStack = dbError instanceof Error ? dbError.stack : undefined;

      return Response.json(
        {
          success: false,
          error: 'Database connection failed. The database may be unreachable or the schema has not been pushed.',
          detail: exposeErrors
            ? {
                name: dbErrName,
                message: dbErrMsg,
                code: dbErrCode,
                stack: dbErrStack,
                hint:
                  'If code is P1003 (table missing): run `npx prisma db push` against the production DATABASE_URL. ' +
                  'If code is P1001 (connection lost): verify DATABASE_URL in Vercel is the Neon POOLED string ' +
                  '(-pooler hostname) with ?pgbouncer=true&connect_timeout=15. ' +
                  'If code is P1009 (db missing): the database name in DATABASE_URL does not exist on the server.',
                component: 'AUTH_LOGIN_DB',
                durationMs: Date.now() - requestStartTime,
              }
            : undefined,
        },
        { status: 500 }
      );
    }

    // Check for DB-level account lockout (lockedUntil field)
    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const retryAfter = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000);
      const minutesLeft = Math.ceil(retryAfter / 60);

      try {
        await systemLog({
          action: 'LOGIN_BLOCKED',
          component: LogComponent.AUTH,
          severity: LogSeverity.WARN,
          message: `Login attempt on locked account: ${email}`,
          userId: user.id,
          metadata: { email, reason: 'ACCOUNT_LOCKED_DB', lockedUntil: user.lockedUntil },
        });
      } catch { /* ignore logging errors */ }

      return Response.json(
        { success: false, error: `Account is locked. Try again in ${minutesLeft} minute(s).` },
        {
          status: 423,
          headers: {
            'Retry-After': String(retryAfter),
          },
        }
      );
    }

    // 7. If user not found: recordFailedAttempt → 401
    if (!user || !user.isActive) {
      const failedResult = await recordFailedAttempt(email, ip);

      try {
        await systemLog({
          action: 'LOGIN_FAILED',
          component: LogComponent.AUTH,
          severity: LogSeverity.WARN,
          message: `Failed login attempt for email: ${email}`,
          metadata: { email, reason: !user ? 'USER_NOT_FOUND' : 'USER_INACTIVE' },
        });
      } catch { /* ignore logging errors */ }

      return Response.json(
        { success: false, error: 'Invalid email or password.', warning: failedResult.message },
        { status: 401 }
      );
    }

    // 8. If password wrong: recordFailedAttempt → 401
    if (!await verifyPassword(password, user.passwordHash)) {
      const failedResult = await recordFailedAttempt(email, ip);

      try {
        await systemLog({
          action: 'LOGIN_FAILED',
          component: LogComponent.AUTH,
          severity: LogSeverity.WARN,
          message: `Failed login attempt for email: ${email}`,
          userId: user.id,
          metadata: { email, reason: 'INVALID_PASSWORD' },
        });
      } catch { /* ignore logging errors */ }

      return Response.json(
        { success: false, error: 'Invalid email or password.', warning: failedResult.message },
        { status: 401 }
      );
    }

    // 9. Login OK: recordSuccessfulLogin
    recordSuccessfulLogin(email, ip);

    // 10. Create session and update lastLoginAt
    const token = generateToken();

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24-hour session

    const session = await db.session.create({
      data: {
        userId: user.id,
        token,
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
        userAgent: request.headers.get('user-agent') || null,
        expiresAt,
      },
    });

    await db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lockedUntil: null,          // Clear any residual lockout on successful login
        failedLoginAttempts: 0,     // Reset failed attempts counter
        lastFailedLoginAt: null,    // Clear last failed attempt timestamp
      },
    });

    try {
      await systemLog({
        action: 'LOGIN_SUCCESS',
        component: LogComponent.AUTH,
        severity: LogSeverity.INFO,
        message: `User ${user.name} logged in successfully`,
        userId: user.id,
        storeId: user.storeId || undefined,
        metadata: { email: user.email, role: user.role },
      });
    } catch { /* ignore logging errors */ }

    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      storeId: user.storeId,
      isActive: user.isActive,
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        taxPin: user.organization.taxPin,
      },
      store: user.store ? {
        id: user.store.id,
        name: user.store.name,
        location: user.store.location,
      } : null,
    };

    return Response.json({
      success: true,
      data: {
        user: authUser,
        token: session.token,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    // ── CATCH-ALL: log the FULL error object to Vercel function logs ──
    //
    // This catches:
    //   • EnvValidationError (from the `void env.DATABASE_URL` touch above)
    //   • JSON parse errors (malformed request body)
    //   • bcrypt errors
    //   • Session creation errors (DB down during db.session.create)
    //   • Any other unexpected error
    //
    // The withErrorBoundary wrapper ALSO catches these, but we log here FIRST
    // with console.error to GUARANTEE the full stack appears in Vercel logs
    // (withErrorBoundary's systemLog() call can fail if the DB is down).
    console.error('[AUTH_LOGIN_FATAL_ERROR]', {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : 'Unknown error',
      code: (error as { code?: string } | null)?.code,
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - requestStartTime,
      timestamp: new Date().toISOString(),
    });

    // Re-throw so withErrorBoundary can format the HTTP response.
    // withErrorBoundary will:
    //   - map the error to a user-friendly message
    //   - include full detail (name/message/code/stack) if EXPOSE_ERRORS=true
    //   - best-effort log to SystemLog table
    throw error;
  }
}

export const POST = withErrorBoundary(loginHandler, 'AUTH_LOGIN');
