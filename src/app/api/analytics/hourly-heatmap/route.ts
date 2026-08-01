// GET /api/analytics/hourly-heatmap
//
// Returns a 7×24 matrix (days-of-week × hours) of revenue and transaction
// counts. Used by the heatmap component to visualise peak sales times.
//
// We pull all transactions in the last 90 days (configurable via `days`)
// so the heatmap has enough data to surface weekly patterns even on stores
// with low daily volume.
//
// Query params:
//   - storeId : REQUIRED
//   - days    : default 90 (how far back to look)
//
// Response:
//   { success, data: { matrix: HeatmapMatrix, peakHours: PeakHour[] } }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import {
  buildHourlyHeatmap,
  getPeakHours,
  type TransactionSlice,
} from '@/lib/analytics-utils';

export const dynamic = 'force-dynamic';

async function getHourlyHeatmapHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const daysRaw = parseInt(searchParams.get('days') || '90', 10);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 365) : 90;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const txs = await db.salesTransaction.findMany({
    where: {
      storeId,
      createdAt: { gte: start },
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    },
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      paymentMethod: true,
      paymentStatus: true,
      transactionType: true,
    },
    take: 100000,
  });

  const slices: TransactionSlice[] = txs.map((t) => ({
    id: t.id,
    createdAt: t.createdAt,
    totalAmount: Number(t.totalAmount),
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    transactionType: t.transactionType,
  }));

  const matrix = buildHourlyHeatmap(slices);
  const peakHours = getPeakHours(matrix, 3);

  return Response.json({
    success: true,
    data: {
      days,
      windowStart: start.toISOString(),
      matrix,
      peakHours,
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getHourlyHeatmapHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER'],
  }),
  'ANALYTICS_HOURLY_HEATMAP',
);
