// GET /api/system-logs — System Expert live feed (public read, capped).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const level = req.nextUrl.searchParams.get("level");
    const logs = await db.systemLog.findMany({
      where: level ? { level } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ ok: true, logs });
  } catch (err) {
    console.error("[system-logs] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load system logs" }, { status: 500 });
  }
}
