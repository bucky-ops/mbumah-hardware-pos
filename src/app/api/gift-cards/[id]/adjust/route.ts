// POST /api/gift-cards/[id]/adjust — manual balance adjustment (audit-logged).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  delta: z.number().refine((v) => v !== 0, "delta must be non-zero"),
  reason: z.string().min(3).max(300),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const { id } = await ctx.params;
    const card = await db.giftCard.findUnique({ where: { id } });
    if (!card) return NextResponse.json({ ok: false, error: "Gift card not found" }, { status: 404 });
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const newBalance = Math.round((Number(card.balance) + parsed.data.delta) * 100) / 100;
    if (newBalance < 0) return NextResponse.json({ ok: false, error: "Adjustment would overdraw card" }, { status: 400 });
    await db.giftCard.update({ where: { id }, data: { balance: newBalance.toFixed(2) } });
    await audit({ userId: user.id, action: "GIFT_CARD_ADJUST", entity: "GiftCard", entityId: id, meta: { delta: parsed.data.delta, reason: parsed.data.reason, newBalance }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error("[gift-cards/adjust] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to adjust gift card" }, { status: 500 });
  }
}
