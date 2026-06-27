// POST /api/transactions/[id]/distribute-receipt
//
// Distributes a sales receipt to a customer via Email (Resend) or WhatsApp
// (Twilio). Requires authentication; any authenticated user with transaction
// read access may send a receipt (cashiers commonly email receipts at POS).
//
// Body:
//   {
//     "channel": "EMAIL" | "WHATSAPP",
//     "email"?:   "customer@example.com",   // required if channel=EMAIL and customer has no email
//     "phone"?:   "+254712345678",          // required if channel=WHATSAPP and customer has no phone
//     "customMessage"?: "Thank you!"
//   }
//
// Returns:
//   200 { success: true, data: DistributionResult }
//   400 { success: false, error: "..." }  — missing recipient
//   404 { success: false, error: "..." }  — transaction not found
//   500 { success: false, error: "..." }  — provider failure

import { type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withErrorBoundary } from "@/lib/logger";
import { LogComponent } from "@/lib/types";
import { distributeReceipt } from "@/lib/receipt-distribution";
import { APIError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function distributeReceiptHandler(
  request: NextRequest,
  session: { userId: string; storeId: string | null; role: string; email: string },
  ...rest: unknown[]
): Promise<Response> {
  const context = rest[0] as RouteContext;
  const { id: transactionId } = await context.params;

  const body = await request.json();
  const { channel, email, phone, customMessage } = body as {
    channel?: "EMAIL" | "WHATSAPP";
    email?: string;
    phone?: string;
    customMessage?: string;
  };

  if (!channel || (channel !== "EMAIL" && channel !== "WHATSAPP")) {
    return Response.json(
      { success: false, error: "channel must be 'EMAIL' or 'WHATSAPP'." },
      { status: 400 },
    );
  }

  // The storeId comes from the session (non-SUPER_ADMIN) or must be provided
  // in the body for SUPER_ADMIN cross-store access.
  const storeId = session.storeId ?? body.storeId;
  if (!storeId) {
    return Response.json(
      { success: false, error: "storeId could not be determined from the session." },
      { status: 400 },
    );
  }

  try {
    const result = await distributeReceipt({
      transactionId,
      channel,
      email,
      phone,
      customMessage,
      userId: session.userId,
      storeId,
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return Response.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json(
        { success: false, error: error.message },
        { status: error.statusCode },
      );
    }
    // Distinguish "not found" (404) from true server errors (500).
    const msg = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(msg) ? 404 : 500;
    return Response.json({ success: false, error: msg }, { status });
  }
}

export const POST = withErrorBoundary(
  requireAuth(distributeReceiptHandler),
  LogComponent.FINANCIAL,
);
