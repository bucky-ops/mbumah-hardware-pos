import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEtimsConfig } from '@/lib/etims-service';
// v2.17.8 (Task 44 - security hardening): this route was previously exported
// with NO auth wrapper at all - KRA eTIMS configuration posture (configured?,
// sandbox?, registration counts) was readable by anyone with a junk Bearer
// token (the edge proxy checks token PRESENCE, never validity). It now runs
// behind requireStoreAccess: DB-backed session validation + ORM tenant
// scoping (the counts below are store-scoped queries, so a branch session
// sees its own branch's numbers).
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/etims/dashboard - eTIMS summary stats
async function etimsDashboardHandler(): Promise<Response> {
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

export const GET = requireStoreAccess(etimsDashboardHandler);
