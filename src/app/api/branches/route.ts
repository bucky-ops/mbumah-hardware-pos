// GET/POST /api/branches

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';

async function getBranchesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const organizationId = searchParams.get('organizationId') || 'org_mbumah';
  const status = searchParams.get('status') || '';

  const where: Record<string, unknown> = { organizationId };

  if (status) {
    where.status = status;
  }

  const branches = await db.store.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      organizationId: true,
      name: true,
      location: true,
      address: true,
      phone: true,
      email: true,
      taxPin: true,
      status: true,
      createdAt: true,
    },
  });

  return Response.json({
    success: true,
    data: branches,
  });
}

async function createBranchHandler(...args: unknown[]): Promise<Response> {
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

  // ── 2. Authorise: only admin roles may create branches ───────────
  const allowedRoles = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

  if (!allowedRoles.includes(requestingUser.role)) {
    await systemLog({
      action: 'BRANCH_CREATE_DENIED',
      component: 'AUTH',
      severity: 'WARN',
      message: `User "${requestingUser.name}" (${requestingUser.role}) attempted to create a branch — denied`,
      userId: requestingUser.id,
      storeId: requestingUser.storeId || undefined,
      metadata: { requestingRole: requestingUser.role },
    });

    return Response.json(
      { success: false, error: 'Only administrators and branch managers can create branches.' },
      { status: 403 }
    );
  }

  // ── 3. Parse & validate request body ─────────────────────────────
  const body = await request.json();
  const { organizationId, name, location, address, phone, email, taxPin, status } = body;

  if (!name || !organizationId) {
    return Response.json(
      { success: false, error: 'name and organizationId are required.' },
      { status: 400 }
    );
  }

  // ── 4. Check for duplicate branch name in organization ───────────
  const existing = await db.store.findFirst({
    where: { organizationId, name },
  });

  if (existing) {
    return Response.json(
      { success: false, error: 'A branch with this name already exists in this organization.' },
      { status: 409 }
    );
  }

  // ── 5. Create the branch ─────────────────────────────────────────
  const branch = await db.store.create({
    data: {
      organizationId,
      name,
      location: location || null,
      address: address || null,
      phone: phone || null,
      email: email || null,
      taxPin: taxPin || null,
      status: status || 'ACTIVE',
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      location: true,
      address: true,
      phone: true,
      email: true,
      taxPin: true,
      status: true,
      createdAt: true,
    },
  });

  await systemLog({
    action: 'BRANCH_CREATED',
    component: 'AUTH',
    severity: 'INFO',
    message: `Branch "${name}" created by "${requestingUser.name}" (${requestingUser.role})`,
    userId: requestingUser.id,
    storeId: requestingUser.storeId || undefined,
    metadata: { branchId: branch.id, branchName: name, createdByRole: requestingUser.role },
  });

  return Response.json({
    success: true,
    data: branch,
  }, { status: 201 });
}

export const GET = withErrorBoundary(getBranchesHandler, 'BRANCHES_LIST');
export const POST = withErrorBoundary(createBranchHandler, 'BRANCHES_CREATE');
