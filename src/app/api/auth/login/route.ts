/**
 * MBUMAH HARDWARE - Authentication: Login
 * POST /api/auth/login - Authenticate user and create session
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

function verifyPassword(password: string, storedHash: string): boolean {
  // Support legacy seeded hashes (plain text like 'hashed_password123_2024')
  if (password === storedHash.replace('hashed_', '').replace('_2024', '')) {
    return true;
  }
  // Support legacy format directly
  if (storedHash.startsWith('hashed_')) {
    const plainPart = storedHash.replace('hashed_', '').replace('_2024', '');
    if (password === plainPart) return true;
    // Also check direct equality for seed data
    if (storedHash === `hashed_${password}_2024`) return true;
  }
  // For production, you would use bcrypt here
  return false;
}

function generateToken(): string {
  // Generate a random token without Node.js crypto module
  const array = new Uint8Array(32);
  // Use crypto.getRandomValues if available (Web Crypto API)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback: Math.random based
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loginHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return Response.json(
      { success: false, error: 'Email and password are required.' },
      { status: 400 }
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

  if (!verifyPassword(password, user.passwordHash)) {
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

  // Generate session token
  const token = generateToken() + Date.now().toString(36);

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24-hour session

  // Create session
  const session = await db.session.create({
    data: {
      userId: user.id,
      token,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
      userAgent: request.headers.get('user-agent') || null,
      expiresAt,
    },
  });

  // Update last login timestamp
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
