// GET/POST /api/chat/channels (v2.16.0 global chat across subdomains)
//
// GET  - channels visible to the caller: the GLOBAL organization channel
//        (every authenticated user, every branch) plus their workspace store
//        threads. Powers the origin badge in the UI (storeName / storeCode).
// POST - create a store-scoped thread (INTERNAL). The global channel itself
//        is a singleton and cannot be created or deleted here.

import { type NextRequest } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import {
  chatChannelCreateSchema,
  getChatAccessibleStoreIds,
  listChatChannels,
} from '@/lib/workspace/chat';

export const dynamic = 'force-dynamic';

async function listChannelsHandler(_request: NextRequest, session: AuthSession): Promise<Response> {
  const channels = await listChatChannels(session);
  return Response.json({ success: true, data: channels });
}

async function createChannelHandler(request: NextRequest, session: AuthSession): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = chatChannelCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid request.' },
      { status: 400 },
    );
  }

  const { title, storeId, participantIds } = parsed.data;

  // Store must exist AND be within the caller's workspace reach.
  const accessible = await getChatAccessibleStoreIds(session);
  if (!accessible.includes(storeId)) {
    return Response.json(
      { success: false, error: 'You can only create threads in your assigned stores.' },
      { status: 403 },
    );
  }

  const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) {
    return Response.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  const participants = Array.from(new Set([...(participantIds ?? []), session.userId]));
  const created = await runWithoutTenant(async () =>
    db.conversation.create({
      data: {
        storeId,
        type: 'INTERNAL',
        title,
        participantIds: JSON.stringify(participants),
      },
      select: { id: true, type: true, title: true, storeId: true },
    }),
  );

  return Response.json({ success: true, data: created }, { status: 201 });
}

export const GET = withErrorBoundary(requireAuth(listChannelsHandler), 'CHAT_CHANNELS');
export const POST = withErrorBoundary(requireAuth(createChannelHandler), 'CHAT_CHANNELS');
