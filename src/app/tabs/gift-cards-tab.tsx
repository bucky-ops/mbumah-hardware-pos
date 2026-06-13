'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Gift, Search, Plus, CreditCard, Loader2,
  Award, Filter, TrendingUp, Clock,
  AlertTriangle, Star, Users, Wallet, CalendarDays,
  Crown, Medal, Shield, ChevronDown, Copy, CheckCircle2,
  Pencil, Trash2, Ban, HandCoins, X, Settings2, ChevronUp,
} from 'lucide-react';

import { useAppStore, useAuthStore } from '@/lib/stores';
import { hasPermission, canCreateUsers } from '@/lib/types';
import {
  giftCardsApi, customersApi,
  formatKES, formatDate, formatDateTime,
  type GiftCardItem,
  type CustomerItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';

// ─── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_REASONS = ['LOYALTY', 'PROMOTION', 'PURCHASE', 'GIFT', 'REFERRAL'] as const;

const CUSTOM_REASONS_STORAGE_KEY = 'mbt_custom_gc_reasons';

// ─── Helpers ────────────────────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-teal-600',
  'from-emerald-500 to-green-600',
  'from-amber-500 to-orange-600',
  'from-red-500 to-rose-600',
  'from-teal-500 to-cyan-600',
  'from-orange-500 to-amber-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
];

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

type LoyaltyTier = 'Bronze' | 'Silver' | 'Gold';

function getLoyaltyTier(points: number): {
  tier: LoyaltyTier;
  color: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
  progressValue: number;
  nextTier: LoyaltyTier | null;
  pointsToNext: number;
} {
  if (points >= 1500) {
    return {
      tier: 'Gold',
      color: 'text-yellow-700 dark:text-yellow-400',
      bg: 'bg-yellow-100 dark:bg-yellow-900/30',
      border: 'border-yellow-300 dark:border-yellow-700',
      icon: <Crown className="h-4 w-4" />,
      progressValue: 100,
      nextTier: null,
      pointsToNext: 0,
    };
  }
  if (points >= 500) {
    return {
      tier: 'Silver',
      color: 'text-gray-600 dark:text-gray-300',
      bg: 'bg-gray-100 dark:bg-gray-800/50',
      border: 'border-gray-300 dark:border-gray-600',
      icon: <Medal className="h-4 w-4" />,
      progressValue: ((points - 500) / 1000) * 100,
      nextTier: 'Gold',
      pointsToNext: 1500 - points,
    };
  }
  return {
    tier: 'Bronze',
    color: 'text-amber-700 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    border: 'border-amber-300 dark:border-amber-700',
    icon: <Shield className="h-4 w-4" />,
    progressValue: (points / 500) * 100,
    nextTier: 'Silver',
    pointsToNext: 500 - points,
  };
}

