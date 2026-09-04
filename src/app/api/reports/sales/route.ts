// GET /api/reports/sales

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withSessionAuth, FINANCIAL_ROLES } from '@/lib/auth';
// FINANCIAL MATH AUDIT (Task 12-b): Prisma Decimal valueOf() returns a STRING —
// `number + decimal` concatenates. All accumulation runs through toDec();
// plain numbers are emitted only at the JSON boundary. Profit basis:
// netRevenue = Σ(totalAmount − taxAmount) (VAT-exclusive) − COGS.
import { toDec, round2 } from '@/lib/utils/financialMath';

/**
 * NET (VAT-exclusive) revenue for a sale line. `lineTotal` is VAT-inclusive
 * gross; extract the VAT component at the line's own rate:
 *   net = lineTotal − lineTotal × taxRate / (100 + taxRate)
 * Rate 0 (exempt) → the line total as-is. VAT is owed to KRA, not revenue.
 */
const lineNetRevenue = (lineTotal: Parameters<typeof toDec>[0], taxRate: Parameters<typeof toDec>[0]) => {
  const gross = toDec(lineTotal);
  const rate = toDec(taxRate);
  if (rate.lte(0)) return gross;
  return gross.minus(gross.mul(rate).div(rate.plus(100)));
};

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

  // Group data by specified dimension — Decimal accumulators (Task 12-b:
  // was `grouped[key].subtotal += tx.subtotal` which STRING-CONCATENATED).
  // `total` remains the tax-inclusive tender per group (stored field basis);
  // the VAT-exclusive net is derived in the summary profit block below.
  type GroupKey = string;
  const grouped: Record<GroupKey, { count: number; subtotal: ReturnType<typeof toDec>; tax: ReturnType<typeof toDec>; discount: ReturnType<typeof toDec>; total: ReturnType<typeof toDec> }> = {};

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
      grouped[key] = { count: 0, subtotal: toDec(0), tax: toDec(0), discount: toDec(0), total: toDec(0) };
    }
    grouped[key].count += 1;
    grouped[key].subtotal = grouped[key].subtotal.plus(toDec(tx.subtotal));
    grouped[key].tax = grouped[key].tax.plus(toDec(tx.taxAmount));
    grouped[key].discount = grouped[key].discount.plus(toDec(tx.discountAmount));
    grouped[key].total = grouped[key].total.plus(toDec(tx.totalAmount));
  }

    const productSales: Record<string, { productName: string; sku: string; quantity: ReturnType<typeof toDec>; revenue: ReturnType<typeof toDec>; cost: ReturnType<typeof toDec>; profit: ReturnType<typeof toDec> }> = {};
  for (const item of transactionItems) {
    const key = item.productId;
    if (!productSales[key]) {
      productSales[key] = {
        productName: item.productName,
        sku: item.product.sku,
        quantity: toDec(0),
        revenue: toDec(0),
        cost: toDec(0),
        profit: toDec(0),
      };
    }
    // Task 12-b: Decimal-safe accumulation. Per-product revenue is the
    // VAT-exclusive net of the line; cost = costPrice × quantity. Discounts are
    // already embedded in lineTotal — never subtracted twice.
    const net = lineNetRevenue(item.lineTotal, item.taxRate);
    const cost = toDec(item.costPrice).mul(toDec(item.quantity));
    productSales[key].quantity = productSales[key].quantity.plus(toDec(item.quantity));
    productSales[key].revenue = productSales[key].revenue.plus(net);
    productSales[key].cost = productSales[key].cost.plus(cost);
    productSales[key].profit = productSales[key].revenue.minus(productSales[key].cost);
  }

    const categorySales: Record<string, { categoryName: string; quantity: ReturnType<typeof toDec>; revenue: ReturnType<typeof toDec> }> = {};
  for (const item of transactionItems) {
    const catId = item.product.categoryId || 'uncategorized';
    const catName = item.product.category?.name || 'Uncategorized';
    if (!categorySales[catId]) {
      categorySales[catId] = { categoryName: catName, quantity: toDec(0), revenue: toDec(0) };
    }
    categorySales[catId].quantity = categorySales[catId].quantity.plus(toDec(item.quantity));
    // VAT-exclusive net revenue per line (Task 12-b).
    categorySales[catId].revenue = categorySales[catId].revenue.plus(lineNetRevenue(item.lineTotal, item.taxRate));
  }

  const totalRevenue = toDec(summary._sum.totalAmount).toNumber();
  // Task 12-b: COGS = Σ(costPrice × quantity) accumulated in Decimal.
  const totalCostDec = Object.values(productSales).reduce(
    (acc, p) => acc.plus(p.cost),
    toDec(0),
  );
  // Net (VAT-exclusive) revenue over the FULL summary scope:
  // netRevenue = Σ(totalAmount) − Σ(taxAmount) — identical to Σ(tx.totalAmount −
  // tx.taxAmount) and computed over every matching transaction, not just the page.
  const netRevenue = toDec(summary._sum.totalAmount).minus(toDec(summary._sum.taxAmount));

    const paymentMethodMap: Record<string, { method: string; count: number; amount: ReturnType<typeof toDec> }> = {};
  for (const tx of transactions) {
    const method = tx.paymentMethod || 'CASH';
    if (!paymentMethodMap[method]) {
      paymentMethodMap[method] = { method, count: 0, amount: toDec(0) };
    }
    paymentMethodMap[method].count += 1;
    // TENDER per method (tax-inclusive) by design — money collected, not revenue.
    paymentMethodMap[method].amount = paymentMethodMap[method].amount.plus(toDec(tx.totalAmount));
  }
  const byPaymentMethod = Object.values(paymentMethodMap).map((row) => ({
    method: row.method,
    count: row.count,
    amount: row.amount.toNumber(),
  }));

  return Response.json({
    success: true,
    data: {
            period: `${dateFrom} to ${dateTo}`,
      totalSales: totalRevenue,
      totalRevenue,
      totalTax: toDec(summary._sum.taxAmount).toNumber(),
      totalDiscount: toDec(summary._sum.discountAmount).toNumber(),
      transactionCount: summary._count,
      avgTransactionValue: toDec(summary._avg.totalAmount).toNumber(),
      byPaymentMethod,

            summary: {
        totalTransactions: summary._count,
        totalRevenue,
        totalSubtotal: toDec(summary._sum.subtotal).toNumber(),
        totalTax: toDec(summary._sum.taxAmount).toNumber(),
        totalDiscount: toDec(summary._sum.discountAmount).toNumber(),
        averageTransactionValue: toDec(summary._avg.totalAmount).toNumber(),
        // Task 12-b PROFIT FORMULA FIX: profit was Σ tax-INCLUSIVE totalAmount −
        // Σ(cost×qty), overstating profit by the whole VAT component. Now:
        //   netRevenue = Σ(totalAmount − taxAmount)   (VAT owed to KRA, not revenue)
        //   cogs       = Σ(costPrice × quantity)      (discounts already embedded
        //               in totalAmount — never subtracted twice)
        //   profit     = netRevenue − cogs; margin = profit / netRevenue × 100
        //               (0 when netRevenue ≤ 0; negative profit stays visible).
        grossProfit: round2(netRevenue.minus(totalCostDec)),
        profitMargin: netRevenue.gt(0) ? Math.round(netRevenue.minus(totalCostDec).div(netRevenue).mul(100).toNumber() * 100) / 100 : 0,
      },
      grouped: Object.entries(grouped).map(([key, values]) => ({
        key,
        count: values.count,
        subtotal: values.subtotal.toNumber(),
        tax: values.tax.toNumber(),
        discount: values.discount.toNumber(),
        total: values.total.toNumber(),
      })),
      byProduct: Object.values(productSales)
        .map((p) => ({
          productName: p.productName,
          sku: p.sku,
          quantity: p.quantity.toNumber(),
          revenue: round2(p.revenue),
          cost: round2(p.cost),
          profit: round2(p.profit),
        }))
        .sort((a, b) => b.revenue - a.revenue),
      byCategory: Object.values(categorySales)
        .map((c) => ({
          categoryName: c.categoryName,
          quantity: c.quantity.toNumber(),
          revenue: round2(c.revenue),
        }))
        .sort((a, b) => b.revenue - a.revenue),
      transactions,
    },
    pagination: {
      page,
      limit,
    },
  });
}

export const GET = withErrorBoundary(withSessionAuth(getSalesReportHandler, FINANCIAL_ROLES.READ), 'REPORTS_SALES');
