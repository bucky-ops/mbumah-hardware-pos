# Global chat

Since v2.16.0 the internal staff chat spans the whole organization: a single GLOBAL channel that every authenticated user can read from any branch, plus the existing store-scoped threads. Chat visibility is deliberately separate from operational data visibility - being able to read the global channel does not grant access to any store's data.

## Architecture in one paragraph

Chat reuses the existing `Conversation` / `ConversationMessage` models. One singleton conversation (`conv_global`, type `GLOBAL`, `storeId = null`) is the organization-wide channel; every other conversation keeps its `storeId` and stays isolated to that store's workspace. Messages on the global channel carry a denormalized `ConversationMessage.storeId` marking the **sender's origin branch**, which the UI renders as a badge. All chat traffic goes through polling REST endpoints - there is no WebSocket for chat (see [Why no WebSocket](#why-no-websocket-for-chat)).

The global channel is created lazily and idempotently (`ensureGlobalChannel` upserts `conv_global`), and the seed also creates it (stage 24, with three demo messages).

## Channel visibility rules

| Channel type | Who can read |
|--------------|--------------|
| GLOBAL (`conv_global`) | Every authenticated user of the organization, every branch, no membership needed |
| Store threads (type `INTERNAL`) | Users whose accessible store set contains the thread's `storeId`: org-wide roles (`SUPER_ADMIN`, `STORE_OWNER` see all active stores), otherwise primary store + active `StoreMembership` rows |

Implementation notes:

- All chat queries run via `runWithoutTenant` **with explicit where clauses** (`src/lib/workspace/chat.ts`). The global conversation has `storeId = null`, and the ORM tenancy extension (which ANDs `session.storeId`) would otherwise hide it.
- Channel access is computed server-side from the session (`canAccessChannel`, `getChatAccessibleStoreIds`) - never trusted from the client.

## Origin store badge

Every message row can carry `storeId` (the sender's workspace at send time). The messages endpoint batches the origin store lookups (no N+1) and returns `originStoreId`, `originStoreName` and `originStoreCode` per message, so the UI can badge each message with its branch (`JUJ`, `THI`, ...) or "Organization" when the sender had no store origin (for example from the org console).

When sending, a claimed origin store is honoured only if it is one the sender may operate in; a forged or unreachable claim falls back to the sender's own primary store. The message is stamped `messageType: 'TEXT'`.

## Endpoints

All endpoints are authenticated (`requireAuth`). Non-GET chat requests are rate limited by the proxy's `MESSAGING` tier (see below).

| Endpoint | Method | Behaviour |
|----------|--------|-----------|
| `/api/chat/channels` | GET | Channels visible to the caller: the global channel first, then their store threads (up to 100) with `storeName`, `storeCode`, `isGlobal`, `lastMessageAt`, `lastMessagePreview`, `messageCount` |
| `/api/chat/channels` | POST | Create a store-scoped thread (`INTERNAL`). The global channel is a singleton and cannot be created or deleted here. Zod-validated; the target store must be in the caller's accessible set (403 otherwise) |
| `/api/chat/channels/{channelId}/messages` | GET | Message history, cursor pagination (`?before=<ISO timestamp>`, `?limit=` 1-100, default 50), oldest first, with sender (`id`, `name`, `role`) and origin badge fields |
| `/api/chat/channels/{channelId}/messages` | POST | Send a message (see security below). Updates the conversation's `lastMessageAt` and `lastMessagePreview` (first 100 characters) |
| `/api/chat/channels/{channelId}/read` | POST | Mark the channel read: upserts the caller's timestamp into the target message's `readStatus` JSON (explicit `messageId` or the latest message) |
| `/api/chat/unread-count` | GET | Unread badge count across the global channel and all accessible store channels (latest message per channel that is newer than the caller's read marker and not their own) |

Access denied on any channel returns `403` with a generic message.

## Polling fallback: 5s / 15s

The chat page (`/chat`, `src/components/workspace/global-chat.tsx`) polls:

- **Messages: every 5 seconds** for the active channel, with an append-only merge so replays never produce duplicate bubbles.
- **Channel list: every 15 seconds** to pick up thread activity and new previews.

Polling was chosen over push for the chat surface specifically because it works identically on Vercel serverless, Docker self-hosting and offline LAN installs, and because chat never blocks the POS (a stalled chat poll cannot affect checkout).

## Security

- **Zod validation** on every write: `chatMessageSchema` (content trimmed, 1 to `CHAT_MAX_MESSAGE_LENGTH` = 2000 characters; optional nullable `storeId` max 64 chars) and `chatChannelCreateSchema` (title 1-120, storeId required, up to 50 participant ids). Invalid payloads return 400 with the first issue message.
- **2000 character cap** enforced server-side (`CHAT_MAX_MESSAGE_LENGTH`).
- **MESSAGING rate tier**: the proxy rate limits non-GET `/api/chat/*` requests at 30 requests per minute per client IP (tier key includes the path prefix), with `429` + `Retry-After` when exceeded.
- **Text-only rendering**: the client renders message content as plain text - there is no HTML injection surface.
- **No existence leak**: unknown channels answer with the same 403 as forbidden ones.

### Moderation: documented limitation

There is no moderation tooling in v2.16.0: no delete-message endpoint, no admin moderation UI, no per-user mute. Messages are append-only rows; a Super Admin can remove abusive content only with direct database access. If abuse becomes a problem, add moderation endpoints before exposing chat to large teams.

## Why no WebSocket for chat

The realtime notification service (`mini-services/notification-service`, socket.io on port 3003) exists for live receipts and POS notifications, and only for deployments that can run it (Docker self-hosting; nginx routes same-origin `/socket.io/` traffic to it with websocket upgrade). On Vercel serverless it does not run, and the client degrades gracefully.

Chat deliberately does not ride that socket:

- Chat must work on every deployment shape, including Vercel previews and offline laptops where the notification service is absent.
- Serverless-friendly: a polling client needs no sticky sessions, no extra process, and no websocket upgrade path through proxies and tunnels.
- The chat page is a dedicated route (`/chat`), so a slow poll never interacts with the POS tab's realtime needs.

If push delivery for chat is ever needed, the existing notification service is the place to extend - not a new transport in the Next.js app.

## UI entry points

The chat page is linked from the organization console header, branch workspaces and the branch selector. Each entry point can poll `/api/chat/unread-count` for its badge. The page title is "Global Chat | Mbumah Hardware POS".
