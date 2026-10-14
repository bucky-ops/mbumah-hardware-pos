// GET /api/transactions/[id] — full sale detail (public read, masked customer).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const tx = await db.transaction.findUnique({
      where: { id },
      include: {
        branch: { select: { name: true, code: true, kraPin: true } },
        user: { select: { name: true } },
        customer: { select: { name: true } },
        items: true,
        payments: true,
      },
    });
    if (!tx) return NextResponse.json({ ok: false, error: "Transaction not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      transaction: {
        id: tx.id, ref: tx.ref, branch: tx.branch.name, cashier: tx.user.name,
        customer: tx.customer?.name ?? "Walk-in", status: tx.status,
        subtotal: Number(tx.subtotal), vat: Number(tx.vatAmount), total: Number(tx.totalAmount),
        vatInclusive: tx.vatInclusive,
        items: tx.items.map((i) => ({ description: i.description, uom: i.uom, qty: Number(i.qty), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) })),
        payments: tx.payments.map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
        createdAt: tx.createdAt,
      },
    });
  } catch (err) {
    console.error("[transactions/detail] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load transaction" }, { status: 500 });
  }
}
