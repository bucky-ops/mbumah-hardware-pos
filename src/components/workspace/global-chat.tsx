'use client';

// MBUMAH HARDWARE POS - Global chat (v2.16.0 subdomain workspaces)
//
// Organization-wide chat built on the /api/chat/* endpoints:
//   - The GLOBAL channel is readable by every authenticated user of every
//     branch (chat visibility is deliberately separate from data access).
//   - Messages carry an origin store badge (sender branch or Organization).
//   - 5s polling fallback, no duplicate messages (append-only merge),
//     reconnect-safe, never blocks POS (dedicated route, no global sockets).
//   - Content is rendered as TEXT ONLY (no HTML injection surface).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, MessagesSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginScreen } from '@/components/login-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { useAuthStore, useAppStore } from '@/lib/stores';
import { authorizedFetchJson } from '@/lib/api';
import { useWorkspaceAuthBoot } from '@/lib/workspace/workspace-store';
import { useWorkspaceStore } from '@/lib/workspace/workspace-store';

interface ChatChannel {
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

interface ChatMessage {
  id: string;
  content: string;
  messageType: string;
  sentAt: string;
  isOwn: boolean;
  sender: { id: string; name: string; role: string };
  originStoreId: string | null;
  originStoreName?: string | null;
  originStoreCode?: string | null;
  readBy?: number;
}

const POLL_INTERVAL_MS = 5000;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function GlobalChat() {
  const hasMounted = useWorkspaceAuthBoot();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const workspaceStore = useWorkspaceStore((s) => s.store);
  const [channels, setChannels] = useState<ChatChannel[] | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const knownMessageIds = useRef<Set<string>>(new Set());

  // Channel list: poll every 15s for thread activity.
  useEffect(() => {
    document.title = 'Global Chat | Mbumah Hardware POS';
    return () => {
      document.title = 'MBUMAH HARDWARE - POS & ERP System';
    };
  }, []);

  const loadChannels = useCallback(async () => {
    const res = await authorizedFetchJson('/api/chat/channels');
    if (!res.ok || !res.json?.success) return;
    const data = (res.json.data ?? []) as ChatChannel[];
    setChannels(data);
    setActiveChannelId((prev) => {
      if (prev && data.some((c) => c.id === prev)) return prev;
      const global = data.find((c) => c.isGlobal);
      return global ? global.id : data[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    // Deferred initial load: keeps the effect body free of synchronous
    // setState (react-hooks/set-state-in-effect) while polling continues.
    const initial = setTimeout(() => void loadChannels(), 0);
    const timer = setInterval(() => void loadChannels(), 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [isAuthenticated, loadChannels]);

  // Messages: 5s polling with append-only merge (no duplicates).
  const loadMessages = useCallback(async (channelId: string) => {
    const res = await authorizedFetchJson(`/api/chat/channels/${encodeURIComponent(channelId)}/messages?limit=80`);
    if (!res.ok || !res.json?.success) return;
    const data = (res.json.data ?? []) as ChatMessage[];
    setMessages((prev) => {
      const fresh = data.filter((m) => !knownMessageIds.current.has(m.id));
      for (const m of fresh) knownMessageIds.current.add(m.id);
      if (fresh.length === 0) return prev;
      // Merge by id, keep chronological order.
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of data) map.set(m.id, m);
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
      );
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !activeChannelId) return;
    // Deferred reset + first fetch (same set-state-in-effect rationale).
    const initial = setTimeout(() => {
      knownMessageIds.current = new Set();
      setMessages([]);
      void loadMessages(activeChannelId);
    }, 0);
    const timer = setInterval(() => void loadMessages(activeChannelId), POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [isAuthenticated, activeChannelId, loadMessages]);

  // Auto-scroll to the newest message (respecting manual scroll-up).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || !activeChannelId || sending) return;
    setSending(true);
    setError('');
    const res = await authorizedFetchJson(
      `/api/chat/channels/${encodeURIComponent(activeChannelId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          content,
          // Origin = the workspace this tab is in (org console sends null).
          storeId: workspaceStore?.id ?? currentStoreId ?? null,
        }),
      },
    );
    setSending(false);
    if (!res.ok || !res.json?.success) {
      setError(res.json?.error || 'Message could not be sent.');
      return;
    }
    setDraft('');
    const message = res.json.data as ChatMessage;
    knownMessageIds.current.add(message.id);
    setMessages((prev) => [...prev, message]);
    void loadChannels();
  }, [draft, activeChannelId, sending, workspaceStore, currentStoreId, loadChannels]);

  const activeChannel = useMemo(
    () => channels?.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  if (!hasMounted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading chat...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <LoginScreen />
      </ErrorBoundary>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      <header className="border-b bg-background">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
              Back
            </Link>
          </Button>
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <MessagesSquare className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Global Chat</h1>
            <p className="text-xs text-muted-foreground">All branches and the organization console, one room</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 grid md:grid-cols-[240px_1fr] gap-4 min-h-0">
        {/* Channel list */}
        <aside aria-label="Chat channels" className="border rounded-lg bg-card overflow-y-auto custom-scrollbar max-h-48 md:max-h-none">
          {channels === null ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <ul className="divide-y">
              {channels.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setActiveChannelId(c.id)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-muted/60 ${c.id === activeChannelId ? 'bg-muted font-medium' : ''}`}
                    aria-current={c.id === activeChannelId ? 'true' : undefined}
                  >
                    <span className="flex items-center gap-1.5">
                      {c.isGlobal ? (
                        <Badge variant="secondary" className="text-[10px]">Global</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">{c.storeCode || 'Branch'}</Badge>
                      )}
                      <span className="truncate">{c.isGlobal ? 'Global (All Stores)' : c.title || 'Thread'}</span>
                    </span>
                    {c.lastMessagePreview && (
                      <span className="block text-xs text-muted-foreground truncate mt-0.5">{c.lastMessagePreview}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Thread */}
        <section aria-label="Messages" className="border rounded-lg bg-card flex flex-col min-h-[60vh] md:min-h-0">
          <div className="px-4 py-2.5 border-b flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium truncate">
              {activeChannel?.isGlobal ? 'Global (All Stores)' : activeChannel?.title || 'Select a channel'}
            </p>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 max-h-96 md:max-h-[calc(100vh-16rem)]">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No messages yet. Say hello to every branch.
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.isOwn ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                    <span className="font-medium text-foreground">{m.isOwn ? 'You' : m.sender.name}</span>
                    <MessageOriginBadge message={m} />
                    <span>{timeLabel(m.sentAt)}</span>
                  </div>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    {/* Text-only render: chat content is never HTML. */}
                    {m.content}
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            className="border-t p-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message every branch..."
              maxLength={2000}
              aria-label="Message text"
              className="flex-1 h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button type="submit" size="sm" disabled={sending || draft.trim().length === 0}>
              {sending ? 'Sending...' : (
                <>
                  <Send className="h-4 w-4 mr-1" aria-hidden="true" />
                  Send
                </>
              )}
            </Button>
          </form>
          {error && <p className="px-3 pb-3 text-xs text-red-600" role="alert">{error}</p>}
        </section>
      </main>
    </div>
  );
}

function MessageOriginBadge({ message }: { message: ChatMessage }) {
  if (message.originStoreId) {
    return (
      <Badge variant="outline" className="text-[10px] px-1 py-0" title={message.originStoreName || undefined}>
        {message.originStoreCode || message.originStoreName || 'Branch'}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] px-1 py-0">Organization</Badge>
  );
}
