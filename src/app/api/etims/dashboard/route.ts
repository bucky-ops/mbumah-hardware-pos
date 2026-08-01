import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEtimsConfig } from '@/lib/etims-service';

export const dynamic = 'force-dynamic';

// GET /api/etims/dashboard — eTIMS summary stats
export async function GET() {
  try {
    const [registeredProducts, issuedInvoices, pendingProducts, pendingInvoices] = await Promise.all([
      db.product.count({ where: { etimsItemCode: { not: null } } }).catch(() => 0),
      db.salesTransaction.count({ where: { etimsStatus: 'ISSUED' } }).catch(() => 0),
      db.product.count({ where: { etimsItemCode: null, isActive: true } }).catch(() => 0),
      db.salesTransaction.count({ where: { etimsStatus: 'PENDING' } }).catch(() => 0),
    ]);

    const config = getEtimsConfig();
    const isConfigured = Boolean(config.tin && config.branchId);

    return NextResponse.json({
      success: true,
      data: {
        registeredProducts,
        issuedInvoices,
        pendingProducts,
        pendingInvoices,
        isConfigured,
        sandbox: config.sandbox,
        lastSync: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[eTIMS dashboard] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch eTIMS dashboard data' },
      { status: 500 }
    );
  }
}
