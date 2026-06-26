// GET/PATCH/DELETE /api/messages/conversations/[id]
//
// Manage a single conversation thread.
//   GET    — fetch one conversation with resolved participant details + counts
//   PATCH  — update title, add/remove participants, or change type
//   DELETE — soft delete a conversation (cascades to messages via onDelete: Cascade)

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['INTERNAL', 'CUSTOMER_SUPPORT'];

/**
 * Helper — load a conversation + verify the caller is a participant
 * (or SUPER_ADMIN). Returns the conversation row or a 403/404 Response.
 */
async function loadConversationForCaller(
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

  // Participant check (SUPER_ADMIN bypasses).
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

// ── GET: fetch one conversation ──────────────────────────────────────────────
async function getConversationHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null },
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as { params: Promise<{ id: string }> };
  const { id: conversationId } = await context.params;

  const loaded = await loadConversationForCaller(conversationId, session);
  if (!loaded.ok) return loaded.response;
  const c = loaded.conversation;

  let ids: string[] = [];
  try {
    ids = JSON.parse(c.participantIds) as string[];
  } catch {
    ids = [];
  }

  const participants = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true, role: true, storeId: true },
  });

  const messageCount = await db.conversationMessage.count({
    where: { conversationId },
  });

  return Response.json({
    success: true,
    data: {
      id: c.id,
      storeId: c.storeId,
      type: c.type,
      title: c.title,
      participantIds: ids,
      participants: participants.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        storeId: p.storeId,
      })),
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: c.lastMessagePreview,
      messageCount,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    },
  });
}

// ── PATCH: update conversation metadata ───────────────────────────────────────
async function patchConversationHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as { params: Promise<{ id: string }> };
  const { id: conversationId } = await context.params;

  const loaded = await loadConversationForCaller(conversationId, session);
  if (!loaded.ok) return loaded.response;
  const existing = loaded.conversation;

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const { title, type, addParticipantIds, removeParticipantIds } = body as {
    title?: string;
    type?: string;
    addParticipantIds?: string[];
    removeParticipantIds?: string[];
  };

  // Resolve current participant IDs.
  let currentIds: string[] = [];
  try {
    currentIds = JSON.parse(existing.participantIds) as string[];
  } catch {
    currentIds = [];
  }

  // Apply add/remove operations.
  if (addParticipantIds?.length) {
    // Validate new participants exist + are active.
    const newUsers = await db.user.findMany({
      where: {
        id: { in: addParticipantIds },
        isActive: true,
      },
      select: { id: true },
    });
    const newIds = newUsers.map((u) => u.id);
    currentIds = Array.from(new Set([...currentIds, ...newIds]));
  }
  if (removeParticipantIds?.length) {
    // Prevent removing yourself accidentally (use DELETE instead).
    currentIds = currentIds.filter(
      (id) => !removeParticipantIds.includes(id) || id === session.userId,
    );
  }

  // Don't allow a conversation to drop below 1 participant.
  if (currentIds.length === 0) {
    return Response.json(
      { success: false, error: 'A conversation must have at least one participant.' },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {
    participantIds: JSON.stringify(currentIds),
  };
  if (typeof title === 'string') updates.title = title.trim() || null;
  if (type && VALID_TYPES.includes(type)) updates.type = type;

  const updated = await db.conversation.update({
    where: { id: conversationId },
    data: updates,
  });

  await systemLog({
    action: 'CONVERSATION_UPDATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Conversation ${conversationId} updated by ${session.email}`,
    userId: session.userId,
    storeId: updated.storeId,
    metadata: {
      conversationId,
      titleChanged: typeof title === 'string',
      typeChanged: !!type,
      participantsAdded: addParticipantIds?.length || 0,
      participantsRemoved: removeParticipantIds?.length || 0,
    },
  });

  return Response.json({
    success: true,
    data: {
      id: updated.id,
      storeId: updated.storeId,
      type: updated.type,
      title: updated.title,
      participantIds: currentIds,
      lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: updated.lastMessagePreview,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
    message: 'Conversation updated.',
  });
}

// ── DELETE: remove a conversation (cascades to messages) ──────────────────────
async function deleteConversationHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as { params: Promise<{ id: string }> };
  const { id: conversationId } = await context.params;

  const loaded = await loadConversationForCaller(conversationId, session);
  if (!loaded.ok) return loaded.response;
  const existing = loaded.conversation;

  await db.conversation.delete({ where: { id: conversationId } });

  await systemLog({
    action: 'CONVERSATION_DELETED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.WARN,
    message: `Conversation ${conversationId} deleted by ${session.email}`,
    userId: session.userId,
    storeId: existing.storeId,
    metadata: { conversationId },
  });

  return Response.json({
    success: true,
    message: 'Conversation deleted.',
  });
}

export const GET = withErrorBoundary(
  requireAuth(getConversationHandler),
  'CONVERSATION_GET',
);
export const PATCH = withErrorBoundary(
  requireAuth(patchConversationHandler),
  'CONVERSATION_PATCH',
);
export const DELETE = withErrorBoundary(
  requireAuth(deleteConversationHandler),
  'CONVERSATION_DELETE',
);
