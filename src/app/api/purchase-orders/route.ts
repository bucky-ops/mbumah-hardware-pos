// Purchase orders.
// GET  /api/purchase-orders → list (public read)
// POST /api/purchase-orders → raise a PO (MANAGER+)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pos = await db.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: { supplier: { select: { name: true } }, branch: { select: { name: true, code: true } }, items: true },
    });
    return NextResponse.json({
      ok: true,
      items: pos.map((p) => ({
        id: p.id, number: p.number, supplier: p.supplier.name, branch: p.branch.name,
        status: p.status, total: Number(p.total), expectedAt: p.expectedAt, receivedAt: p.receivedAt,
        lines: p.items.length,
      })),
    });
  } catch (err) {
    console.error("[purchase-orders] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load purchase orders" }, { status: 500 });
  }
}

const postSchema = z.object({
  branchId: z.string().min(1),
  supplierId: z.string().min(1),
  description: z.string().min(2).max(200),
  qty: z.number().min(1),
  unitCost: z.number().min(1),
  expectedInDays: z.number().int().min(1).max(180).default(7),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user || !roleAtLeast(user.role as never, "MANAGER")) {
      return NextResponse.json({ ok: false, error: "Forbidden: requires MANAGER role" }, { status: 403 });
    }
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const d = parsed.data;
    const seq = (await db.purchaseOrder.count()) + 1;
    const po = await db.purchaseOrder.create({
      data: {
        branchId: d.branchId, supplierId: d.supplierId, number: `PO-${new Date().getFullYear()}-${String(seq).padStart(3, "0")}`,
        status: "SENT", total: (d.qty * d.unitCost).toFixed(2), expectedAt: new Date(Date.now() + d.expectedInDays * 86_400_000),
        items: { create: { description: d.description, qty: d.qty.toFixed(2), unitCost: d.unitCost.toFixed(2) } },
      },
    });
    await audit({ userId: user.id, action: "PO_CREATE", entity: "PurchaseOrder", entityId: po.id, meta: { number: po.number, total: d.qty * d.unitCost }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, po: { id: po.id, number: po.number } });
  } catch (err) {
    console.error("[purchase-orders] create failed", err);
    return NextResponse.json({ ok: false, error: "Failed to create purchase order" }, { status: 500 });
  }
}
