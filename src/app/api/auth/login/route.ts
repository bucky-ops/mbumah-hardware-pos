// POST /api/auth/login

import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { isRateLimited } from '@/lib/rate-limit';
import { loginSchema, validateInput } from '@/lib/validations';

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
  const body = await request.json();

  const validation = validateInput(loginSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const { email, password } = validation.data;

  // Rate limit by IP address before any DB queries
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown';
  const rateLimit = isRateLimited(`login:${ip}`, { max: 5, windowMs: 15 * 60 * 1000 });
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

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      organization: true,
      store: true,
    },
  });

  if (!user || !user.isActive) {
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
      { success: false, error: 'Invalid email or password.' },
      { status: 401 }
    );
  }

  if (!await verifyPassword(password, user.passwordHash)) {
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
      { success: false, error: 'Invalid email or password.' },
      { status: 401 }
    );
  }

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
    data: { lastLoginAt: new Date() },
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
}

export const POST = withErrorBoundary(loginHandler, 'AUTH_LOGIN');
