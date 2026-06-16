// GET/PUT /api/system-config
// Requires SUPER_ADMIN role

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { requireAuth, AuthSession } from '@/lib/auth';

// Sensitive config keys (containing 'secret', 'key', 'password', 'token', or 'pin')
// have their values masked in API responses and audit logs to prevent credential
// leakage via the system-config endpoint.
const SENSITIVE_KEY_PATTERNS = ['secret', 'password', 'token', 'apikey', 'api_key'];

function isSensitiveConfigKey(rawKey: string): boolean {
  const k = rawKey.toLowerCase();
  // Match any of the patterns as standalone words/substrings, but avoid
  // false positives like 'keywords' or 'keyresult' by checking boundaries.
  if (k.includes('secret') || k.includes('password') || k.includes('token')) {
    return true;
  }
  // 'key' / 'pin' need word-boundary-ish checks to avoid 'keyboard' / 'pinning' false positives
  if (/\bkey\b/.test(k) || /(^|_)pin(_|$)/.test(k)) {
    return true;
  }
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

function maskConfigValue(rawValue: string): string {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return '***';
  }
  // Show first 2 chars + '***' for short identifiable hint, or full mask if very short
  if (rawValue.length <= 4) {
    return '***';
  }
  return rawValue.slice(0, 2) + '***';
}

type ConfigRow = {
  id: string;
  key: string;
  value: string;
  category?: string | null;
  description?: string | null;
  updatedAt?: Date;
  createdAt?: Date;
};

function maskSensitiveConfig<T extends ConfigRow>(config: T): T {
  if (isSensitiveConfigKey(config.key)) {
    return { ...config, value: maskConfigValue(config.value) };
  }
  return config;
}


async function getSystemConfigHandler(
  request: NextRequest,
  _session: AuthSession
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const category = searchParams.get('category') || '';

  const rawConfigs = await db.systemConfig.findMany({
    orderBy: { key: 'asc' },
  });

  // SECURITY (H-05): Mask sensitive config values (secret/key/password/token/pin)
  // before returning to the client. The endpoint is SUPER_ADMIN-only but defense
  // in depth prevents accidental credential leakage via logs, proxies, or browser
  // dev tools that capture API responses.
  const configs = rawConfigs.map(maskSensitiveConfig);

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

  const result = category && categorized[category]
    ? { [category]: categorized[category] }
    : categorized;

  return Response.json({
    success: true,
    data: result,
    all: configs,
  });
}

async function updateSystemConfigHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
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

  // SECURITY (H-05): Mask sensitive config values in audit log so credentials
  // are not persisted in plaintext in the SystemLog table.
  const sensitive = isSensitiveConfigKey(existing.key);
  const loggedOldValue = sensitive ? maskConfigValue(existing.value) : existing.value;
  const loggedNewValue = sensitive ? maskConfigValue(String(value)) : String(value);

  await systemLog({
    action: 'CONFIG_UPDATED',
    component: 'SYSTEM',
    severity: 'INFO',
    message: `Config "${existing.key}" updated${sensitive ? ' (sensitive value)' : ` from "${loggedOldValue}" to "${loggedNewValue}"`}`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: {
      key: existing.key,
      oldValue: loggedOldValue,
      newValue: loggedNewValue,
      isSensitive: sensitive,
      updatedBy: session.email,
    },
  });

  return Response.json({
    success: true,
    data: maskSensitiveConfig(updated),
  });
}

export const GET = withErrorBoundary(
  requireAuth(getSystemConfigHandler, { roles: ['SUPER_ADMIN'] }),
  'SYSTEM_CONFIG'
);
export const PUT = withErrorBoundary(
  requireAuth(updateSystemConfigHandler, { roles: ['SUPER_ADMIN'] }),
  'SYSTEM_CONFIG'
);
