import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { checkoutBodySchema, processCheckout } from "@/lib/sales/checkout-service";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sales/checkout — server-authoritative sale creation.
//
//  • Auth: session cookie (requireAuth) — no anonymous checkouts.
//  • Idempotency-Key header: uuid from the client. When it is MBM-shaped it
//    becomes the transaction ref and a retry returns the ORIGINAL sale
//    (offline-sync dedupe); otherwise a fresh MBM-<branch>-<ymd>-<rand> ref
//    is generated.
//  • Prices, tax flags and UoM are read from the DB, never from the body.
//  • STORE_CREDIT is hard-validated against the credit limit atomically.
//
// 201 → { transaction: { id, ref, status, totalAmount, balanceDue }, receipt,
//         riskScore? }  — riskScore (0–100, post-charge re-score) is present
//         ONLY when the sale charged STORE_CREDIT (additive key).
// 200 → { duplicate: true, transaction, receipt }  (idempotent replay)
//
// Task 20-b: the returned receipt carries an additive `transactionId` field
// (the server Transaction.id) so CheckoutReceipt can dispatch receipt SMS via
// POST /api/v1/sales/[id]/receipt-sms without further plumbing — the receipt
// object is what the cart store keeps as lastReceipt.
// ─────────────────────────────────────────────────────────────────────────────

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireAuth(req as NextRequest);

  const json: unknown = await req.json().catch(() => null);
  const parsed = checkoutBodySchema.safeParse(json);
  if (!parsed.success) throw parsed.error; // mapped to 400 + field issues

  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
  const result = await processCheckout(user, parsed.data, idempotencyKey);

  if (result.duplicate) {
    return NextResponse.json({
      duplicate: true,
      transaction: result.transaction,
      receipt: { ...result.receipt, transactionId: result.transaction.id },
    });
  }
  return NextResponse.json(
    {
      transaction: result.transaction,
      // Additive: the receipt is the object persisted as the till's
      // lastReceipt — stamping the transaction id here lets CheckoutReceipt
      // offer "Send via SMS" with zero extra prop plumbing.
      receipt: { ...result.receipt, transactionId: result.transaction.id },
      // Additive: only set when STORE_CREDIT was charged (service re-scored
      // the borrower's credit risk in the checkout transaction).
      ...(result.riskScore !== undefined ? { riskScore: result.riskScore } : {}),
    },
    { status: 201 }
  );
});
