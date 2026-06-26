'use client';

/**
 * Conversations Tab — internal staff chat (threaded, real-time-ish).
 *
 * Two-pane layout (desktop):
 *   • Left:  conversation list (with search + "new conversation" button)
 *   • Right: selected conversation's message thread + composer
 *
 * On mobile: the panes toggle — selecting a conversation slides the thread
 * into view; a back button returns to the list.
 *
 * Backed by /api/messages/conversations routes (see Phase 4). Uses TanStack
 * Query for data fetching with 5-second refetch polling on the active
 * conversation's messages for near-real-time updates.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MessageSquare, Send, Plus, Search, ArrowLeft, Users,
  Loader2, Trash2, Settings2, Hash, Clock, CheckCheck,
  RefreshCw, X, UserCircle2,
} from 'lucide-react';

import { useAppStore, useAuthStore } from '@/lib/stores';
import {
  conversationsApi,
  usersApi,
  type ConversationItem,
  type ConversationMessageItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return d.toLocaleDateString('en-GB', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatFullTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-rose-500', 'bg-pink-500', 'bg-fuchsia-500', 'bg-purple-500',
    'bg-violet-500', 'bg-indigo-500', 'bg-blue-500', 'bg-sky-500',
    'bg-cyan-500', 'bg-teal-500', 'bg-emerald-500', 'bg-green-500',
    'bg-lime-500', 'bg-yellow-500', 'bg-amber-500', 'bg-orange-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ── Conversation List Pane ───────────────────────────────────────────────────

function ConversationList({
  storeId,
  selectedId,
  onSelect,
  onNewConversation,
}: {
  storeId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['conversations', storeId, typeFilter],
    queryFn: () => conversationsApi.list(storeId, typeFilter !== 'all' ? typeFilter : undefined),
    enabled: !!storeId,
    refetchInterval: 10_000, // Poll for new conversations every 10s
  });

  const conversations = data?.data ?? [];

  const filtered = useMemo(() => {
    if (!search) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.participants?.some((p) => p.name.toLowerCase().includes(q)) ||
        c.lastMessagePreview?.toLowerCase().includes(q),
    );
  }, [conversations, search]);

  return (
    <div className="flex flex-col h-full border-r">
      {/* Header */}
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Conversations
          </h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" className="h-7" onClick={onNewConversation}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="INTERNAL">Internal (staff)</SelectItem>
            <SelectItem value="CUSTOMER_SUPPORT">Customer support</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 px-4 space-y-2">
            <MessageSquare className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {search ? 'No conversations match your search.' : 'No conversations yet.'}
            </p>
            {!search && (
              <Button variant="outline" size="sm" onClick={onNewConversation}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Start one
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-0.5 p-1">
            {filtered.map((conv) => (
              <ConversationListItem
                key={conv.id}
                conversation={conv}
                selected={conv.id === selectedId}
                onClick={() => onSelect(conv.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ConversationListItem({
  conversation,
  selected,
  onClick,
}: {
  conversation: ConversationItem;
  selected: boolean;
  onClick: () => void;
}) {
  const title =
    conversation.title ||
    conversation.participants?.map((p) => p.name).join(', ') ||
    'Untitled conversation';
  const preview = conversation.lastMessagePreview || 'No messages yet';
  const lastAt = conversation.lastMessageAt;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-2.5 rounded-lg transition-colors ${
        selected
          ? 'bg-primary/10 ring-1 ring-primary/30'
          : 'hover:bg-muted/60'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="relative">
          <Avatar className="h-9 w-9">
            <AvatarFallback className={getAvatarColor(title)}>
              {getInitials(title)}
            </AvatarFallback>
          </Avatar>
          {conversation.type === 'INTERNAL' && (
            <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-blue-500 border-2 border-background flex items-center justify-center">
              <Users className="h-2 w-2 text-white" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm truncate text-foreground">{title}</p>
            {lastAt && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatTime(lastAt)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{preview}</p>
          {conversation.messageCount != null && conversation.messageCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                <Hash className="h-2.5 w-2.5 mr-0.5" />
                {conversation.messageCount}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {conversation.participants?.length || 0} participants
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Conversation Thread Pane ─────────────────────────────────────────────────

function ConversationThread({
  storeId,
  conversationId,
  onBack,
}: {
  storeId: string;
  conversationId: string;
  onBack: () => void;
}) {
  const authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load conversation metadata.
  const { data: conversationData, isLoading: loadingMeta } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => conversationsApi.get(conversationId),
    enabled: !!conversationId,
  });

  // Load messages with polling.
  const { data: messagesData, isLoading: loadingMessages } = useQuery({
    queryKey: ['conversation-messages', conversationId],
    queryFn: () => conversationsApi.listMessages(conversationId, { limit: 100, order: 'asc' }),
    enabled: !!conversationId,
    refetchInterval: 5_000, // Poll for new messages every 5s
  });

  const messages = messagesData?.data ?? [];
  const conversation = conversationData?.data;

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const postMutation = useMutation({
    mutationFn: (data: { content: string }) =>
      conversationsApi.postMessage(conversationId, { content: data.content, messageType: 'TEXT' }),
    onSuccess: () => {
      setMessageText('');
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations', storeId] });
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
    },
    onError: (err) => handleError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: () => conversationsApi.delete(conversationId),
    onSuccess: () => {
      toast.success('Conversation deleted.');
      queryClient.invalidateQueries({ queryKey: ['conversations', storeId] });
      onBack();
    },
    onError: (err) => handleError(err),
  });

  const handleSend = () => {
    const trimmed = messageText.trim();
    if (!trimmed || postMutation.isPending) return;
    postMutation.mutate({ content: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loadingMeta || !conversation) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b">
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className={`h-12 w-2/3 ${i % 2 ? 'ml-auto' : ''}`} />
          ))}
        </div>
      </div>
    );
  }

  const title =
    conversation.title ||
    conversation.participants?.map((p) => p.name).join(', ') ||
    'Untitled conversation';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar className="h-8 w-8">
          <AvatarFallback className={getAvatarColor(title)}>
            {getInitials(title)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{title}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              {conversation.type === 'INTERNAL' ? 'Internal' : 'Support'}
            </Badge>
            <span>{conversation.participants?.length || 0} participants</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowSettings(true)}>
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 bg-muted/20">
        {loadingMessages ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className={`h-12 w-2/3 ${i % 2 ? 'ml-auto' : ''}`} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <MessageSquare className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No messages yet.</p>
            <p className="text-xs text-muted-foreground/60">Send the first message below to start the conversation.</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              showAvatar={
                idx === 0 ||
                messages[idx - 1].senderId !== msg.senderId ||
                new Date(messages[idx - 1].sentAt).getTime() + 5 * 60 * 1000 < new Date(msg.sentAt).getTime()
              }
            />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="p-3 border-t bg-background">
        <div className="flex items-end gap-2">
          <Textarea
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            className="resize-none min-h-[40px] max-h-32 text-sm"
            disabled={postMutation.isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!messageText.trim() || postMutation.isPending}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {postMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Settings dialog — key forces remount on open so form state resets from props */}
      <ConversationSettingsDialog
        key={`settings-${conversation.id}-${showSettings}`}
        conversation={conversation}
        open={showSettings}
        onOpenChange={setShowSettings}
        storeId={storeId}
      />

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{title}" and all {conversation.messageCount ?? 0} message(s).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MessageBubble({
  message,
  showAvatar,
}: {
  message: ConversationMessageItem;
  showAvatar: boolean;
}) {
  const isSystem = message.messageType === 'SYSTEM';
  const isOwn = message.isOwn;
  const senderName = message.sender?.name || 'Unknown';

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full max-w-md text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 shrink-0 ${showAvatar ? '' : 'invisible'}`}>
        {showAvatar && (
          <Avatar className="h-8 w-8">
            <AvatarFallback className={isOwn ? 'bg-primary text-primary-foreground' : getAvatarColor(senderName)}>
              {getInitials(senderName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        {showAvatar && (
          <div className={`flex items-center gap-1.5 text-xs ${isOwn ? 'flex-row-reverse' : ''}`}>
            <span className="font-medium text-foreground">
              {isOwn ? 'You' : senderName}
            </span>
            <span className="text-muted-foreground">{formatTime(message.sentAt)}</span>
          </div>
        )}
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
            isOwn
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-card border rounded-bl-md'
          }`}
          title={formatFullTime(message.sentAt)}
        >
          {message.content}
        </div>
        {isOwn && message.readBy.length > 1 && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground px-1">
            <CheckCheck className="h-3 w-3" />
            <span>Read by {message.readBy.length - 1}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings Dialog ──────────────────────────────────────────────────────────

function ConversationSettingsDialog({
  conversation,
  open,
  onOpenChange,
  storeId,
}: {
  conversation: ConversationItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(conversation.title || '');
  const [type, setType] = useState(conversation.type);

  // Load store users for the "add participant" selector.
  const { data: usersData } = useQuery({
    queryKey: ['store-users', storeId],
    queryFn: () => usersApi.list(storeId),
    enabled: open && !!storeId,
  });
  const storeUsers = usersData?.data ?? [];
  const eligibleUsers = storeUsers.filter(
    (u: { id: string; isActive: boolean }) =>
      u.isActive && !conversation.participantIds.includes(u.id),
  );

  const [addUserId, setAddUserId] = useState('');

  // State is lazily initialized from `conversation` on mount. The parent
  // remounts this component (via `key`) whenever the dialog opens, so these
  // initial values are always fresh — no effect-based reset needed.

  const updateMutation = useMutation({
    mutationFn: (data: { title?: string; type?: 'INTERNAL' | 'CUSTOMER_SUPPORT'; addParticipantIds?: string[] }) =>
      conversationsApi.update(conversation.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations', storeId] });
    },
    onError: (err) => handleError(err),
  });

  const handleSaveSettings = () => {
    const updates: { title?: string; type?: 'INTERNAL' | 'CUSTOMER_SUPPORT' } = {};
    if (title !== (conversation.title || '')) updates.title = title;
    if (type !== conversation.type) updates.type = type;
    if (Object.keys(updates).length > 0) {
      updateMutation.mutate(updates);
    }
  };

  const handleAddParticipant = () => {
    if (!addUserId) return;
    updateMutation.mutate(
      { addParticipantIds: [addUserId] },
      {
        onSuccess: () => {
          toast.success('Participant added.');
          setAddUserId('');
        },
      },
    );
  };

  const handleRemoveParticipant = (userId: string) => {
    updateMutation.mutate(
      { removeParticipantIds: [userId] },
      {
        onSuccess: () => toast.success('Participant removed.'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Conversation Settings
          </DialogTitle>
          <DialogDescription>Update title, type, and participants.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="conv-title">Title</Label>
            <Input
              id="conv-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Optional conversation title"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="conv-type">Type</Label>
            <Select value={type} onValueChange={(v: 'INTERNAL' | 'CUSTOMER_SUPPORT') => setType(v)}>
              <SelectTrigger id="conv-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INTERNAL">Internal (staff)</SelectItem>
                <SelectItem value="CUSTOMER_SUPPORT">Customer support</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Participants */}
          <div className="space-y-2">
            <Label>Participants ({conversation.participants?.length || 0})</Label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
              {conversation.participants?.map((p) => (
                <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg border text-sm">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className={getAvatarColor(p.name)}>
                      {getInitials(p.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.role}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-rose-600 hover:text-rose-700"
                    onClick={() => handleRemoveParticipant(p.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Add participant */}
          {eligibleUsers.length > 0 && (
            <div className="flex gap-2">
              <Select value={addUserId} onValueChange={setAddUserId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Add a participant..." />
                </SelectTrigger>
                <SelectContent>
                  {eligibleUsers.map((u: { id: string; name: string; role: string }) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleAddParticipant} disabled={!addUserId || updateMutation.isPending}>
                Add
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleSaveSettings} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── New Conversation Dialog ──────────────────────────────────────────────────

function NewConversationDialog({
  storeId,
  open,
  onOpenChange,
  onCreated,
}: {
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'INTERNAL' | 'CUSTOMER_SUPPORT'>('INTERNAL');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['store-users', storeId],
    queryFn: () => usersApi.list(storeId),
    enabled: open && !!storeId,
  });
  const storeUsers = (usersData?.data ?? []).filter((u: { isActive: boolean }) => u.isActive);

  // State defaults are already correct. The parent remounts this component
  // (via `key`) whenever the dialog opens, so state is always fresh — no
  // effect-based reset needed.

  const createMutation = useMutation({
    mutationFn: () =>
      conversationsApi.create({
        storeId,
        type,
        title: title.trim() || undefined,
        participantIds: selectedUserIds,
      }),
    onSuccess: (data) => {
      const conv = data.data;
      toast.success('Conversation created.');
      queryClient.invalidateQueries({ queryKey: ['conversations', storeId] });
      onOpenChange(false);
      if (conv) onCreated(conv.id);
    },
    onError: (err) => handleError(err),
  });

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            New Conversation
          </DialogTitle>
          <DialogDescription>
            Start a new chat thread. You'll be added as a participant automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="new-conv-title">Title (optional)</Label>
            <Input
              id="new-conv-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Inventory Restock Discussion"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-conv-type">Type</Label>
            <Select value={type} onValueChange={(v: 'INTERNAL' | 'CUSTOMER_SUPPORT') => setType(v)}>
              <SelectTrigger id="new-conv-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INTERNAL">Internal (staff-to-staff)</SelectItem>
                <SelectItem value="CUSTOMER_SUPPORT">Customer support</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Participants (select at least 1)</Label>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : storeUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No other active users in this store.</p>
            ) : (
              <ScrollArea className="max-h-48 rounded-md border">
                <div className="divide-y">
                  {storeUsers.map((u: { id: string; name: string; email: string; role: string }) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 p-2.5 hover:bg-muted/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(u.id)}
                        onChange={() => toggleUser(u.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className={getAvatarColor(u.name)}>
                          {getInitials(u.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email} • {u.role}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || selectedUserIds.length === 0}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Conversation'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function ConversationsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);

  if (!currentStoreId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Please select a store to view conversations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-blue-600" />
            Staff Conversations
          </h2>
          <p className="text-sm text-muted-foreground">
            Internal team chat and customer support threads. Separate from customer messaging.
          </p>
        </div>
      </div>

      <Card className="h-[calc(100vh-220px)] min-h-[500px] overflow-hidden p-0">
        <div className="grid md:grid-cols-[320px_1fr] h-full">
          {/* List pane — hidden on mobile when a conversation is selected */}
          <div className={`h-full ${selectedId ? 'hidden md:block' : 'block'}`}>
            <ConversationList
              storeId={currentStoreId}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNewConversation={() => setShowNewDialog(true)}
            />
          </div>

          {/* Thread pane — hidden on mobile when no conversation is selected */}
          <div className={`h-full ${selectedId ? 'block' : 'hidden md:block'}`}>
            {selectedId ? (
              <ConversationThread
                storeId={currentStoreId}
                conversationId={selectedId}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-3">
                <div className="p-4 rounded-full bg-muted">
                  <MessageSquare className="h-10 w-10 text-muted-foreground/60" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Select a conversation</p>
                  <p className="text-xs text-muted-foreground">
                    Choose a conversation from the list, or start a new one.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowNewDialog(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  New Conversation
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <NewConversationDialog
        key={`new-${showNewDialog}`}
        storeId={currentStoreId}
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
