import { NextResponse, type NextRequest } from "next/server";

import { withErrorHandler } from "@/lib/api-error-handler";
import { requireRole } from "@/lib/api/guard";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit — audit trail reader (MANAGER+).
//
// ?limit=  default 50, clamped to [1, 200] — keeps responses bounded so the
//          endpoint can't be used to dump the whole trail in one request.
//          Newest first (descending createdAt).
//
// NOTE: AuditLog.userId is a plain string column in the schema (no Prisma
// relation), so the user {name, role} projection is joined in application code
// with a single batched query instead of a relational include.
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

export const GET = route(async (req) => {
  await requireRole(req, "MANAGER");

  const parsedLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10);
  const limit = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(parsedLimit, 1), 200);

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    db.auditLog.count(),
  ]);

  const userIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => Boolean(id)))];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const items = logs.map((l) => {
    let meta: unknown = null;
    if (l.meta) {
      try {
        meta = JSON.parse(l.meta);
      } catch {
        meta = l.meta; // tolerate legacy/free-form meta payloads
      }
    }
    return {
      id: l.id,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      meta,
      ip: l.ip,
      createdAt: l.createdAt,
      user: l.userId ? (byId.get(l.userId) ?? null) : null,
    };
  });

  return NextResponse.json({ items, total, limit });
});
