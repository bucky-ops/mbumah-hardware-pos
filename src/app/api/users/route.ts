/**
 * MBUMAH HARDWARE - Users API
 * GET /api/users - List users for a store
 * POST /api/users - Create a new user
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';

async function getUsersHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId') || '';
  const organizationId = searchParams.get('organizationId') || '';
  const role = searchParams.get('role') || '';
  const isActive = searchParams.get('isActive') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: Record<string, unknown> = {};

  if (storeId) where.storeId = storeId;
  if (organizationId) where.organizationId = organizationId;
  if (role) where.role = role;
  if (isActive !== '') where.isActive = isActive === 'true';

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
    ];
  }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        storeId: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.user.count({ where }),
  ]);

  // Count active sessions
  const activeSessions = await db.session.count({
    where: { expiresAt: { gt: new Date() } },
  });

  return Response.json({
    success: true,
    data: users,
    meta: { activeSessions },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createUserHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { name, email, role, phone, storeId, organizationId, password } = body;

  if (!name || !email || !role || !password) {
    return Response.json(
      { success: false, error: 'Name, email, role, and password are required' },
      { status: 400 }
    );
  }

  // Check if email already exists
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(
      { success: false, error: 'A user with this email already exists' },
      { status: 409 }
    );
  }

  // Hash password (simple hash for demo - use bcrypt in production)
  const passwordHash = `hashed_${password}_${Date.now()}`;

  const user = await db.user.create({
    data: {
      name,
      email,
      role,
      phone: phone || null,
      storeId: storeId || null,
      organizationId: organizationId || 'org_mbumah',
      passwordHash,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      isActive: true,
      createdAt: true,
      storeId: true,
    },
  });

  await systemLog({
    action: 'USER_CREATED',
    component: 'AUTH',
    severity: 'INFO',
    message: `User "${name}" (${email}) created with role ${role}`,
    storeId: storeId || undefined,
    metadata: { userId: user.id, role },
  });

  return Response.json({
    success: true,
    data: user,
  }, { status: 201 });
}

export const GET = withErrorBoundary(getUsersHandler, 'USERS');
export const POST = withErrorBoundary(createUserHandler, 'USERS');
