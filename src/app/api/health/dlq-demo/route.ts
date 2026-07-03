// GET /api/health/dlq-demo
//
// Phase 6 — Demonstrates the Dead Letter Queue lifecycle.
//
// This is a PUBLIC health endpoint (no auth required) that creates
// synthetic DLQ items and returns their state for observability.
//
// Query params:
//   ?failCount=3        — number of DLQ items to create (default 3, max 10)
//   ?operationType=SEND_SMS — operation type for the items
//   ?processNow=0       — if 1, also run one processor cycle (default 0)
//
// Example:
//   curl /api/health/dlq-demo?failCount=3&operationType=SEND_SMS
//
// Response (200):
//   {
//     "success": true,
//     "data": {
//       "createdCount": 3,
//       "operationType": "SEND_SMS",
//       "items": [...],
//       "metrics": { ... },
//       "processorResult": null  // or result if processNow=1
//     }
//   }

import { type NextRequest } from 'next/server';
import { successResponse } from '@/lib/api-response';
import { dlq, DLQOperationType } from '@/lib/dead-letter-queue';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── Valid operation types ─────────────────────────────────────────────────────
const VALID_OPERATION_TYPES = new Set<string>(Object.values(DLQOperationType));

/** Map operation type to a plausible target service name. */
function targetServiceForType(type: string): string {
  switch (type) {
    case 'SEND_SMS': return 'twilio-sms';
    case 'SEND_EMAIL': return 'resend-email';
    case 'SEND_WHATSAPP': return 'twilio-whatsapp';
    case 'MPESA_STK_PUSH': return 'mpesa-daraja';
    case 'WEBHOOK_DELIVERY': return 'generic-webhook';
    default: return 'unknown';
  }
}

/** Make a synthetic payload for the given operation type. */
function makePayload(type: string, index: number): string {
  switch (type) {
    case 'SEND_SMS':
      return JSON.stringify({ to: `+25471234567${index}`, message: `Test SMS #${index + 1} from DLQ demo` });
    case 'SEND_EMAIL':
      return JSON.stringify({ to: `test${index}@example.com`, subject: `DLQ Demo Email #${index + 1}`, html: '<p>Test</p>' });
    case 'SEND_WHATSAPP':
      return JSON.stringify({ to: `+25471234567${index}`, message: `WhatsApp test #${index + 1}` });
    case 'MPESA_STK_PUSH':
      return JSON.stringify({ phone: `25471234567${index}`, amount: 100 * (index + 1), accountReference: 'DLQ-DEMO', transactionDesc: 'Test' });
    case 'WEBHOOK_DELIVERY':
      return JSON.stringify({ url: 'https://httpbin.org/post', method: 'POST', body: JSON.stringify({ test: index }) });
    default:
      return JSON.stringify({ test: index, note: 'generic DLQ demo item' });
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;

  // ── Parse + validate query params ───────────────────────────────────────
  let operationType = url.searchParams.get('operationType') || DLQOperationType.SEND_SMS;
  if (!VALID_OPERATION_TYPES.has(operationType)) {
    operationType = DLQOperationType.SEND_SMS;
  }

  const failCount = Math.min(
    Math.max(1, parseInt(url.searchParams.get('failCount') || '3', 10)),
    10,
  );
  const processNow = url.searchParams.get('processNow') === '1';

  // ── Phase A: Create synthetic DLQ items ──────────────────────────────────
  const targetService = targetServiceForType(operationType);
  const createdItems: Array<{ id: string; operationType: string; targetService: string; status: string }> = [];

  for (let i = 0; i < failCount; i++) {
    const payload = makePayload(operationType, i);
    const syntheticError = new Error(`Simulated failure #${i + 1} for ${operationType}`);

    const id = await dlq.enqueue({
      operationType,
      targetService,
      payload,
      maxRetries: 2, // Low so items become DEAD quickly in demo
      priority: 10,
      error: syntheticError,
      metadata: {
        demo: true,
        itemIndex: i + 1,
      },
    });

    createdItems.push({ id, operationType, targetService, status: 'PENDING' });
  }

  // ── Phase B: Optionally run one processor cycle ──────────────────────────
  // When processNow=1, we force items to be immediately processable and
  // run one processor cycle. Without registered handlers, items with
  // unknown operation types will be marked DEAD. This demonstrates the
  // full lifecycle: PENDING → RETRYING → DEAD.
  //
  // For known types (SEND_SMS, etc.), the handler is registered if the
  // DLQ processor has been started at least once. In dev without real
  // credentials, the handler will fail and items will be re-queued or
  // marked DEAD.
  let processorResult = null;
  if (processNow) {
    try {
      // Force all created items to be immediately processable
      for (const item of createdItems) {
        await db.deadLetterQueue.update({
          where: { id: item.id },
          data: { nextRetryAt: new Date() },
        });
      }

      processorResult = await dlq.process({ maxItems: failCount });
    } catch (err) {
      processorResult = {
        error: err instanceof Error ? err.message : String(err),
        note: 'Processor cycle failed — this is expected if no handlers are registered or the target service is down.',
      };
    }
  }

  // ── Phase C: Get current metrics ────────────────────────────────────────
  const metrics = await dlq.getMetrics();

  return successResponse({
    createdCount: createdItems.length,
    operationType,
    targetService,
    processNow,
    items: createdItems,
    processorResult,
    metrics,
  });
}
