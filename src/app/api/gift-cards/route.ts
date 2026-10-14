// Gift cards.
// GET  /api/gift-cards → list (public read; codes partially masked)
// POST /api/gift-cards → issue (auth)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cards = await db.giftCard.findMany({ orderBy: { issuedAt: "desc" } });
    return NextResponse.json({
      ok: true,
      items: cards.map((c) => ({
        id: c.id, codeMasked: c.code.slice(0, 8) + "—" + c.code.slice(-3), branchId: c.branchId,
        initialAmount: Number(c.initialAmount), balance: Number(c.balance), status: c.status, issuedAt: c.issuedAt, expiresAt: c.expiresAt,
      })),
    });
  } catch (err) {
    console.error("[gift-cards] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load gift cards" }, { status: 500 });
  }
}

const postSchema = z.object({
  branchId: z.string().min(1),
  amount: z.number().min(100).max(1_000_000),
  expiresInDays: z.number().int().min(1).max(730).default(365),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const code = `MBH-GC-${Math.floor(1000 + Math.random() * 8999)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const card = await db.giftCard.create({
      data: {
        code, branchId: parsed.data.branchId, initialAmount: parsed.data.amount.toFixed(2),
        balance: parsed.data.amount.toFixed(2), issuedByName: user.name,
        expiresAt: new Date(Date.now() + parsed.data.expiresInDays * 86_400_000),
      },
    });
    await audit({ userId: user.id, action: "GIFT_CARD_ISSUE", entity: "GiftCard", entityId: card.id, meta: { amount: parsed.data.amount }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, card: { id: card.id, code, balance: Number(card.balance) } });
  } catch (err) {
    console.error("[gift-cards] issue failed", err);
    return NextResponse.json({ ok: false, error: "Failed to issue gift card" }, { status: 500 });
  }
}
