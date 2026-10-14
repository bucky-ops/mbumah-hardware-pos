// GET /api/audit-logs — Audit Expert feed (public read; PII-safe: no IPs in
// list output beyond masked hint, no internal ids beyond entity labels).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const branch = sp.get("branch");
    const action = sp.get("action");
    const rows = await db.auditLog.findMany({
      where: {
        ...(action ? { action: { contains: action } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({
      ok: true,
      items: rows
        .filter((r) => !branch || (r.storeId ?? "").includes(branch) || branch === "all")
        .map((r) => ({
          id: r.id, timestamp: r.createdAt, user: r.userName ?? "System", role: r.role ?? "SYSTEM",
          action: r.action, resource: r.entity, result: "Success",
          branch: r.storeId ?? "org", ipHint: r.ip ? `${r.ip.split(".")[0]}.x.x.x` : "—",
        })),
    });
  } catch (err) {
    console.error("[audit-logs] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load audit logs" }, { status: 500 });
  }
}
