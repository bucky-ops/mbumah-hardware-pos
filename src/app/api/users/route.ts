// GET/POST /api/users

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

// RBAC: defines which roles each creator role is allowed to create
const ROLE_CREATION_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  STORE_OWNER: ['STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  BRANCH_MANAGER: ['CASHIER', 'ACCOUNTANT'],
  // CASHIER and ACCOUNTANT cannot create users at all
};

async function createUserHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;

  // ── 1. Authenticate the requesting user ──────────────────────────
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }

  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) {
    return Response.json(
      { success: false, error: 'Invalid or expired session.' },
      { status: 401 }
    );
  }

  if (new Date(session.expiresAt) < new Date()) {
    await db.session.delete({ where: { id: session.id } });
    return Response.json(
      { success: false, error: 'Session expired. Please login again.' },
      { status: 401 }
    );
  }

  if (!session.user.isActive) {
    return Response.json(
      { success: false, error: 'User account is deactivated.' },
      { status: 403 }
    );
  }

  const requestingUser = session.user;

  // ── 2. Authorise: only admin roles may create users ──────────────
  const adminRoles = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

  if (!adminRoles.includes(requestingUser.role)) {
    await systemLog({
      action: 'USER_CREATE_DENIED',
      component: 'AUTH',
      severity: 'WARN',
      message: `User "${requestingUser.name}" (${requestingUser.email}) with role ${requestingUser.role} attempted to create a user — denied`,
      userId: requestingUser.id,
      storeId: requestingUser.storeId || undefined,
      metadata: { requestingRole: requestingUser.role },
    });

    return Response.json(
      { success: false, error: 'Only administrators and branch managers can create new users' },
      { status: 403 }
    );
  }

  // ── 3. Parse & validate request body ─────────────────────────────
  const body = await request.json();
  const { name, email, role, phone, storeId, organizationId, password } = body;

  if (!name || !email || !role || !password) {
    return Response.json(
      { success: false, error: 'Name, email, role, and password are required' },
      { status: 400 }
    );
  }

  // ── 4. RBAC: check if requesting role is allowed to create target role ─
  const allowedRoles = ROLE_CREATION_PERMISSIONS[requestingUser.role] || [];

  if (!allowedRoles.includes(role)) {
    await systemLog({
      action: 'USER_CREATE_DENIED',
      component: 'AUTH',
      severity: 'WARN',
      message: `User "${requestingUser.name}" (${requestingUser.role}) attempted to create user with role ${role} — role not allowed`,
      userId: requestingUser.id,
      storeId: requestingUser.storeId || undefined,
      metadata: { requestingRole: requestingUser.role, targetRole: role },
    });

    return Response.json(
      {
        success: false,
        error: `Your role (${requestingUser.role}) is not authorized to create users with role ${role}`,
      },
      { status: 403 }
    );
  }

  // ── 5. Check for duplicate email ─────────────────────────────────
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(
      { success: false, error: 'A user with this email already exists' },
      { status: 409 }
    );
  }

  // ── 6. Create the user ───────────────────────────────────────────
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
    message: `User "${name}" (${email}) created with role ${role} by "${requestingUser.name}" (${requestingUser.role})`,
    userId: requestingUser.id,
    storeId: storeId || requestingUser.storeId || undefined,
    metadata: { createdUserId: user.id, createdRole: role, createdByRole: requestingUser.role },
  });

  return Response.json({
    success: true,
    data: user,
  }, { status: 201 });
}

export const GET = withErrorBoundary(getUsersHandler, 'USERS');
export const POST = withErrorBoundary(createUserHandler, 'USERS');
