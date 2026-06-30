// PUT  /api/financial/accounts/[id] — update an account's mutable metadata.
// DELETE /api/financial/accounts/[id] — deactivate an account (never hard delete).

import { type NextRequest } from 'next/server';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { updateAccount } from '@/lib/accounting-helpers';
import { APIError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function updateAccountHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const { name, description, subType, isActive, updatedByUserId } = body as {
    name?: string;
    description?: string;
    subType?: string;
    isActive?: boolean;
    updatedByUserId?: string;
  };

  if (!updatedByUserId) {
    return Response.json(
      { success: false, error: 'updatedByUserId is required for the audit trail.' },
      { status: 400 },
    );
  }

  const updates: {
    name?: string;
    description?: string;
    subType?: string;
    isActive?: boolean;
  } = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (subType !== undefined) updates.subType = subType;
  if (isActive !== undefined) updates.isActive = isActive;

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { success: false, error: 'No updatable fields supplied (name, description, subType, isActive).' },
      { status: 400 },
    );
  }

  try {
    const updated = await updateAccount(id, updates, updatedByUserId, {
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
    return Response.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json(
        { success: false, error: error.message },
        { status: error.statusCode },
      );
    }
    throw error;
  }
}

async function deactivateAccountHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  // DELETE accepts an optional JSON body for the audit trail.
  let body: { userId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const userId = body.userId;
  if (!userId) {
    return Response.json(
      { success: false, error: 'userId is required for the audit trail.' },
      { status: 400 },
    );
  }

  try {
    const deactivated = await updateAccount(
      id,
      { isActive: false },
      userId,
      {
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      },
    );
    return Response.json({
      success: true,
      data: deactivated,
      message: 'Account deactivated (set isActive=false).',
    });
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json(
        { success: false, error: error.message },
        { status: error.statusCode },
      );
    }
    throw error;
  }
}

export const PUT = withFinancialAuth(
  withErrorBoundary(updateAccountHandler, LogComponent.FINANCIAL),
  FINANCIAL_ROLES.WRITE,
);
export const DELETE = withFinancialAuth(
  withErrorBoundary(deactivateAccountHandler, LogComponent.FINANCIAL),
  FINANCIAL_ROLES.WRITE,
);
