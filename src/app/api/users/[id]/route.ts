// GET/PATCH/DELETE /api/users/[id]
//
// EMPLOYEE-CRUD FIX (2026-09-10): until now /api/users only exposed list +
// create. The Admin tab's "Edit user" and "Deactivate user" buttons showed
// success toasts but NEVER called the server — edits were silently lost and
// deactivated users stayed active. This route completes the DML surface:
//   GET    — one user (never returns passwordHash)
//   PATCH  — update name / phone / role / isActive / password / store reset
//   DELETE — SOFT delete (isActive=false). Hard deletes are not offered:
//            sales, journal entries and audit logs reference users forever.
//
// Security model (mirrors /api/users POST):
//   • SUPER_ADMIN + STORE_OWNER only (requireAuth roles list).
//   • Segregation of duties: only SUPER_ADMIN may set role to SUPER_ADMIN or
//     ACCOUNTANT, and only SUPER_ADMIN may edit another SUPER_ADMIN.
//   • You cannot deactivate yourself, demote yourself, or deactivate the last
//     active SUPER_ADMIN (that would lock everyone out of the org).
//   • Store scoping: STORE_OWNER may only manage users of their own store;
//     SUPER_ADMIN may manage anyone in the organization.
//   • Every mutation is written to the SystemLog audit trail.

import { type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const SUPER_ONLY_ROLES: readonly string[] = ['SUPER_ADMIN', 'ACCOUNTANT'];

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  storeId: true,
  store: { select: { id: true, name: true } },
} as const;

/** Load + authorize the target user. Returns { user } or a Response error. */
async function loadAuthorizedTarget(
  id: string,
  session: AuthSession
): Promise<{ user: Awaited<ReturnType<typeof db.user.findUnique>> & { storeId: string | null; role: string } } | { error: Response }> {
  const user = await db.user.findUnique({
    where: { id },
    select: { ...USER_SELECT, organizationId: true },
  });
  if (!user) {
    return { error: Response.json({ success: false, error: 'User not found.' }, { status: 404 }) };
  }
  // Tenant scope: STORE_OWNER can only manage users in their own store.
  // SUPER_ADMIN may manage any user inside their organization.
  if (session.role !== 'SUPER_ADMIN') {
    if (!session.storeId || user.storeId !== session.storeId) {
      return { error: Response.json({ success: false, error: 'You can only manage users of your own store.' }, { status: 403 }) };
    }
  } else if (user.organizationId !== session.organizationId) {
    return { error: Response.json({ success: false, error: 'User belongs to a different organization.' }, { status: 403 }) };
  }
  // Only SUPER_ADMIN may touch a SUPER_ADMIN account (including self-edit).
  if (user.role === 'SUPER_ADMIN' && session.role !== 'SUPER_ADMIN') {
    return { error: Response.json({ success: false, error: 'Only a SUPER_ADMIN can modify a SUPER_ADMIN account.' }, { status: 403 }) };
  }
  return { user: user as never };
}

// ── GET: user detail (never leaks passwordHash) ──────────────────────────────
async function getUserHandler(
  request: NextRequest,
  session: AuthSession,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  const result = await loadAuthorizedTarget(id, session);
  if ('error' in result) return result.error;
  return Response.json({ success: true, data: result.user });
}

