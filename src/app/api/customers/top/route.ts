// GET /api/customers/top
// Returns top customers by total spend (computed from SalesTransaction grandTotals).
// Query params: storeId (required), limit (default 5, max 20), period (all|month|quarter|year)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withSessionAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function getTopCustomersHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const limit = Math.min(parseInt(searchParams.get('limit') || '5', 10), 20);
  const period = searchParams.get('period') || 'all';

  // Compute date filter for the period
  let dateFilter: { gte?: Date } = {};
  const now = new Date();
  if (period === 'month') {
    dateFilter = { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
  } else if (period === 'quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    dateFilter = { gte: new Date(now.getFullYear(), quarterStartMonth, 1) };
  } else if (period === 'year') {
    dateFilter = { gte: new Date(now.getFullYear(), 0, 1) };
  }

  // QA FIX (Kenya Plumbing Co. incident audit): SalesTransaction has NO
  // `status` column — the field is `paymentStatus` (PENDING, COMPLETED,
  // FAILED, REFUNDED, PARTIAL). The invalid groupBy filter made this endpoint
  // 500 on every call ("Unknown argument `status`"), so the Top Customers
  // widget never loaded. Also restrict to SALE rows so REFUND/VOID entries
  // don't pollute spend totals.
  const where: Record<string, unknown> = {
    storeId,
    paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    transactionType: 'SALE',
  };
  if (dateFilter.gte) {
    where.createdAt = dateFilter;
  }

  const topCustomersRaw = await db.salesTransaction.groupBy({
    by: ['customerId'],
    where: {
      ...where,
      customerId: { not: null },
    },
    _sum: { totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: limit,
  });

  // Filter out null customerIds (shouldn't happen with the where clause but TS safety)
  const validRows = topCustomersRaw.filter(
    (r): r is typeof r & { customerId: string } => r.customerId !== null,
  );

  if (validRows.length === 0) {
    return Response.json({
      success: true,
      data: [],
      period,
    });
  }

  // Fetch customer details in one query
  const customerIds = validRows.map((r) => r.customerId);
  const customers = await db.customer.findMany({
    where: { id: { in: customerIds } },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      loyaltyTier: true,
      loyaltyPoints: true,
      currentDebtBalance: true,
      createdAt: true,
    },
  });

  const customerMap = new Map(customers.map((c) => [c.id, c]));

  // Combine aggregate + customer info
  const result = validRows.map((row, index) => {
    const customer = customerMap.get(row.customerId);
    if (!customer) return null;
    const totalSpend = Number(row._sum.totalAmount ?? 0);
    const orderCount = row._count.id;
    const avgOrderValue = orderCount > 0 ? totalSpend / orderCount : 0;
    return {
      rank: index + 1,
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      loyaltyTier: customer.loyaltyTier,
      loyaltyPoints: customer.loyaltyPoints,
      currentDebtBalance: Number(customer.currentDebtBalance ?? 0),
      totalSpend,
      orderCount,
      avgOrderValue: Math.round(avgOrderValue),
      firstPurchaseAt: customer.createdAt,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  // Compute total spend across ALL customers (for share %)
  const totalAllSpend = await db.salesTransaction.aggregate({
    where,
    _sum: { totalAmount: true },
  });
  const totalSpendAll = Number(totalAllSpend._sum.totalAmount ?? 0);

  return Response.json({
    success: true,
    data: result,
    period,
    totalSpendAll,
  });
}

// AUDIT FIX (Task 3-d): session-validated (was Bearer-presence only).
// Any store role — read-only top-customers aggregation.
export const GET = withErrorBoundary(
  withSessionAuth(getTopCustomersHandler),
  'CUSTOMERS_TOP',
);
