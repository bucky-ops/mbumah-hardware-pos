import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrorHandler } from "@/lib/api-error-handler";
import { requireRole, assertTargetBranch } from "@/lib/api/guard";
import { D, round2 } from "@/lib/format";

// src/app/api/v1/drawer/history/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/drawer/history — Drawer session history drill-down (Task 21-a).
//
//   GET  MANAGER+ — paginated CLOSED drawer sessions for the branch, newest
//                  close first, each WITH:
//     • closing summary — openingFloat, Σ FLOAT_IN, Σ PAYOUT, expectedDrawer
//       (frozen derivable: counted − variance), countedAmount, variance and
//       the variance close-note (joined back from the AuditLog DRAWER_CLOSE
//       meta where the note was frozen at close time — Task 20-a contract);
//     • the full movement list (FLOAT_IN / PAYOUT with notes + timestamps).
//
//   Query: ?branchId= (OWNER scope, BOLA-checked) &page=1 &pageSize=6 (≤ 20)
//
//   RBAC/BOLA: MANAGER+; OWNER may pass any branchId, others are pinned to
//   their own branch by assertTargetBranch (same pattern as /api/v1/drawer).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");

  const qp = req.nextUrl.searchParams;
  assertTargetBranch(user, qp.get("branchId"));
  const branchId = user.role === "OWNER" ? qp.get("branchId") ?? user.branchId : user.branchId;

  const page = Math.max(1, Math.floor(Number(qp.get("page") ?? "1") || 1));
  const pageSize = Math.min(20, Math.max(1, Math.floor(Number(qp.get("pageSize") ?? "6") || 6)));

  const [sessions, total] = await Promise.all([
    db.cashDrawerSession.findMany({
      where: { branchId, status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { name: true } },
        movements: { orderBy: { createdAt: "asc" } },
      },
    }),
    db.cashDrawerSession.count({ where: { branchId, status: "CLOSED" } }),
  ]);

  // Variance close-notes live in the audit trail (DRAWER_CLOSE → meta.note),
  // one row per close — join the FIRST audit per session back onto it.
  const ids = sessions.map((s) => s.id);
  const audits = ids.length
    ? await db.auditLog.findMany({
        where: { action: "DRAWER_CLOSE", entityId: { in: ids } },
        orderBy: { createdAt: "asc" },
        select: { entityId: true, meta: true, userId: true, createdAt: true },
      })
    : [];
  const noteBySession = new Map<string, string | null>();
  const closedByBySession = new Map<string, string | null>();
  const auditorIds = new Set<string>();
  for (const a of audits) {
    if (!a.entityId || noteBySession.has(a.entityId)) continue;
    try {
      const meta = a.meta ? (JSON.parse(a.meta) as { note?: string | null }) : null;
      noteBySession.set(a.entityId, meta?.note ?? null);
    } catch {
      noteBySession.set(a.entityId, null);
    }
    if (a.userId) {
      auditorIds.add(a.userId);
      if (!closedByBySession.has(a.entityId)) closedByBySession.set(a.entityId, a.userId);
    }
  }
  const closers = auditorIds.size
    ? await db.user.findMany({ where: { id: { in: [...auditorIds] } }, select: { id: true, name: true } })
    : [];
  const closerName = new Map(closers.map((u) => [u.id, u.name]));

  return NextResponse.json({
    page,
    pageSize,
    total,
    sessions: sessions.map((s) => {
      const floatIn = s.movements
        .filter((m) => m.type === "FLOAT_IN")
        .reduce((acc, m) => acc.plus(m.amount), D(0));
      const payouts = s.movements
        .filter((m) => m.type === "PAYOUT")
        .reduce((acc, m) => acc.plus(m.amount), D(0));
      // The expected figure at the close moment is exactly counted − variance
      // (both frozen on the row) — no live recompute needed for closed shifts.
      const expected =
        s.countedAmount != null && s.variance != null ? D(s.countedAmount).minus(D(s.variance)) : null;

      return {
        id: s.id,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
        openedByName: s.user.name,
        closedByName: closerName.get(closedByBySession.get(s.id) ?? "") ?? s.user.name,
        closing: {
          openingFloat: round2(D(s.openingFloat).toNumber()),
          floatIn: round2(floatIn.toNumber()),
          payouts: round2(payouts.toNumber()),
          expectedDrawer: expected != null ? round2(expected.toNumber()) : null,
          countedAmount: s.countedAmount != null ? round2(D(s.countedAmount).toNumber()) : null,
          variance: s.variance != null ? round2(D(s.variance).toNumber()) : null,
          closeNote: noteBySession.get(s.id) ?? null,
        },
        movements: s.movements.map((m) => ({
          id: m.id,
          type: m.type,
          amount: round2(D(m.amount).toNumber()),
          note: m.note ?? null,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }),
  });
});
