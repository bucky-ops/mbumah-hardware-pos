// POST /api/rentals/[id]/return — record a return (+ optional damage fee).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, clientIp } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ damageFee: z.number().min(0).max(1_000_000).default(0), note: z.string().max(500).optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const { id } = await ctx.params;
    const rental = await db.rental.findUnique({ where: { id } });
    if (!rental) return NextResponse.json({ ok: false, error: "Rental not found" }, { status: 404 });
    if (rental.status === "RETURNED") return NextResponse.json({ ok: false, error: "Rental already returned" }, { status: 400 });
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const updated = await db.rental.update({
      where: { id },
      data: { status: "RETURNED", returnedAt: new Date(), damageFee: parsed.data.damageFee.toFixed(2), notes: parsed.data.note ?? rental.notes },
    });
    await audit({ userId: user.id, action: "RENTAL_RETURN", entity: "Rental", entityId: id, meta: { damageFee: parsed.data.damageFee }, ip: clientIp(req) });
    return NextResponse.json({ ok: true, rental: updated });
  } catch (err) {
    console.error("[rentals/return] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to record return" }, { status: 500 });
  }
}
