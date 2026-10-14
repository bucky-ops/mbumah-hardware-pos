// GET /api/receipts/[id] — receipt detail (public read).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const receipt = await db.receipt.findUnique({
      where: { id },
      include: { branch: true, transaction: { include: { items: true, payments: true, user: { select: { name: true } } } } },
    });
    if (!receipt) return NextResponse.json({ ok: false, error: "Receipt not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      receipt: {
        id: receipt.id, number: receipt.number, branch: receipt.branch.name, kraPin: receipt.branch.kraPin,
        customer: receipt.customerName ?? "Walk-in", total: Number(receipt.total), smsStatus: receipt.smsStatus,
        transaction: receipt.transaction
          ? {
              ref: receipt.transaction.ref, cashier: receipt.transaction.user.name,
              items: receipt.transaction.items.map((i) => ({ description: i.description, qty: Number(i.qty), uom: i.uom, lineTotal: Number(i.lineTotal) })),
              payments: receipt.transaction.payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
            }
          : null,
        createdAt: receipt.createdAt,
      },
    });
  } catch (err) {
    console.error("[receipts/detail] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load receipt" }, { status: 500 });
  }
}
