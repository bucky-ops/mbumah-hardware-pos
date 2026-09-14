import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { checkoutBodySchema, processCheckout } from "@/lib/sales/checkout-service";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sales/sync — flush target for the offline order queue.
//
// Body: { orders: [{ clientId: string, ...checkoutBody }, ...] }
// Orders are processed SEQUENTIALLY (stock interlocks stay predictable). Each
// order is settled independently: business rejections (409 insufficient stock,
// 400 credit limit, …) are REPORTED per order — the batch itself still returns
// 200 so the client can drop exactly the orders that succeeded.
//
// IDEMPOTENCY: the idempotency key for order N is `MBM-SYNC-<clientId>` —
// MBM-shaped, so it becomes the transaction ref and is stable across offline
// retries (a retried flush replays the original sale instead of duplicating it).
// ─────────────────────────────────────────────────────────────────────────────

const syncBodySchema = z.object({
  orders: z
    .array(
      z.object({
        clientId: z.string().min(1),
        ...checkoutBodySchema.shape,
      })
    )
    .min(1)
    .max(50),
});

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireAuth(req as NextRequest);

  const json: unknown = await req.json().catch(() => null);
  const parsed = syncBodySchema.safeParse(json);
  if (!parsed.success) throw parsed.error; // 400 with field issues

  const results: Array<
    | { clientId: string; ok: true; duplicate: boolean; transaction: unknown; receipt: unknown }
    | { clientId: string; ok: false; error: string }
  > = [];

  for (const order of parsed.data.orders) {
    try {
      const result = await processCheckout(user, order, `MBM-SYNC-${order.clientId}`);
      results.push({
        clientId: order.clientId,
        ok: true,
        duplicate: result.duplicate,
        transaction: result.transaction,
        receipt: result.receipt,
      });
    } catch (err) {
      // Business failures are reported, not thrown — the batch must complete.
      if (err instanceof ApiError) {
        results.push({ clientId: order.clientId, ok: false, error: err.message });
      } else {
        throw err; // unknown → whole request 500s via withErrorHandler
      }
    }
  }

  return NextResponse.json({ results });
});
