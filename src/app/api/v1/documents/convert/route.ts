// src/app/api/v1/documents/convert/route.ts — THE workflow state transition
// endpoint (directive 2):
//
//   QUOTE ──→ PROFORMA ──→ ORDER ──→ SALE(invoice)
//
// The terminal SALE conversion is the money moment: in ONE atomic $transaction
// it re-prices from live products, creates the invoice, records payments,
// charges store credit behind the HARD credit-limit gate, deducts inventory
// via the guarded CAS decrement, and flips the source document to CONVERTED.
// PROFORMA/ORDER conversions are pure priced snapshots (no stock/credit).
//
// BOLA: source row branch-checked with assertBranchAccess (persisted row, not
// client hints). RBAC: any staff role (front-counter workflow).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { convertDocument } from "@/lib/documents/service";

const convertSchema = z
  .object({
    sourceId: z.string().min(1),
    targetType: z.enum(["PROFORMA", "ORDER", "SALE"]),
    validUntil: z.string().datetime({ offset: true }).nullable().optional(),
    paymentMethod: z.enum(["CASH", "MPESA", "BANK_TRANSFER"]).optional(),
    paymentAmount: z.number().min(0).optional(),
    useCredit: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // A partially-paid SALE conversion must not silently exceed the ticket:
    // the server caps paymentAmount at the grand total, but reject nonsense
    // (negative already handled by min(0)) and fully-paid + useCredit combos
    // that would double-count.
    if (v.targetType === "SALE" && v.useCredit && v.paymentAmount !== undefined) {
      // allowed — shortfall goes to credit; validated in the service against
      // the live total (client cannot know the re-priced total).
      void v;
    }
    if (v.targetType !== "SALE" && (v.useCredit || v.paymentMethod || v.paymentAmount)) {
      ctx.addIssue({
        code: "custom",
        path: ["targetType"],
        message: "Payment fields are only valid when converting to SALE",
      });
    }
  });

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireAuth(req as NextRequest);
  const body = convertSchema.parse(await req.json());

  const result = await convertDocument(user, {
    sourceId: body.sourceId,
    targetType: body.targetType,
    validUntil: body.validUntil ?? null,
    paymentMethod: body.paymentMethod,
    paymentAmount: body.paymentAmount,
    useCredit: body.useCredit ?? false,
    notes: body.notes ?? null,
  });

  return NextResponse.json(result, { status: 201 });
});
