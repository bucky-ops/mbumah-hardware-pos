// GET /api/transactions/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getTransactionHandler(...args: unknown[]): Promise<Response> {
  const _request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const transaction = await db.salesTransaction.findUnique({
    where: { id },
    include: {
      cashier: { select: { id: true, name: true, email: true, role: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              unitType: true,
              imageUrl: true,
              isRental: true,
            },
          },
        },
      },
      payments: true,
      debtLedgers: {
        include: {
          debtPayments: true,
        },
      },
      receipt: true,
    },
  });

  if (!transaction) {
    return Response.json(
      { success: false, error: 'Transaction not found.' },
      { status: 404 }
    );
  }

    const totalCost = transaction.items.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0);
  const grossProfit = transaction.subtotal - totalCost;
  const profitMargin = transaction.subtotal > 0 ? (grossProfit / transaction.subtotal) * 100 : 0;

  return Response.json({
    success: true,
    data: {
      ...transaction,
      analytics: {
        totalCost,
        grossProfit,
        profitMargin: Math.round(profitMargin * 100) / 100,
        averageItemValue: transaction.items.length > 0
          ? transaction.totalAmount / transaction.items.length
          : 0,
      },
    },
  });
}

export const GET = withErrorBoundary(getTransactionHandler, 'TRANSACTION_DETAIL');
