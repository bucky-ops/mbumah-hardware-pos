// GET /api/receipts

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

async function getReceiptsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const transactionId = searchParams.get('transactionId') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const where: Record<string, unknown> = { storeId };

  if (transactionId) {
    where.transactionId = transactionId;
  }

  const [receipts, total] = await Promise.all([
    db.receipt.findMany({
      where,
      include: {
        transaction: {
          select: {
            id: true,
            receiptNumber: true,
            subtotal: true,
            taxAmount: true,
            discountAmount: true,
            totalAmount: true,
            paymentMethod: true,
            paymentStatus: true,
            transactionType: true,
            createdAt: true,
            cashier: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true, phone: true } },
            items: {
              select: {
                id: true,
                productName: true,
                quantity: true,
                unitType: true,
                pricePerUnit: true,
                lineTotal: true,
                discountPercent: true,
                taxRate: true,
              },
            },
            payments: {
              select: {
                id: true,
                paymentMethod: true,
                amount: true,
                status: true,
                reference: true,
                processedAt: true,
              },
            },
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            location: true,
            phone: true,
            email: true,
            address: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.receipt.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: receipts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export const GET = withErrorBoundary(getReceiptsHandler, 'RECEIPTS_LIST');
