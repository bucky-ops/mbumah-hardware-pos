// src/app/api/v1/documents/[id]/route.ts — document detail for the Documents
// tab (full line items, payments, lineage, allowed conversions).
//
// GET /api/v1/documents/{id}
// BOLA: the persisted row's branchId is checked with assertBranchAccess —
// a MANAGER/CASHIER can never read another branch's quotations, even by
// guessing ids (OWNERS may cross branches by design).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth } from "@/lib/api/guard";
import { getDocument } from "@/lib/documents/service";

export const GET = withErrorHandler(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const user = await requireAuth(req as NextRequest);
    const { id } = await ctx.params; // Next 16: params is a Promise

    const document = await getDocument(user, id);
    return NextResponse.json({ document });
  }
);
