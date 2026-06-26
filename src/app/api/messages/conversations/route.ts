// GET/POST /api/messages/conversations
//
// List and create conversation threads (internal staff chat or
// customer-support chat). Each conversation is a thread of ConversationMessage
// rows, separate from the outbound customer Message model.
//
// GET  — list conversations for the caller's store. The caller is automatically
//        included in the participantIds filter (they only see threads they're
//        part of), unless they're SUPER_ADMIN (sees all store conversations).
// POST — create a new conversation. The caller is auto-added as a participant.
//
// Query params (GET):
//   storeId — required (enforced by requireAuth; SUPER_ADMIN may pass any)
//   type    — INTERNAL | CUSTOMER_SUPPORT (optional filter)
//   limit   — default 50, max 200

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['INTERNAL', 'CUSTOMER_SUPPORT'];

// ── GET: list conversations ──────────────────────────────────────────────────
async function listConversationsHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;

  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const type = searchParams.get('type') || '';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);

  const where: Record<string, unknown> = { storeId };
  if (type && VALID_TYPES.includes(type)) where.type = type;

  // Non-admins only see conversations they're a participant in. We store
  // participantIds as a JSON array string, so we use a `contains` filter
  // on the userId. (SQLite-compatible; for PG we'd use the array operator.)
  if (session.role !== 'SUPER_ADMIN') {
    where.participantIds = { contains: session.userId };
  }

  const conversations = await db.conversation.findMany({
    where,
    include: {
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: limit,
  });

  // Resolve participant user names for the UI.
  const allParticipantIds = new Set<string>();
  for (const c of conversations) {
    try {
      const ids = JSON.parse(c.participantIds) as string[];
      ids.forEach((id) => allParticipantIds.add(id));
    } catch {
      // ignore parse errors — defensive
    }
  }

  const participants =
    allParticipantIds.size > 0
      ? await db.user.findMany({
          where: { id: { in: Array.from(allParticipantIds) } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];

  const participantMap = new Map(participants.map((p) => [p.id, p]));

  const data = conversations.map((c) => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(c.participantIds) as string[];
    } catch {
      ids = [];
    }
    return {
      id: c.id,
      storeId: c.storeId,
      type: c.type,
      title: c.title,
      participantIds: ids,
      participants: ids
        .map((id) => participantMap.get(id))
        .filter(Boolean)
        .map((p) => ({ id: p!.id, name: p!.name, email: p!.email, role: p!.role })),
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: c.lastMessagePreview,
      messageCount: c._count.messages,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  });

  return Response.json({ success: true, data });
}

// ── POST: create a conversation ──────────────────────────────────────────────
async function createConversationHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const { storeId, type = 'INTERNAL', title, participantIds = [] } = body as {
    storeId?: string;
    type?: string;
    title?: string;
    participantIds?: string[];
  };

  const resolvedStoreId = storeId || session.storeId;
  if (!resolvedStoreId) {
    return Response.json(
      { success: false, error: 'storeId is required (session has no store assignment).' },
      { status: 400 },
    );
  }

  if (!VALID_TYPES.includes(type)) {
    return Response.json(
      { success: false, error: `type must be one of: ${VALID_TYPES.join(', ')}.` },
      { status: 400 },
    );
  }

  // Caller is always auto-added as a participant.
  const uniqueIds = Array.from(new Set([session.userId, ...participantIds]));

  // Validate that all participant IDs are real users in the same org/store.
  // (We allow cross-store participants for SUPER_ADMIN; otherwise participants
  // must share the caller's storeId.)
  const validUsers = await db.user.findMany({
    where:
      session.role === 'SUPER_ADMIN'
        ? { id: { in: uniqueIds } }
        : { id: { in: uniqueIds }, OR: [{ storeId: resolvedStoreId }, { role: 'SUPER_ADMIN' }] },
    select: { id: true, isActive: true },
  });
  const validIds = new Set(validUsers.filter((u) => u.isActive).map((u) => u.id));
  const filteredIds = uniqueIds.filter((id) => validIds.has(id));

  if (filteredIds.length < 2) {
    return Response.json(
      {
        success: false,
        error:
          'A conversation needs at least 2 valid, active participants (the caller + at least one other).',
      },
      { status: 400 },
    );
  }

  const conversation = await db.conversation.create({
    data: {
      storeId: resolvedStoreId,
      type,
      title: title?.trim() || null,
      participantIds: JSON.stringify(filteredIds),
    },
  });

  // Optional: post a system "conversation created" message as the first entry.
  await db.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      senderId: session.userId,
      content: `Conversation started by ${session.email}`,
      messageType: 'SYSTEM',
      readStatus: JSON.stringify({ [session.userId]: new Date().toISOString() }),
    },
  });

  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: 'Conversation started',
    },
  });

  await systemLog({
    action: 'CONVERSATION_CREATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Conversation ${conversation.id} created by ${session.email} (${type}, ${filteredIds.length} participants)`,
    userId: session.userId,
    storeId: resolvedStoreId,
    metadata: {
      conversationId: conversation.id,
      type,
      participantCount: filteredIds.length,
    },
  });

  return Response.json(
    {
      success: true,
      data: {
        id: conversation.id,
        storeId: conversation.storeId,
        type: conversation.type,
        title: conversation.title,
        participantIds: filteredIds,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: conversation.lastMessagePreview,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
      message: 'Conversation created.',
    },
    { status: 201 },
  );
}

export const GET = withErrorBoundary(
  requireAuth(listConversationsHandler),
  'CONVERSATIONS_LIST',
);
export const POST = withErrorBoundary(
  requireAuth(createConversationHandler),
  'CONVERSATIONS_CREATE',
);
