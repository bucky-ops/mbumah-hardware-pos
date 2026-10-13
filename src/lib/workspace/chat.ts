// MBUMAH HARDWARE POS - Global chat helpers (v2.16.0 subdomain workspaces)
//
// Chat is ORGANIZATION-WIDE: every authenticated user can read the global
// channel regardless of branch assignment (spec: "Chat visibility is separate
// from operational data visibility"). Store-scoped threads keep their existing
// isolation; this module adds the global channel + origin badges on top.
//
// Security notes:
//   - All queries run via runWithoutTenant with EXPLICIT where clauses:
//     the global conversation has storeId = null and the ORM tenancy
//     extension (which ANDs session.storeId) would otherwise hide it.
//   - Channel access is computed here (accessibleStoreIds), never trusted
//     from the client.

import { z } from 'zod';
import { db, runWithoutTenant } from '@/lib/db';

export const GLOBAL_CONVERSATION_ID = 'conv_global';

export const CHAT_MAX_MESSAGE_LENGTH = 2000;

export const chatMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty.')
    .max(CHAT_MAX_MESSAGE_LENGTH, `Message must be ${CHAT_MAX_MESSAGE_LENGTH} characters or fewer.`),
  // Origin store of the sender (their current workspace). Null = organization.
  storeId: z.string().trim().max(64).nullable().optional(),
});

export const chatChannelCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  storeId: z.string().trim().min(1).max(64),
  participantIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

export interface ChatChannel {
  id: string;
  type: string;
  title: string | null;
  storeId: string | null;
  storeName: string | null;
  storeCode: string | null;
  isGlobal: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
}

/**
 * Store ids whose chat threads the user may open: the global channel is
 * always readable; store threads follow workspace assignment rules.
 */
export async function getChatAccessibleStoreIds(
  session: { userId: string; role: string; storeId: string | null },
): Promise<string[]> {
  if (session.role === 'SUPER_ADMIN' || session.role === 'STORE_OWNER') {
    const stores = await db.store.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    return stores.map((s) => s.id);
  }
  const memberships = await db.storeMembership.findMany({
    where: { userId: session.userId, status: 'ACTIVE' },
    select: { storeId: true },
  });
  const ids = new Set(memberships.map((m) => m.storeId));
  if (session.storeId) ids.add(session.storeId);
  return Array.from(ids);
}

/** Lazily ensure the singleton global channel exists (idempotent). */
export async function ensureGlobalChannel(): Promise<string> {
  await db.conversation.upsert({
    where: { id: GLOBAL_CONVERSATION_ID },
    update: {},
    create: {
      id: GLOBAL_CONVERSATION_ID,
      storeId: null,
      type: 'GLOBAL',
      title: 'Global (All Stores)',
      participantIds: '[]',
    },
  });
  return GLOBAL_CONVERSATION_ID;
}

export async function listChatChannels(session: {
  userId: string;
  role: string;
  storeId: string | null;
}): Promise<ChatChannel[]> {
  return runWithoutTenant(async () => {
    await ensureGlobalChannel();
    const accessibleStoreIds = await getChatAccessibleStoreIds(session);

    const conversations = await db.conversation.findMany({
      where: {
        OR: [
          { id: GLOBAL_CONVERSATION_ID },
          { storeId: { in: accessibleStoreIds }, type: { not: 'GLOBAL' } },
        ],
      },
      include: { _count: { select: { messages: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });

    const storeIds = Array.from(
      new Set(conversations.map((c) => c.storeId).filter(Boolean) as string[]),
    );
    const stores = storeIds.length
      ? await db.store.findMany({
          where: { id: { in: storeIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const storeMap = new Map(stores.map((s) => [s.id, s]));

    // Global channel first, then most recent threads.
    return conversations
      .sort((a, b) => {
        if (a.id === GLOBAL_CONVERSATION_ID) return -1;
        if (b.id === GLOBAL_CONVERSATION_ID) return 1;
        return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
      })
      .map((c) => {
        const store = c.storeId ? storeMap.get(c.storeId) : undefined;
        return {
          id: c.id,
          type: c.type,
          title: c.title,
          storeId: c.storeId,
          storeName: store?.name ?? null,
          storeCode: store?.code ?? null,
          isGlobal: c.id === GLOBAL_CONVERSATION_ID || c.type === 'GLOBAL',
          lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
          lastMessagePreview: c.lastMessagePreview,
          messageCount: c._count.messages,
        } satisfies ChatChannel;
      });
  });
}

/**
 * Can this session open the given conversation? Global: any authenticated
 * user. Store thread: workspace assignment (org roles pass via their
 * accessible-ids computation).
 */
export async function canAccessChannel(
  session: { userId: string; role: string; storeId: string | null },
  conversationId: string,
): Promise<{ ok: boolean; storeId: string | null; isGlobal: boolean }> {
  return runWithoutTenant(async () => {
    await ensureGlobalChannel();
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, storeId: true, type: true },
    });
    if (!conversation) return { ok: false, storeId: null, isGlobal: false };

    if (conversation.id === GLOBAL_CONVERSATION_ID || conversation.type === 'GLOBAL') {
      return { ok: true, storeId: null, isGlobal: true };
    }

    const accessible = await getChatAccessibleStoreIds(session);
    const ok = !!conversation.storeId && accessible.includes(conversation.storeId);
    return { ok, storeId: conversation.storeId, isGlobal: false };
  });
}

/** Parse the per-user readStatus JSON defensively. */
export function parseReadStatus(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
