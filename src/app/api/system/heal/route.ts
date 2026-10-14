// POST /api/system/heal — self-healing verification pass (audited).
// Recreates the engraved admin if missing/drifted + verifies org store.
// Dev: public. Production: SUPER_ADMIN only.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureEngravedAdmin } from "@/lib/engraved-admin";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (process.env.NODE_ENV === "production" && (!user || user.role !== "SUPER_ADMIN")) {
      return NextResponse.json({ ok: false, error: "SUPER_ADMIN required" }, { status: 403 });
    }
    const engraved = await ensureEngravedAdmin();
    const checks = {
      engravedAdmin: true,
      orgBranch: (await db.branch.count({ where: { isActive: true } })) > 0,
      schemaReachable: (await db.$queryRaw`SELECT 1`) !== undefined,
    };
    await db.systemLog.create({
      data: {
        level: engraved.created || engraved.repaired ? "WARN" : "INFO",
        component: "SystemHeal",
        message: engraved.created
          ? "Engraved admin was missing — recreated"
          : engraved.repaired
            ? "Engraved admin drifted — repaired"
            : "Engraved admin verified (self-healing OK)",
        metadata: JSON.stringify(checks),
      },
    });
    await audit({ userId: user?.id ?? null, action: "SYSTEM_HEAL", entity: "System", meta: { ...checks, engraved }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, checks, engraved, at: new Date().toISOString() });
  } catch (err) {
    console.error("[system/heal] failed", err);
    return NextResponse.json({ ok: false, error: "System heal failed" }, { status: 500 });
  }
}
