import { NextResponse, after } from "next/server";
import { z } from "zod";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { audit } from "@/lib/audit";
import { isMockMode, settleMpesa, stkQuery } from "@/lib/mpesa/daraja";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payments/mpesa/callback — Safaricom C2B STK webhook (HARDENED).
//
// THREAT MODEL — this endpoint is reachable from the public internet and the
// body is fully attacker-controlled. A forged "ResultCode: 0" callback must
// NEVER mark a payment as received. Three defensive layers:
//
//   1. SHARED SECRET — when MPESA_CALLBACK_TOKEN is configured, the header
//      `x-callback-token` must match, else 401. (Cheap pre-filter, NOT the
//      real defence — the token lives in env on the same host.)
//   2. IMMEDIATE ACK, NO TRUST — respond 200 {ResultCode: 0, ResultDesc:
//      "Accepted"} right away (Safaricom retries non-200s aggressively) and do
//      ALL verification inside after(), never trusting the payload.
//   3. DARAJA CROSS-VERIFICATION (the real defence) — before any DB write we
//      call stkQuery(checkoutRequestId), an authenticated query made WITH OUR
//      OWN credentials. Its ResultCode is the only trusted verdict; the
//      callback payload is treated as a hint (used only to carry the receipt
//      number, and as a last-resort fallback — clearly flagged verified:false
//      and audited — when Daraja itself is unreachable).
//
// Mock mode skips the network query (nothing to verify against) and settles
// directly from the payload.
// ─────────────────────────────────────────────────────────────────────────────

// Lenient parse: accept the documented Safaricom envelope without over-fitting.
const metadataItem = z.object({ Name: z.string(), Value: z.unknown().optional() });
const callbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string().min(1),
      ResultCode: z.coerce.number(),
      ResultDesc: z.string().optional(),
      CallbackMetadata: z
        .object({ Item: z.array(metadataItem).optional() })
        .optional(),
    }),
  }),
});

/** Extracts the M-Pesa receipt number from CallbackMetadata.Item[]. */
function extractReceipt(meta: z.infer<typeof metadataItem>[] | undefined): string | null {
  const item = meta?.find((i) => i.Name === "MpesaReceiptNumber");
  return item?.Value !== undefined && item.Value !== null ? String(item.Value) : null;
}

export const POST = withErrorHandler(async (req: Request) => {
  // Layer 1 — optional shared secret.
  const expectedToken = process.env.MPESA_CALLBACK_TOKEN;
  if (expectedToken && req.headers.get("x-callback-token") !== expectedToken) {
    throw ApiError.unauthorized("Invalid callback token");
  }

  const json: unknown = await req.json().catch(() => null);
  const parsed = callbackSchema.safeParse(json);
  if (!parsed.success) throw ApiError.badRequest("Unrecognized callback payload");

  const cb = parsed.data.Body.stkCallback;
  const receipt = extractReceipt(cb.CallbackMetadata?.Item);

  // Layer 2 — acknowledge immediately; verification continues after the
  // response has been flushed (Next.js `after()`).
  after(async () => {
    const settleArgs = {
      checkoutRequestId: cb.CheckoutRequestID,
      resultDesc: cb.ResultDesc ?? null,
      mpesaReceipt: receipt,
      merchantRequestId: cb.MerchantRequestID ?? null,
    };
    try {
      if (isMockMode()) {
        // Nothing to cross-verify offline — the payload IS the source of truth.
        await settleMpesa({ ...settleArgs, resultCode: cb.ResultCode, verified: true });
        return;
      }
      // Layer 3 — TRUST THE QUERY, not the payload. Authenticated with our
      // credentials; callbacks can be spoofed, this answer cannot (cheaply).
      const q = await stkQuery(cb.CheckoutRequestID);
      await settleMpesa({ ...settleArgs, resultCode: q.ResultCode, resultDesc: q.ResultDesc, verified: true });
    } catch (err) {
      // Daraja unreachable: settle from the payload but mark it UNVERIFIED and
      // leave an audit trail so reconciliation can re-check it later.
      await settleMpesa({ ...settleArgs, resultCode: cb.ResultCode, verified: false });
      await audit({
        action: "MPESA_VERIFY_FALLBACK",
        entity: "MpesaTransaction",
        entityId: cb.CheckoutRequestID,
        meta: {
          reason: "stkQuery failed during callback verification",
          error: err instanceof Error ? err.message : String(err),
          payloadResultCode: cb.ResultCode,
        },
      });
    }
  });

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
});
