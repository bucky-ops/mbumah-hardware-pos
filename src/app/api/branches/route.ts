import { NextResponse, type NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-error-handler";
import { requireRole } from "@/lib/api/guard";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/branches — branch registry with product/user counts (MANAGER+).
// Branch KRA PINs are included; this endpoint is MANAGER-gated on both layers
// (middleware ROLE_ROUTE_POLICY + requireRole below).
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

export const GET = route(async (req) => {
  await requireRole(req, "MANAGER");

  const branches = await db.branch.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true, users: true } },
    },
  });

  return NextResponse.json({ items: branches, total: branches.length });
});
