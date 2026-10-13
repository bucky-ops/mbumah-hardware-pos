// GET /api/chat/unread-count (v2.16.0 global chat)
//
// Unread badge for the chat entry points (org console, branch workspace,
// branch selector, /chat). Counts the latest message per channel that is
// newer than the caller's last read marker. Poll-friendly and cheap.

import { type NextRequest } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { GLOBAL_CONVERSATION_ID, getChatAccessibleStoreIds, parseReadStatus } from '@/lib/workspace/chat';

export const dynamic = 'force-dynamic';

async function unreadCountHandler(_request: NextRequest, session: AuthSession): Promise<Response> {
  const result = await runWithoutTenant(async () => {
    const accessibleStoreIds = await getChatAccessibleStoreIds(session);

    const channels = await db.conversation.findMany({
      where: {
        OR: [
          { id: GLOBAL_CONVERSATION_ID },
          { storeId: { in: accessibleStoreIds }, type: { not: 'GLOBAL' } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    if (channels.length === 0) return { unread: 0 };

    // Latest message per channel; a channel is unread when its newest
    // message is not from the caller and is newer than their read marker.
    const latestPerChannel = await Promise.all(
      channels.map(async (c) => {
        const last = await db.conversationMessage.findFirst({
          where: { conversationId: c.id },
          orderBy: { sentAt: 'desc' },
          select: { id: true, sentAt: true, readStatus: true, senderId: true },
        });
        return last;
      }),
    );

    let unread = 0;
    for (const last of latestPerChannel) {
      if (!last) continue;
      if (last.senderId === session.userId) continue; // own message never unread
      const readStatus = parseReadStatus(last.readStatus);
      const lastRead = readStatus[session.userId];
      if (!lastRead || new Date(lastRead) < last.sentAt) unread += 1;
    }
    return { unread };
  });

  return Response.json({ success: true, data: result });
}

export const GET = withErrorBoundary(requireAuth(unreadCountHandler), 'CHAT_UNREAD');
