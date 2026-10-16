// POST /api/payments/mpesa/b2c/queue-timeout - Daraja B2C queue timeout webhook.
//
// Daraja calls this when the B2C request could not be processed in time. The
// affected MpesaTransaction rows stay PROCESSING/PENDING - a timeout is NOT a
// failure (money may still move); ops reconciles via the M-Pesa portal and the
// result webhook may still arrive later. We log the event for observability.

import { type NextRequest } from 'next/server';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function b2cTimeoutHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  await systemLog({
    action: 'MPESA_B2C_QUEUE_TIMEOUT',
    component: LogComponent.PAYMENT,
    severity: LogSeverity.WARN,
    message: 'Daraja B2C queue timeout received; transaction left for reconciliation.',
    metadata: { body: JSON.stringify(body).slice(0, 500) },
  }).catch(() => {});
  return Response.json({ success: true });
}

export const POST = withErrorBoundary(b2cTimeoutHandler, 'MPESA_B2C_TIMEOUT');
