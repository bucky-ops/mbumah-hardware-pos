// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Admin-controlled VAT Settings API (v2.8.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// GET   /api/settings/vat   — current admin-controlled VAT rate (percent).
// PATCH /api/settings/vat   — set the VAT rate (0–100). 0 disables VAT on all
//                             NEW documents (sales/invoices/POs).
//
// The rate is persisted in the global SystemConfig store under the key
// `vat_rate_percent` (see src/lib/vat-settings.ts) and is AUTHORITATIVE for
// all document-creation paths. Historical documents keep their stored amounts.
//
// Auth:
//   • GET   — any authenticated user (cashiers need the rate for labels).
//   • PATCH — SUPER_ADMIN or STORE_OWNER only.
// ─────────────────────────────────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import {
  DEFAULT_VAT_RATE_PERCENT,
  VAT_CONFIG_KEY,
  getVatRatePercent,
  invalidateVatRateCache,
} from '@/lib/vat-settings';

export const dynamic = 'force-dynamic';

// ── GET: current VAT rate ───────────────────────────────────────────────────
async function getHandler(
  _request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  return runWithoutTenant(async () => {
    const vatRatePercent = await getVatRatePercent();
    const config = await db.systemConfig.findUnique({
      where: { key: VAT_CONFIG_KEY },
      select: { updatedAt: true },
    });
    return NextResponse.json({
      success: true,
      data: {
        vatRatePercent,
        isDefault: config === null,
        updatedAt: config?.updatedAt?.toISOString() ?? null,
      },
    });
  });
}

// ── PATCH: update VAT rate ──────────────────────────────────────────────────
const patchBodySchema = z.object({
  vatRatePercent: z
    .number()
    .min(0, 'VAT rate cannot be negative.')
    .max(100, 'VAT rate cannot exceed 100%.'),
});

async function patchHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  const { vatRatePercent } = parsed.data;

  return runWithoutTenant(async () => {
    const previous = await db.systemConfig.findUnique({
      where: { key: VAT_CONFIG_KEY },
    });

    const saved = await db.systemConfig.upsert({
      where: { key: VAT_CONFIG_KEY },
      update: { value: String(vatRatePercent) },
      create: {
        key: VAT_CONFIG_KEY,
        value: String(vatRatePercent),
        description:
          'Admin-controlled VAT rate (percent) applied to POS sales, invoices and purchase orders. 0 disables VAT.',
      },
    });

    invalidateVatRateCache();

    await systemLog({
      action: 'VAT_RATE_UPDATED',
      component: 'SYSTEM',
      severity: 'INFO',
      message: `VAT rate updated from ${previous?.value ?? String(DEFAULT_VAT_RATE_PERCENT)}% to ${vatRatePercent}%`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: {
        oldValue: previous?.value ?? String(DEFAULT_VAT_RATE_PERCENT),
        newValue: String(vatRatePercent),
        updatedBy: session.email,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        vatRatePercent,
        updatedAt: saved.updatedAt.toISOString(),
      },
    });
  });
}

// GET: any authenticated user (labels + previews need the rate).
export const GET = withErrorBoundary(
  requireAuth(getHandler),
  'SETTINGS_VAT_GET',
);

// PATCH: SUPER_ADMIN or STORE_OWNER only.
export const PATCH = withErrorBoundary(
  requireAuth(patchHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'SETTINGS_VAT_PATCH',
);
