// Global chat — org-wide + per-branch messages.
// GET  /api/chat        → last 100 messages (public read; console drawer)
// POST /api/chat        → post a message (demo-open but rate limited 10/5min
//                         per IP; audit-logged as GUEST when no session).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { rateLimit, clientIp } from "@/lib/auth/rateLimit";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  content: z.string().min(1).max(2000),
  branchId: z.string().nullish(),
});

export async function GET(req: NextRequest) {
  try {
    const branchId = req.nextUrl.searchParams.get("branchId");
    const messages = await db.chatMessage.findMany({
      where: branchId ? { OR: [{ branchId: null }, { branchId }] } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ ok: true, messages: messages.reverse() });
  } catch (err) {
    console.error("[chat] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load chat" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`chat:${clientIp(req)}`, { limit: 10, windowMs: 5 * 60_000 });
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: "Too many messages. Slow down." }, { status: 429 });
    }
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid message" }, { status: 400 });
    }
    const user = await getSessionUser(req);
    const msg = await db.chatMessage.create({
      data: {
        branchId: parsed.data.branchId ?? null,
        userId: user?.id ?? null,
        userName: user?.name ?? "Guest",
        userRole: user?.role ?? "GUEST",
        content: parsed.data.content,
      },
    });
    return NextResponse.json({ ok: true, message: msg });
  } catch (err) {
    console.error("[chat] post failed", err);
    return NextResponse.json({ ok: false, error: "Failed to post message" }, { status: 500 });
  }
}
