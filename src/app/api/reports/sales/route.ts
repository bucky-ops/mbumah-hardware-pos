// GET /api/reports/sales

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

async function getSalesReportHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const paymentMethod = searchParams.get('paymentMethod') || '';
  const categoryId = searchParams.get('categoryId') || '';
  const groupBy = searchParams.get('groupBy') || 'day'; // day, week, month, product, category, cashier
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');

  if (!dateFrom || !dateTo) {
    return Response.json(
      { success: false, error: 'dateFrom and dateTo are required.' },
      { status: 400 }
    );
  }

  const startDate = new Date(dateFrom);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(dateTo);
  endDate.setHours(23, 59, 59, 999);

  const where: Record<string, unknown> = {
    storeId,
    createdAt: { gte: startDate, lte: endDate },
    transactionType: 'SALE',
    paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
  };

  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }

  // Fetch transactions and items
  const [transactions, transactionItems] = await Promise.all([
    db.salesTransaction.findMany({
      where,
      include: {
        cashier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        items: categoryId
          ? {
              where: {
                product: { categoryId },
              },
              include: {
                product: { select: { categoryId: true, category: { select: { name: true } } } },
              },
            }
          : {
              include: {
                product: { select: { categoryId: true, category: { select: { name: true } } } },
              },
            },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.saleItem.findMany({
      where: {
        transaction: {
          storeId,
          createdAt: { gte: startDate, lte: endDate },
          transactionType: 'SALE',
          paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
          ...(paymentMethod ? { paymentMethod } : {}),
        },
        ...(categoryId ? { product: { categoryId } } : {}),
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            categoryId: true,
            category: { select: { id: true, name: true } },
          },
        },
        transaction: {
          select: {
            id: true,
            receiptNumber: true,
            paymentMethod: true,
            createdAt: true,
            cashier: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  // Summary totals
  const summary = await db.salesTransaction.aggregate({
    where,
    _sum: {
      subtotal: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
    },
    _count: true,
    _avg: { totalAmount: true },
  });

  // Group data by specified dimension
  type GroupKey = string;
  const grouped: Record<GroupKey, { count: number; subtotal: number; tax: number; discount: number; total: number }> = {};

  for (const tx of transactions) {
    let key: string;

    switch (groupBy) {
      case 'day': {
        key = new Date(tx.createdAt).toISOString().split('T')[0];
        break;
      }
      case 'week': {
        const d = new Date(tx.createdAt);
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        key = startOfWeek.toISOString().split('T')[0];
        break;
      }
      case 'month': {
        key = new Date(tx.createdAt).toISOString().substring(0, 7);
        break;
      }
      case 'cashier': {
        key = tx.cashier.name;
        break;
      }
      case 'payment_method': {
        key = tx.paymentMethod;
        break;
      }
      default: {
        key = new Date(tx.createdAt).toISOString().split('T')[0];
      }
    }

    if (!grouped[key]) {
      grouped[key] = { count: 0, subtotal: 0, tax: 0, discount: 0, total: 0 };
    }
    grouped[key].count += 1;
    grouped[key].subtotal += tx.subtotal;
    grouped[key].tax += tx.taxAmount;
    grouped[key].discount += tx.discountAmount;
    grouped[key].total += tx.totalAmount;
  }

    const productSales: Record<string, { productName: string; sku: string; quantity: number; revenue: number; cost: number; profit: number }> = {};
  for (const item of transactionItems) {
    const key = item.productId;
    if (!productSales[key]) {
      productSales[key] = {
        productName: item.productName,
        sku: item.product.sku,
        quantity: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      };
    }
    productSales[key].quantity += item.quantity;
    productSales[key].revenue += item.lineTotal;
    productSales[key].cost += item.costPrice * item.quantity;
    productSales[key].profit = productSales[key].revenue - productSales[key].cost;
  }

    const categorySales: Record<string, { categoryName: string; quantity: number; revenue: number }> = {};
  for (const item of transactionItems) {
    const catId = item.product.categoryId || 'uncategorized';
    const catName = item.product.category?.name || 'Uncategorized';
    if (!categorySales[catId]) {
      categorySales[catId] = { categoryName: catName, quantity: 0, revenue: 0 };
    }
    categorySales[catId].quantity += item.quantity;
    categorySales[catId].revenue += item.lineTotal;
  }

  const totalRevenue = summary._sum.totalAmount || 0;
  const totalCost = Object.values(productSales).reduce((sum, p) => sum + p.cost, 0);

    const paymentMethodMap: Record<string, { method: string; count: number; amount: number }> = {};
  for (const tx of transactions) {
    const method = tx.paymentMethod || 'CASH';
    if (!paymentMethodMap[method]) {
      paymentMethodMap[method] = { method, count: 0, amount: 0 };
    }
    paymentMethodMap[method].count += 1;
    paymentMethodMap[method].amount += tx.totalAmount;
  }
  const byPaymentMethod = Object.values(paymentMethodMap);

  return Response.json({
    success: true,
    data: {
            period: `${dateFrom} to ${dateTo}`,
      totalSales: totalRevenue,
      totalRevenue,
      totalTax: summary._sum.taxAmount || 0,
      totalDiscount: summary._sum.discountAmount || 0,
      transactionCount: summary._count,
      avgTransactionValue: summary._avg.totalAmount || 0,
      byPaymentMethod,

            summary: {
        totalTransactions: summary._count,
        totalRevenue,
        totalSubtotal: summary._sum.subtotal || 0,
        totalTax: summary._sum.taxAmount || 0,
        totalDiscount: summary._sum.discountAmount || 0,
        averageTransactionValue: summary._avg.totalAmount || 0,
        grossProfit: totalRevenue - totalCost,
        profitMargin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
      },
      grouped: Object.entries(grouped).map(([key, values]) => ({
        key,
        ...values,
      })),
      byProduct: Object.values(productSales).sort((a, b) => b.revenue - a.revenue),
      byCategory: Object.values(categorySales).sort((a, b) => b.revenue - a.revenue),
      transactions,
    },
    pagination: {
      page,
      limit,
    },
  });
}

export const GET = withErrorBoundary(getSalesReportHandler, 'REPORTS_SALES');
