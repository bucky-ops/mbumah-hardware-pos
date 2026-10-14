// Suppliers Expert module.
// GET  /api/suppliers → profiles + performance scores (public read)
// POST /api/suppliers → register supplier (MANAGER+)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [suppliers, pos] = await Promise.all([
      db.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { purchaseOrders: true } } } }),
      db.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { supplier: { select: { name: true } } } }),
    ]);
    return NextResponse.json({
      ok: true,
      items: suppliers.map((s) => ({
        id: s.id, name: s.name, category: s.category, contactName: s.contactName,
        leadTimeDays: s.leadTimeDays, onTimeRate: s.onTimeRate, fulfillmentScore: s.fulfillmentScore,
        openPOs: s._count.purchaseOrders, isActive: s.isActive,
      })),
      purchaseOrders: pos.map((p) => ({ id: p.id, number: p.number, supplier: p.supplier.name, status: p.status, total: Number(p.total), expectedAt: p.expectedAt })),
    });
  } catch (err) {
    console.error("[suppliers] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load suppliers" }, { status: 500 });
  }
}

const postSchema = z.object({
  name: z.string().min(2).max(120),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  category: z.string().max(60).optional(),
  leadTimeDays: z.number().int().min(0).max(120).default(7),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user || !roleAtLeast(user.role as never, "MANAGER")) {
      return NextResponse.json({ ok: false, error: "Forbidden: requires MANAGER role" }, { status: 403 });
    }
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const supplier = await db.supplier.create({ data: parsed.data });
    await audit({ userId: user.id, action: "SUPPLIER_CREATE", entity: "Supplier", entityId: supplier.id, meta: { name: supplier.name }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, supplier });
  } catch (err) {
    console.error("[suppliers] create failed", err);
    return NextResponse.json({ ok: false, error: "Failed to create supplier" }, { status: 500 });
  }
}
