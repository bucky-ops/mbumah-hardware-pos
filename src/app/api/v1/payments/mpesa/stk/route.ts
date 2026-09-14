import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { db } from "@/lib/db";
import { initiateStkPush, isMockMode } from "@/lib/mpesa/daraja";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/payments/mpesa/stk — initiate an STK push (or its mock).
//
// Body: { phone: ^(\+?254|0)(7|1)\d{8}$, amount > 0, transactionId?, planId?,
//         purpose: "SALE" | "DEBT_REPAYMENT" (default SALE) }
// Phone is normalized to 2547XXXXXXXX before persistence/Daraja.
//
// Mock mode  → row status AWAITING_PIN + checkoutRequestId WSMOCK_xxxxxxxx;
//              { checkoutRequestId, mock: true }
// Real mode  → Daraja initiateStkPush, row status INITIATED;
//              { checkoutRequestId, mock: false }
// ─────────────────────────────────────────────────────────────────────────────

const stkSchema = z.object({
  phone: z.string().regex(/^(\+?254|0)(7|1)\d{8}$/, "Invalid Kenyan phone number"),
  amount: z.coerce.number().positive(),
  transactionId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
  purpose: z.enum(["SALE", "DEBT_REPAYMENT"]).default("SALE"),
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/^\+/, "");
  return digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
}

function mockRequestId(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += charset[Math.floor(Math.random() * charset.length)];
  return `WSMOCK_${suffix}`;
}

export const POST = withErrorHandler(async (req: Request) => {
  await requireAuth(req as NextRequest);

  const json: unknown = await req.json().catch(() => null);
  const parsed = stkSchema.safeParse(json);
  if (!parsed.success) throw parsed.error;

  const phone = normalizePhone(parsed.data.phone);
  const { amount, transactionId, planId, purpose } = parsed.data;

  if (isMockMode()) {
    const checkoutRequestId = mockRequestId();
    await db.mpesaTransaction.create({
      data: {
        checkoutRequestId,
        phone,
        amount,
        purpose,
        planId: planId ?? null,
        transactionId: transactionId ?? null,
        status: "AWAITING_PIN", // the mock status endpoint "enters the PIN" after 6s
      },
    });
    return NextResponse.json({ checkoutRequestId, mock: true });
  }

  const push = await initiateStkPush({
    phone,
    amount,
    ref: transactionId ?? "MBUMAH-POS",
    purpose,
  });
  await db.mpesaTransaction.create({
    data: {
      checkoutRequestId: push.checkoutRequestId,
      merchantRequestId: push.merchantRequestId,
      phone,
      amount,
      purpose,
      planId: planId ?? null,
      transactionId: transactionId ?? null,
      status: "INITIATED",
    },
  });
  return NextResponse.json({ checkoutRequestId: push.checkoutRequestId, mock: false });
});
