// GET /api/products/bundles — product bundles (public read).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bundles = await db.bundle.findMany({ where: { isActive: true }, include: { items: { include: { product: { select: { name: true, sku: true, sellingPrice: true } } } } } });
    return NextResponse.json({
      ok: true,
      items: bundles.map((b) => ({
        id: b.id, name: b.name, sku: b.sku, price: Number(b.price),
        items: b.items.map((i) => ({ name: i.product.name, sku: i.product.sku, qty: Number(i.qty), unitPrice: Number(i.product.sellingPrice) })),
      })),
    });
  } catch (err) {
    console.error("[bundles] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load bundles" }, { status: 500 });
  }
}