function getStatusBadge(status: GiftCardItem['status']) {
  switch (status) {
    case 'ACTIVE':
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 border-green-200 dark:border-green-800">
          <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Active
        </Badge>
      );
    case 'REDEEMED':
      return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 border-gray-200 dark:border-gray-700">
          Redeemed
        </Badge>
      );
    case 'EXPIRED':
      return (
        <Badge variant="destructive" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 border-red-200 dark:border-red-800">
          Expired
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 border-orange-200 dark:border-orange-800">
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getIssuedReasonBadge(reason: string) {
  switch (reason) {
    case 'LOYALTY':
      return <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 border-violet-200 dark:border-violet-800">Loyalty</Badge>;
    case 'PROMOTION':
      return <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 border-cyan-200 dark:border-cyan-800">Promotion</Badge>;
    case 'PURCHASE':
      return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800">Purchase</Badge>;
    case 'GIFT':
      return <Badge className="bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-900/30 border-pink-200 dark:border-pink-800">Gift</Badge>;
    case 'REFERRAL':
      return <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/30 border-teal-200 dark:border-teal-800">Referral</Badge>;
    default:
      return <Badge className="bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900/30 border-slate-200 dark:border-slate-800">{reason}</Badge>;
  }
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  const now = new Date();
  const daysUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function GiftCardsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const userRole = (user?.role || 'SALES_PERSON') as 'SUPER_ADMIN' | 'STORE_OWNER' | 'BRANCH_MANAGER' | 'SALES_PERSON' | 'ACCOUNTANT';

  // Permission checks
  const canCreate = hasPermission(userRole, 'crm', 'create');
  const canDelete = hasPermission(userRole, 'crm', 'delete');
  const canUpdate = hasPermission(userRole, 'crm', 'update');
  const canRedeem = canCreate || canUpdate;
  const isAdmin = canCreateUsers(userRole);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<GiftCardItem | null>(null);
  const [editExpiry, setEditExpiry] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editMinPurchase, setEditMinPurchase] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Confirm dialog state
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'delete' | 'cancel' | 'redeem' | null>(null);
  const [confirmCard, setConfirmCard] = useState<GiftCardItem | null>(null);

  // Manage Reasons state
  const [showReasonsPanel, setShowReasonsPanel] = useState(false);
  const [newReason, setNewReason] = useState('');
  const [customReasons, setCustomReasons] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(CUSTOM_REASONS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // All reasons (default + custom)
  const allReasons = useMemo(() => {
    return [...DEFAULT_REASONS, ...customReasons];
  }, [customReasons]);

  // Persist custom reasons to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_REASONS_STORAGE_KEY, JSON.stringify(customReasons));
    } catch {
      // ignore
    }
  }, [customReasons]);

  // Create form state
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formReason, setFormReason] = useState<string>('LOYALTY');
  const [formMinPurchase, setFormMinPurchase] = useState('');
  const [formExpiry, setFormExpiry] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: giftCardsData, isLoading: giftCardsLoading } = useQuery({
    queryKey: ['gift-cards', currentStoreId, statusFilter],
    queryFn: () =>
      giftCardsApi.list({
        storeId: currentStoreId,
        status: statusFilter !== 'all' ? statusFilter : undefined,
      }),
  });

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 200 }),
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: giftCardsApi.create,
    onSuccess: (res) => {
      const code = res.data?.code;
      toast.success(`Gift card created! Code: ${code}`);
      setCreateDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['gift-cards', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create gift card'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof giftCardsApi.update>[1] }) =>
      giftCardsApi.update(id, data),
    onSuccess: (res) => {
      toast.success('Gift card updated successfully');
      setEditDialogOpen(false);
      setEditingCard(null);
      queryClient.invalidateQueries({ queryKey: ['gift-cards', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update gift card'),
  });

  const deleteMutation = useMutation({
    mutationFn: giftCardsApi.delete,
    onSuccess: () => {
      toast.success('Gift card deleted successfully');
      setConfirmDialogOpen(false);
      setConfirmCard(null);
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['gift-cards', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete gift card'),
  });

  const redeemMutation = useMutation({
    mutationFn: giftCardsApi.redeem,
    onSuccess: () => {
      toast.success('Gift card redeemed successfully');
      setConfirmDialogOpen(false);
      setConfirmCard(null);
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['gift-cards', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to redeem gift card'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => giftCardsApi.update(id, { status: 'CANCELLED' }),
    onSuccess: () => {
      toast.success('Gift card cancelled successfully');
      setConfirmDialogOpen(false);
      setConfirmCard(null);
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['gift-cards', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to cancel gift card'),
  });

  // ─── Derived data ──────────────────────────────────────────────────────────

  const giftCards: GiftCardItem[] = giftCardsData?.data || [];
  const customers: CustomerItem[] = customersData?.data || [];

  // Filtered gift cards
  const filteredCards = useMemo(() => {
    let result = giftCards;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (gc) =>
          gc.code.toLowerCase().includes(q) ||
          gc.customer?.name?.toLowerCase().includes(q) ||
          gc.issuedReason.toLowerCase().includes(q)
      );
    }

    // Reason filter
    if (reasonFilter !== 'all') {
      result = result.filter((gc) => gc.issuedReason === reasonFilter);
    }

    return result;
  }, [giftCards, searchQuery, reasonFilter]);

  // Top active clients ranked by totalPurchases then loyaltyPoints
  const topClients = useMemo(() => {
    return [...customers]
      .filter((c) => c.isActive)
      .sort((a, b) => {
        const tpA = a.totalPurchases ?? 0;
        const tpB = b.totalPurchases ?? 0;
        if (tpB !== tpA) return tpB - tpA;
        return b.loyaltyPoints - a.loyaltyPoints;
      })
      .slice(0, 8);
  }, [customers]);

  // Stats
  const stats = useMemo(() => {
    const activeCards = giftCards.filter((gc) => gc.status === 'ACTIVE');
    const totalBalance = activeCards.reduce((sum, gc) => sum + gc.currentBalance, 0);
    const activeClients = customers.filter((c) => c.isActive).length;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const cardsThisMonth = giftCards.filter(
      (gc) => new Date(gc.createdAt) >= startOfMonth
    ).length;

    return {
      totalActive: activeCards.length,
      totalBalance,
      activeClients,
      cardsThisMonth,
    };
  }, [giftCards, customers]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function resetForm() {
    setFormCustomerId('');
    setFormAmount('');
    setFormReason('LOYALTY');
    setFormMinPurchase('');
    setFormExpiry('');
    setFormNotes('');
  }

  function handleCreateGiftCard() {
    if (!formAmount || parseFloat(formAmount) <= 0) {
      toast.error('Please enter a valid gift card amount.');
      return;
    }

    createMutation.mutate({
      storeId: currentStoreId,
      customerId: formCustomerId || undefined,
      initialBalance: parseFloat(formAmount),
      issuedReason: formReason,
      minimumPurchase: formMinPurchase ? parseFloat(formMinPurchase) : undefined,
      expiresAt: formExpiry || undefined,
    });
  }

  function handleIssueToCustomer(customerId: string, customerName: string) {
    const customer = customers.find((c) => c.id === customerId);
    const tier = getLoyaltyTier(customer?.loyaltyPoints ?? 0);

    setFormCustomerId(customerId);
    setFormReason('LOYALTY');
    // Suggest amount based on tier
    if (tier.tier === 'Gold') setFormAmount('5000');
    else if (tier.tier === 'Silver') setFormAmount('2000');
    else setFormAmount('1000');
    setFormMinPurchase('');
    setFormExpiry('');
    setCreateDialogOpen(true);
    toast.info(`Issuing gift card to ${customerName} (${tier.tier} tier)`);
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      toast.success(`Copied ${code} to clipboard`);
    }).catch(() => {
      toast.error('Failed to copy code');
    });
  }

  function handleEditCard(gc: GiftCardItem) {
    setEditingCard(gc);
    setEditExpiry(gc.expiresAt ? gc.expiresAt.split('T')[0] : '');
    setEditReason(gc.issuedReason);
    setEditMinPurchase(String(gc.minimumPurchase || ''));
    setEditNotes('');
    setEditDialogOpen(true);
  }

  function handleSaveEdit() {
    if (!editingCard) return;
    updateMutation.mutate({
      id: editingCard.id,
      data: {
        expiresAt: editExpiry || undefined,
        issuedReason: editReason,
        minimumPurchase: editMinPurchase ? parseFloat(editMinPurchase) : 0,
        notes: editNotes || undefined,
      },
    });
  }

  function handleConfirmAction() {
    if (!confirmCard || !confirmAction) return;

    switch (confirmAction) {
      case 'delete':
        deleteMutation.mutate(confirmCard.id);
        break;
      case 'cancel':
        cancelMutation.mutate(confirmCard.id);
        break;
      case 'redeem':
        redeemMutation.mutate(confirmCard.id);
        break;
    }
  }

  function openConfirmDialog(action: 'delete' | 'cancel' | 'redeem', gc: GiftCardItem) {
    setConfirmAction(action);
    setConfirmCard(gc);
    setConfirmDialogOpen(true);
  }

  function handleAddCustomReason() {
    const trimmed = newReason.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!trimmed) {
      toast.error('Please enter a valid reason name.');
      return;
    }
    if (allReasons.includes(trimmed)) {
      toast.error('This reason already exists.');
      return;
    }
    setCustomReasons((prev) => [...prev, trimmed]);
    setNewReason('');
    toast.success(`Added custom reason: ${trimmed}`);
  }

  function handleDeleteCustomReason(reason: string) {
    if (DEFAULT_REASONS.includes(reason as typeof DEFAULT_REASONS[number])) {
      toast.error('Cannot delete default reasons.');
      return;
    }
    setCustomReasons((prev) => prev.filter((r) => r !== reason));
    toast.success(`Removed custom reason: ${reason}`);
  }

  const isConfirmLoading = deleteMutation.isPending || cancelMutation.isPending || redeemMutation.isPending;

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (giftCardsLoading || customersLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-32 mb-1" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="space-y-6 p-4 md:p-6 max-w-[1600px] mx-auto">
        {/* ─── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
              <Gift className="h-7 w-7 text-pink-500" />
              Gift Cards
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage gift cards, track loyalty, and reward your best customers
            </p>
          </div>
          {canCreate && (
            <Button
              onClick={() => {
                resetForm();
                setCreateDialogOpen(true);
              }}
              className="bg-pink-600 hover:bg-pink-700 text-white shadow-md"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Gift Card
            </Button>
          )}
        </div>

        {/* ─── Stats Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-green-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Active Cards</p>
                  <p className="text-2xl font-bold mt-1">{stats.totalActive}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {giftCards.length} total issued
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-pink-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Total Balance</p>
                  <p className="text-2xl font-bold mt-1">{formatKES(stats.totalBalance)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Across active cards
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center">
                  <Wallet className="h-6 w-6 text-pink-600 dark:text-pink-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-violet-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Active Clients</p>
                  <p className="text-2xl font-bold mt-1">{stats.activeClients}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Eligible for rewards
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                  <Users className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Issued This Month</p>
                  <p className="text-2xl font-bold mt-1">{stats.cardsThisMonth}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    New gift cards
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <CalendarDays className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Main Content ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* ─── Gift Cards Table (2/3) ────────────────────────────────────── */}
          <div className="xl:col-span-2 space-y-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <CreditCard className="h-5 w-5 text-pink-500" />
                      Gift Cards
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {filteredCards.length} card{filteredCards.length !== 1 ? 's' : ''} found
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search cards..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 w-[200px] h-9"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowFilters(!showFilters)}
                      className={showFilters ? 'bg-accent' : ''}
                    >
                      <Filter className="h-4 w-4 mr-1" />
                      Filters
                      <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    </Button>
                  </div>
                </div>

                {/* Filter Row */}
                {showFilters && (
                  <div className="space-y-3 mt-3 pt-3 border-t">
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Status:</Label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="ACTIVE">Active</SelectItem>
                            <SelectItem value="REDEEMED">Redeemed</SelectItem>
                            <SelectItem value="EXPIRED">Expired</SelectItem>
                            <SelectItem value="CANCELLED">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Reason:</Label>
                        <Select value={reasonFilter} onValueChange={setReasonFilter}>
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Reasons</SelectItem>
                            {allReasons.map((reason) => (
                              <SelectItem key={reason} value={reason}>
                                {reason.charAt(0) + reason.slice(1).toLowerCase().replace(/_/g, ' ')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Manage Reasons Panel - Admin only */}
                    {isAdmin && (
                      <div className="border-t pt-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground w-full justify-between"
                          onClick={() => setShowReasonsPanel(!showReasonsPanel)}
                        >
                          <span className="flex items-center gap-1.5">
                            <Settings2 className="h-3.5 w-3.5" />
                            Manage Reasons
                          </span>
                          {showReasonsPanel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>

                        {showReasonsPanel && (
                          <div className="mt-2 p-3 rounded-lg border bg-muted/30 space-y-3">
                            <div className="flex flex-wrap gap-1.5">
                              {allReasons.map((reason) => {
                                const isDefault = DEFAULT_REASONS.includes(reason as typeof DEFAULT_REASONS[number]);
                                return (
                                  <div
                                    key={reason}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${
                                      isDefault
                                        ? 'bg-muted text-muted-foreground border-border'
                                        : 'bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800'
                                    }`}
                                  >
                                    {reason.charAt(0) + reason.slice(1).toLowerCase().replace(/_/g, ' ')}
                                    {isDefault ? (
                                      <span className="text-[9px] text-muted-foreground/60 ml-0.5">default</span>
                                    ) : (
                                      <button
                                        onClick={() => handleDeleteCustomReason(reason)}
                                        className="ml-0.5 hover:text-red-600 transition-colors"
                                        title="Remove custom reason"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            <div className="flex gap-2">
                              <Input
                                placeholder="New reason name..."
                                value={newReason}
                                onChange={(e) => setNewReason(e.target.value)}
                                className="h-8 text-xs flex-1"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddCustomReason();
                                }}
                              />
                              <Button
                                size="sm"
                                className="h-8 text-xs bg-pink-600 hover:bg-pink-700 text-white"
                                onClick={handleAddCustomReason}
                                disabled={!newReason.trim()}
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Add
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Custom reasons appear in filters and create forms. Default reasons cannot be removed.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>

              <CardContent className="px-0 pb-0">
                {filteredCards.length === 0 ? (
                  <div className="text-center py-16 px-4">
                    <Gift className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground font-medium">No gift cards found</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      {searchQuery || statusFilter !== 'all' || reasonFilter !== 'all'
                        ? 'Try adjusting your filters'
                        : 'Create your first gift card to get started'}
                    </p>
                    {canCreate && !searchQuery && statusFilter === 'all' && reasonFilter === 'all' && (
                      <Button
                        className="mt-4 bg-pink-600 hover:bg-pink-700 text-white"
                        onClick={() => setCreateDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Gift Card
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-6">Code</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Expiry</TableHead>
                            {(canDelete || canRedeem) && <TableHead className="text-right pr-6">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredCards.map((gc) => {
                            const balancePercent = gc.initialBalance > 0
                              ? (gc.currentBalance / gc.initialBalance) * 100
                              : 0;

                            return (
                              <TableRow key={gc.id} className="group">
                                <TableCell className="pl-6">
                                  <div className="flex items-center gap-2">
                                    <code className="text-sm font-mono font-semibold bg-muted px-2 py-0.5 rounded">
                                      {gc.code}
                                    </code>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                          onClick={() => copyCode(gc.code)}
                                        >
                                          <Copy className="h-3 w-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Copy code</TooltipContent>
                                    </Tooltip>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {gc.customer ? (
                                    <div className="flex items-center gap-2">
                                      <Avatar className="h-7 w-7">
                                        <AvatarFallback
                                          className={`bg-gradient-to-br ${getAvatarGradient(gc.customer.name)} text-white text-[10px]`}
                                        >
                                          {getInitials(gc.customer.name)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div>
                                        <p className="text-sm font-medium leading-none">
                                          {gc.customer.name}
                                        </p>
                                        {gc.customer.phone && (
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {gc.customer.phone}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-sm text-muted-foreground italic">Unassigned</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="space-y-1">
                                    <p className="text-sm font-semibold">
                                      {formatKES(gc.currentBalance)}
                                    </p>
                                    <Progress
                                      value={balancePercent}
                                      className="h-1.5 w-20 ml-auto"
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                      of {formatKES(gc.initialBalance)}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell>{getStatusBadge(gc.status)}</TableCell>
                                <TableCell>{getIssuedReasonBadge(gc.issuedReason)}</TableCell>
                                <TableCell>
                                  {gc.expiresAt ? (
                                    <div className="flex items-center gap-1.5">
                                      <Clock className="h-3 w-3 text-muted-foreground" />
                                      <span
                                        className={`text-xs ${
                                          isExpired(gc.expiresAt)
                                            ? 'text-red-600 dark:text-red-400 font-medium'
                                            : isExpiringSoon(gc.expiresAt)
                                            ? 'text-amber-600 dark:text-amber-400 font-medium'
                                            : 'text-muted-foreground'
                                        }`}
                                      >
                                        {formatDate(gc.expiresAt)}
                                      </span>
                                      {isExpiringSoon(gc.expiresAt) && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                          </TooltipTrigger>
                                          <TooltipContent>Expires within 30 days</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">No expiry</span>
                                  )}
                                </TableCell>
                                {(canDelete || canRedeem) && (
                                  <TableCell className="text-right pr-6">
                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      {canDelete && gc.status === 'ACTIVE' && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                              onClick={() => handleEditCard(gc)}
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Edit gift card</TooltipContent>
                                        </Tooltip>
                                      )}
                                      {canRedeem && gc.status === 'ACTIVE' && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                                              onClick={() => openConfirmDialog('redeem', gc)}
                                            >
                                              <HandCoins className="h-3.5 w-3.5" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Redeem gift card</TooltipContent>
                                        </Tooltip>
                                      )}
                                      {canDelete && gc.status === 'ACTIVE' && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                              onClick={() => openConfirmDialog('cancel', gc)}
                                            >
                                              <Ban className="h-3.5 w-3.5" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Cancel gift card</TooltipContent>
                                        </Tooltip>
                                      )}
                                      {canDelete && (gc.status === 'CANCELLED' || gc.status === 'EXPIRED') && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                              onClick={() => openConfirmDialog('delete', gc)}
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Delete gift card</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  </TableCell>
                                )}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-3 px-4 pb-4">
                      {filteredCards.map((gc) => {
                        const balancePercent = gc.initialBalance > 0
                          ? (gc.currentBalance / gc.initialBalance) * 100
                          : 0;

                        return (
                          <Card key={gc.id} className="shadow-sm">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <code className="text-sm font-mono font-semibold bg-muted px-2 py-0.5 rounded">
                                    {gc.code}
                                  </code>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => copyCode(gc.code)}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                                {getStatusBadge(gc.status)}
                              </div>

                              {gc.customer && (
                                <div className="flex items-center gap-2 mb-3">
                                  <Avatar className="h-6 w-6">
                                    <AvatarFallback
                                      className={`bg-gradient-to-br ${getAvatarGradient(gc.customer.name)} text-white text-[9px]`}
                                    >
                                      {getInitials(gc.customer.name)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm font-medium">{gc.customer.name}</span>
                                </div>
                              )}

                              <div className="space-y-2">
                                <div className="flex justify-between items-baseline">
                                  <span className="text-sm text-muted-foreground">Balance</span>
                                  <span className="font-semibold">{formatKES(gc.currentBalance)}</span>
                                </div>
                                <Progress value={balancePercent} className="h-1.5" />
                                <p className="text-[10px] text-muted-foreground text-right">
                                  of {formatKES(gc.initialBalance)}
                                </p>
                              </div>

                              <Separator className="my-3" />

                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {getIssuedReasonBadge(gc.issuedReason)}
                                  {gc.expiresAt && (
                                    <span
                                      className={`text-xs flex items-center gap-1 ${
                                        isExpired(gc.expiresAt)
                                          ? 'text-red-600 dark:text-red-400'
                                          : isExpiringSoon(gc.expiresAt)
                                          ? 'text-amber-600 dark:text-amber-400'
                                          : 'text-muted-foreground'
                                      }`}
                                    >
                                      <Clock className="h-3 w-3" />
                                      {formatDate(gc.expiresAt)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Mobile Action Buttons */}
                              {(canDelete || canRedeem) && (
                                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
                                  {canDelete && gc.status === 'ACTIVE' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => handleEditCard(gc)}
                                    >
                                      <Pencil className="h-3 w-3 mr-1" />
                                      Edit
                                    </Button>
                                  )}
                                  {canRedeem && gc.status === 'ACTIVE' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/20"
                                      onClick={() => openConfirmDialog('redeem', gc)}
                                    >
                                      <HandCoins className="h-3 w-3 mr-1" />
                                      Redeem
                                    </Button>
                                  )}
                                  {canDelete && gc.status === 'ACTIVE' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs text-orange-700 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-900/20"
                                      onClick={() => openConfirmDialog('cancel', gc)}
                                    >
                                      <Ban className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  )}
                                  {canDelete && (gc.status === 'CANCELLED' || gc.status === 'EXPIRED') && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20"
                                      onClick={() => openConfirmDialog('delete', gc)}
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />
                                      Delete
                                    </Button>
                                  )}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Top Active Clients Sidebar (1/3) ──────────────────────────── */}
          <div className="space-y-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Award className="h-5 w-5 text-amber-500" />
                  Top Active Clients
                </CardTitle>
                <CardDescription>
                  Ranked by total purchases &amp; loyalty
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topClients.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No active clients yet</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar">
                    {topClients.map((customer, idx) => {
                      const tier = getLoyaltyTier(customer.loyaltyPoints);
                      const totalPurchases = customer.totalPurchases ?? 0;

                      return (
                        <div
                          key={customer.id}
                          className={`relative p-3 rounded-lg border ${tier.border} ${tier.bg} transition-all hover:shadow-sm`}
                        >
                          {/* Rank badge */}
                          <div className="absolute -top-2 -left-1">
                            {idx === 0 && (
                              <span className="flex items-center justify-center h-6 w-6 rounded-full bg-yellow-500 text-white text-xs font-bold shadow">
                                1
                              </span>
                            )}
                            {idx === 1 && (
                              <span className="flex items-center justify-center h-6 w-6 rounded-full bg-gray-400 text-white text-xs font-bold shadow">
                                2
                              </span>
                            )}
                            {idx === 2 && (
                              <span className="flex items-center justify-center h-6 w-6 rounded-full bg-amber-600 text-white text-xs font-bold shadow">
                                3
                              </span>
                            )}
                            {idx > 2 && (
                              <span className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-muted-foreground text-xs font-bold">
                                {idx + 1}
                              </span>
                            )}
                          </div>

                          <div className="flex items-start gap-3 ml-5">
                            <Avatar className="h-10 w-10 mt-0.5">
                              <AvatarFallback
                                className={`bg-gradient-to-br ${getAvatarGradient(customer.name)} text-white text-xs font-semibold`}
                              >
                                {getInitials(customer.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <p className="text-sm font-semibold truncate">
                                  {customer.name}
                                </p>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${tier.bg} ${tier.color} border ${tier.border}`}>
                                      {tier.icon}
                                      {tier.tier}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {tier.tier} tier — {customer.loyaltyPoints} loyalty points
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              {customer.phone && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {customer.phone}
                                </p>
                              )}

                              <div className="mt-2 space-y-1.5">
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Total Purchases</span>
                                  <span className="font-semibold">{formatKES(totalPurchases)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Loyalty Points</span>
                                  <span className="font-semibold">{customer.loyaltyPoints.toLocaleString()}</span>
                                </div>

                                {/* Tier progress bar */}
                                {tier.nextTier && (
                                  <div className="space-y-0.5">
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>{tier.tier}</span>
                                      <span>{tier.nextTier}</span>
                                    </div>
                                    <Progress value={tier.progressValue} className="h-1.5" />
                                    <p className="text-[10px] text-muted-foreground">
                                      {tier.pointsToNext} pts to {tier.nextTier}
                                    </p>
                                  </div>
                                )}
                              </div>

                              {canCreate && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mt-2 h-7 text-xs w-full"
                                  onClick={() => handleIssueToCustomer(customer.id, customer.name)}
                                >
                                  <Gift className="h-3 w-3 mr-1" />
                                  Issue Gift Card
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Loyalty Tiers Legend */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Star className="h-4 w-4 text-amber-500" />
                  Loyalty Tiers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <Shield className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Bronze</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400/80">0 – 499 points</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                  <Medal className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Silver</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">500 – 1,499 points</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <Crown className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  <div>
                    <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">Gold</p>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400/80">1,500+ points</p>
                  </div>
                </div>

                <Separator className="my-2" />

                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
                  <p>
                    Points are earned from purchases. Gift cards are issued as rewards
                    based on loyalty tier and purchase history.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ─── Create Gift Card Dialog ─────────────────────────────────────── */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-pink-500" />
                Create Gift Card
              </DialogTitle>
              <DialogDescription>
                Issue a new gift card. The code will be auto-generated as MH-GC-XXXXXX.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Customer Selection */}
              <div className="space-y-2">
                <Label htmlFor="gc-customer" className="text-sm font-medium">
                  Customer <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Select value={formCustomerId} onValueChange={setFormCustomerId}>
                  <SelectTrigger id="gc-customer">
                    <SelectValue placeholder="Select a customer..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {customers
                      .filter((c) => c.isActive)
                      .map((c) => {
                        const tier = getLoyaltyTier(c.loyaltyPoints);
                        return (
                          <SelectItem key={c.id} value={c.id}>
                            <div className="flex items-center gap-2">
                              <span>{c.name}</span>
                              <span className={`text-[10px] ${tier.color}`}>{tier.tier}</span>
                              {c.totalPurchases !== undefined && c.totalPurchases > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  ({formatKES(c.totalPurchases)})
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="gc-amount" className="text-sm font-medium">
                  Initial Balance (KES) <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    KES
                  </span>
                  <Input
                    id="gc-amount"
                    type="number"
                    min="1"
                    step="100"
                    placeholder="e.g. 5000"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="pl-12"
                  />
                </div>
                {/* Quick amount buttons */}
                <div className="flex gap-2 flex-wrap">
                  {[1000, 2000, 5000, 10000].map((amt) => (
                    <Button
                      key={amt}
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setFormAmount(String(amt))}
                    >
                      {formatKES(amt)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Issued Reason */}
              <div className="space-y-2">
                <Label htmlFor="gc-reason" className="text-sm font-medium">
                  Issued Reason
                </Label>
                <Select
                  value={formReason}
                  onValueChange={setFormReason}
                >
                  <SelectTrigger id="gc-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allReasons.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {reason.charAt(0) + reason.slice(1).toLowerCase().replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Minimum Purchase */}
              <div className="space-y-2">
                <Label htmlFor="gc-min-purchase" className="text-sm font-medium">
                  Minimum Purchase (KES) <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="gc-min-purchase"
                  type="number"
                  min="0"
                  step="100"
                  placeholder="e.g. 1000 — card only valid above this amount"
                  value={formMinPurchase}
                  onChange={(e) => setFormMinPurchase(e.target.value)}
                />
              </div>

              {/* Expiry Date */}
              <div className="space-y-2">
                <Label htmlFor="gc-expiry" className="text-sm font-medium">
                  Expiry Date <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="gc-expiry"
                  type="date"
                  value={formExpiry}
                  onChange={(e) => setFormExpiry(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + 3);
                      setFormExpiry(d.toISOString().split('T')[0]);
                    }}
                  >
                    3 months
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + 6);
                      setFormExpiry(d.toISOString().split('T')[0]);
                    }}
                  >
                    6 months
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() + 1);
                      setFormExpiry(d.toISOString().split('T')[0]);
                    }}
                  >
                    1 year
                  </Button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="gc-notes" className="text-sm font-medium">
                  Notes <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="gc-notes"
                  placeholder="Any additional notes..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateGiftCard}
                disabled={createMutation.isPending || !formAmount}
                className="bg-pink-600 hover:bg-pink-700 text-white"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Create Gift Card
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Edit Gift Card Dialog ─────────────────────────────────────── */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-amber-500" />
                Edit Gift Card
              </DialogTitle>
              <DialogDescription>
                Update gift card details for <code className="font-mono font-semibold">{editingCard?.code}</code>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Current Info (read-only) */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/50 border">
                <div>
                  <p className="text-xs text-muted-foreground">Current Balance</p>
                  <p className="text-sm font-semibold">{formatKES(editingCard?.currentBalance ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Initial Balance</p>
                  <p className="text-sm font-semibold">{formatKES(editingCard?.initialBalance ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <div className="mt-0.5">{editingCard && getStatusBadge(editingCard.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Customer</p>
                  <p className="text-sm font-semibold">{editingCard?.customer?.name || 'Unassigned'}</p>
                </div>
              </div>

              {/* Issued Reason */}
              <div className="space-y-2">
                <Label htmlFor="edit-reason" className="text-sm font-medium">
                  Issued Reason
                </Label>
                <Select value={editReason} onValueChange={setEditReason}>
                  <SelectTrigger id="edit-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allReasons.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {reason.charAt(0) + reason.slice(1).toLowerCase().replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Minimum Purchase */}
              <div className="space-y-2">
                <Label htmlFor="edit-min-purchase" className="text-sm font-medium">
                  Minimum Purchase (KES)
                </Label>
                <Input
                  id="edit-min-purchase"
                  type="number"
                  min="0"
                  step="100"
                  value={editMinPurchase}
                  onChange={(e) => setEditMinPurchase(e.target.value)}
                />
              </div>

              {/* Expiry Date */}
              <div className="space-y-2">
                <Label htmlFor="edit-expiry" className="text-sm font-medium">
                  Expiry Date
                </Label>
                <Input
                  id="edit-expiry"
                  type="date"
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="edit-notes" className="text-sm font-medium">
                  Notes <span className="text-muted-foreground">(will be logged)</span>
                </Label>
                <Textarea
                  id="edit-notes"
                  placeholder="Reason for update..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Confirm Action Dialog ─────────────────────────────────────── */}
        <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {confirmAction === 'delete' && <Trash2 className="h-5 w-5 text-red-500" />}
                {confirmAction === 'cancel' && <Ban className="h-5 w-5 text-orange-500" />}
                {confirmAction === 'redeem' && <HandCoins className="h-5 w-5 text-green-500" />}
                {confirmAction === 'delete' && 'Delete Gift Card'}
                {confirmAction === 'cancel' && 'Cancel Gift Card'}
                {confirmAction === 'redeem' && 'Redeem Gift Card'}
              </DialogTitle>
              <DialogDescription>
                {confirmAction === 'delete' && (
                  <>
                    Are you sure you want to permanently delete gift card{' '}
                    <code className="font-mono font-semibold">{confirmCard?.code}</code>?
                    This action cannot be undone.
                  </>
                )}
                {confirmAction === 'cancel' && (
                  <>
                    Are you sure you want to cancel gift card{' '}
                    <code className="font-mono font-semibold">{confirmCard?.code}</code>?
                    The remaining balance of {confirmCard && formatKES(confirmCard.currentBalance)} will be voided.
                  </>
                )}
                {confirmAction === 'redeem' && (
                  <>
                    Are you sure you want to redeem gift card{' '}
                    <code className="font-mono font-semibold">{confirmCard?.code}</code>?
                    The full balance of {confirmCard && formatKES(confirmCard.currentBalance)} will be marked as used.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            {confirmCard && (
              <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Code</span>
                  <code className="font-mono font-semibold">{confirmCard.code}</code>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">{confirmCard.customer?.name || 'Unassigned'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balance</span>
                  <span className="font-semibold">{formatKES(confirmCard.currentBalance)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  {getStatusBadge(confirmCard.status)}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmDialogOpen(false)}
                disabled={isConfirmLoading}
              >
                No, Keep It
              </Button>
              <Button
                onClick={handleConfirmAction}
                disabled={isConfirmLoading}
                className={
                  confirmAction === 'delete'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : confirmAction === 'cancel'
                    ? 'bg-orange-600 hover:bg-orange-700 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }
              >
                {isConfirmLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {confirmAction === 'delete' && 'Yes, Delete'}
                    {confirmAction === 'cancel' && 'Yes, Cancel'}
                    {confirmAction === 'redeem' && 'Yes, Redeem'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
