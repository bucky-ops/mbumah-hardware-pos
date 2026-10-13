// POST /api/chat/channels/[channelId]/read (v2.16.0 global chat)
//
// Marks a channel read for the caller: upserts their timestamp into the
// message row(s) readStatus JSON and returns the resulting unread count
// for the whole chat surface (global + accessible store channels).

import { type NextRequest } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { canAccessChannel, parseReadStatus } from '@/lib/workspace/chat';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ channelId: string }>;
}

async function markReadHandler(request: NextRequest, session: AuthSession, ...args: unknown[]): Promise<Response> {
  const context = args[0] as RouteContext;
  const { channelId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { messageId?: string };

  const access = await canAccessChannel(session, channelId);
  if (!access.ok) {
    return Response.json(
      { success: false, error: 'You do not have access to this channel.' },
      { status: 403 },
    );
  }

  const nowIso = new Date().toISOString();

  await runWithoutTenant(async () => {
    if (body.messageId) {
      const message = await db.conversationMessage.findUnique({
        where: { id: body.messageId },
        select: { id: true, readStatus: true },
      });
      if (message) {
        const readStatus = parseReadStatus(message.readStatus);
        readStatus[session.userId] = nowIso;
        await db.conversationMessage.update({
          where: { id: message.id },
          data: { readStatus: JSON.stringify(readStatus) },
        });
      }
      return;
    }

    // No explicit message id: mark the latest message of the channel read.
    const latest = await db.conversationMessage.findFirst({
      where: { conversationId: channelId },
      orderBy: { sentAt: 'desc' },
      select: { id: true, readStatus: true },
    });
    if (latest) {
      const readStatus = parseReadStatus(latest.readStatus);
      readStatus[session.userId] = nowIso;
      await db.conversationMessage.update({
        where: { id: latest.id },
        data: { readStatus: JSON.stringify(readStatus) },
      });
    }
  });

  return Response.json({ success: true, data: { lastReadAt: nowIso } });
}

export const POST = withErrorBoundary(requireAuth(markReadHandler), 'CHAT_READ');
