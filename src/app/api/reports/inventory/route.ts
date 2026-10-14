// GET /api/reports/inventory — stock health report (public read).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await db.product.findMany({ where: { deletedAt: null }, select: { category: true, stockQty: true, reorderLevel: true, buyingPrice: true, sellingPrice: true } });
    const byCategory = new Map<string, { skus: number; stockValue: number; retailValue: number; low: number }>();
    for (const p of products) {
      const e = byCategory.get(p.category) ?? { skus: 0, stockValue: 0, retailValue: 0, low: 0 };
      e.skus++;
      e.stockValue += Number(p.stockQty) * Number(p.buyingPrice);
      e.retailValue += Number(p.stockQty) * Number(p.sellingPrice);
      if (Number(p.stockQty) <= Number(p.reorderLevel)) e.low++;
      byCategory.set(p.category, e);
    }
    const low = products.filter((p) => Number(p.stockQty) <= Number(p.reorderLevel)).length;
    return NextResponse.json({
      ok: true,
      totals: { skus: products.length, stockValue: Math.round(products.reduce((a, p) => a + Number(p.stockQty) * Number(p.buyingPrice), 0) * 100) / 100, retailValue: Math.round(products.reduce((a, p) => a + Number(p.stockQty) * Number(p.sellingPrice), 0) * 100) / 100, low },
      categories: [...byCategory.entries()].map(([category, v]) => ({ category, ...v, stockValue: Math.round(v.stockValue * 100) / 100, retailValue: Math.round(v.retailValue * 100) / 100 })).sort((a, b) => b.stockValue - a.stockValue),
    });
  } catch (err) {
    console.error("[reports/inventory] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to build inventory report" }, { status: 500 });
  }
}
