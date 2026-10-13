// GET/POST /api/chat/channels/[channelId]/messages (v2.16.0 global chat)
//
// GET  - message history for a channel. The GLOBAL channel is readable by
//        every authenticated user of the organization (all branches); store
//        threads require workspace assignment. Cursor pagination (?before=).
// POST - send a message. Zod-validated (length cap), rate limited by the
//        proxy MESSAGING tier, XSS-safe (the client renders text only), and
//        stamped with the sender's origin store for the branch badge.

import { type NextRequest } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { chatMessageSchema, canAccessChannel, parseReadStatus } from '@/lib/workspace/chat';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ channelId: string }>;
}

async function listMessagesHandler(request: NextRequest, session: AuthSession, ...args: unknown[]): Promise<Response> {
  const context = args[0] as RouteContext;
  const { channelId } = await context.params;
  const { searchParams } = new URL(request.url);
  const before = searchParams.get('before');
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 100);

  const access = await canAccessChannel(session, channelId);
  if (!access.ok) {
    return Response.json(
      { success: false, error: 'You do not have access to this channel.' },
      { status: 403 },
    );
  }

  return runWithoutTenant(async () => {
    const messages = await db.conversationMessage.findMany({
      where: {
        conversationId: channelId,
        ...(before ? { sentAt: { lt: new Date(before) } } : {}),
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
      },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });

    // Origin store names for branch badges (batch, never N+1 per message).
    const originIds = Array.from(
      new Set(messages.map((m) => m.storeId).filter(Boolean) as string[]),
    );
    const originStores = originIds.length
      ? await db.store.findMany({
          where: { id: { in: originIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const originMap = new Map(originStores.map((s) => [s.id, s]));

    const data = messages
      .slice()
      .reverse() // oldest-first for the UI
      .map((m) => ({
        id: m.id,
        content: m.content,
        messageType: m.messageType,
        sentAt: m.sentAt.toISOString(),
        isOwn: m.senderId === session.userId,
        sender: m.sender,
        originStoreId: m.storeId,
        originStoreName: m.storeId ? originMap.get(m.storeId)?.name ?? null : null,
        originStoreCode: m.storeId ? originMap.get(m.storeId)?.code ?? null : null,
        readBy: Object.keys(parseReadStatus(m.readStatus)).length,
      }));

    return Response.json({ success: true, data });
  });
}

async function sendMessageHandler(request: NextRequest, session: AuthSession, ...args: unknown[]): Promise<Response> {
  const context = args[0] as RouteContext;
  const { channelId } = await context.params;

  const access = await canAccessChannel(session, channelId);
  if (!access.ok) {
    return Response.json(
      { success: false, error: 'You do not have access to this channel.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = chatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid message.' },
      { status: 400 },
    );
  }

  // Origin store: the caller's claimed workspace store, but only when it is
  // one they may operate in (org console sends have no store origin).
  const claimed = parsed.data.storeId ?? session.storeId ?? null;
  let originStoreId: string | null = null;
  if (claimed) {
    const store = await db.store.findUnique({
      where: { id: claimed },
      select: { id: true, status: true },
    });
    if (store && store.status === 'ACTIVE') {
      const { getChatAccessibleStoreIds } = await import('@/lib/workspace/chat');
      const accessible = await getChatAccessibleStoreIds(session);
      // A forged/unreachable claimed origin falls back to the sender's own
      // primary store (the truthful origin), never to a foreign branch.
      originStoreId = accessible.includes(store.id) ? store.id : session.storeId ?? null;
    }
  }

  return runWithoutTenant(async () => {
    const message = await db.conversationMessage.create({
      data: {
        conversationId: channelId,
        senderId: session.userId,
        storeId: originStoreId,
        content: parsed.data.content,
        messageType: 'TEXT',
      },
      include: { sender: { select: { id: true, name: true, role: true } } },
    });

    await db.conversation.update({
      where: { id: channelId },
      data: {
        lastMessageAt: message.sentAt,
        lastMessagePreview: message.content.slice(0, 100),
      },
    });

    return Response.json(
      {
        success: true,
        data: {
          id: message.id,
          content: message.content,
          messageType: message.messageType,
          sentAt: message.sentAt.toISOString(),
          isOwn: true,
          sender: message.sender,
          originStoreId: message.storeId,
          readBy: 0,
        },
      },
      { status: 201 },
    );
  });
}

export const GET = withErrorBoundary(requireAuth(listMessagesHandler), 'CHAT_MESSAGES');
export const POST = withErrorBoundary(requireAuth(sendMessageHandler), 'CHAT_MESSAGES');
