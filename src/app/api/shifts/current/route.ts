// GET /api/shifts/current
//
// v2.6.0 BLIND CLOSEOUT: this endpoint is the cashier's "my current shift"
// hydration call, so it follows the same default-blind rule as the X-read:
//   • role ∈ OWNER_ROLES (SUPER_ADMIN, STORE_OWNER) → cash figures visible
//     by default; `?blind=1` forces a blind read; `?blind=0` explicitly
//     un-blinds (owners only).
//   • role ∉ OWNER_ROLES (or no session — fail closed) → BLIND:
//       - cashDifference is nulled (the variance reveals the expected figure
//         by implication),
//       - the SHIFT_CASH_BREAKDOWN JSON persisted in Shift.notes by the
//         Z-read (which contains expectedCash/difference) is redacted from
//         `notes` — otherwise the blind rule would leak through free text.
//
// AUTH NOTE: the route intentionally stays session-OPTIONAL (no hard 401) —
// the frontend calls it during initial hydration before a token exists, and
// the pre-v2.6 contract returns `{ success: true, data: null }` there.
// Unauthenticated callers are treated as non-owners (fail-closed blind), so
// no expected/variance figures can leak without a valid owner session.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { getSessionFromRequest, OWNER_ROLES } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Marker written by POST /api/shifts/[id]/end — the persisted machine-
// readable cash breakdown (contains expectedCash + difference). Kept in
// sync with BREAKDOWN_MARKER in that route.
const BREAKDOWN_MARKER = 'SHIFT_CASH_BREAKDOWN:';

async function getCurrentShiftHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  const userId = searchParams.get('userId');

  if (!storeId || !userId) {
    // Graceful no-op during initial hydration instead of a console-flooding 400.
    return Response.json({ success: true, data: null });
  }

  // ── v2.6.0 blind-closeout resolution (session-optional, fail-closed) ──
  const session = await getSessionFromRequest(request);
  const isOwner = session ? OWNER_ROLES.includes(session.role) : false;
  const blindParam = searchParams.get('blind');
  const blind = blindParam === '1' || !isOwner;

  const shift = await db.shift.findFirst({
    where: { storeId, userId, status: 'ACTIVE' },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      store: { select: { id: true, name: true, location: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  if (!shift) {
    return Response.json({ success: true, data: null });
  }

  // Blind rule: redact the Z-read breakdown (expectedCash/difference live in
  // there) from the free-form notes; user-typed notes stay visible.
  const visibleNotes = blind
    ? (shift.notes || '').split(BREAKDOWN_MARKER)[0].trimEnd()
    : shift.notes;

  const data = {
    id: shift.id,
    userId: shift.userId,
    userName: shift.user.name,
    storeId: shift.storeId,
    startedAt: shift.startedAt.toISOString(),
    endedAt: shift.endedAt ? shift.endedAt.toISOString() : null,
    startingCash: shift.startingCash,
    endingCash: shift.endingCash,
    countedCash: shift.countedCash,
    // Blind closeout: the variance reveals the expected figure — hidden
    // (null) unless the caller is owner-or-above and has not asked for a
    // blind read.
    cashDifference: blind ? null : shift.cashDifference,
    totalSales: shift.totalSales,
    totalTransactions: shift.totalTransactions,
    status: shift.status,
    notes: visibleNotes,
    blind,
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
  };

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(getCurrentShiftHandler, 'SHIFT_CURRENT');
