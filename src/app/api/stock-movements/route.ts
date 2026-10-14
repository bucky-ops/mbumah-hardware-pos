// Stock movements.
// GET  /api/stock-movements → ledger (public read)
// POST /api/stock-movements → record IN/OUT/ADJUST + sync product qty (auth)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const branchId = req.nextUrl.searchParams.get("branchId");
    const movements = await db.stockMovement.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { product: { select: { name: true, sku: true } }, branch: { select: { name: true, code: true } } },
    });
    return NextResponse.json({
      ok: true,
      items: movements.map((m) => ({
        id: m.id, product: m.product.name, sku: m.product.sku, branch: m.branch.name,
        type: m.type, qty: Number(m.qty), balanceAfter: m.balanceAfter ? Number(m.balanceAfter) : null,
        reason: m.reason, userName: m.userName, createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error("[stock-movements] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load stock movements" }, { status: 500 });
  }
}

const postSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().min(1),
  type: z.enum(["IN", "OUT", "ADJUST", "RETURN", "WRITE_OFF"]),
  qty: z.number(),
  reason: z.string().min(3).max(300),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const d = parsed.data;
    const product = await db.product.findUnique({ where: { id: d.productId } });
    if (!product) return NextResponse.json({ ok: false, error: "Product not found" }, { status: 404 });
    const signed = d.type === "IN" || d.type === "RETURN" ? Math.abs(d.qty) : d.type === "ADJUST" ? d.qty : -Math.abs(d.qty);
    const newQty = Math.round((Number(product.stockQty) + signed) * 1000) / 1000;
    if (newQty < 0) return NextResponse.json({ ok: false, error: "Adjustment would take stock negative" }, { status: 400 });
    await db.product.update({ where: { id: d.productId }, data: { stockQty: newQty.toFixed(3) } });
    const movement = await db.stockMovement.create({
      data: {
        branchId: d.branchId, productId: d.productId, type: d.type, qty: signed.toFixed(3),
        balanceAfter: newQty.toFixed(3), reason: d.reason, userId: user.id, userName: user.name,
      },
    });
    await audit({ userId: user.id, action: "STOCK_ADJUST", entity: "Product", entityId: d.productId, meta: { type: d.type, qty: signed }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, movement: { id: movement.id }, newQty });
  } catch (err) {
    console.error("[stock-movements] create failed", err);
    return NextResponse.json({ ok: false, error: "Failed to record movement" }, { status: 500 });
  }
}
