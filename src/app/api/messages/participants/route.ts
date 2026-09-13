// GET /api/messages/participants — active staff list for the chat participant picker.
//
// CHAT PRESENCE FIX (v2.5.6): the New Conversation and Add Participant dialogs
// previously called `GET /api/users`, which is gated to SUPER_ADMIN and
// STORE_OWNER only. A shift manager (BRANCH_MANAGER) or cashier therefore got
// "403 Insufficient permissions" and the dialog rendered
// "No other active users in this store." — even though every teammate was
// active. This endpoint exposes the MINIMAL directory chat needs to ANY
// authenticated staff member:
//
//   • Only ACTIVE users (isActive: true) — deactivated staff never appear.
//   • Only the caller's own store (non-SUPER_ADMIN callers cannot browse
//     other stores; a passed storeId is ignored/overridden by the session).
//   • The caller is excluded from the list (the conversation creator is
//     auto-added as a participant server-side, so self-selection is noise).
//   • Minimal fields only (id/name/email/role/avatar/lastLoginAt) — no
//     password hashes, counters, store reassignments or other admin fields.
//
// `lastLoginAt` lets the UI show a "last active" hint without pretending to
// be a live presence system (presence/heartbeat is a planned v2.6 feature).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function listParticipantsHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const requestedStoreId = searchParams.get('storeId') || '';

  // Zero-trust tenancy: non-SUPER_ADMIN callers are ALWAYS narrowed to their
  // own store, regardless of what the client asks for. SUPER_ADMIN (who has
  // no fixed store) may pass ?storeId= explicitly, falling back to their
  // session store if any.
  const storeId =
    session.role === 'SUPER_ADMIN'
      ? requestedStoreId || session.storeId || ''
      : session.storeId || '';

  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required (session has no store assignment).' },
      { status: 400 },
    );
  }

  const users = await db.user.findMany({
    where: {
      storeId,
      isActive: true,
      id: { not: session.userId }, // caller is auto-added; exclude self
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      lastLoginAt: true,
    },
    orderBy: [{ name: 'asc' }],
    take: 200,
  });

  return Response.json({
    success: true,
    data: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarUrl: u.avatarUrl,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
  });
}

export const GET = withErrorBoundary(
  requireAuth(listParticipantsHandler),
  'MESSAGES_PARTICIPANTS'
);
