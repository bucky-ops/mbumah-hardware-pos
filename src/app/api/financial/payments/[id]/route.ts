// PUT /api/financial/payments/[id] - Void a payment

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function voidPaymentHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.payment.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Payment not found.' },
      { status: 404 }
    );
  }

  if (existing.status === 'REFUNDED') {
    return Response.json(
      { success: false, error: 'Payment is already refunded/voided.' },
      { status: 400 }
    );
  }

  if (existing.status === 'FAILED') {
    return Response.json(
      { success: false, error: 'Cannot void a failed payment.' },
      { status: 400 }
    );
  }

  const payment = await db.payment.update({
    where: { id },
    data: { status: 'REFUNDED' },
  });

  await systemLog({
    action: 'PAYMENT_VOIDED',
    component: LogComponent.PAYMENT,
    severity: LogSeverity.WARN,
    message: `Payment ${id} voided/refunded (KES ${existing.amount}, ${existing.paymentMethod})`,
    storeId: existing.storeId,
    metadata: {
      paymentId: id,
      amount: existing.amount,
      paymentMethod: existing.paymentMethod,
      transactionId: existing.transactionId,
    },
  });

  return Response.json({
    success: true,
    message: 'Payment voided successfully.',
    data: payment,
  });
}

export const PUT = withErrorBoundary(voidPaymentHandler, 'PAYMENT_VOID');
