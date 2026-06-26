'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MessageSquare, Send, Phone, Clock, CheckCircle, AlertCircle,
  Loader2, Plus, Search, Filter, Smartphone, Mail,
  FileText, Bell, RefreshCw,
  PartyPopper, Sparkles,
  Calendar, Users, ExternalLink,
} from 'lucide-react';
import { useAppStore, useAuthStore } from '@/lib/stores';
import {
  messagesApi, customersApi, debtApi, messagingApi,
  formatKES, formatDateTime,
  openWhatsApp, openEmail, openSMS,
  type BulkMessageResult,
  type BulkMessageRecipient,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import type { MessageItem } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── Badge Configs ──────────────────────────────────────────

const CHANNEL_BADGE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  WHATSAPP: {
    label: 'WhatsApp',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    icon: Phone,
  },
  SMS: {
    label: 'SMS',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    icon: Smartphone,
  },
  BOTH: {
    label: 'Both',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    icon: Mail,
  },
};

const MESSAGE_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  DEBT_REMINDER: {
    label: 'Debt Reminder',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  PAYMENT_CONFIRMATION: {
    label: 'Payment Confirmation',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  BALANCE_UPDATE: {
    label: 'Balance Update',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  PROMOTION: {
    label: 'Promotion',
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  },
  CUSTOM: {
    label: 'Custom',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

const STATUS_BADGE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: {
    label: 'Pending',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    icon: Clock,
  },
  SENT: {
    label: 'Sent',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    icon: Send,
  },
  DELIVERED: {
    label: 'Delivered',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    icon: CheckCircle,
  },
  FAILED: {
    label: 'Failed',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    icon: AlertCircle,
  },
  READ: {
    label: 'Read',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    icon: CheckCircle,
  },
};

// ── Message Templates ──────────────────────────────────────

const MESSAGE_TEMPLATES = [
  {
    id: 'christmas',
    type: 'PROMOTION',
    label: '🎄 Christmas',
    content:
      '🎄 Merry Christmas from Mbumah Hardware! We appreciate your business. Visit us for special holiday deals!',
  },
  {
    id: 'new-year',
    type: 'PROMOTION',
    label: '🎉 New Year',
    content:
      '🎉 Happy New Year from Mbumah Hardware! Start the year right with our great deals on building materials!',
  },
  {
    id: 'easter',
    type: 'PROMOTION',
    label: '🐰 Easter',
    content:
      '🐰 Happy Easter from Mbumah Hardware! Celebrate with our special Easter discounts!',
  },
  {
    id: 'valentine',
    type: 'PROMOTION',
    label: '❤️ Valentine',
    content:
      '❤️ Happy Valentine\'s Day! Show your love with a gift from Mbumah Hardware!',
  },
  {
    id: 'general-promotion',
    type: 'PROMOTION',
    label: '🔥 Promotion',
    content:
      '🔥 Special offer at Mbumah Hardware! Great deals on all building materials. Visit us today!',
  },
  {
    id: 'debt-reminder',
    type: 'DEBT_REMINDER',
    label: '💳 Debt Reminder',
    content:
      'Dear {name}, your outstanding balance at Mbumah Hardware is KES {amount}. Please settle at your earliest convenience.',
  },
  {
    id: 'thank-you',
    type: 'PAYMENT_CONFIRMATION',
    label: '👍 Thank You',
    content:
      'Thank you for doing business with Mbumah Hardware! We appreciate your continued support.',
  },
  {
    id: 'payment-confirmation',
    type: 'PAYMENT_CONFIRMATION',
    label: '✅ Payment Confirmation',
    content:
      'Thank you {customer_name}! We have received your payment of KES {amount} at MBUMAH HARDWARE. Your account has been updated.',
  },
  {
    id: 'balance-update',
    type: 'BALANCE_UPDATE',
    label: '📊 Balance Update',
    content:
      'Hello {customer_name}, your current account balance at MBUMAH HARDWARE is KES {balance}. Thank you for your continued business!',
  },
];

// ── Kenyan Holiday / Bulk Broadcast templates ──────────────────────────────
// One-click fill buttons in the Bulk Broadcast tab. Each `content` is sent
// verbatim to every recipient in the chosen audience.

const HOLIDAY_TEMPLATES: { id: string; label: string; content: string }[] = [
  {
    id: 'christmas',
    label: '🎄 Christmas',
    content:
      '🎄 Merry Christmas from Mbumah Hardware! Wishing you joy and prosperity. Thank you for your continued business.',
  },
  {
    id: 'new-year',
    label: '🎉 New Year',
    content:
      '🎉 Happy New Year from Mbumah Hardware! Wishing you a prosperous year ahead. Visit us for great deals on building materials.',
  },
  {
    id: 'easter',
    label: '🐰 Easter',
    content:
      '🐰 Happy Easter from Mbumah Hardware! May this season bring you renewal and joy. Special discounts on building materials this week.',
  },
  {
    id: 'madaraka',
    label: '🇰🇪 Madaraka Day',
    content:
      '🇰🇪 Happy Madaraka Day from Mbumah Hardware! Celebrating Kenya\'s self-governance with great deals on building materials today.',
  },
  {
    id: 'mashujaa',
    label: '🇰🇪 Mashujaa Day',
    content:
      '🇰🇪 Happy Mashujaa Day from Mbumah Hardware! Celebrating our heroes with special offers. Visit us for quality building materials.',
  },
  {
    id: 'jamhuri',
    label: '🇰🇪 Jamhuri Day',
    content:
      '🇰🇪 Happy Jamhuri Day from Mbumah Hardware! Celebrating Kenya\'s Republic with exclusive holiday discounts on all building materials.',
  },
];

type BulkAudience = 'ALL' | 'CUSTOMERS_WITH_PHONES' | 'DEBTORS' | 'LOYALTY_MEMBERS';
type BulkChannel = 'WHATSAPP' | 'SMS';

const AUDIENCE_LABELS: Record<BulkAudience, string> = {
  ALL: 'All customers',
  CUSTOMERS_WITH_PHONES: 'Customers with phones',
  DEBTORS: 'Debtors (with outstanding balance)',
  LOYALTY_MEMBERS: 'Loyalty members',
};

// ── Main Component ─────────────────────────────────────────

export default function MessagingTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const _authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState('dashboard');

  // ── Pagination State ────────────────────────────────────
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageSize = 10;

  // ── Filter State ────────────────────────────────────────
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Send Message Dialog State ───────────────────────────
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendForm, setSendForm] = useState({
    customerId: '',
    phone: '',
    channel: 'WHATSAPP' as 'SMS' | 'WHATSAPP' | 'BOTH',
    messageType: 'CUSTOM' as 'DEBT_REMINDER' | 'PAYMENT_CONFIRMATION' | 'BALANCE_UPDATE' | 'PROMOTION' | 'CUSTOM',
    subject: '',
    content: '',
  });
  const [lastWaLink, setLastWaLink] = useState<string | null>(null);

  // ── Debt Reminder Dialog State ──────────────────────────
  const [showDebtReminderDialog, setShowDebtReminderDialog] = useState(false);
  const [selectedDebtCustomerIds, setSelectedDebtCustomerIds] = useState<Set<string>>(new Set());

  // ── Balance Update Dialog State ─────────────────────────
  const [showBalanceDialog, setShowBalanceDialog] = useState(false);
  const [selectedBalanceCustomerIds, setSelectedBalanceCustomerIds] = useState<Set<string>>(new Set());

  // ── Bulk / Holiday Broadcast State ──────────────────────
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkSubject, setBulkSubject] = useState('');
  const [bulkAudience, setBulkAudience] = useState<BulkAudience>('CUSTOMERS_WITH_PHONES');
  const [bulkChannel, setBulkChannel] = useState<BulkChannel>('WHATSAPP');
  const [bulkScheduledAt, setBulkScheduledAt] = useState('');
  const [bulkResult, setBulkResult] = useState<BulkMessageResult | null>(null);

  // ── Queries ─────────────────────────────────────────────

  const messagesQuery = useQuery({
    queryKey: ['messages', currentStoreId, filterChannel, filterStatus, filterType],
    queryFn: () =>
      messagesApi.list({
        storeId: currentStoreId,
        channel: filterChannel !== 'all' ? filterChannel : undefined,
        status: filterStatus !== 'all' ? filterStatus : undefined,
        messageType: filterType !== 'all' ? filterType : undefined,
        limit: 200,
      }),
    enabled: !!currentStoreId,
  });

  const customersQuery = useQuery({
    queryKey: ['customers', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 500 }),
    enabled: !!currentStoreId,
  });

  const debtQuery = useQuery({
    queryKey: ['debt-overdue', currentStoreId],
    queryFn: () => debtApi.list({ storeId: currentStoreId, status: 'OVERDUE', limit: 200 }),
    enabled: !!currentStoreId,
  });

  const debtOutstandingQuery = useQuery({
    queryKey: ['debt-outstanding', currentStoreId],
    queryFn: () => debtApi.list({ storeId: currentStoreId, status: 'OUTSTANDING', limit: 200 }),
    enabled: !!currentStoreId,
  });

  // ── Computed Data ───────────────────────────────────────

  const messages = Array.isArray(messagesQuery.data?.data) ? messagesQuery.data.data : [];
  const customers = Array.isArray(customersQuery.data?.data) ? customersQuery.data.data : [];
  const overdueDebts = Array.isArray(debtQuery.data?.data) ? debtQuery.data.data : [];
  const outstandingDebts = Array.isArray(debtOutstandingQuery.data?.data) ? debtOutstandingQuery.data.data : [];

  // Stats
  const stats = useMemo(() => {
    const totalSent = messages.filter((m) => m.status === 'SENT' || m.status === 'DELIVERED' || m.status === 'READ').length;
    const whatsappSent = messages.filter((m) => (m.channel === 'WHATSAPP' || m.channel === 'BOTH') && (m.status === 'SENT' || m.status === 'DELIVERED' || m.status === 'READ')).length;
    const pending = messages.filter((m) => m.status === 'PENDING').length;
    const failed = messages.filter((m) => m.status === 'FAILED').length;
    return { totalSent, whatsappSent, pending, failed };
  }, [messages]);

  // Filtered messages for history
  const filteredMessages = useMemo(() => {
    let result = [...messages];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          (m.customerName && m.customerName.toLowerCase().includes(q)) ||
          (m.customerPhone && m.customerPhone.toLowerCase().includes(q)) ||
          m.content.toLowerCase().includes(q) ||
          (m.subject && m.subject.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [messages, searchQuery]);

  // Paginated messages
  const paginatedMessages = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return filteredMessages.slice(start, start + historyPageSize);
  }, [filteredMessages, historyPage, historyPageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredMessages.length / historyPageSize));

  // Overdue debt customers (unique by customerId)
  const overdueCustomers = useMemo(() => {
    const map = new Map<string, { customerId: string; customerName: string; phone: string | null; totalOwed: number }>();
    for (const d of overdueDebts) {
      const key = d.customerId;
      const existing = map.get(key);
      const name = d.customer?.name ?? 'Unknown';
      const phone = d.customer?.phone ?? null;
      if (existing) {
        existing.totalOwed += d.balance;
      } else {
        map.set(key, { customerId: d.customerId, customerName: name, phone, totalOwed: d.balance });
      }
    }
    return Array.from(map.values());
  }, [overdueDebts]);

  // Outstanding debt customers (with balance > 0)
  const balanceCustomers = useMemo(() => {
    const map = new Map<string, { customerId: string; customerName: string; phone: string | null; balance: number }>();
    for (const d of outstandingDebts) {
      const key = d.customerId;
      const existing = map.get(key);
      const name = d.customer?.name ?? 'Unknown';
      const phone = d.customer?.phone ?? null;
      if (existing) {
        existing.balance += d.balance;
      } else {
        map.set(key, { customerId: d.customerId, customerName: name, phone, balance: d.balance });
      }
    }
    // Also include overdue customers
    for (const d of overdueDebts) {
      const key = d.customerId;
      const existing = map.get(key);
      const name = d.customer?.name ?? 'Unknown';
      const phone = d.customer?.phone ?? null;
      if (existing) {
        existing.balance += d.balance;
      } else {
        map.set(key, { customerId: d.customerId, customerName: name, phone, balance: d.balance });
      }
    }
    return Array.from(map.values());
  }, [outstandingDebts, overdueDebts]);

  // ── Customer lookup ─────────────────────────────────────

  const selectedCustomer = useMemo(() => {
    if (!sendForm.customerId) return null;
    return customers.find((c) => c.id === sendForm.customerId) ?? null;
  }, [customers, sendForm.customerId]);

  // ── Mutations ───────────────────────────────────────────

  const sendMessageMutation = useMutation({
    mutationFn: (data: { customerId?: string; phone: string; channel: 'SMS' | 'WHATSAPP' | 'BOTH'; messageType: 'DEBT_REMINDER' | 'PAYMENT_CONFIRMATION' | 'BALANCE_UPDATE' | 'PROMOTION' | 'CUSTOM'; subject?: string; content: string; storeId?: string }) =>
      messagesApi.send(data),
    onSuccess: (response: { data?: MessageItem }) => {
      toast.success('Message sent successfully');
      queryClient.invalidateQueries({ queryKey: ['messages', currentStoreId] });
      if (response.data?.waLink) {
        setLastWaLink(response.data.waLink);
      } else {
        setShowSendDialog(false);
        resetSendForm();
      }
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Send message');
      toast.error(msg);
    },
  });

  const sendDebtReminderMutation = useMutation({
    mutationFn: ({ customerId, phone, storeId, debtAmount }: { customerId: string; phone: string; storeId: string; debtAmount: number }) =>
      messagesApi.sendDebtReminder(customerId, phone, storeId, debtAmount),
    onSuccess: () => {
      toast.success('Debt reminder sent');
      queryClient.invalidateQueries({ queryKey: ['messages', currentStoreId] });
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Send debt reminder');
      toast.error(msg);
    },
  });

  const sendBalanceUpdateMutation = useMutation({
    mutationFn: ({ customerId, phone, storeId, balance }: { customerId: string; phone: string; storeId: string; balance: number }) =>
      messagesApi.sendBalanceUpdate(customerId, phone, storeId, balance),
    onSuccess: () => {
      toast.success('Balance update sent');
      queryClient.invalidateQueries({ queryKey: ['messages', currentStoreId] });
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Send balance update');
      toast.error(msg);
    },
  });

  // ── Bulk Broadcast Mutation ─────────────────────────────
  // Calls messagingApi.bulk({ storeId, message, channel, audience, subject,
  // scheduledAt }) and surfaces a per-recipient results panel.
  const sendBulkBroadcastMutation = useMutation({
    mutationFn: async (): Promise<BulkMessageResult> => {
      const payload = {
        storeId: currentStoreId,
        message: bulkMessage.trim(),
        channel: bulkChannel,
        audience: bulkAudience,
        subject: bulkSubject.trim() || undefined,
        scheduledAt: bulkScheduledAt ? new Date(bulkScheduledAt).toISOString() : undefined,
      };
      // Preferred: typed API client (returns ApiResponse<BulkMessageResult>).
      try {
        const res = await messagingApi.bulk(payload);
        if (res?.data) return res.data;
      } catch {
        // fall through to direct fetch
      }
      // Fallback: direct fetch with same-origin credentials.
      const r = await fetch('/api/messaging/bulk', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await r.json()) as { success?: boolean; data?: BulkMessageResult; error?: string };
      if (!json.success || !json.data) {
        throw new Error(json.error || `Request failed: ${r.status}`);
      }
      return json.data;
    },
    onSuccess: (result) => {
      toast.success(
        `Broadcast queued: ${result.sent.length} recipient${result.sent.length === 1 ? '' : 's'}, ${result.skipped.length} skipped`,
      );
      setBulkResult(result);
      queryClient.invalidateQueries({ queryKey: ['messages', currentStoreId] });
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Send bulk broadcast');
      toast.error(msg);
    },
  });

  // ── Handlers ────────────────────────────────────────────

  function resetSendForm() {
    setSendForm({
      customerId: '',
      phone: '',
      channel: 'WHATSAPP',
      messageType: 'CUSTOM',
      subject: '',
      content: '',
    });
    setLastWaLink(null);
  }

  function handleCustomerSelect(customerId: string) {
    const customer = customers.find((c) => c.id === customerId);
    setSendForm((prev) => ({
      ...prev,
      customerId,
      phone: customer?.phone ?? '',
    }));
  }

  function handleTemplateSelect(templateId: string) {
    const template = MESSAGE_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      const customerName = selectedCustomer?.name ?? '{customer_name}';
      // Try to get debt amount for the selected customer (combine overdue + outstanding).
      const allDebts = [...overdueDebts, ...outstandingDebts];
      const customerDebt = selectedCustomer
        ? allDebts
            .filter((d) => d.customerId === selectedCustomer.id)
            .reduce((s, d) => s + d.balance, 0)
        : 0;
      const debtAmount = customerDebt > 0 ? customerDebt : 0;
      const content = template.content
        .replace('{customer_name}', customerName)
        .replace('{name}', customerName)
        .replace('{amount}', formatKES(debtAmount))
        .replace('{balance}', formatKES(debtAmount));
      setSendForm((prev) => ({
        ...prev,
        messageType: template.type as typeof prev.messageType,
        content,
      }));
    }
  }

  function _handleSendMessage() {
    if (!sendForm.phone.trim()) {
      toast.error('Phone number is required');
      return;
    }
    if (!sendForm.content.trim()) {
      toast.error('Message content is required');
      return;
    }
    sendMessageMutation.mutate({
      customerId: sendForm.customerId || undefined,
      phone: sendForm.phone,
      channel: sendForm.channel,
      messageType: sendForm.messageType,
      subject: sendForm.subject || undefined,
      content: sendForm.content,
      storeId: currentStoreId,
    });
  }

  function handleSendDebtReminders() {
    if (selectedDebtCustomerIds.size === 0) {
      toast.error('Select at least one customer');
      return;
    }
    let sentCount = 0;
    for (const customerId of selectedDebtCustomerIds) {
      const cust = overdueCustomers.find((c) => c.customerId === customerId);
      if (cust?.phone) {
        sendDebtReminderMutation.mutate({
          customerId: cust.customerId,
          phone: cust.phone,
          storeId: currentStoreId,
          debtAmount: cust.totalOwed,
        });
        sentCount++;
      }
    }
    if (sentCount > 0) {
      toast.success(`Sending ${sentCount} debt reminder(s)...`);
      setSelectedDebtCustomerIds(new Set());
      setShowDebtReminderDialog(false);
    } else {
      toast.error('None of the selected customers have a phone number');
    }
  }

  function handleSendBalanceUpdates() {
    if (selectedBalanceCustomerIds.size === 0) {
      toast.error('Select at least one customer');
      return;
    }
    let sentCount = 0;
    for (const customerId of selectedBalanceCustomerIds) {
      const cust = balanceCustomers.find((c) => c.customerId === customerId);
      if (cust?.phone) {
        sendBalanceUpdateMutation.mutate({
          customerId: cust.customerId,
          phone: cust.phone,
          storeId: currentStoreId,
          balance: cust.balance,
        });
        sentCount++;
      }
    }
    if (sentCount > 0) {
      toast.success(`Sending ${sentCount} balance update(s)...`);
      setSelectedBalanceCustomerIds(new Set());
      setShowBalanceDialog(false);
    } else {
      toast.error('None of the selected customers have a phone number');
    }
  }

  function toggleDebtCustomer(customerId: string) {
    setSelectedDebtCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  function toggleBalanceCustomer(customerId: string) {
    setSelectedBalanceCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Messaging</h2>
          <p className="text-muted-foreground text-sm">
            Send messages, reminders, and promotions to your customers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['messages', currentStoreId] });
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { resetSendForm(); setShowSendDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" />
            Send Message
          </Button>
        </div>
      </div>

      {/* ── Sub Tabs ───────────────────────────────────────── */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="quick-send">Quick Send</TabsTrigger>
          <TabsTrigger value="bulk-broadcast">Broadcast</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════
            DASHBOARD TAB
        ══════════════════════════════════════════════════════ */}
        <TabsContent value="dashboard" className="space-y-6 mt-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Messages Sent</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalSent}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Sent, delivered &amp; read
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">WhatsApp Sent</CardTitle>
                <Phone className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">
                  {stats.whatsappSent}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Via WhatsApp channel
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Pending</CardTitle>
                <Clock className="h-4 w-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {stats.pending}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Awaiting delivery
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
                <AlertCircle className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-700 dark:text-red-400">
                  {stats.failed}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Delivery failures
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Message Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Messages by Channel</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(['WHATSAPP', 'SMS', 'BOTH'] as const).map((channel) => {
                    const count = messages.filter((m) => m.channel === channel).length;
                    const pct = messages.length > 0 ? (count / messages.length) * 100 : 0;
                    const config = CHANNEL_BADGE[channel];
                    return (
                      <div key={channel} className="flex items-center gap-3">
                        <div className={`p-1.5 rounded ${config.color}`}>
                          <config.icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="font-medium">{config.label}</span>
                            <span className="text-muted-foreground">{count}</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Messages by Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(['DEBT_REMINDER', 'PAYMENT_CONFIRMATION', 'BALANCE_UPDATE', 'PROMOTION', 'CUSTOM'] as const).map(
                    (type) => {
                      const count = messages.filter((m) => m.messageType === type).length;
                      const pct = messages.length > 0 ? (count / messages.length) * 100 : 0;
                      const config = MESSAGE_TYPE_BADGE[type];
                      return (
                        <div key={type} className="flex items-center gap-3">
                          <Badge variant="outline" className={`text-xs ${config.color}`}>
                            {config.label}
                          </Badge>
                          <div className="flex-1">
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-medium">{config.label}</span>
                              <span className="text-muted-foreground">{count}</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Messages */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Messages</CardTitle>
            </CardHeader>
            <CardContent>
              {messagesQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No messages yet</p>
                  <p className="text-xs mt-1">Send your first message to get started</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {messages.slice(0, 5).map((msg) => {
                    const statusConfig = STATUS_BADGE[msg.status] ?? STATUS_BADGE.PENDING;
                    const channelConfig = CHANNEL_BADGE[msg.channel] ?? CHANNEL_BADGE.WHATSAPP;
                    return (
                      <div
                        key={msg.id}
                        className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <div className={`p-1.5 rounded mt-0.5 ${channelConfig.color}`}>
                          <channelConfig.icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">
                              {msg.customerName || msg.customerPhone || 'Unknown'}
                            </span>
                            <Badge variant="outline" className={`text-xs ${statusConfig.color}`}>
                              {statusConfig.label}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {msg.content}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {msg.sentAt ? formatDateTime(msg.sentAt) : formatDateTime(msg.createdAt)}
                          </p>
                        </div>
                        {msg.waLink && (
                          <a
                            href={msg.waLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-600 hover:text-green-700 text-xs underline shrink-0"
                          >
                            Open WhatsApp
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════
            QUICK SEND TAB
        ══════════════════════════════════════════════════════ */}
        <TabsContent value="quick-send" className="space-y-6 mt-4">
          {/* Quick Send - Holiday & Greeting Cards */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                Quick Send
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select a message type to auto-generate a message. The message will be editable before sending.
              </p>

              {/* Message Type Selection Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {MESSAGE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTemplateSelect(t.id)}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all text-left hover:shadow-md ${
                      sendForm.content === t.content ||
                      (sendForm.messageType === t.type && sendForm.content.includes(t.content.substring(0, 20)))
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-transparent bg-muted/30 hover:bg-muted/50 hover:border-muted-foreground/20'
                    }`}
                  >
                    <span className="block text-base mb-1">{t.label}</span>
                    <span className="text-[10px] text-muted-foreground block truncate">{t.type.replace(/_/g, ' ')}</span>
                  </button>
                ))}
              </div>

              {/* Customer and Phone Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Select onValueChange={handleCustomerSelect} value={sendForm.customerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a customer..." />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-60">
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} {c.phone ? `(${c.phone})` : ''}
                          </SelectItem>
                        ))}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Phone / Email</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Phone e.g. 0712345678"
                      value={sendForm.phone}
                      onChange={(e) => setSendForm((prev) => ({ ...prev, phone: e.target.value }))}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Email (optional)"
                      value={sendForm.subject}
                      onChange={(e) => setSendForm((prev) => ({ ...prev, subject: e.target.value }))}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>

              {/* Editable Message */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Message Content</Label>
                  <span className="text-xs text-muted-foreground">{sendForm.content.length} chars</span>
                </div>
                <Textarea
                  placeholder="Select a template above or type your message here..."
                  value={sendForm.content}
                  onChange={(e) => setSendForm((prev) => ({ ...prev, content: e.target.value }))}
                  rows={4}
                  className="resize-y"
                />
              </div>

              {/* Send Buttons - WhatsApp, SMS, Email */}
              <div className="flex flex-wrap gap-3">
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    if (!sendForm.phone.trim()) {
                      toast.error('Phone number is required for WhatsApp');
                      return;
                    }
                    if (!sendForm.content.trim()) {
                      toast.error('Message content is required');
                      return;
                    }
                    openWhatsApp(sendForm.phone, sendForm.content);
                    // Also log the message
                    sendMessageMutation.mutate({
                      customerId: sendForm.customerId || undefined,
                      phone: sendForm.phone,
                      channel: 'WHATSAPP',
                      messageType: sendForm.messageType,
                      subject: sendForm.subject || undefined,
                      content: sendForm.content,
                      storeId: currentStoreId,
                    });
                  }}
                  disabled={!sendForm.phone || !sendForm.content}
                >
                  <Phone className="h-4 w-4 mr-2" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className="border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20"
                  onClick={() => {
                    if (!sendForm.phone.trim()) {
                      toast.error('Phone number is required for SMS');
                      return;
                    }
                    if (!sendForm.content.trim()) {
                      toast.error('Message content is required');
                      return;
                    }
                    openSMS(sendForm.phone, sendForm.content);
                    sendMessageMutation.mutate({
                      customerId: sendForm.customerId || undefined,
                      phone: sendForm.phone,
                      channel: 'SMS',
                      messageType: sendForm.messageType,
                      subject: sendForm.subject || undefined,
                      content: sendForm.content,
                      storeId: currentStoreId,
                    });
                  }}
                  disabled={!sendForm.phone || !sendForm.content}
                >
                  <Smartphone className="h-4 w-4 mr-2" />
                  SMS
                </Button>
                <Button
                  variant="outline"
                  className="border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  onClick={() => {
                    const emailTo = sendForm.subject || selectedCustomer?.email || '';
                    if (!emailTo.trim()) {
                      toast.error('Email address is required (enter in the Email field)');
                      return;
                    }
                    if (!sendForm.content.trim()) {
                      toast.error('Message content is required');
                      return;
                    }
                    openEmail(emailTo, `Mbumah Hardware - ${sendForm.messageType.replace(/_/g, ' ')}`, sendForm.content);
                    sendMessageMutation.mutate({
                      customerId: sendForm.customerId || undefined,
                      phone: sendForm.phone,
                      channel: 'WHATSAPP',
                      messageType: sendForm.messageType,
                      subject: sendForm.subject || undefined,
                      content: sendForm.content,
                      storeId: currentStoreId,
                    });
                  }}
                  disabled={!sendForm.content}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Email
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Send Debt Reminders */}
            <Card className="border-red-200 dark:border-red-900/40">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  Send Debt Reminders
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Send WhatsApp reminders to customers with overdue debts.
                  <span className="block mt-1 font-medium text-foreground">
                    {overdueCustomers.length} customer(s) with overdue debts
                  </span>
                </p>
                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => {
                    setSelectedDebtCustomerIds(new Set());
                    setShowDebtReminderDialog(true);
                  }}
                  disabled={overdueCustomers.length === 0}
                >
                  <Bell className="h-4 w-4 mr-2" />
                  Send Debt Reminders
                </Button>
              </CardContent>
            </Card>

            {/* Send Balance Updates */}
            <Card className="border-amber-200 dark:border-amber-900/40">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-5 w-5 text-amber-600" />
                  Send Balance Updates
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Send balance updates to customers with outstanding amounts.
                  <span className="block mt-1 font-medium text-foreground">
                    {balanceCustomers.length} customer(s) with outstanding balances
                  </span>
                </p>
                <Button
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => {
                    setSelectedBalanceCustomerIds(new Set());
                    setShowBalanceDialog(true);
                  }}
                  disabled={balanceCustomers.length === 0}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Send Balance Updates
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Quick Compose */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-5 w-5" />
                Quick Compose
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Customer Selector */}
                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Select onValueChange={handleCustomerSelect} value={sendForm.customerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a customer..." />
                    </SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-60">
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} {c.phone ? `(${c.phone})` : ''}
                          </SelectItem>
                        ))}
                      </ScrollArea>
                    </SelectContent>
                  </Select>
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input
                    placeholder="e.g. 0712345678"
                    value={sendForm.phone}
                    onChange={(e) => setSendForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>

                {/* Channel */}
                <div className="space-y-2">
                  <Label>Channel</Label>
                  <Select
                    value={sendForm.channel}
                    onValueChange={(val) =>
                      setSendForm((prev) => ({ ...prev, channel: val as typeof prev.channel }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                      <SelectItem value="SMS">SMS</SelectItem>
                      <SelectItem value="BOTH">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Message Type */}
                <div className="space-y-2">
                  <Label>Message Type</Label>
                  <Select
                    value={sendForm.messageType}
                    onValueChange={(val) =>
                      setSendForm((prev) => ({ ...prev, messageType: val as typeof prev.messageType }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEBT_REMINDER">Debt Reminder</SelectItem>
                      <SelectItem value="PAYMENT_CONFIRMATION">Payment Confirmation</SelectItem>
                      <SelectItem value="BALANCE_UPDATE">Balance Update</SelectItem>
                      <SelectItem value="PROMOTION">Promotion</SelectItem>
                      <SelectItem value="CUSTOM">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Subject (optional) */}
              <div className="space-y-2">
                <Label>Subject (optional)</Label>
                <Input
                  placeholder="Message subject..."
                  value={sendForm.subject}
                  onChange={(e) => setSendForm((prev) => ({ ...prev, subject: e.target.value }))}
                />
              </div>

              {/* Template Quick Select */}
              <div className="space-y-2">
                <Label>Quick Template</Label>
                <div className="flex flex-wrap gap-2">
                  {MESSAGE_TEMPLATES.map((t) => (
                    <Button
                      key={t.id}
                      variant="outline"
                      size="sm"
                      onClick={() => handleTemplateSelect(t.id)}
                      className="text-xs"
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="space-y-2">
                <Label>Message Content</Label>
                <Textarea
                  placeholder="Type your message here..."
                  value={sendForm.content}
                  onChange={(e) => setSendForm((prev) => ({ ...prev, content: e.target.value }))}
                  rows={5}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  {sendForm.content.length} characters
                </p>
              </div>

              {/* Send Buttons */}
              <div className="flex flex-wrap gap-3">
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    if (!sendForm.phone.trim()) {
                      toast.error('Phone number is required for WhatsApp');
                      return;
                    }
                    if (!sendForm.content.trim()) {
                      toast.error('Message content is required');
                      return;
                    }
                    openWhatsApp(sendForm.phone, sendForm.content);
                    sendMessageMutation.mutate({
                      customerId: sendForm.customerId || undefined,
                      phone: sendForm.phone,
                      channel: 'WHATSAPP',
                      messageType: sendForm.messageType,
                      subject: sendForm.subject || undefined,
                      content: sendForm.content,
                      storeId: currentStoreId,
                    });
                  }}
                  disabled={sendMessageMutation.isPending || !sendForm.phone || !sendForm.content}
                >
                  <Phone className="h-4 w-4 mr-2" />
                  WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className="border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
                  onClick={() => {
                    if (!sendForm.phone.trim()) {
                      toast.error('Phone number is required for SMS');
                      return;
                    }
                    if (!sendForm.content.trim()) {
                      toast.error('Message content is required');
                      return;
                    }
                    openSMS(sendForm.phone, sendForm.content);
                    sendMessageMutation.mutate({
                      customerId: sendForm.customerId || undefined,
                      phone: sendForm.phone,
                      channel: 'SMS',
                      messageType: sendForm.messageType,
                      subject: sendForm.subject || undefined,
                      content: sendForm.content,
                      storeId: currentStoreId,
                    });
                  }}
                  disabled={sendMessageMutation.isPending || !sendForm.phone || !sendForm.content}
                >
                  <Smartphone className="h-4 w-4 mr-2" />
                  SMS
                </Button>
                <Button
                  variant="outline"
                  className="border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
                  onClick={() => {
                    const emailTo = sendForm.subject || selectedCustomer?.email || '';
                    if (!emailTo.trim()) {
                      toast.error('Email address is required');
                      return;
                    }
                    if (!sendForm.content.trim()) {
                      toast.error('Message content is required');
                      return;
                    }
                    openEmail(emailTo, `Mbumah Hardware - ${sendForm.messageType.replace(/_/g, ' ')}`, sendForm.content);
                    sendMessageMutation.mutate({
                      customerId: sendForm.customerId || undefined,
                      phone: sendForm.phone,
                      channel: 'WHATSAPP',
                      messageType: sendForm.messageType,
                      subject: sendForm.subject || undefined,
                      content: sendForm.content,
                      storeId: currentStoreId,
                    });
                  }}
                  disabled={sendMessageMutation.isPending || !sendForm.content}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Email
                </Button>
              </div>

              {/* WhatsApp Link Display */}
              {lastWaLink && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-1">
                    WhatsApp link generated
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-400 mb-2">
                    Click the link below to open WhatsApp and send the message:
                  </p>
                  <a
                    href={lastWaLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-green-600 hover:text-green-700 underline break-all"
                  >
                    {lastWaLink}
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 ml-2"
                    onClick={() => {
                      navigator.clipboard.writeText(lastWaLink);
                      toast.success('Link copied to clipboard');
                    }}
                  >
                    Copy Link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 ml-1"
                    onClick={() => {
                      setShowSendDialog(false);
                      resetSendForm();
                    }}
                  >
                    Close
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════
            BULK / HOLIDAY BROADCAST TAB
        ══════════════════════════════════════════════════════ */}
        <TabsContent value="bulk-broadcast" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PartyPopper className="h-5 w-5 text-amber-500" />
                Bulk / Holiday Broadcast
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Send one message to many customers at once. We generate a wa.me deep link
                per recipient (and log every send to the Messages table for audit).
                Open each link to dispatch it in WhatsApp. SMS channel skips the link step
                and just logs the message.
              </p>

              {/* Audience + Channel + Scheduled At */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Audience
                  </Label>
                  <Select value={bulkAudience} onValueChange={(v) => setBulkAudience(v as BulkAudience)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{AUDIENCE_LABELS.ALL}</SelectItem>
                      <SelectItem value="CUSTOMERS_WITH_PHONES">{AUDIENCE_LABELS.CUSTOMERS_WITH_PHONES}</SelectItem>
                      <SelectItem value="DEBTORS">{AUDIENCE_LABELS.DEBTORS}</SelectItem>
                      <SelectItem value="LOYALTY_MEMBERS">{AUDIENCE_LABELS.LOYALTY_MEMBERS}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> Channel
                  </Label>
                  <Select value={bulkChannel} onValueChange={(v) => setBulkChannel(v as BulkChannel)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WHATSAPP">WhatsApp (wa.me link per recipient)</SelectItem>
                      <SelectItem value="SMS">SMS (log only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Scheduled At <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    type="datetime-local"
                    value={bulkScheduledAt}
                    onChange={(e) => setBulkScheduledAt(e.target.value)}
                  />
                </div>
              </div>

              {/* Subject (optional) */}
              <div className="space-y-2">
                <Label>Subject <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  placeholder="e.g. Holiday Greetings from Mbumah Hardware"
                  value={bulkSubject}
                  onChange={(e) => setBulkSubject(e.target.value)}
                />
              </div>

              {/* Quick holiday templates */}
              <div className="space-y-2">
                <Label>Quick Holiday Templates</Label>
                <div className="flex flex-wrap gap-2">
                  {HOLIDAY_TEMPLATES.map((t) => (
                    <Button
                      key={t.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-9"
                      onClick={() => {
                        setBulkMessage(t.content);
                        if (!bulkSubject.trim()) setBulkSubject(t.label.replace(/^[^\w]+\s/, '').trim() + ' — Mbumah Hardware');
                      }}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Message */}
              <div className="space-y-2">
                <Label>
                  Message <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  placeholder="Type your broadcast message here, or pick a holiday template above…"
                  value={bulkMessage}
                  onChange={(e) => setBulkMessage(e.target.value)}
                  rows={5}
                  className="resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  {bulkMessage.length} characters · sent verbatim to every recipient in the chosen audience
                </p>
              </div>

              {/* Send button + audience hint */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white gap-2"
                  onClick={() => {
                    if (!bulkMessage.trim()) {
                      toast.error('Message is required');
                      return;
                    }
                    setBulkResult(null);
                    sendBulkBroadcastMutation.mutate();
                  }}
                  disabled={sendBulkBroadcastMutation.isPending || !bulkMessage.trim()}
                >
                  {sendBulkBroadcastMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send Broadcast
                </Button>
                <p className="text-xs text-muted-foreground">
                  Audience: <span className="font-medium">{AUDIENCE_LABELS[bulkAudience]}</span>
                  {bulkScheduledAt && (
                    <> · scheduled for <span className="font-medium">{formatDateTime(bulkScheduledAt)}</span></>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Results panel */}
          {bulkResult && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    Broadcast Results
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                      {bulkResult.sent.length} sent
                    </Badge>
                    {bulkResult.skipped.length > 0 && (
                      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        {bulkResult.skipped.length} skipped
                      </Badge>
                    )}
                    <Badge variant="outline">
                      {bulkResult.broadcastSummary.totalCandidates} candidates
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary banner */}
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  Channel: <span className="font-medium">{bulkResult.broadcastSummary.channel}</span>
                  {' · '}Audience: <span className="font-medium">{AUDIENCE_LABELS[bulkResult.broadcastSummary.audience] ?? bulkResult.broadcastSummary.audience}</span>
                  {' · '}Subject: <span className="font-medium">{bulkResult.broadcastSummary.subject || '—'}</span>
                  {bulkResult.broadcastSummary.scheduledAt && (
                    <> {' · '}Scheduled: <span className="font-medium">{formatDateTime(bulkResult.broadcastSummary.scheduledAt)}</span></>
                  )}
                </div>

                {/* Recipients table */}
                {bulkResult.sent.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No recipients received this broadcast.</p>
                    <p className="text-xs mt-1">
                      Check that the chosen audience has customers with valid phone numbers.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead className="w-[40%]">Name</TableHead>
                          <TableHead className="w-[35%]">Phone</TableHead>
                          <TableHead className="text-right w-[25%]">Open</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bulkResult.sent.map((r: BulkMessageRecipient) => (
                          <TableRow key={r.customerId}>
                            <TableCell className="font-medium text-sm break-words">{r.name || 'Unknown'}</TableCell>
                            <TableCell className="text-sm break-all">{r.phone || '—'}</TableCell>
                            <TableCell className="text-right">
                              {r.waLink ? (
                                <Button
                                  asChild
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs gap-1.5 bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
                                >
                                  <a href={r.waLink} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open
                                  </a>
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Skipped reasons (collapsed) */}
                {bulkResult.skipped.length > 0 && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                      Skipped recipients ({bulkResult.skipped.length})
                    </p>
                    <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 max-h-32 overflow-y-auto">
                      {bulkResult.skipped.slice(0, 20).map((s, i) => (
                        <li key={s.customerId || i} className="break-words">
                          • {s.name || s.customerId || 'Unknown'} ({s.phone || 'no phone'}): {s.reason}
                        </li>
                      ))}
                      {bulkResult.skipped.length > 20 && (
                        <li className="italic">… and {bulkResult.skipped.length - 20} more</li>
                      )}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Open every waLink sequentially (browser will throttle but most will open).
                      const links = bulkResult.sent
                        .map((r) => r.waLink)
                        .filter((l): l is string => Boolean(l));
                      if (links.length === 0) {
                        toast.info('No WhatsApp links to open');
                        return;
                      }
                      if (links.length > 10) {
                        toast.info(`Opening first 10 of ${links.length} WhatsApp chats (browsers block mass pop-ups).`);
                      }
                      links.slice(0, 10).forEach((l) => window.open(l, '_blank'));
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open All (first 10)
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBulkResult(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════
            HISTORY TAB
        ══════════════════════════════════════════════════════ */}
        <TabsContent value="history" className="space-y-4 mt-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, phone, or content..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setHistoryPage(1); }}
                  />
                </div>
                <Select value={filterChannel} onValueChange={(val) => { setFilterChannel(val); setHistoryPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <Filter className="h-4 w-4 mr-1" />
                    <SelectValue placeholder="Channel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Channels</SelectItem>
                    <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                    <SelectItem value="SMS">SMS</SelectItem>
                    <SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={(val) => { setFilterType(val); setHistoryPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="DEBT_REMINDER">Debt Reminder</SelectItem>
                    <SelectItem value="PAYMENT_CONFIRMATION">Payment Confirmation</SelectItem>
                    <SelectItem value="BALANCE_UPDATE">Balance Update</SelectItem>
                    <SelectItem value="PROMOTION">Promotion</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={(val) => { setFilterStatus(val); setHistoryPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="SENT">Sent</SelectItem>
                    <SelectItem value="DELIVERED">Delivered</SelectItem>
                    <SelectItem value="FAILED">Failed</SelectItem>
                    <SelectItem value="READ">Read</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* History Table */}
          <Card>
            <CardContent className="p-0">
              {messagesQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredMessages.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No messages found</p>
                  <p className="text-sm mt-1">Try adjusting your filters or send a new message</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>Channel</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="max-w-[200px]">Content</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedMessages.map((msg) => {
                          const channelConfig = CHANNEL_BADGE[msg.channel] ?? CHANNEL_BADGE.WHATSAPP;
                          const typeConfig = MESSAGE_TYPE_BADGE[msg.messageType] ?? MESSAGE_TYPE_BADGE.CUSTOM;
                          const statusConfig = STATUS_BADGE[msg.status] ?? STATUS_BADGE.PENDING;
                          return (
                            <TableRow key={msg.id} className="hover:bg-muted/50">
                              <TableCell>
                                <div>
                                  <p className="font-medium text-sm">
                                    {msg.customerName || 'Unknown'}
                                  </p>
                                  {msg.customerPhone && (
                                    <p className="text-xs text-muted-foreground">
                                      {msg.customerPhone}
                                    </p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`text-xs ${channelConfig.color}`}>
                                  <channelConfig.icon className="h-3 w-3 mr-1" />
                                  {channelConfig.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`text-xs ${typeConfig.color}`}>
                                  {typeConfig.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[200px]">
                                <p className="text-sm truncate">{msg.content}</p>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`text-xs ${statusConfig.color}`}>
                                  <statusConfig.icon className="h-3 w-3 mr-1" />
                                  {statusConfig.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {msg.sentAt
                                  ? formatDateTime(msg.sentAt)
                                  : formatDateTime(msg.createdAt)}
                              </TableCell>
                              <TableCell>
                                {msg.waLink ? (
                                  <a
                                    href={msg.waLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-700 underline"
                                  >
                                    <Phone className="h-3 w-3" />
                                    wa.me
                                  </a>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-sm text-muted-foreground">
                      Showing {(historyPage - 1) * historyPageSize + 1}–
                      {Math.min(historyPage * historyPageSize, filteredMessages.length)} of{' '}
                      {filteredMessages.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                        disabled={historyPage <= 1}
                      >
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {historyPage} / {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                        disabled={historyPage >= totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════
            TEMPLATES TAB
        ══════════════════════════════════════════════════════ */}
        <TabsContent value="templates" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MESSAGE_TEMPLATES.map((template) => {
              const typeConfig = MESSAGE_TYPE_BADGE[template.type] ?? MESSAGE_TYPE_BADGE.CUSTOM;
              return (
                <Card key={template.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{template.label}</CardTitle>
                      <Badge variant="outline" className={`text-xs ${typeConfig.color}`}>
                        {typeConfig.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-sm whitespace-pre-wrap">{template.content}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Placeholders:</span>
                      {template.content.includes('{customer_name}') && (
                        <Badge variant="secondary" className="text-xs">{'{customer_name}'}</Badge>
                      )}
                      {template.content.includes('{amount}') && (
                        <Badge variant="secondary" className="text-xs">{'{amount}'}</Badge>
                      )}
                      {template.content.includes('{balance}') && (
                        <Badge variant="secondary" className="text-xs">{'{balance}'}</Badge>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setActiveSubTab('quick-send');
                        handleTemplateSelect(template.id);
                      }}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      Use Template
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* ════════════════════════════════════════════════════════
          SEND MESSAGE DIALOG
      ════════════════════════════════════════════════════════ */}
      <Dialog open={showSendDialog} onOpenChange={(open) => { setShowSendDialog(open); if (!open) resetSendForm(); }}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Send New Message
            </DialogTitle>
            <DialogDescription>
              Compose and send a new message to a customer
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Customer Selector */}
            <div className="space-y-2">
              <Label>Customer</Label>
              <Select onValueChange={handleCustomerSelect} value={sendForm.customerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a customer..." />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-60">
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                placeholder="e.g. 0712345678"
                value={sendForm.phone}
                onChange={(e) => setSendForm((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>

            {/* Channel & Type Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select
                  value={sendForm.channel}
                  onValueChange={(val) =>
                    setSendForm((prev) => ({ ...prev, channel: val as typeof prev.channel }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                    <SelectItem value="SMS">SMS</SelectItem>
                    <SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Message Type</Label>
                <Select
                  value={sendForm.messageType}
                  onValueChange={(val) =>
                    setSendForm((prev) => ({ ...prev, messageType: val as typeof prev.messageType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEBT_REMINDER">Debt Reminder</SelectItem>
                    <SelectItem value="PAYMENT_CONFIRMATION">Payment Confirmation</SelectItem>
                    <SelectItem value="BALANCE_UPDATE">Balance Update</SelectItem>
                    <SelectItem value="PROMOTION">Promotion</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label>Subject (optional)</Label>
              <Input
                placeholder="Message subject..."
                value={sendForm.subject}
                onChange={(e) => setSendForm((prev) => ({ ...prev, subject: e.target.value }))}
              />
            </div>

            {/* Template Presets */}
            <div className="space-y-2">
              <Label>Quick Template</Label>
              <div className="flex flex-wrap gap-2">
                {MESSAGE_TEMPLATES.map((t) => (
                  <Button
                    key={t.id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleTemplateSelect(t.id)}
                    className="text-xs"
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label>Message Content</Label>
              <Textarea
                placeholder="Type your message here..."
                value={sendForm.content}
                onChange={(e) => setSendForm((prev) => ({ ...prev, content: e.target.value }))}
                rows={5}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {sendForm.content.length} characters
              </p>
            </div>

            {/* WhatsApp Link Display */}
            {lastWaLink && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-1">
                  WhatsApp link generated
                </p>
                <p className="text-xs text-green-700 dark:text-green-400 mb-2">
                  Click the link below to open WhatsApp and send the message:
                </p>
                <a
                  href={lastWaLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-green-600 hover:text-green-700 underline break-all"
                >
                  {lastWaLink}
                </a>
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(lastWaLink);
                      toast.success('Link copied to clipboard');
                    }}
                  >
                    Copy Link
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setShowSendDialog(false); resetSendForm(); }}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => {
                if (!sendForm.phone.trim()) { toast.error('Phone required'); return; }
                if (!sendForm.content.trim()) { toast.error('Message required'); return; }
                openWhatsApp(sendForm.phone, sendForm.content);
                sendMessageMutation.mutate({
                  customerId: sendForm.customerId || undefined,
                  phone: sendForm.phone,
                  channel: 'WHATSAPP',
                  messageType: sendForm.messageType,
                  subject: sendForm.subject || undefined,
                  content: sendForm.content,
                  storeId: currentStoreId,
                });
              }}
              disabled={sendMessageMutation.isPending || !sendForm.phone || !sendForm.content}
            >
              <Phone className="h-4 w-4 mr-2" />WhatsApp
            </Button>
            <Button
              variant="outline"
              className="border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
              onClick={() => {
                if (!sendForm.phone.trim()) { toast.error('Phone required'); return; }
                if (!sendForm.content.trim()) { toast.error('Message required'); return; }
                openSMS(sendForm.phone, sendForm.content);
                sendMessageMutation.mutate({
                  customerId: sendForm.customerId || undefined,
                  phone: sendForm.phone,
                  channel: 'SMS',
                  messageType: sendForm.messageType,
                  subject: sendForm.subject || undefined,
                  content: sendForm.content,
                  storeId: currentStoreId,
                });
              }}
              disabled={sendMessageMutation.isPending || !sendForm.phone || !sendForm.content}
            >
              <Smartphone className="h-4 w-4 mr-2" />SMS
            </Button>
            <Button
              variant="outline"
              className="border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
              onClick={() => {
                const emailTo = sendForm.subject || selectedCustomer?.email || '';
                if (!emailTo.trim()) { toast.error('Email required'); return; }
                if (!sendForm.content.trim()) { toast.error('Message required'); return; }
                openEmail(emailTo, `Mbumah Hardware - ${sendForm.messageType.replace(/_/g, ' ')}`, sendForm.content);
                sendMessageMutation.mutate({
                  customerId: sendForm.customerId || undefined,
                  phone: sendForm.phone,
                  channel: 'WHATSAPP',
                  messageType: sendForm.messageType,
                  subject: sendForm.subject || undefined,
                  content: sendForm.content,
                  storeId: currentStoreId,
                });
              }}
              disabled={sendMessageMutation.isPending || !sendForm.content}
            >
              <Mail className="h-4 w-4 mr-2" />Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════
          DEBT REMINDER DIALOG
      ════════════════════════════════════════════════════════ */}
      <Dialog open={showDebtReminderDialog} onOpenChange={setShowDebtReminderDialog}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Send Debt Reminders
            </DialogTitle>
            <DialogDescription>
              Send overdue debt reminder notifications to customers via WhatsApp
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Select customers to send overdue debt reminders via WhatsApp. Only customers with phone numbers will receive messages.
            </p>

            {debtQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : overdueCustomers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No customers with overdue debts</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (selectedDebtCustomerIds.size === overdueCustomers.length) {
                        setSelectedDebtCustomerIds(new Set());
                      } else {
                        setSelectedDebtCustomerIds(new Set(overdueCustomers.map((c) => c.customerId)));
                      }
                    }}
                  >
                    {selectedDebtCustomerIds.size === overdueCustomers.length
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {selectedDebtCustomerIds.size} selected
                  </span>
                </div>

                <ScrollArea className="max-h-72">
                  <div className="space-y-2">
                    {overdueCustomers.map((cust) => (
                      <label
                        key={cust.customerId}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedDebtCustomerIds.has(cust.customerId)
                            ? 'bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-800'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedDebtCustomerIds.has(cust.customerId)}
                          onChange={() => toggleDebtCustomer(cust.customerId)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{cust.customerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {cust.phone || 'No phone number'}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20">
                          {formatKES(cust.totalOwed)}
                        </Badge>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDebtReminderDialog(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleSendDebtReminders}
              disabled={selectedDebtCustomerIds.size === 0 || sendDebtReminderMutation.isPending}
            >
              {sendDebtReminderMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Bell className="h-4 w-4 mr-2" />
              )}
              Send {selectedDebtCustomerIds.size} Reminder(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════
          BALANCE UPDATE DIALOG
      ════════════════════════════════════════════════════════ */}
      <Dialog open={showBalanceDialog} onOpenChange={setShowBalanceDialog}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-600" />
              Send Balance Updates
            </DialogTitle>
            <DialogDescription>
              Send account balance update notifications to customers via WhatsApp
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Select customers to send account balance updates via WhatsApp. Only customers with phone numbers will receive messages.
            </p>

            {debtOutstandingQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : balanceCustomers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No customers with outstanding balances</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (selectedBalanceCustomerIds.size === balanceCustomers.length) {
                        setSelectedBalanceCustomerIds(new Set());
                      } else {
                        setSelectedBalanceCustomerIds(new Set(balanceCustomers.map((c) => c.customerId)));
                      }
                    }}
                  >
                    {selectedBalanceCustomerIds.size === balanceCustomers.length
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {selectedBalanceCustomerIds.size} selected
                  </span>
                </div>

                <ScrollArea className="max-h-72">
                  <div className="space-y-2">
                    {balanceCustomers.map((cust) => (
                      <label
                        key={cust.customerId}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedBalanceCustomerIds.has(cust.customerId)
                            ? 'bg-amber-50 border-amber-300 dark:bg-amber-900/20 dark:border-amber-800'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedBalanceCustomerIds.has(cust.customerId)}
                          onChange={() => toggleBalanceCustomer(cust.customerId)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{cust.customerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {cust.phone || 'No phone number'}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20">
                          {formatKES(cust.balance)}
                        </Badge>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBalanceDialog(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleSendBalanceUpdates}
              disabled={selectedBalanceCustomerIds.size === 0 || sendBalanceUpdateMutation.isPending}
            >
              {sendBalanceUpdateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              Send {selectedBalanceCustomerIds.size} Update(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
