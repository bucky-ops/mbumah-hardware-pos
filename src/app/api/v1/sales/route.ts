import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-error-handler";
import { requireAuth, assertTargetBranch } from "@/lib/api/guard";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sales — recent sales feed for the POS/EOD surfaces.
//
// Query: ?limit (default 20, max 100) · ?branchId (non-OWNERs are forced to
// their own branch) · ?status (COMPLETED|CREDIT|PARTIAL|HELD).
// Decimal money is serialized as strings (the wire contract of this project).
// ─────────────────────────────────────────────────────────────────────────────

const STATUSES = ["COMPLETED", "CREDIT", "PARTIAL", "HELD"] as const;

export const GET = withErrorHandler(async (req: Request) => {
  const user = await requireAuth(req as NextRequest);

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 20;

  const branchIdParam = url.searchParams.get("branchId");
  assertTargetBranch(user, branchIdParam);
  // Non-OWNERs can never leave their own branch, even by omitting the filter.
  const branchId = user.role === "OWNER" ? (branchIdParam ?? undefined) : user.branchId;

  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && (STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined;

  const transactions = await db.transaction.findMany({
    where: { branchId, status },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      ref: true,
      status: true,
      totalAmount: true,
      amountPaid: true,
      balanceDue: true,
      createdAt: true,
      customer: { select: { name: true } },
      user: { select: { name: true } },
      _count: { select: { items: true } },
      payments: { select: { method: true, amount: true }, orderBy: { receivedAt: "asc" } },
    },
  });

  return NextResponse.json({
    items: transactions.map((t) => ({
      id: t.id,
      ref: t.ref,
      status: t.status,
      totalAmount: String(t.totalAmount),
      amountPaid: String(t.amountPaid),
      balanceDue: String(t.balanceDue),
      createdAt: t.createdAt.toISOString(),
      customer: t.customer?.name ?? null,
      user: t.user.name,
      itemCount: t._count.items,
      payments: t.payments.map((p) => ({ method: p.method, amount: String(p.amount) })),
    })),
  });
});
