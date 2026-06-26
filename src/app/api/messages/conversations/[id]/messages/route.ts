// GET/POST /api/messages/conversations/[id]/messages
//
// List and post messages within a single conversation thread.
//
//   GET  — paginated list of ConversationMessage rows, oldest-first by default.
//   POST — add a new message to the thread. The caller must be a participant.
//          On POST we also update the parent Conversation's lastMessageAt /
//          lastMessagePreview (denormalized for the list UI).
//
// Query params (GET):
//   limit    — default 50, max 200
//   before   — ISO timestamp; return messages sent BEFORE this time (for
//              paginating backward in time / infinite scroll)
//   order    — asc | desc (default asc, oldest-first for chat UX)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_MESSAGE_TYPES = ['TEXT', 'IMAGE', 'FILE', 'SYSTEM'];

/**
 * Verify the caller is a participant of the conversation.
 * Returns the conversation row or a 403/404 Response.
 */
async function authorizeParticipant(
  conversationId: string,
  session: { userId: string; role: string },
): Promise<{ ok: true; conversation: NonNullable<Awaited<ReturnType<typeof db.conversation.findUnique>>> } | { ok: false; response: Response }> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    return {
      ok: false,
      response: Response.json(
        { success: false, error: 'Conversation not found.' },
        { status: 404 },
      ),
    };
  }

  if (session.role !== 'SUPER_ADMIN') {
    let ids: string[] = [];
    try {
      ids = JSON.parse(conversation.participantIds) as string[];
    } catch {
      ids = [];
    }
    if (!ids.includes(session.userId)) {
      return {
        ok: false,
        response: Response.json(
          { success: false, error: 'You are not a participant in this conversation.' },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, conversation };
}

// ── GET: list messages in a conversation ──────────────────────────────────────
async function listMessagesHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null },
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as { params: Promise<{ id: string }> };
  const { id: conversationId } = await context.params;

  const auth = await authorizeParticipant(conversationId, session);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);
  const before = searchParams.get('before');
  const order = searchParams.get('order') === 'desc' ? 'desc' : 'asc';

  const where: Record<string, unknown> = { conversationId };
  if (before) {
    const beforeDate = new Date(before);
    if (!isNaN(beforeDate.getTime())) {
      where.sentAt = { lt: beforeDate };
    }
  }

  const messages = await db.conversationMessage.findMany({
    where,
    include: {
      sender: { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { sentAt: order },
    take: limit,
  });

  // Mark the caller's read timestamp on each message's readStatus.
  // (We don't persist the read-mark here — that's a separate PATCH — but we
  // return the parsed readStatus so the UI can show "unread" badges.)
  const data = messages.map((m) => {
    let readStatus: Record<string, string> = {};
    try {
      readStatus = JSON.parse(m.readStatus) as Record<string, string>;
    } catch {
      readStatus = {};
    }
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      sender: m.sender,
      content: m.content,
      messageType: m.messageType,
      attachmentUrl: m.attachmentUrl,
      sentAt: m.sentAt.toISOString(),
      readBy: Object.keys(readStatus),
      readStatus,
      isOwn: m.senderId === session.userId,
    };
  });

  return Response.json({ success: true, data });
}

// ── POST: post a new message to a conversation ────────────────────────────────
async function postMessageHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as { params: Promise<{ id: string }> };
  const { id: conversationId } = await context.params;

  const auth = await authorizeParticipant(conversationId, session);
  if (!auth.ok) return auth.response;
  const conversation = auth.conversation;

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const { content, messageType = 'TEXT', attachmentUrl } = body as {
    content?: string;
    messageType?: string;
    attachmentUrl?: string;
  };

  if (!content || !content.trim()) {
    return Response.json(
      { success: false, error: 'content is required.' },
      { status: 400 },
    );
  }

  if (!VALID_MESSAGE_TYPES.includes(messageType)) {
    return Response.json(
      { success: false, error: `messageType must be one of: ${VALID_MESSAGE_TYPES.join(', ')}.` },
      { status: 400 },
    );
  }

  // Length sanity check (defensive — UI may not enforce).
  if (content.length > 10_000) {
    return Response.json(
      { success: false, error: 'content is too long (max 10,000 characters).' },
      { status: 400 },
    );
  }

  // Persist the message.
  const message = await db.conversationMessage.create({
    data: {
      conversationId,
      senderId: session.userId,
      content: content.trim(),
      messageType,
      attachmentUrl: attachmentUrl || null,
      // Sender has implicitly read their own message.
      readStatus: JSON.stringify({ [session.userId]: new Date().toISOString() }),
    },
    include: {
      sender: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  // Update the parent conversation's denormalized last-message fields.
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: content.trim().slice(0, 100),
    },
  });

  await systemLog({
    action: 'CONVERSATION_MESSAGE_POSTED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Message posted by ${session.email} to conversation ${conversationId}`,
    userId: session.userId,
    storeId: conversation.storeId,
    metadata: {
      conversationId,
      messageId: message.id,
      messageType,
    },
  });

  return Response.json(
    {
      success: true,
      data: {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        sender: message.sender,
        content: message.content,
        messageType: message.messageType,
        attachmentUrl: message.attachmentUrl,
        sentAt: message.sentAt.toISOString(),
        readBy: [session.userId],
        isOwn: true,
      },
      message: 'Message posted.',
    },
    { status: 201 },
  );
}

export const GET = withErrorBoundary(
  requireAuth(listMessagesHandler),
  'CONVERSATION_MESSAGES_LIST',
);
export const POST = withErrorBoundary(
  requireAuth(postMessageHandler),
  'CONVERSATION_MESSAGES_POST',
);
