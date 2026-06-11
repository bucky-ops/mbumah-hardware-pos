/**
 * MBUMAH HARDWARE POS - System Config API
 * GET /api/system-config - List all system configs
 * PUT /api/system-config - Update a config value
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';

async function getSystemConfigHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const category = searchParams.get('category') || '';

  const configs = await db.systemConfig.findMany({
    orderBy: { key: 'asc' },
  });

  // Group by category based on key prefix convention
  const categorized: Record<string, typeof configs> = {
    General: [],
    POS: [],
    Inventory: [],
    Financial: [],
    Notifications: [],
    Other: [],
  };

  for (const config of configs) {
    const key = config.key.toLowerCase();
    if (key.startsWith('store_') || key.startsWith('app_') || key.startsWith('general_')) {
      categorized.General.push(config);
    } else if (key.startsWith('pos_') || key.startsWith('receipt_') || key.startsWith('vat_') || key.startsWith('currency')) {
      categorized.POS.push(config);
    } else if (key.startsWith('inventory_') || key.startsWith('low_stock') || key.startsWith('reorder_')) {
      categorized.Inventory.push(config);
    } else if (key.startsWith('financial_') || key.startsWith('payment_') || key.startsWith('debt_')) {
      categorized.Financial.push(config);
    } else if (key.startsWith('notif_') || key.startsWith('email_') || key.startsWith('sms_')) {
      categorized.Notifications.push(config);
    } else {
      categorized.Other.push(config);
    }
  }

  // If category filter provided, return only that category
  const result = category && categorized[category]
    ? { [category]: categorized[category] }
    : categorized;

  return Response.json({
    success: true,
    data: result,
    all: configs,
  });
}

async function updateSystemConfigHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { id, key, value } = body;

  if (!id && !key) {
    return Response.json(
      { success: false, error: 'Config id or key is required' },
      { status: 400 }
    );
  }

  if (value === undefined || value === null) {
    return Response.json(
      { success: false, error: 'Value is required' },
      { status: 400 }
    );
  }

  const existing = id
    ? await db.systemConfig.findUnique({ where: { id } })
    : await db.systemConfig.findUnique({ where: { key } });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Config not found' },
      { status: 404 }
    );
  }

  const updated = await db.systemConfig.update({
    where: { id: existing.id },
    data: { value: String(value) },
  });

  await systemLog({
    action: 'CONFIG_UPDATED',
    component: 'SYSTEM',
    severity: 'INFO',
    message: `Config "${existing.key}" updated from "${existing.value}" to "${value}"`,
    metadata: { key: existing.key, oldValue: existing.value, newValue: value },
  });

  return Response.json({
    success: true,
    data: updated,
  });
}

export const GET = withErrorBoundary(getSystemConfigHandler, 'SYSTEM_CONFIG');
export const PUT = withErrorBoundary(updateSystemConfigHandler, 'SYSTEM_CONFIG');
