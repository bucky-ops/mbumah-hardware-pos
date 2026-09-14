// src/app/api/v1/documents/route.ts — Document & Workflow Correlation Engine
// list + creation endpoints.
//
// GET  /api/v1/documents?limit&type&status&branchId
//        → OPEN quotation/proforma/order pipeline for the Documents tab.
//        Non-OWNERs are force-scoped to their own branch (BOLA layer 2 on
//        every persisted row via listDocuments → service scope).
// POST /api/v1/documents — create a QUOTE or PROFORMA from product IDs.
//        Prices/tax/uom come from the server catalog only; totals computed by
//        the shared Decimal engine (discounts BEFORE 16% VAT).
//
// RBAC: any staff role may operate the document pipeline (it is a
// front-counter workflow). The mandated Cashier blocks (/api/users,
// /api/branches, /api/reports…) live in ROLE_ROUTE_POLICY and are untouched.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth, assertTargetBranch } from "@/lib/api/guard";
import { createDocument, listDocuments } from "@/lib/documents/service";
import { DOCUMENT_TYPES, type DocumentStatus, type DocumentType } from "@/lib/documents/types";

const LIST_TYPES: ReadonlySet<string> = new Set(DOCUMENT_TYPES);
const LIST_STATUSES: ReadonlySet<string> = new Set([
  "OPEN",
  "CONVERTED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
  "CREDIT",
  "PARTIAL",
]);

const createSchema = z.object({
  type: z.enum(["QUOTE", "PROFORMA"]),
  customerId: z.string().min(1).nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.number().positive("qty must be greater than 0"),
        discountPct: z.number().min(0).max(100).optional(),
      })
    )
    .min(1, "At least one line item is required"),
  vatInclusive: z.boolean().optional(),
  orderDiscountPct: z.number().min(0).max(100).optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const GET = withErrorHandler(async (req: Request) => {
  const user = await requireAuth(req as NextRequest);

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 50;

  const branchIdParam = url.searchParams.get("branchId");
  assertTargetBranch(user, branchIdParam); // BOLA hint check (query)
  // Non-OWNERs can never leave their own branch, even by omitting the filter.
  const branchId = user.role === "OWNER" ? (branchIdParam ?? undefined) : user.branchId;

  const typeParam = url.searchParams.get("type");
  const statusParam = url.searchParams.get("status");
  const type = typeParam && LIST_TYPES.has(typeParam) ? (typeParam as DocumentType) : undefined;
  const status =
    statusParam && LIST_STATUSES.has(statusParam) ? (statusParam as DocumentStatus) : undefined;

  const items = await listDocuments({ branchId, type, status, limit });
  return NextResponse.json({ items });
});

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireAuth(req as NextRequest);
  const body = createSchema.parse(await req.json());

  // Creator's branch is always the document's branch — no client branchId is
  // accepted on this write path, which makes BOLA moot here by construction.
  const document = await createDocument(user, {
    type: body.type,
    customerId: body.customerId ?? null,
    items: body.items.map((i) => ({
      productId: i.productId,
      qty: i.qty,
      discountPct: i.discountPct ?? 0,
    })),
    vatInclusive: body.vatInclusive ?? false, // documents default to EXCLUSIVE (B2B)
    orderDiscountPct: body.orderDiscountPct ?? 0,
    validUntil: body.validUntil ?? null,
    notes: body.notes ?? null,
  });

  return NextResponse.json({ document }, { status: 201 });
});
