// GET /api/reports/sales — sales report with trend + payment mix (public read).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 7), 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);
    const txns = await db.transaction.findMany({
      where: { type: "SALE", createdAt: { gte: since } },
      select: { subtotal: true, vatAmount: true, totalAmount: true, createdAt: true, branchId: true, payments: { select: { method: true, amount: true } } },
    });
    const byDay: Array<{ date: string; revenue: number; txns: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const dStart = new Date();
      dStart.setHours(0, 0, 0, 0);
      dStart.setTime(dStart.getTime() - i * 86_400_000);
      const dEnd = new Date(dStart.getTime() + 86_400_000);
      const dayTxns = txns.filter((t) => t.createdAt >= dStart && t.createdAt < dEnd);
      byDay.push({ date: dStart.toISOString().slice(0, 10), revenue: Math.round(dayTxns.reduce((a, t) => a + Number(t.subtotal), 0) * 100) / 100, txns: dayTxns.length });
    }
    const mix: Record<string, number> = {};
    for (const t of txns) for (const p of t.payments) mix[p.method] = (mix[p.method] ?? 0) + Number(p.amount);
    return NextResponse.json({
      ok: true, days,
      totals: { revenue: Math.round(txns.reduce((a, t) => a + Number(t.subtotal), 0) * 100) / 100, vat: Math.round(txns.reduce((a, t) => a + Number(t.vatAmount), 0) * 100) / 100, txns: txns.length },
      byDay, paymentMix: mix,
    });
  } catch (err) {
    console.error("[reports/sales] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to build sales report" }, { status: 500 });
  }
}
