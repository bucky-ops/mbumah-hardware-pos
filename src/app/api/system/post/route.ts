// POST /api/system/post — engraved-admin post / boot check.
// Dev: public (sandbox convenience). Production: SUPER_ADMIN only.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureEngravedAdmin, isEngravedAdmin } from "@/lib/engraved-admin";
import { getSessionUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      const user = await getSessionUser(req);
      if (!user || (!isEngravedAdmin({ email: user.email }) && user.role !== "SUPER_ADMIN")) {
        return NextResponse.json({ ok: false, error: "SUPER_ADMIN required" }, { status: 403 });
      }
    }
    const result = await ensureEngravedAdmin();
    const counts = {
      users: await db.user.count(),
      branches: await db.branch.count(),
      products: await db.product.count(),
    };
    return NextResponse.json({ ok: true, engraved: result, counts, at: new Date().toISOString() });
  } catch (err) {
    console.error("[system/post] failed", err);
    return NextResponse.json({ ok: false, error: "System post failed" }, { status: 500 });
  }
}
