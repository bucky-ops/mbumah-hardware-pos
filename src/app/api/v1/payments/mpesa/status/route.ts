import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { db } from "@/lib/db";
import { isMockMode, settleMpesa, stkQuery } from "@/lib/mpesa/daraja";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/payments/mpesa/status?checkoutRequestId=… — poll endpoint for the
// POS M-Pesa state machine (called every 2s from MPesaCheckoutModal).
//
//  • Mock mode:  age > 6s and unsettled → simulate the customer entering their
//    PIN (fake receipt Q#########, verified: true) and settle.
//  • Real mode:  age > 30s and unsettled → cross-check with Daraja stkQuery
//    (authenticated) and settle from the query result. Polls before that age
//    simply report the stored state — the callback webhook settles sooner in
//    the happy path.
//
// Response: { status, mpesaReceipt, resultDesc, amount (String), verified,
//             purpose, mock }
// ─────────────────────────────────────────────────────────────────────────────

/** Fake Safaricom-style receipt: Q + 9 digits (e.g. Q7H5VK2LM9 shape). */
function fakeReceipt(): string {
  return `Q${Math.floor(100_000_000 + Math.random() * 900_000_000)}`;
}

export const GET = withErrorHandler(async (req: Request) => {
  await requireAuth(req as NextRequest);

  const checkoutRequestId = new URL(req.url).searchParams.get("checkoutRequestId")?.trim();
  if (!checkoutRequestId) throw ApiError.badRequest("checkoutRequestId is required");

  const mock = isMockMode();
  let mpesa = await db.mpesaTransaction.findUnique({ where: { checkoutRequestId } });
  if (!mpesa) throw ApiError.notFound("M-Pesa transaction not found");

  const settled = mpesa.status === "SUCCESS" || mpesa.status === "FAILED";
  if (!settled) {
    const ageMs = Date.now() - mpesa.createdAt.getTime();

    if (mock && ageMs > 6_000) {
      // Simulated PIN entry — settle with a synthetic verified receipt.
      await settleMpesa({
        checkoutRequestId,
        resultCode: 0,
        resultDesc: "The service request is processed successfully.",
        mpesaReceipt: fakeReceipt(),
        verified: true,
      });
    } else if (!mock && ageMs > 30_000) {
      // Give the async callback a 30s head start, then poll Daraja ourselves.
      const q = await stkQuery(checkoutRequestId); // throws → 502, client retries next tick
      await settleMpesa({
        checkoutRequestId,
        resultCode: q.ResultCode,
        resultDesc: q.ResultDesc,
        verified: true,
      });
    }

    mpesa = await db.mpesaTransaction.findUniqueOrThrow({ where: { checkoutRequestId } });
  }

  return NextResponse.json({
    status: mpesa.status,
    mpesaReceipt: mpesa.mpesaReceipt,
    resultDesc: mpesa.resultDesc,
    amount: String(mpesa.amount),
    verified: mpesa.verified,
    purpose: mpesa.purpose,
    mock,
  });
});
