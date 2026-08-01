// GET /api/data-exports/stats?storeId=...
//
// Aggregate stats for the Data Export Dashboard header cards:
//   - totalExports
//   - completedExports
//   - failedExports
//   - totalRecordsExported
//   - totalFileSizeBytes
//   - successRate (0-1)
//   - byType: { [exportType: string]: { count: number; records: number } }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const FINANCIAL_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

async function statsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const rows = await db.dataExport.findMany({
    where: { storeId },
    select: {
      id: true,
      exportType: true,
      status: true,
      recordCount: true,
      fileSizeBytes: true,
    },
  });

  const totalExports = rows.length;
  const completedExports = rows.filter((r) => r.status === 'COMPLETED').length;
  const failedExports = rows.filter((r) => r.status === 'FAILED').length;
  const totalRecordsExported = rows.reduce((sum, r) => sum + (r.recordCount || 0), 0);
  const totalFileSizeBytes = rows.reduce((sum, r) => sum + (r.fileSizeBytes || 0), 0);
  // Success rate = completed / (completed + failed). Pending/processing rows
  // are excluded from the denominator so they don't drag the rate down.
  const denom = completedExports + failedExports;
  const successRate = denom > 0 ? completedExports / denom : 1;

  const byType: Record<string, { count: number; records: number }> = {};
  for (const r of rows) {
    if (!byType[r.exportType]) byType[r.exportType] = { count: 0, records: 0 };
    byType[r.exportType].count += 1;
    byType[r.exportType].records += r.recordCount || 0;
  }

  return Response.json({
    success: true,
    data: {
      totalExports,
      completedExports,
      failedExports,
      totalRecordsExported,
      totalFileSizeBytes,
      successRate,
      byType,
    },
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(statsHandler, FINANCIAL_READ_ROLES),
  'DATA_EXPORTS_STATS',
);
