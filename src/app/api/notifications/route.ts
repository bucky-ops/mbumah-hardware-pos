// GET   /api/notifications → recent notifications + unread count (public read)
// PATCH /api/notifications → mark all read (any authenticated user)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [items, unread] = await Promise.all([
      db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      db.notification.count({ where: { read: false } }),
    ]);
    return NextResponse.json({ ok: true, items, unread });
  } catch (err) {
    console.error("[notifications] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load notifications" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    await db.notification.updateMany({ where: { read: false }, data: { read: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[notifications] mark-read failed", err);
    return NextResponse.json({ ok: false, error: "Failed to mark read" }, { status: 500 });
  }
}
