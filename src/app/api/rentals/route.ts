// Rentals Expert module.
// GET  /api/rentals → fleet list + utilization (public read)
// POST /api/rentals → rent out an item (auth required)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, clientIp } from "@/lib/auth-utils";
import { rateLimit } from "@/lib/auth/rateLimit";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rentals = await db.rental.findMany({
      orderBy: { rentOutAt: "desc" },
      include: { customer: { select: { name: true } }, branch: { select: { name: true, code: true } } },
    });
    const active = rentals.filter((r) => r.status === "ACTIVE").length;
    const overdue = rentals.filter((r) => r.status === "OVERDUE").length;
    return NextResponse.json({
      ok: true,
      stats: { active, overdue, returned: rentals.filter((r) => r.status === "RETURNED").length, utilizationPct: Math.min(100, Math.round(((active + overdue) / Math.max(rentals.length, 1)) * 100)) },
      items: rentals.map((r) => ({
        id: r.id, item: r.itemDescription, branch: r.branch.name, customer: r.customer?.name ?? "Walk-in",
        qty: r.qty, dailyRate: Number(r.dailyRate), deposit: Number(r.deposit), damageFee: Number(r.damageFee),
        status: r.status, rentOutAt: r.rentOutAt, expectedReturnAt: r.expectedReturnAt, returnedAt: r.returnedAt,
      })),
    });
  } catch (err) {
    console.error("[rentals] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load rentals" }, { status: 500 });
  }
}

const postSchema = z.object({
  branchId: z.string().min(1),
  itemDescription: z.string().min(2).max(200),
  customerId: z.string().nullish(),
  qty: z.number().int().min(1).max(100).default(1),
  dailyRate: z.number().min(1),
  deposit: z.number().min(0).default(0),
  days: z.number().int().min(1).max(365).default(7),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const rl = rateLimit(`rentals:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
    if (!rl.allowed) return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid rental payload" }, { status: 400 });
    const d = parsed.data;
    const rental = await db.rental.create({
      data: {
        branchId: d.branchId, customerId: d.customerId ?? null, itemDescription: d.itemDescription,
        qty: d.qty, dailyRate: d.dailyRate.toFixed(2), deposit: d.deposit.toFixed(2),
        status: "ACTIVE", rentOutAt: new Date(), expectedReturnAt: new Date(Date.now() + d.days * 86_400_000),
      },
    });
    await audit({ userId: user.id, action: "RENT_OUT", entity: "Rental", entityId: rental.id, meta: { item: d.itemDescription }, ip: clientIp(req) });
    return NextResponse.json({ ok: true, rental });
  } catch (err) {
    console.error("[rentals] create failed", err);
    return NextResponse.json({ ok: false, error: "Failed to create rental" }, { status: 500 });
  }
}
