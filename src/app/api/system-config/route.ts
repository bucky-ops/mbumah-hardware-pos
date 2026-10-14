// GET /api/system-config  → org/system configuration (public read)
// PUT /api/system-config  → upsert keys (MANAGER+ required)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, clientIp } from "@/lib/auth-utils";
import { rateLimit } from "@/lib/auth/rateLimit";
import { audit } from "@/lib/audit";
import { ROLE_ROUTE_POLICY, roleAtLeast, type Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.systemConfig.findMany();
    const config: Record<string, string> = {};
    for (const r of rows) config[r.key] = r.value;
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("[system-config] read failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load config" }, { status: 500 });
  }
}

const putSchema = z.object({ config: z.record(z.string(), z.string().max(2000)) });

export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    const rule = ROLE_ROUTE_POLICY.find((r) => r.prefix === "/api/branches");
    if (!user || (rule && !roleAtLeast(user.role as Role, rule.minRole))) {
      return NextResponse.json({ ok: false, error: "Forbidden: requires MANAGER role" }, { status: 403 });
    }
    const rl = rateLimit(`syscfg:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
    if (!rl.allowed) return NextResponse.json({ ok: false, error: "Too many updates" }, { status: 429 });
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    for (const [key, value] of Object.entries(parsed.data.config)) {
      await db.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    await audit({ userId: user.id, action: "SYSTEM_CONFIG_UPDATE", entity: "SystemConfig", meta: { keys: Object.keys(parsed.data.config) }, ip: clientIp(req) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[system-config] write failed", err);
    return NextResponse.json({ ok: false, error: "Failed to update config" }, { status: 500 });
  }
}
