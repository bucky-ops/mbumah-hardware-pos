// GET /api/stores — branch/store directory for the console branch selector,
// workspace routing and SSO hints. Public read (no PII).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RESERVED_SUBDOMAINS } from "@/lib/release";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const branches = await db.branch.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, code: true, name: true, town: true, slug: true, subdomain: true, brandColor: true, location: true, sizeSqm: true },
    });
    return NextResponse.json({
      ok: true,
      stores: branches,
      reserved: [...RESERVED_SUBDOMAINS],
      workspaceRootDomain: "mbumah.co.ke",
    });
  } catch (err) {
    console.error("[stores] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to list stores" }, { status: 500 });
  }
}
