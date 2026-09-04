// GET /api/suppliers/performance
//
// Returns performance metrics for all suppliers in a store.
// Query params: storeId (required), period (month|quarter|year, default year)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function getPeriodRange(period: string): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from: Date;

  switch (period) {
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      break;
    case 'quarter':
      from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      break;
    case 'year':
    default:
      from = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      break;
  }

  return { from, to };
}

async function getSuppliersPerformanceHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const period = searchParams.get('period') || 'year';
  const { from, to } = getPeriodRange(period);

  // Fetch all active suppliers for this store
  const suppliers = await db.supplier.findMany({
    where: { storeId, isActive: true },
    include: {
      purchaseOrders: {
        where: {
          orderDate: { gte: from, lte: to },
          status: { not: 'CANCELLED' },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
        orderBy: { orderDate: 'desc' },
      },
    },
  });

  // Calculate performance metrics for each supplier
  const performanceData = suppliers.map((supplier) => {
    const orders = supplier.purchaseOrders;
    const totalOrders = orders.length;
    const totalSpend = orders.reduce((sum, po) => sum + Number(po.totalAmount), 0);

    // On-time delivery: POs that have expectedDate and were received before or on that date
    const receivedOrders = orders.filter((po) => po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED');
    const onTimeOrders = receivedOrders.filter((po) => {
      if (!po.expectedDate || !po.receivedAt) return true; // No expected date = assume on time
      return new Date(po.receivedAt) <= new Date(po.expectedDate);
    });
    const onTimeDeliveryRate = receivedOrders.length > 0
      ? Math.round((onTimeOrders.length / receivedOrders.length) * 100)
      : 100; // Default 100% if no received orders

    // Average fulfillment time (days between order and receipt)
    const fulfilledOrders = receivedOrders.filter((po) => po.receivedAt);
    const avgFulfillmentDays = fulfilledOrders.length > 0
      ? Math.round(
          fulfilledOrders.reduce((sum, po) => {
            const orderDate = new Date(po.orderDate);
            const receivedAt = new Date(po.receivedAt!);
            const diffDays = Math.ceil(
              (receivedAt.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24),
            );
            return sum + Math.max(diffDays, 0);
          }, 0) / fulfilledOrders.length,
        )
      : 0;

    // Quality rating based on return rate (lower returns = higher quality)
    // Since we don't have a direct return model, we'll use a proxy:
    // Quality rating = 5 - (percentage of partially received orders / 20)
    const partiallyReceivedCount = orders.filter((po) => po.status === 'PARTIALLY_RECEIVED').length;
    const returnRate = totalOrders > 0 ? (partiallyReceivedCount / totalOrders) * 100 : 0;
    const qualityRating = Math.max(1, Math.min(5, Math.round(5 - returnRate / 20)));

    // Top products supplied
    const productMap = new Map<string, { id: string; name: string; sku: string; totalQty: number; totalValue: number }>();
    for (const po of orders) {
      for (const item of po.items) {
        const existing = productMap.get(item.productId);
        const qty = Number(item.quantity);
        const value = Number(item.totalCost);
        if (existing) {
          existing.totalQty += qty;
          existing.totalValue += value;
        } else {
          productMap.set(item.productId, {
            id: item.productId,
            name: item.product?.name || item.productName,
            sku: item.product?.sku || '',
            totalQty: qty,
            totalValue: value,
          });
        }
      }
    }
    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 5);

    // Outstanding balance: sum of POs that are not yet fully received/paid
    const outstandingPOs = orders.filter((po) =>
      ['DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(po.status),
    );
    const outstandingBalance = outstandingPOs.reduce((sum, po) => sum + Number(po.totalAmount), 0);

    // Last order date
    const lastOrderDate = orders.length > 0 ? orders[0].orderDate : null;

    // Trend: compare current period spend to previous period
    // Simplified: use a positive trend indicator if recent orders exist
    const recentOrders = orders.filter((po) => {
      const orderDate = new Date(po.orderDate);
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return orderDate >= threeMonthsAgo;
    });
    const trend = recentOrders.length > totalOrders / 4 ? 'up' : recentOrders.length === 0 ? 'down' : 'stable';

    // Performance score: weighted average
    // On-time delivery: 40%, Quality: 30%, Order volume: 30%
    const normalizedVolume = Math.min(totalOrders / 10, 1) * 5; // Normalize to 0-5 scale
    const performanceScore = Math.round(
      (onTimeDeliveryRate / 100) * 5 * 0.4 +
      qualityRating * 0.3 +
      normalizedVolume * 0.3,
    );

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      contactPerson: supplier.contactPerson,
      email: supplier.email,
      phone: supplier.phone,
      rating: supplier.rating,
      paymentTerms: supplier.paymentTerms,
      metrics: {
        totalOrders,
        totalSpend,
        onTimeDeliveryRate,
        avgFulfillmentDays,
        qualityRating,
        topProducts,
        outstandingBalance,
        lastOrderDate,
        trend,
        performanceScore,
      },
    };
  });

  // Sort by performance score descending
  performanceData.sort((a, b) => b.metrics.performanceScore - a.metrics.performanceScore);

  return Response.json({
    success: true,
    data: performanceData,
    period,
    dateRange: { from: from.toISOString(), to: to.toISOString() },
  });
}

// AUDIT FIX (Task 3-d): session-validated + storeId-param scoping
// (requireStoreAccess). Any store role — read-only supplier metrics.
export const GET = withErrorBoundary(
  requireStoreAccess(getSuppliersPerformanceHandler),
  'SUPPLIERS_PERFORMANCE',
);
