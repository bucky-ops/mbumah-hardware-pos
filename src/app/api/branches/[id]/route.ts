// GET/PATCH /api/branches/[id]
//
// BRANCH CODES (v2.3.0): branch detail + code assignment.
//
//   GET    — one branch (includes the unique `code`).
//   PATCH  — update name / code / location / address / phone / email /
//            taxPin / status. The branch `code` is the linchpin of the
//            coding system: it flows into product SKUs (MBM-<CODE>-…),
//            employee staff numbers (MBM-<CODE>-E###) and transfer
//            destination SKUs, so it is validated (2-6 letters/digits,
//            uppercase) and checked for uniqueness before save (409 on a
//            clash). Manager-or-above only — branch identity is an
//            organization-level setting.
//
// Why PATCH matters operationally: without it, a branch code could only be
// set at creation time; existing branches (like the 5 live Mbumah branches)
// could never receive codes without direct database surgery.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, getSessionFromRequest, MANAGER_PLUS_ROLES } from '@/lib/auth';
import { normalizeBranchCode } from '@/lib/helpers';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const BRANCH_SELECT = {
  id: true,
  organizationId: true,
  code: true,
  name: true,
  location: true,
  address: true,
  phone: true,
  email: true,
  taxPin: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function getBranchHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const branch = await db.store.findUnique({
    where: { id },
    select: BRANCH_SELECT,
  });

  if (!branch) {
    return Response.json(
      { success: false, error: 'Branch not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: branch });
}

async function updateBranchHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const session = await getSessionFromRequest(request);

  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.store.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Branch not found.' },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'name', 'location', 'address', 'phone', 'email', 'taxPin', 'status',
  ];
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field] === '' ? null : body[field];
    }
  }

  // ── Branch code: normalize + uniqueness guard ────────────────────
  if (body.code !== undefined) {
    if (body.code === null || body.code === '') {
      // Explicit clearing is refused: an uncoded branch breaks SKU/employee
      // code generation and silently loses traceability. Set a new code
      // instead of removing the old one.
      return Response.json(
        { success: false, error: 'Branch code cannot be removed. Replace it with a new code instead.' },
        { status: 400 }
      );
    }
    const code = normalizeBranchCode(body.code);
    if (!code) {
      return Response.json(
        { success: false, error: 'Branch code must be 2-6 letters/digits (e.g. NAK, JUJ, NCBD).' },
        { status: 400 }
      );
    }
    if (code !== existing.code) {
      const clash = await db.store.findUnique({ where: { code }, select: { id: true } });
      if (clash && clash.id !== id) {
        return Response.json(
          { success: false, error: `Branch code "${code}" is already used by another branch.` },
          { status: 409 }
        );
      }
      updateData.code = code;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const branch = await db.store.update({
    where: { id },
    data: updateData,
    select: BRANCH_SELECT,
  });

  await systemLog({
    action: 'BRANCH_UPDATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Branch "${branch.name}" (${branch.code || 'no code'}) updated by "${session?.email || 'unknown'}"`,
    userId: session?.userId,
    storeId: branch.id,
    metadata: {
      branchId: id,
      updatedFields: Object.keys(updateData),
      previousCode: existing.code,
      newCode: branch.code,
    },
  });

  return Response.json({ success: true, data: branch });
}

export const GET = withErrorBoundary(withSessionAuth(getBranchHandler), 'BRANCH_DETAIL');
export const PATCH = withErrorBoundary(
  withSessionAuth(updateBranchHandler, { roles: MANAGER_PLUS_ROLES }),
  'BRANCH_UPDATE'
);
