// GET /api/suppliers/[id]/performance
//
// Detailed performance for a single supplier.
// Includes: monthly order trend, product list, payment history.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getSupplierPerformanceHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const supplierId = (await context.params).id;
  const { searchParams } = new URL(request.url);

  const period = searchParams.get('period') || 'year';

  // Calculate period range
  const now = new Date();
  let monthsBack = 12;
  if (period === 'month') monthsBack = 1;
  else if (period === 'quarter') monthsBack = 3;

  const from = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);

  // Fetch supplier
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier) {
    return Response.json(
      { success: false, error: 'Supplier not found.' },
      { status: 404 },
    );
  }

  // Fetch all purchase orders for this supplier
  const purchaseOrders = await db.purchaseOrder.findMany({
    where: {
      supplierId,
      orderDate: { gte: from },
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
    },
    orderBy: { orderDate: 'desc' },
  });

  // Monthly order trend
  const monthlyTrend: { month: string; orders: number; spend: number }[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthLabel = d.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' });
    const monthOrders = purchaseOrders.filter((po) => {
      const orderDate = new Date(po.orderDate);
      return orderDate.getMonth() === d.getMonth() && orderDate.getFullYear() === d.getFullYear();
    });
    const monthSpend = monthOrders
      .filter((po) => po.status !== 'CANCELLED')
      .reduce((sum, po) => sum + Number(po.totalAmount), 0);
    monthlyTrend.push({
      month: monthLabel,
      orders: monthOrders.length,
      spend: monthSpend,
    });
  }

  // Product list supplied
  const productMap = new Map<string, {
    id: string;
    name: string;
    sku: string;
    totalQty: number;
    totalValue: number;
    lastOrderDate: string;
  }>();
  for (const po of purchaseOrders) {
    for (const item of po.items) {
      const existing = productMap.get(item.productId);
      const qty = Number(item.quantity);
      const value = Number(item.totalCost);
      if (existing) {
        existing.totalQty += qty;
        existing.totalValue += value;
        if (new Date(po.orderDate) > new Date(existing.lastOrderDate)) {
          existing.lastOrderDate = po.orderDate.toISOString();
        }
      } else {
        productMap.set(item.productId, {
          id: item.productId,
          name: item.product?.name || item.productName,
          sku: item.product?.sku || '',
          totalQty: qty,
          totalValue: value,
          lastOrderDate: po.orderDate.toISOString(),
        });
      }
    }
  }
  const products = Array.from(productMap.values()).sort((a, b) => b.totalValue - a.totalValue);

  // Payment history (based on PO status changes)
  const paymentHistory = purchaseOrders
    .filter((po) => po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED')
    .map((po) => ({
      poNumber: po.poNumber,
      amount: Number(po.totalAmount),
      status: po.status,
      orderDate: po.orderDate.toISOString(),
      receivedAt: po.receivedAt?.toISOString() || null,
      expectedDate: po.expectedDate?.toISOString() || null,
    }));

  // Performance metrics
  const activeOrders = purchaseOrders.filter((po) => po.status !== 'CANCELLED');
  const totalOrders = activeOrders.length;
  const totalSpend = activeOrders.reduce((sum, po) => sum + Number(po.totalAmount), 0);

  const receivedOrders = purchaseOrders.filter((po) => po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED');
  const onTimeOrders = receivedOrders.filter((po) => {
    if (!po.expectedDate || !po.receivedAt) return true;
    return new Date(po.receivedAt) <= new Date(po.expectedDate);
  });
  const onTimeDeliveryRate = receivedOrders.length > 0
    ? Math.round((onTimeOrders.length / receivedOrders.length) * 100)
    : 100;

  const fulfilledOrders = receivedOrders.filter((po) => po.receivedAt);
  const avgFulfillmentDays = fulfilledOrders.length > 0
    ? Math.round(
        fulfilledOrders.reduce((sum, po) => {
          const orderDate = new Date(po.orderDate);
          const receivedAt = new Date(po.receivedAt!);
          const diffDays = Math.ceil((receivedAt.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
          return sum + Math.max(diffDays, 0);
        }, 0) / fulfilledOrders.length,
      )
    : 0;

  const partiallyReceivedCount = purchaseOrders.filter((po) => po.status === 'PARTIALLY_RECEIVED').length;
  const returnRate = totalOrders > 0 ? (partiallyReceivedCount / totalOrders) * 100 : 0;
  const qualityRating = Math.max(1, Math.min(5, Math.round(5 - returnRate / 20)));

  const outstandingPOs = purchaseOrders.filter((po) =>
    ['DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(po.status),
  );
  const outstandingBalance = outstandingPOs.reduce((sum, po) => sum + Number(po.totalAmount), 0);

  const normalizedVolume = Math.min(totalOrders / 10, 1) * 5;
  const performanceScore = Math.round(
    (onTimeDeliveryRate / 100) * 5 * 0.4 +
    qualityRating * 0.3 +
    normalizedVolume * 0.3,
  );

  return Response.json({
    success: true,
    data: {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        email: supplier.email,
        phone: supplier.phone,
        contactPerson: supplier.contactPerson,
        rating: supplier.rating,
        paymentTerms: supplier.paymentTerms,
        city: supplier.city,
        address: supplier.address,
      },
      metrics: {
        totalOrders,
        totalSpend,
        onTimeDeliveryRate,
        avgFulfillmentDays,
        qualityRating,
        outstandingBalance,
        performanceScore,
      },
      monthlyTrend,
      products,
      paymentHistory,
      period,
      dateRange: { from: from.toISOString(), to: now.toISOString() },
    },
  });
}

export const GET = withErrorBoundary(getSupplierPerformanceHandler, 'SUPPLIER_PERFORMANCE_DETAIL');
