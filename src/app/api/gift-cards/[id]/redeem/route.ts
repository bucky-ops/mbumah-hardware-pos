// POST /api/gift-cards/[id]/redeem — spend part/all of a gift card balance.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ amount: z.number().min(1) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const { id } = await ctx.params;
    const card = await db.giftCard.findUnique({ where: { id } });
    if (!card) return NextResponse.json({ ok: false, error: "Gift card not found" }, { status: 404 });
    if (card.status !== "ACTIVE") return NextResponse.json({ ok: false, error: `Card is ${card.status}` }, { status: 400 });
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const balance = Number(card.balance);
    if (parsed.data.amount > balance) {
      return NextResponse.json({ ok: false, error: `Insufficient balance (KES ${balance.toLocaleString()})` }, { status: 400 });
    }
    const newBalance = Math.round((balance - parsed.data.amount) * 100) / 100;
    const updated = await db.giftCard.update({
      where: { id },
      data: { balance: newBalance.toFixed(2), status: newBalance === 0 ? "REDEEMED" : "ACTIVE", redeemedAt: newBalance === 0 ? new Date() : card.redeemedAt },
    });
    await audit({ userId: user.id, action: "GIFT_CARD_REDEEM", entity: "GiftCard", entityId: id, meta: { amount: parsed.data.amount, newBalance }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, balance: newBalance, status: updated.status });
  } catch (err) {
    console.error("[gift-cards/redeem] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to redeem gift card" }, { status: 500 });
  }
}
