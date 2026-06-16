// POST /api/auth/login

import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { isRateLimited } from '@/lib/rate-limit';
import { loginSchema, validateInput } from '@/lib/validations';
import { checkBruteForce, recordFailedAttempt, recordSuccessfulLogin } from '@/lib/brute-force';
import { sanitizeInput, getClientIp } from '@/lib/security';

// Verify password — only bcrypt is supported; legacy plaintext is rejected
async function verifyPassword(password: string, storedHash: string): Promise<{ valid: boolean; requiresReset: boolean }> {
  // If the stored hash is a proper bcrypt hash, verify it
  try {
    if (storedHash.startsWith('$2')) {
      const valid = await bcrypt.compare(password, storedHash);
      return { valid, requiresReset: false };
    }
  } catch { /* ignore bcrypt errors */ }

  // Legacy "hashed_" format: do NOT compare in plaintext — force password reset
  if (storedHash.startsWith('hashed_')) {
    return { valid: false, requiresReset: true };
  }

  return { valid: false, requiresReset: false };
}

// Generate a cryptographically secure token using only crypto.getRandomValues
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loginHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
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
      { success: false, error: 'Invalid email or password.' },
      {
        status: 401,
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
  const user = await db.user.findUnique({
    where: { email },
    include: {
      organization: true,
      store: true,
    },
  });

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
      { success: false, error: 'Invalid email or password.' },
      {
        status: 401,
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
  const passwordResult = await verifyPassword(password, user.passwordHash);
  if (passwordResult.requiresReset) {
    // Flag the user for forced password reset on next login
    try {
      await db.user.update({
        where: { id: user.id },
        data: { requiresPasswordReset: true },
      });
    } catch { /* ignore if field doesn't exist yet */ }
  }
  if (!passwordResult.valid) {
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
}

export const POST = withErrorBoundary(loginHandler, 'AUTH_LOGIN');
