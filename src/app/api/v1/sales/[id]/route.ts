import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { decryptKraPin } from "@/lib/crypto";
import { db } from "@/lib/db";
import { round2 } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sales/[id] — single-sale receipt payload for REPRINT.
//
// Response = the eTIMS ReceiptData contract (src/lib/types.ts) plus two
// additive fields: `status` (list parity) and per-line `hsCode`. All Prisma
// Decimals are converted with Number(); money rounding mirrors the shared
// checkout receipt builder.
//
// BRANCH FENCE → 404, NOT 403: for a non-OWNER asking about another branch's
// sale we answer "Sale not found" so the endpoint never leaks the *existence*
// of records across branches (assertBranchAccess's 403 would confirm one).
//
// NOTE: `buildReceipt` in src/lib/sales/checkout-service.ts is module-private
// (and existing files are frozen), so the mapping below mirrors it exactly:
//   • cuSerial   = KRA_CU_SERIAL env ?? "MBM-CU-0001"  (same source as checkout)
//   • kraPin     = branch.kraPin ?? "P051234567X"
//   • buyerPin   = decryptKraPin(customer.kraPinEnc) — verbatim on the reprint
//     only (eTIMS tax-invoice requirement); directory APIs emit masked forms.
//   • taxCategories = distinct items.taxCategory joined "," (A=exempt / B=16%
//     is persisted per line at checkout, so no extra isTaxExempt logic needed)
//   • hsCodesSummary = distinct item product hsCodes joined "," (≤80 chars)
//   • grossSubtotal = round2(subtotal + discountAmount)
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_KRA_PIN = "P051234567X";
const FALLBACK_CU_SERIAL = "MBM-CU-0001";

// Same include shape as checkout-service's RECEIPT_INCLUDE, but the customer
// is narrowed to {name, kraPinEnc} (the only fields a receipt needs) and payments
// are ordered deterministically (receivedAt asc) for stable reprints.
export const GET = withErrorHandler(async (raw: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAuth(raw as NextRequest);
  const { id } = await ctx.params;

  const t = await db.transaction.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { hsCode: true } } } },
      payments: { orderBy: { receivedAt: "asc" } },
      branch: true,
      customer: { select: { name: true, kraPinEnc: true } },
      user: { select: { name: true } },
    },
  });

  if (!t) throw ApiError.notFound("Sale not found");
  if (t.branchId !== user.branchId && user.role !== "OWNER") {
    // Cross-branch probe → identical response to a missing id (no existence leak).
    throw ApiError.notFound("Sale not found");
  }

  const hsCodes = Array.from(
    new Set(t.items.map((i) => i.product?.hsCode).filter((c): c is string => !!c))
  )
    .join(",")
    .slice(0, 80);
  const taxCategories = Array.from(new Set(t.items.map((i) => i.taxCategory))).join(",");

  return NextResponse.json({
    ref: t.ref,
    createdAt: t.createdAt.toISOString(),
    status: t.status,
    vatInclusive: t.vatInclusive,
    branchName: t.branch.name,
    branchLocation: t.branch.location,
    kraPin: t.branch.kraPin ?? FALLBACK_KRA_PIN,
    cashier: t.user.name,
    customerName: t.customer?.name ?? null,
    buyerPin: decryptKraPin(t.customer?.kraPinEnc) ?? null,
    invoiceNumber: t.ref,
    cuSerial: process.env.KRA_CU_SERIAL ?? FALLBACK_CU_SERIAL,
    lines: t.items.map((i) => ({
      description: i.description,
      qty: Number(i.qty),
      uom: i.uom,
      unitPrice: Number(i.unitPrice),
      discountPct: Number(i.discountPct),
      lineNet: Number(i.lineNet),
      vatAmount: Number(i.vatAmount),
      hsCode: i.product?.hsCode ?? null,
    })),
    grossSubtotal: round2(Number(t.subtotal) + Number(t.discountAmount)),
    discount: Number(t.discountAmount),
    vat: Number(t.vatAmount),
    total: Number(t.totalAmount),
    payments: t.payments.map((p) => ({
      method: p.method as PaymentMethod,
      amount: Number(p.amount),
      reference: p.reference,
    })),
    balance: Number(t.balanceDue),
    taxCategories,
    hsCodesSummary: hsCodes,
  });
});
