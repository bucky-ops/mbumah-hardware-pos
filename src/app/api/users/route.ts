// GET/POST /api/users
// Requires SUPER_ADMIN or STORE_OWNER role

import { type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { createUserSchema, validateInput } from '@/lib/validations';

export const dynamic = 'force-dynamic';

async function getUsersHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId') || '';
  const organizationId = searchParams.get('organizationId') || '';
  const role = searchParams.get('role') || '';
  const isActive = searchParams.get('isActive') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: Record<string, unknown> = {};

  // Non-SUPER_ADMIN users can only see users from their own store
  if (session.role !== 'SUPER_ADMIN') {
    where.storeId = session.storeId || '';
  } else {
    if (storeId) where.storeId = storeId;
  }

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

async function createUserHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const body = await request.json();

  const validation = validateInput(createUserSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const { name, email, role, phone, storeId, organizationId, password } = validation.data;

  // AUDIT REMEDIATION (F9-4): segregation of duties on role assignment —
  // only SUPER_ADMIN may mint SUPER_ADMIN or ACCOUNTANT users. Previously any
  // financial role reaching this route could escalate itself to SUPER_ADMIN
  // (bypassing all store checks via runWithoutTenant). The session here comes
  // from requireAuth → getSessionFromRequest(request) (the same helper used
  // elsewhere), so no extra round-trip is needed to identify the actor.
  const PRIVILEGED_ROLES: readonly string[] = ['SUPER_ADMIN', 'ACCOUNTANT'];
  if (PRIVILEGED_ROLES.includes(role) && session.role !== 'SUPER_ADMIN') {
    await systemLog({
      action: 'ROLE_ASSIGNMENT_DENIED',
      component: 'AUTH',
      severity: 'WARN',
      message: `User ${session.email} (role: ${session.role}) denied assignment of privileged role ${role} to ${email}.`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: { targetEmail: email, requestedRole: role, actorRole: session.role },
    }).catch(() => {});
    return Response.json(
      { success: false, error: 'Only SUPER_ADMIN can assign the SUPER_ADMIN or ACCOUNTANT roles.' },
      { status: 403 }
    );
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(
      { success: false, error: 'A user with this email already exists' },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Non-SUPER_ADMIN users can only create users in their own store
  const targetStoreId =
    session.role === 'SUPER_ADMIN' ? (storeId || null) : session.storeId;

  const user = await db.user.create({
    data: {
      name,
      email,
      role,
      phone: phone || null,
      storeId: targetStoreId,
      organizationId: organizationId || session.organizationId,
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
    userId: session.userId,
    storeId: targetStoreId || undefined,
    metadata: { newUserId: user.id, role, createdBy: session.email },
  });

  // AUDIT REMEDIATION (F9-4): role assignment on create stays open to
  // authenticated admins (STORE_OWNER may create staff), so record an explicit
  // ROLE_ASSIGNED audit-trail entry with actor + target for every assignment.
  await systemLog({
    action: 'ROLE_ASSIGNED',
    component: 'AUTH',
    severity: 'INFO',
    message: `Role ${role} assigned to ${email} by ${session.email} (${session.role}).`,
    userId: session.userId,
    storeId: targetStoreId || undefined,
    metadata: { targetUserId: user.id, targetEmail: email, assignedRole: role, assignedBy: session.email, actorRole: session.role },
  });

  return Response.json(
    {
      success: true,
      data: user,
    },
    { status: 201 }
  );
}

export const GET = withErrorBoundary(
  requireAuth(getUsersHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'USERS'
);
export const POST = withErrorBoundary(
  requireAuth(createUserHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'USERS'
);
