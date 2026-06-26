// GET/PUT/DELETE /api/vouchers/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getVoucherHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const voucher = await db.voucher.findUnique({
    where: { id },
    include: {
      campaign: {
        select: { id: true, name: true, campaignType: true, status: true },
      },
      redemptions: {
        orderBy: { createdAt: 'desc' },
        include: {
          voucher: { select: { code: true, name: true } },
        },
      },
    },
  });

  if (!voucher) {
    return Response.json(
      { success: false, error: 'Voucher not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: voucher });
}

async function updateVoucherHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.voucher.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Voucher not found.' },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};

  // Handle status changes
  if (body.status) {
    const validStatuses = ['ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'];
    if (!validStatuses.includes(body.status)) {
      return Response.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }
    updateData.status = body.status;
  }

  // Allow updating basic fields
  const allowedFields = [
    'name', 'description', 'minimumPurchase', 'maxDiscount',
    'maxUses', 'maxUsesPerUser', 'freeProductId', 'campaignId',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (body.value !== undefined) {
    if (body.value <= 0) {
      return Response.json(
        { success: false, error: 'value must be greater than 0.' },
        { status: 400 }
      );
    }
    updateData.value = parseFloat(String(body.value));
  }

  if (body.startDate !== undefined) {
    updateData.startDate = body.startDate ? new Date(body.startDate) : new Date();
  }

  if (body.endDate !== undefined) {
    updateData.endDate = body.endDate ? new Date(body.endDate) : null;
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const voucher = await db.voucher.update({
    where: { id },
    data: updateData,
    include: {
      campaign: {
        select: { id: true, name: true, campaignType: true, status: true },
      },
    },
  });

  await systemLog({
    action: 'VOUCHER_UPDATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Voucher ${existing.code} updated`,
    storeId: existing.storeId,
    metadata: {
      voucherId: id,
      voucherCode: existing.code,
      updatedFields: Object.keys(updateData),
      previousStatus: existing.status,
    },
  });

  return Response.json({ success: true, data: voucher });
}

async function deleteVoucherHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.voucher.findUnique({
    where: { id },
    include: { redemptions: true },
  });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Voucher not found.' },
      { status: 404 }
    );
  }

  // Only allow deletion if no redemptions
  if (existing.redemptions.length > 0) {
    return Response.json(
      { success: false, error: 'Cannot delete voucher with existing redemptions. Cancel it instead.' },
      { status: 400 }
    );
  }

  await db.voucher.delete({ where: { id } });

  await systemLog({
    action: 'VOUCHER_DELETED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Voucher ${existing.code} (${existing.name}) deleted`,
    storeId: existing.storeId,
    metadata: { voucherId: id, voucherCode: existing.code },
  });

  return Response.json({ success: true, data: { id, deleted: true } });
}

export const GET = withErrorBoundary(getVoucherHandler, 'VOUCHER_DETAIL');
export const PUT = withErrorBoundary(updateVoucherHandler, 'VOUCHER_UPDATE');
export const DELETE = withErrorBoundary(deleteVoucherHandler, 'VOUCHER_DELETE');