// ── PATCH: update user ───────────────────────────────────────────────────────
async function updateUserHandler(
  request: NextRequest,
  session: AuthSession,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
  const role = typeof body.role === 'string' ? body.role.trim() : undefined;
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;

  if (name !== undefined && (name.length < 2 || name.length > 100)) {
    return Response.json({ success: false, error: 'name must be 2-100 characters.' }, { status: 400 });
  }
  if (phone !== undefined && phone.length > 20) {
    return Response.json({ success: false, error: 'phone must be at most 20 characters.' }, { status: 400 });
  }
  if (password !== undefined && password.length < 6) {
    return Response.json({ success: false, error: 'password must be at least 6 characters.' }, { status: 400 });
  }

  const result = await loadAuthorizedTarget(id, session);
  if ('error' in result) return result.error;
  const target = result.user;

  // ── Segregation of duties on role changes (mirrors POST /api/users) ──
  if (role !== undefined && role !== target.role) {
    const VALID_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'];
    if (!VALID_ROLES.includes(role)) {
      return Response.json({ success: false, error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }
    if (SUPER_ONLY_ROLES.includes(role) && session.role !== 'SUPER_ADMIN') {
      await systemLog({
        action: 'ROLE_ASSIGNMENT_DENIED',
        component: 'AUTH',
        severity: 'WARN',
        message: `User ${session.email} denied grant of privileged role ${role} to ${target.email}.`,
        userId: session.userId,
        storeId: session.storeId || undefined,
      }).catch(() => {});
      return Response.json({ success: false, error: 'Only SUPER_ADMIN can assign the SUPER_ADMIN or ACCOUNTANT roles.' }, { status: 403 });
    }
    // Self-demotion guard: don't let the org's acting admin lock themselves out.
    if (target.id === session.userId && target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
      return Response.json({ success: false, error: 'You cannot change your own SUPER_ADMIN role.' }, { status: 409 });
    }
  }

  // ── Self-deactivation guard ──
  if (isActive === false && target.id === session.userId) {
    return Response.json({ success: false, error: 'You cannot deactivate your own account.' }, { status: 409 });
  }

  // ── Last-active-SUPER_ADMIN guard on deactivation and demotion ──
  if ((isActive === false || (role !== undefined && role !== 'SUPER_ADMIN')) && target.role === 'SUPER_ADMIN' && target.isActive) {
    const activeSuperAdmins = await db.user.count({
      where: { role: 'SUPER_ADMIN', isActive: true, organizationId: target.organizationId },
    });
    if (activeSuperAdmins <= 1) {
      return Response.json(
        { success: false, error: 'Cannot remove the last active SUPER_ADMIN. Promote another admin first.' },
        { status: 409 }
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone || null;
  if (role !== undefined && role !== target.role) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (password !== undefined) data.passwordHash = await bcrypt.hash(password, 12);

  if (Object.keys(data).length === 0) {
    return Response.json({ success: false, error: 'No editable fields provided.' }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: USER_SELECT,
  });

  await systemLog({
    action: 'USER_UPDATED',
    component: 'AUTH',
    severity: 'INFO',
    message: `User ${updated.email} updated by ${session.email}. Fields: ${Object.keys(data).join(', ')}.`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: { targetUserId: id, fields: Object.keys(data) },
  }).catch(() => {});

  if (data.role) {
    await systemLog({
      action: 'ROLE_ASSIGNED',
      component: 'AUTH',
      severity: 'INFO',
      message: `Role of ${updated.email} changed from ${target.role} to ${data.role} by ${session.email} (${session.role}).`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: { targetUserId: id, previousRole: target.role, newRole: data.role, assignedBy: session.email },
    }).catch(() => {});
  }

  return Response.json({ success: true, data: updated });
}

// ── DELETE: soft delete (deactivate) — history keeps referring to this row ──
async function deactivateUserHandler(
  request: NextRequest,
  session: AuthSession,
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;

  const result = await loadAuthorizedTarget(id, session);
  if ('error' in result) return result.error;
  const target = result.user;

  if (target.id === session.userId) {
    return Response.json({ success: false, error: 'You cannot deactivate your own account.' }, { status: 409 });
  }
  if (!target.isActive) {
    return Response.json({ success: true, data: { id: target.id, isActive: false }, message: 'User was already deactivated.' });
  }
  if (target.role === 'SUPER_ADMIN') {
    const activeSuperAdmins = await db.user.count({
      where: { role: 'SUPER_ADMIN', isActive: true, organizationId: target.organizationId },
    });
    if (activeSuperAdmins <= 1) {
      return Response.json(
        { success: false, error: 'Cannot deactivate the last active SUPER_ADMIN. Promote another admin first.' },
        { status: 409 }
      );
    }
  }

  // Kill live sessions so an deactivated user is logged out immediately.
  await db.session.deleteMany({ where: { userId: id } });

  const updated = await db.user.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, name: true, email: true, isActive: true },
  });

  await systemLog({
    action: 'USER_DEACTIVATED',
    component: 'AUTH',
    severity: 'WARN',
    message: `User ${updated.email} deactivated (soft delete) by ${session.email}. Sessions revoked.`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: { targetUserId: id, deactivatedBy: session.email },
  }).catch(() => {});

  return Response.json({ success: true, data: updated, message: `User ${updated.name} deactivated.` });
}

export const GET = withErrorBoundary(
  requireAuth(getUserHandler as (...args: unknown[]) => Promise<Response>, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'USERS_DETAIL'
);
export const PATCH = withErrorBoundary(
  requireAuth(updateUserHandler as (...args: unknown[]) => Promise<Response>, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'USERS_UPDATE'
);
export const DELETE = withErrorBoundary(
  requireAuth(deactivateUserHandler as (...args: unknown[]) => Promise<Response>, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'USERS_DEACTIVATE'
);
