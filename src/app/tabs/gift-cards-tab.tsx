'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Gift, Search, Plus, Copy, Eye, EyeOff, Loader2,
  ArrowUpDown, Filter, CreditCard, Calendar, Phone,
  Mail, User, FileText, AlertTriangle, CheckCircle2,
  XCircle, Clock, ChevronDown, Settings2, Sparkles,
  TrendingDown, TrendingUp, Ban, RefreshCw, Wallet,
  MoreHorizontal, Pencil, Trash2, ShieldAlert, Info,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  giftCardsApi,
  customersApi,
  formatKES,
  formatDate,
  formatDateTime,
} from '@/lib/api';
import type {
  GiftCardItem,
  GiftCardReason,
  GiftCardStatus,
} from '@/lib/types';
import {
  GiftCardReason as GiftCardReasonEnum,
  GiftCardStatus as GiftCardStatusEnum,
} from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';

// ─── Props ────────────────────────────────────────────────────────
interface GiftCardsTabProps {
  storeId: string;
  userRole: string;
  userId: string;
}

// ─── Reason Config ─────────────────────────────────────────────────
const REASON_CONFIG: Record<GiftCardReason, { label: string; description: string; color: string; bgClass: string; textClass: string; icon: React.ReactNode }> = {
  CUSTOMER_LOYALTY: {
    label: 'Customer Loyalty',
    description: 'Reward for loyal customers',
    color: 'text-amber-700 dark:text-amber-400',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-800 dark:text-amber-300',
    icon: <Sparkles className="h-3 w-3" />,
  },
  PROMOTION: {
    label: 'Promotion',
    description: 'Marketing or promotional giveaway',
    color: 'text-green-700 dark:text-green-400',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    textClass: 'text-green-800 dark:text-green-300',
    icon: <Gift className="h-3 w-3" />,
  },
  REFUND_CREDIT: {
    label: 'Refund Credit',
    description: 'Issued as a refund for a return',
    color: 'text-red-700 dark:text-red-400',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textClass: 'text-red-800 dark:text-red-300',
    icon: <RefreshCw className="h-3 w-3" />,
  },
  STORE_CREDIT: {
    label: 'Store Credit',
    description: 'General store credit',
    color: 'text-cyan-700 dark:text-cyan-400',
    bgClass: 'bg-cyan-100 dark:bg-cyan-900/30',
    textClass: 'text-cyan-800 dark:text-cyan-300',
    icon: <Wallet className="h-3 w-3" />,
  },
  GIFT: {
    label: 'Gift',
    description: 'Gift card for someone special',
    color: 'text-pink-700 dark:text-pink-400',
    bgClass: 'bg-pink-100 dark:bg-pink-900/30',
    textClass: 'text-pink-800 dark:text-pink-300',
    icon: <Gift className="h-3 w-3" />,
  },
  EMPLOYEE_AWARD: {
    label: 'Employee Award',
    description: 'Recognition or bonus for employees',
    color: 'text-purple-700 dark:text-purple-400',
    bgClass: 'bg-purple-100 dark:bg-purple-900/30',
    textClass: 'text-purple-800 dark:text-purple-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  COMPLAINT_RESOLUTION: {
    label: 'Complaint Resolution',
    description: 'Compensation for a complaint',
    color: 'text-orange-700 dark:text-orange-400',
    bgClass: 'bg-orange-100 dark:bg-orange-900/30',
    textClass: 'text-orange-800 dark:text-orange-300',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  OTHER: {
    label: 'Other',
    description: 'Other reason',
    color: 'text-gray-700 dark:text-gray-400',
    bgClass: 'bg-gray-100 dark:bg-gray-800/50',
    textClass: 'text-gray-800 dark:text-gray-300',
    icon: <FileText className="h-3 w-3" />,
  },
};

// ─── Status Config ─────────────────────────────────────────────────
const STATUS_CONFIG: Record<GiftCardStatus, { label: string; bgClass: string; textClass: string; dotClass: string }> = {
  ACTIVE: {
    label: 'Active',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    textClass: 'text-green-800 dark:text-green-300',
    dotClass: 'bg-green-500',
  },
  REDEEMED: {
    label: 'Redeemed',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
    textClass: 'text-blue-800 dark:text-blue-300',
    dotClass: 'bg-blue-500',
  },
  EXPIRED: {
    label: 'Expired',
    bgClass: 'bg-gray-100 dark:bg-gray-800/50',
    textClass: 'text-gray-800 dark:text-gray-300',
    dotClass: 'bg-gray-500',
  },
  CANCELLED: {
    label: 'Cancelled',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textClass: 'text-red-800 dark:text-red-300',
    dotClass: 'bg-red-500',
  },
  PARTIALLY_REDEEMED: {
    label: 'Partially Redeemed',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-800 dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
};

// ─── Sort Options ──────────────────────────────────────────────────
type SortField = 'date' | 'balance' | 'status';
type SortOrder = 'asc' | 'desc';

// ─── Permission Helpers ────────────────────────────────────────────
function canCreate(role: string): boolean {
  return ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER'].includes(role);
}
function canEdit(role: string): boolean {
  return ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'].includes(role);
}
function canRedeem(role: string): boolean {
  return ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER'].includes(role);
}
function canCancel(role: string): boolean {
  return ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'].includes(role);
}
function canAdjust(role: string): boolean {
  return ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(role);
}
function canHardDelete(role: string): boolean {
  return role === 'SUPER_ADMIN';
}
function canViewDetails(role: string): boolean {
  return true; // All roles can view
}

// ─── Auto-generate gift card code ─────────────────────────────────
function generateGiftCardCode(): string {
  const prefix = 'GC';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix;
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ─── Sub-Components ────────────────────────────────────────────────

function ReasonBadge({ reason }: { reason: GiftCardReason }) {
  const config = REASON_CONFIG[reason];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${config.bgClass} ${config.textClass}`}>
      {config.icon}
      {config.label}
    </span>
  );
}

function StatusBadge({ status }: { status: GiftCardStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${config.bgClass} ${config.textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </span>
  );
}

function BalanceProgressBar({ current, initial }: { current: number; initial: number }) {
  const percentage = initial > 0 ? Math.min((current / initial) * 100, 100) : 0;
  let barColor = 'bg-green-500';
  if (percentage <= 25) barColor = 'bg-red-500';
  else if (percentage <= 50) barColor = 'bg-amber-500';
  else if (percentage <= 75) barColor = 'bg-cyan-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">{formatKES(current)}</span>
        <span className="text-muted-foreground">of {formatKES(initial)}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function AutoAdjustIndicator({ autoAdjust, isVisible }: { autoAdjust: boolean; isVisible: boolean }) {
  if (!autoAdjust) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Settings2 className="h-3 w-3" />
              Manual
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Visibility managed manually</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 text-[10px] ${isVisible ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
            <Settings2 className="h-3 w-3" />
            Auto {isVisible ? '(visible)' : '(hidden)'}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>Auto-adjust: card becomes invisible when balance reaches 0</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Loading Skeleton ──────────────────────────────────────────────
function GiftCardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="animate-pulse">
          <CardContent className="p-4 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-2 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────────────
function EmptyState({ onCreateClick, canCreateCards }: { onCreateClick: () => void; canCreateCards: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Gift className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">No Gift Cards Found</h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
        Get started by creating your first gift card. You can issue cards for customer loyalty, promotions, refunds, and more.
      </p>
      {canCreateCards && (
        <Button onClick={onCreateClick} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Gift Card
        </Button>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────
export default function GiftCardsTab({ storeId, userRole, userId }: GiftCardsTabProps) {
  const queryClient = useQueryClient();

  // ── State ──
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [reasonFilter, setReasonFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showFilters, setShowFilters] = useState(false);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);

  // Selected card for detail/edit
  const [selectedCard, setSelectedCard] = useState<GiftCardItem | null>(null);

  // Create form state
  const [createForm, setCreateForm] = useState<{
    code: string;
    reason: GiftCardReason;
    initialBalance: string;
    recipientName: string;
    recipientPhone: string;
    recipientEmail: string;
    customerId: string;
    expiryDate: string;
    autoAdjustItems: boolean;
    notes: string;
  }>({
    code: generateGiftCardCode(),
    reason: 'CUSTOMER_LOYALTY' as GiftCardReason,
    initialBalance: '',
    recipientName: '',
    recipientPhone: '',
    recipientEmail: '',
    customerId: '',
    expiryDate: '',
    autoAdjustItems: true,
    notes: '',
  });

  // Edit form state
  const [editForm, setEditForm] = useState<{
    reason: string;
    recipientName: string;
    recipientPhone: string;
    recipientEmail: string;
    expiryDate: string;
    autoAdjustItems: boolean;
    isVisible: boolean;
    notes: string;
    initialBalance: string;
  }>({
    reason: '',
    recipientName: '',
    recipientPhone: '',
    recipientEmail: '',
    expiryDate: '',
    autoAdjustItems: true,
    isVisible: true,
    notes: '',
    initialBalance: '',
  });

  // Redeem form state
  const [redeemForm, setRedeemForm] = useState<{
    amount: string;
    transactionId: string;
    notes: string;
  }>({
    amount: '',
    transactionId: '',
    notes: '',
  });

  // Adjust balance form state
  const [adjustForm, setAdjustForm] = useState<{
    amount: string;
    reason: string;
    notes: string;
  }>({
    amount: '',
    reason: '',
    notes: '',
  });

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<Array<{ id: string; name: string; phone: string | null; email: string | null }>>([]);

  // ── Queries ──
  const { data: giftCardsData, isLoading, error } = useQuery({
    queryKey: ['giftCards', storeId, statusFilter, reasonFilter, searchQuery, sortField, sortOrder],
    queryFn: async () => {
      const result = await giftCardsApi.list({
        storeId,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        reason: reasonFilter !== 'ALL' ? reasonFilter : undefined,
        search: searchQuery || undefined,
      });
      return Array.isArray(result.data) ? result.data : [];
    },
    enabled: !!storeId,
  });

  const giftCards = useMemo(() => Array.isArray(giftCardsData) ? giftCardsData : [], [giftCardsData]);

  // Customer search query
  const { data: customerSearchData } = useQuery({
    queryKey: ['customerSearch', customerSearch],
    queryFn: async () => {
      if (!customerSearch || customerSearch.length < 2) return [];
      const result = await customersApi.search(customerSearch, storeId);
      return Array.isArray(result.data) ? result.data : [];
    },
    enabled: customerSearch.length >= 2,
  });

  // Update customer search results when data changes
  React.useEffect(() => {
    if (customerSearchData) {
      setCustomerSearchResults(customerSearchData.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
      })));
    }
  }, [customerSearchData]);

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: async () => {
      const balance = parseFloat(createForm.initialBalance);
      if (isNaN(balance) || balance <= 0) throw new Error('Please enter a valid balance greater than 0');
      return giftCardsApi.create({
        storeId,
        code: createForm.code || undefined,
        reason: createForm.reason,
        initialBalance: balance,
        recipientName: createForm.recipientName || undefined,
        recipientPhone: createForm.recipientPhone || undefined,
        recipientEmail: createForm.recipientEmail || undefined,
        customerId: createForm.customerId || undefined,
        expiryDate: createForm.expiryDate || undefined,
        autoAdjustItems: createForm.autoAdjustItems,
        notes: createForm.notes || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Gift card created successfully');
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      resetCreateForm();
      setCreateDialogOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create gift card');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCard) throw new Error('No card selected');
      const payload: Record<string, unknown> = {
        reason: editForm.reason,
        recipientName: editForm.recipientName || undefined,
        recipientPhone: editForm.recipientPhone || undefined,
        recipientEmail: editForm.recipientEmail || undefined,
        autoAdjustItems: editForm.autoAdjustItems,
        isVisible: editForm.isVisible,
        notes: editForm.notes || undefined,
      };
      // Handle expiry date
      if (editForm.expiryDate) {
        payload.expiryDate = editForm.expiryDate;
      } else {
        payload.expiryDate = null;
      }
      // Handle initial balance if changed
      if (editForm.initialBalance) {
        const newBalance = parseFloat(editForm.initialBalance);
        if (!isNaN(newBalance) && newBalance !== selectedCard.initialBalance) {
          payload.initialBalance = newBalance;
        }
      }
      return giftCardsApi.update(selectedCard.id, payload);
    },
    onSuccess: () => {
      toast.success('Gift card updated successfully');
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      setEditDialogOpen(false);
      setSelectedCard(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update gift card');
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCard) throw new Error('No card selected');
      const amount = parseFloat(redeemForm.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Please enter a valid amount');
      if (amount > selectedCard.currentBalance) throw new Error('Amount exceeds current balance');
      return giftCardsApi.redeem(selectedCard.id, {
        amount,
        transactionId: redeemForm.transactionId || undefined,
        notes: redeemForm.notes || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Gift card redeemed successfully');
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      setRedeemForm({ amount: '', transactionId: '', notes: '' });
      setRedeemDialogOpen(false);
      setDetailDialogOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to redeem gift card');
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCard) throw new Error('No card selected');
      const amount = parseFloat(adjustForm.amount);
      if (isNaN(amount) || amount === 0) throw new Error('Please enter a valid amount');
      if (!adjustForm.reason.trim()) throw new Error('Please provide a reason for the adjustment');
      return giftCardsApi.adjust(selectedCard.id, {
        amount,
        reason: adjustForm.reason,
      });
    },
    onSuccess: () => {
      toast.success('Balance adjusted successfully');
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      setAdjustForm({ amount: '', reason: '', notes: '' });
      setAdjustDialogOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to adjust balance');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCard) throw new Error('No card selected');
      return giftCardsApi.cancel(selectedCard.id);
    },
    onSuccess: () => {
      toast.success('Gift card cancelled');
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      setCancelDialogOpen(false);
      setDetailDialogOpen(false);
      setSelectedCard(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to cancel gift card');
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCard) throw new Error('No card selected');
      return giftCardsApi.delete(selectedCard.id, true);
    },
    onSuccess: () => {
      toast.success('Gift card permanently deleted');
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      setDeleteDialogOpen(false);
      setDetailDialogOpen(false);
      setSelectedCard(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete gift card');
    },
  });

  const toggleVisibilityMutation = useMutation({
    mutationFn: async (card: GiftCardItem) => {
      return giftCardsApi.toggleVisibility(card.id);
    },
    onSuccess: () => {
      toast.success('Visibility toggled');
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to toggle visibility');
    },
  });

  // ── Helpers ──
  const resetCreateForm = useCallback(() => {
    setCreateForm({
      code: generateGiftCardCode(),
      reason: 'CUSTOMER_LOYALTY' as GiftCardReason,
      initialBalance: '',
      recipientName: '',
      recipientPhone: '',
      recipientEmail: '',
      customerId: '',
      expiryDate: '',
      autoAdjustItems: true,
      notes: '',
    });
    setCustomerSearch('');
    setCustomerSearchResults([]);
  }, []);

  const openDetailDialog = useCallback((card: GiftCardItem) => {
    setSelectedCard(card);
    setDetailDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((card: GiftCardItem) => {
    setSelectedCard(card);
    setEditForm({
      reason: card.reason,
      recipientName: card.recipientName ?? '',
      recipientPhone: card.recipientPhone ?? '',
      recipientEmail: card.recipientEmail ?? '',
      expiryDate: card.expiryDate ? card.expiryDate.split('T')[0] : '',
      autoAdjustItems: card.autoAdjustItems,
      isVisible: card.isVisible,
      notes: card.notes ?? '',
      initialBalance: String(card.initialBalance),
    });
    setEditDialogOpen(true);
  }, []);

  const copyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      toast.success('Code copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy code');
    });
  }, []);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }, [sortField]);

  const remainingAfterRedeem = useMemo(() => {
    if (!selectedCard || !redeemForm.amount) return selectedCard?.currentBalance ?? 0;
    const amount = parseFloat(redeemForm.amount);
    if (isNaN(amount)) return selectedCard.currentBalance;
    return Math.max(0, selectedCard.currentBalance - amount);
  }, [selectedCard, redeemForm.amount]);

  const isExpired = useCallback((card: GiftCardItem) => {
    if (!card.expiryDate) return false;
    return new Date(card.expiryDate) < new Date();
  }, []);

  // ── Render ──
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gift className="h-6 w-6 text-pink-500" />
            Gift Cards
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage gift cards, track balances, and process redemptions
          </p>
        </div>
        {canCreate(userRole) && (
          <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Gift Card
          </Button>
        )}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code, recipient name, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2 self-start"
          >
            <Filter className="h-4 w-4" />
            Filters
            <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </Button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-2 p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Status:</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Reason:</Label>
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Reasons</SelectItem>
                  {Object.entries(REASON_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator orientation="vertical" className="h-8 hidden sm:block" />
            <div className="flex items-center gap-1">
              <Label className="text-xs whitespace-nowrap">Sort:</Label>
              <Button
                variant={sortField === 'date' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => toggleSort('date')}
              >
                <Calendar className="h-3 w-3" />
                Date
                <ArrowUpDown className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant={sortField === 'balance' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => toggleSort('balance')}
              >
                <Wallet className="h-3 w-3" />
                Balance
                <ArrowUpDown className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant={sortField === 'status' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => toggleSort('status')}
              >
                <CreditCard className="h-3 w-3" />
                Status
                <ArrowUpDown className="h-2.5 w-2.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <GiftCardGridSkeleton />
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive">Failed to load gift cards. Please try again.</p>
          </CardContent>
        </Card>
      ) : giftCards.length === 0 ? (
        <EmptyState
          onCreateClick={() => setCreateDialogOpen(true)}
          canCreateCards={canCreate(userRole)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {giftCards.map((card) => {
            const isCardExpired = isExpired(card);
            return (
              <Card
                key={card.id}
                className={`group transition-all duration-200 hover:shadow-md ${
                  !card.isVisible ? 'opacity-60' : ''
                } ${isCardExpired && card.status === 'ACTIVE' ? 'border-amber-300 dark:border-amber-700' : ''}`}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Top row: Code + Status + Actions dropdown */}
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="flex items-center gap-1.5 min-w-0 cursor-pointer flex-1"
                      onClick={() => {
                        if (canViewDetails(userRole)) openDetailDialog(card);
                      }}
                    >
                      <span className="font-mono text-sm font-bold tracking-wider truncate">
                        {card.code}
                      </span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyCode(card.code);
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy code</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <StatusBadge status={card.status as GiftCardStatus} />
                      {/* ─── Actions Dropdown ─── */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Actions
                          </DropdownMenuLabel>
                          <DropdownMenuGroup>
                            {/* View Details */}
                            <DropdownMenuItem
                              onClick={() => openDetailDialog(card)}
                              className="gap-2 cursor-pointer"
                            >
                              <Info className="h-4 w-4" />
                              View Details
                            </DropdownMenuItem>

                            {/* Edit */}
                            {canEdit(userRole) && (
                              <DropdownMenuItem
                                onClick={() => openEditDialog(card)}
                                className="gap-2 cursor-pointer"
                              >
                                <Pencil className="h-4 w-4" />
                                Edit Gift Card
                              </DropdownMenuItem>
                            )}

                            {/* Toggle Visibility */}
                            {canEdit(userRole) && (
                              <DropdownMenuItem
                                onClick={() => toggleVisibilityMutation.mutate(card)}
                                className="gap-2 cursor-pointer"
                              >
                                {card.isVisible ? (
                                  <>
                                    <EyeOff className="h-4 w-4" />
                                    Hide Card
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-4 w-4" />
                                    Show Card
                                  </>
                                )}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>

                          {/* Active card actions */}
                          {['ACTIVE', 'PARTIALLY_REDEEMED'].includes(card.status) && card.currentBalance > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel className="text-xs text-muted-foreground">
                                Card Operations
                              </DropdownMenuLabel>
                              <DropdownMenuGroup>
                                {/* Redeem */}
                                {canRedeem(userRole) && (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedCard(card);
                                      setRedeemForm({ amount: '', transactionId: '', notes: '' });
                                      setRedeemDialogOpen(true);
                                    }}
                                    className="gap-2 cursor-pointer"
                                  >
                                    <TrendingDown className="h-4 w-4 text-green-600" />
                                    Redeem
                                  </DropdownMenuItem>
                                )}

                                {/* Adjust Balance */}
                                {canAdjust(userRole) && (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedCard(card);
                                      setAdjustForm({ amount: '', reason: '', notes: '' });
                                      setAdjustDialogOpen(true);
                                    }}
                                    className="gap-2 cursor-pointer"
                                  >
                                    <TrendingUp className="h-4 w-4 text-cyan-600" />
                                    Adjust Balance
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuGroup>
                            </>
                          )}

                          {/* Cancel / Delete section */}
                          <DropdownMenuSeparator />
                          {canCancel(userRole) && ['ACTIVE', 'PARTIALLY_REDEEMED'].includes(card.status) && (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedCard(card);
                                setCancelDialogOpen(true);
                              }}
                              className="gap-2 cursor-pointer text-amber-600 dark:text-amber-400 focus:text-amber-600 focus:bg-amber-50 dark:focus:bg-amber-950/30"
                            >
                              <Ban className="h-4 w-4" />
                              Cancel Card
                            </DropdownMenuItem>
                          )}
                          {canHardDelete(userRole) && ['CANCELLED', 'EXPIRED', 'REDEEMED'].includes(card.status) && (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedCard(card);
                                setDeleteDialogOpen(true);
                              }}
                              className="gap-2 cursor-pointer text-red-600 dark:text-red-400 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete Permanently
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Balance progress - clickable */}
                  <div
                    className="cursor-pointer"
                    onClick={() => {
                      if (canViewDetails(userRole)) openDetailDialog(card);
                    }}
                  >
                    <BalanceProgressBar
                      current={card.currentBalance}
                      initial={card.initialBalance}
                    />
                  </div>

                  {/* Reason + Auto-adjust */}
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => {
                      if (canViewDetails(userRole)) openDetailDialog(card);
                    }}
                  >
                    <ReasonBadge reason={card.reason as GiftCardReason} />
                    <AutoAdjustIndicator
                      autoAdjust={card.autoAdjustItems}
                      isVisible={card.isVisible}
                    />
                  </div>

                  {/* Recipient info */}
                  {card.recipientName && (
                    <div
                      className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
                      onClick={() => {
                        if (canViewDetails(userRole)) openDetailDialog(card);
                      }}
                    >
                      <User className="h-3 w-3 shrink-0" />
                      <span className="truncate">{card.recipientName}</span>
                      {card.recipientPhone && (
                        <span className="truncate">({card.recipientPhone})</span>
                      )}
                    </div>
                  )}

                  {/* Expiry + Visibility */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div
                      className="flex items-center gap-1 cursor-pointer flex-1"
                      onClick={() => {
                        if (canViewDetails(userRole)) openDetailDialog(card);
                      }}
                    >
                      {card.expiryDate ? (
                        <>
                          <Clock className="h-3 w-3" />
                          <span className={isCardExpired ? 'text-red-500 font-medium' : ''}>
                            {isCardExpired ? 'Expired ' : 'Expires '}
                            {formatDate(card.expiryDate)}
                          </span>
                        </>
                      ) : (
                        <span>No expiry</span>
                      )}
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canEdit(userRole)) {
                                toggleVisibilityMutation.mutate(card);
                              } else {
                                toast.error('You do not have permission to toggle visibility');
                              }
                            }}
                          >
                            {card.isVisible ? (
                              <Eye className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <EyeOff className="h-3 w-3 text-muted-foreground" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {card.isVisible ? 'Visible - Click to hide' : 'Hidden - Click to show'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Customer link */}
                  {card.customer && (
                    <div
                      className="text-xs text-muted-foreground cursor-pointer"
                      onClick={() => {
                        if (canViewDetails(userRole)) openDetailDialog(card);
                      }}
                    >
                      Linked: <span className="font-medium text-foreground">{card.customer.name}</span>
                    </div>
                  )}

                  {/* Quick action buttons at bottom */}
                  <div className="flex items-center gap-1.5 pt-1 border-t">
                    {canEdit(userRole) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(card);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                    )}
                    {canRedeem(userRole) && ['ACTIVE', 'PARTIALLY_REDEEMED'].includes(card.status) && card.currentBalance > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 flex-1 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCard(card);
                          setRedeemForm({ amount: '', transactionId: '', notes: '' });
                          setRedeemDialogOpen(true);
                        }}
                      >
                        <TrendingDown className="h-3 w-3" />
                        Redeem
                      </Button>
                    )}
                    {canCancel(userRole) && ['ACTIVE', 'PARTIALLY_REDEEMED'].includes(card.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCard(card);
                          setCancelDialogOpen(true);
                        }}
                      >
                        <Ban className="h-3 w-3" />
                        Cancel
                      </Button>
                    )}
                    {canHardDelete(userRole) && ['CANCELLED', 'EXPIRED', 'REDEEMED'].includes(card.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCard(card);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* CREATE GIFT CARD DIALOG                                    */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => {
        if (!open) resetCreateForm();
        setCreateDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-[525px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-pink-500" />
              Create Gift Card
            </DialogTitle>
            <DialogDescription>
              Issue a new gift card with the specified balance and recipient details.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Code */}
            <div className="grid gap-2">
              <Label htmlFor="gc-code">Card Code</Label>
              <div className="flex gap-2">
                <Input
                  id="gc-code"
                  value={createForm.code}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="Auto-generated"
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateForm(prev => ({ ...prev, code: generateGiftCardCode() }))}
                >
                  Regenerate
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Leave as-is for auto-generated code or customize</p>
            </div>

            {/* Reason */}
            <div className="grid gap-2">
              <Label htmlFor="gc-reason">Reason</Label>
              <Select
                value={createForm.reason}
                onValueChange={(v) => setCreateForm(prev => ({ ...prev, reason: v as GiftCardReason }))}
              >
                <SelectTrigger id="gc-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REASON_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        {config.icon}
                        <span>{config.label}</span>
                        <span className="text-muted-foreground text-xs">- {config.description}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Initial Balance */}
            <div className="grid gap-2">
              <Label htmlFor="gc-balance">Initial Balance (KES)</Label>
              <Input
                id="gc-balance"
                type="number"
                min="0"
                step="100"
                value={createForm.initialBalance}
                onChange={(e) => setCreateForm(prev => ({ ...prev, initialBalance: e.target.value }))}
                placeholder="e.g. 5000"
              />
              {createForm.initialBalance && (
                <p className="text-xs text-muted-foreground">
                  = {formatKES(parseFloat(createForm.initialBalance) || 0)}
                </p>
              )}
            </div>

            <Separator />

            {/* Recipient Info */}
            <div className="grid gap-3">
              <Label className="text-sm font-semibold">Recipient Information</Label>
              <div className="grid gap-2">
                <Input
                  placeholder="Recipient name"
                  value={createForm.recipientName}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, recipientName: e.target.value }))}
                  className="h-9"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Phone number"
                    value={createForm.recipientPhone}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, recipientPhone: e.target.value }))}
                    className="h-9"
                  />
                  <Input
                    placeholder="Email address"
                    type="email"
                    value={createForm.recipientEmail}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, recipientEmail: e.target.value }))}
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {/* Link to Customer */}
            <div className="grid gap-2">
              <Label>Link to Existing Customer (Optional)</Label>
              <div className="relative">
                <Input
                  placeholder="Search customers by name or phone..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="h-9"
                />
                {customerSearchResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {customerSearchResults.map((c) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                        onClick={() => {
                          setCreateForm(prev => ({
                            ...prev,
                            customerId: c.id,
                            recipientName: prev.recipientName || c.name,
                            recipientPhone: prev.recipientPhone || (c.phone ?? ''),
                            recipientEmail: prev.recipientEmail || (c.email ?? ''),
                          }));
                          setCustomerSearch(c.name);
                          setCustomerSearchResults([]);
                        }}
                      >
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.phone && <span>{c.phone}</span>}
                          {c.email && <span> &middot; {c.email}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {createForm.customerId && (
                  <div className="flex items-center gap-1 mt-1">
                    <Badge variant="secondary" className="text-xs">Linked</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-xs text-muted-foreground"
                      onClick={() => setCreateForm(prev => ({ ...prev, customerId: '' }))}
                    >
                      Remove link
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Expiry Date */}
            <div className="grid gap-2">
              <Label htmlFor="gc-expiry">Expiry Date (Optional)</Label>
              <Input
                id="gc-expiry"
                type="date"
                value={createForm.expiryDate}
                onChange={(e) => setCreateForm(prev => ({ ...prev, expiryDate: e.target.value }))}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Auto-adjust toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Auto-Adjust Visibility</Label>
                <p className="text-xs text-muted-foreground">
                  When balance reaches 0, card becomes invisible. When balance is increased from 0, card becomes visible again.
                </p>
              </div>
              <Switch
                checked={createForm.autoAdjustItems}
                onCheckedChange={(checked) => setCreateForm(prev => ({ ...prev, autoAdjustItems: checked }))}
              />
            </div>

            {/* Notes */}
            <div className="grid gap-2">
              <Label htmlFor="gc-notes">Notes</Label>
              <Textarea
                id="gc-notes"
                value={createForm.notes}
                onChange={(e) => setCreateForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional notes about this gift card..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetCreateForm(); setCreateDialogOpen(false); }}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !createForm.initialBalance || !createForm.reason}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Gift Card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* DETAIL / VIEW DIALOG                                       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Gift Card Details
            </DialogTitle>
            <DialogDescription>
              View and manage gift card information
            </DialogDescription>
          </DialogHeader>

          {selectedCard && (
            <div className="space-y-6">
              {/* Card Info */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg font-bold">{selectedCard.code}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyCode(selectedCard.code)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <StatusBadge status={selectedCard.status as GiftCardStatus} />
                </div>
                <BalanceProgressBar
                  current={selectedCard.currentBalance}
                  initial={selectedCard.initialBalance}
                />
                <div className="flex items-center justify-between">
                  <ReasonBadge reason={selectedCard.reason as GiftCardReason} />
                  <AutoAdjustIndicator
                    autoAdjust={selectedCard.autoAdjustItems}
                    isVisible={selectedCard.isVisible}
                  />
                </div>
              </div>

              {/* Read-only info */}
              <div className="grid gap-2 text-sm">
                {selectedCard.recipientName && (
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedCard.recipientName}</span>
                    {selectedCard.recipientPhone && <span className="text-muted-foreground">({selectedCard.recipientPhone})</span>}
                  </div>
                )}
                {selectedCard.recipientEmail && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedCard.recipientEmail}</span>
                  </div>
                )}
                {selectedCard.expiryDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>Expires: {formatDate(selectedCard.expiryDate)}</span>
                  </div>
                )}
                {selectedCard.notes && (
                  <div className="flex items-start gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span>{selectedCard.notes}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Created:</span>
                  <span>{formatDateTime(selectedCard.createdAt)}</span>
                </div>
                {selectedCard.createdBy && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Created by:</span>
                    <span>{selectedCard.createdBy.name}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                {canEdit(userRole) && (
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setDetailDialogOpen(false);
                      openEditDialog(selectedCard);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
                {canRedeem(userRole) && ['ACTIVE', 'PARTIALLY_REDEEMED'].includes(selectedCard.status) && selectedCard.currentBalance > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setRedeemForm({ amount: '', transactionId: '', notes: '' });
                      setRedeemDialogOpen(true);
                    }}
                  >
                    <TrendingDown className="h-3.5 w-3.5" />
                    Redeem
                  </Button>
                )}
                {canAdjust(userRole) && ['ACTIVE', 'PARTIALLY_REDEEMED'].includes(selectedCard.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setAdjustForm({ amount: '', reason: '', notes: '' });
                      setAdjustDialogOpen(true);
                    }}
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    Adjust Balance
                  </Button>
                )}
                {canCancel(userRole) && ['ACTIVE', 'PARTIALLY_REDEEMED'].includes(selectedCard.status) && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setCancelDialogOpen(true)}
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Cancel Card
                  </Button>
                )}
                {canHardDelete(userRole) && ['CANCELLED', 'EXPIRED', 'REDEEMED'].includes(selectedCard.status) && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Permanently
                  </Button>
                )}
              </div>

              {/* Redemption History */}
              {selectedCard.redemptions && selectedCard.redemptions.length > 0 && (
                <div className="space-y-3">
                  <Separator />
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    Redemption History
                  </h4>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Amount</TableHead>
                          <TableHead className="text-xs">Transaction</TableHead>
                          <TableHead className="text-xs">Processed By</TableHead>
                          <TableHead className="text-xs">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedCard.redemptions.map((redemption) => (
                          <TableRow key={redemption.id}>
                            <TableCell className="text-xs">
                              {formatDateTime(redemption.createdAt)}
                            </TableCell>
                            <TableCell className="text-xs font-medium text-red-600 dark:text-red-400">
                              -{formatKES(redemption.amount)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {redemption.transaction?.receiptNumber ?? (
                                <span className="text-muted-foreground">N/A</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {redemption.processedBy?.name ?? (
                                <span className="text-muted-foreground">N/A</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                              {redemption.notes ?? '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Meta info */}
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
                <span>Created: {formatDateTime(selectedCard.createdAt)}</span>
                <span>Updated: {formatDateTime(selectedCard.updatedAt)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* EDIT GIFT CARD DIALOG                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-blue-500" />
              Edit Gift Card
            </DialogTitle>
            <DialogDescription>
              Update gift card details. Changes will be saved immediately.
            </DialogDescription>
          </DialogHeader>

          {selectedCard && (
            <div className="grid gap-4 py-4">
              {/* Card info banner */}
              <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{selectedCard.code}</span>
                    <StatusBadge status={selectedCard.status as GiftCardStatus} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Current Balance</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">{formatKES(selectedCard.currentBalance)}</span>
                </div>
              </div>

              <Separator />

              {/* Reason */}
              <div className="grid gap-2">
                <Label>Reason</Label>
                <Select
                  value={editForm.reason}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, reason: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REASON_CONFIG).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          {config.icon}
                          {config.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Initial Balance */}
              <div className="grid gap-2">
                <Label htmlFor="edit-initial-balance">Initial Balance (KES)</Label>
                <Input
                  id="edit-initial-balance"
                  type="number"
                  min={selectedCard.currentBalance}
                  step="100"
                  value={editForm.initialBalance}
                  onChange={(e) => setEditForm(prev => ({ ...prev, initialBalance: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Must be ≥ current balance ({formatKES(selectedCard.currentBalance)}). Current: {formatKES(selectedCard.initialBalance)}
                </p>
              </div>

              {/* Recipient Info */}
              <div className="grid gap-3">
                <Label className="text-sm font-semibold">Recipient Information</Label>
                <div className="grid gap-2">
                  <Input
                    placeholder="Recipient name"
                    value={editForm.recipientName}
                    onChange={(e) => setEditForm(prev => ({ ...prev, recipientName: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Phone number"
                      value={editForm.recipientPhone}
                      onChange={(e) => setEditForm(prev => ({ ...prev, recipientPhone: e.target.value }))}
                    />
                    <Input
                      placeholder="Email address"
                      type="email"
                      value={editForm.recipientEmail}
                      onChange={(e) => setEditForm(prev => ({ ...prev, recipientEmail: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Expiry Date */}
              <div className="grid gap-2">
                <Label htmlFor="edit-expiry">Expiry Date</Label>
                <Input
                  id="edit-expiry"
                  type="date"
                  value={editForm.expiryDate}
                  onChange={(e) => setEditForm(prev => ({ ...prev, expiryDate: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty for no expiry. Current: {selectedCard.expiryDate ? formatDate(selectedCard.expiryDate) : 'No expiry'}
                </p>
              </div>

              {/* Auto-adjust toggle */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm">Auto-Adjust Visibility</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically hide when balance reaches 0
                  </p>
                </div>
                <Switch
                  checked={editForm.autoAdjustItems}
                  onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, autoAdjustItems: checked }))}
                />
              </div>

              {/* Visibility toggle */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm">Visible</Label>
                  <p className="text-xs text-muted-foreground">
                    {editForm.isVisible ? 'Card is visible in listings' : 'Card is hidden from listings'}
                  </p>
                </div>
                <Switch
                  checked={editForm.isVisible}
                  onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isVisible: checked }))}
                />
              </div>

              {/* Notes */}
              <div className="grid gap-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editForm.notes}
                  onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* REDEEM GIFT CARD DIALOG                                    */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <Dialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              Redeem Gift Card
            </DialogTitle>
            <DialogDescription>
              Process a redemption for this gift card
            </DialogDescription>
          </DialogHeader>

          {selectedCard && (
            <div className="grid gap-4 py-4">
              {/* Card summary */}
              <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Card Code</span>
                  <span className="font-mono font-bold">{selectedCard.code}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Balance</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">{formatKES(selectedCard.currentBalance)}</span>
                </div>
              </div>

              {/* Amount */}
              <div className="grid gap-2">
                <Label htmlFor="redeem-amount">Redemption Amount (KES)</Label>
                <Input
                  id="redeem-amount"
                  type="number"
                  min="0"
                  max={selectedCard.currentBalance}
                  step="50"
                  value={redeemForm.amount}
                  onChange={(e) => setRedeemForm(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="Enter amount"
                />
                {redeemForm.amount && parseFloat(redeemForm.amount) > selectedCard.currentBalance && (
                  <p className="text-xs text-destructive">
                    Amount exceeds current balance of {formatKES(selectedCard.currentBalance)}
                  </p>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Remaining after redemption:</span>
                  <span className={`font-medium ${remainingAfterRedeem === 0 ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
                    {formatKES(remainingAfterRedeem)}
                  </span>
                </div>
              </div>

              {/* Transaction Link */}
              <div className="grid gap-2">
                <Label htmlFor="redeem-txn">Link to Transaction (Optional)</Label>
                <Input
                  id="redeem-txn"
                  value={redeemForm.transactionId}
                  onChange={(e) => setRedeemForm(prev => ({ ...prev, transactionId: e.target.value }))}
                  placeholder="Transaction ID or receipt number"
                />
              </div>

              {/* Notes */}
              <div className="grid gap-2">
                <Label htmlFor="redeem-notes">Notes</Label>
                <Textarea
                  id="redeem-notes"
                  value={redeemForm.notes}
                  onChange={(e) => setRedeemForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional notes about this redemption..."
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeemDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => redeemMutation.mutate()}
              disabled={
                redeemMutation.isPending ||
                !redeemForm.amount ||
                (parseFloat(redeemForm.amount) || 0) <= 0 ||
                (parseFloat(redeemForm.amount) || 0) > (selectedCard?.currentBalance ?? 0)
              }
            >
              {redeemMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Redeem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ADJUST BALANCE DIALOG                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-cyan-500" />
              Adjust Gift Card Balance
            </DialogTitle>
            <DialogDescription>
              Increase or decrease the card balance
            </DialogDescription>
          </DialogHeader>

          {selectedCard && (
            <div className="grid gap-4 py-4">
              {/* Current balance */}
              <div className="rounded-lg border p-3 bg-muted/30 flex justify-between text-sm">
                <span className="text-muted-foreground">Current Balance</span>
                <span className="font-semibold">{formatKES(selectedCard.currentBalance)}</span>
              </div>

              {/* Amount (positive = increase, negative = decrease) */}
              <div className="grid gap-2">
                <Label htmlFor="adjust-amount">Adjustment Amount (KES)</Label>
                <Input
                  id="adjust-amount"
                  type="number"
                  step="50"
                  value={adjustForm.amount}
                  onChange={(e) => setAdjustForm(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="Positive to increase, negative to decrease"
                />
                <p className="text-xs text-muted-foreground">
                  Enter a positive number to add balance or a negative number to deduct.
                </p>
                {adjustForm.amount && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">New balance would be:</span>
                    <span className="font-medium">
                      {formatKES(Math.max(0, selectedCard.currentBalance + (parseFloat(adjustForm.amount) || 0)))}
                    </span>
                  </div>
                )}
              </div>

              {/* Reason */}
              <div className="grid gap-2">
                <Label htmlFor="adjust-reason">Reason *</Label>
                <Input
                  id="adjust-reason"
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="e.g., Customer complaint, Promo bonus"
                />
              </div>

              {/* Notes */}
              <div className="grid gap-2">
                <Label htmlFor="adjust-notes">Notes</Label>
                <Textarea
                  id="adjust-notes"
                  value={adjustForm.notes}
                  onChange={(e) => setAdjustForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Additional notes..."
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => adjustMutation.mutate()}
              disabled={
                adjustMutation.isPending ||
                !adjustForm.amount ||
                parseFloat(adjustForm.amount) === 0 ||
                isNaN(parseFloat(adjustForm.amount)) ||
                !adjustForm.reason.trim()
              }
            >
              {adjustMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* CANCEL CONFIRMATION DIALOG                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-amber-500" />
              Cancel Gift Card
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the gift card. The card status will be set to &quot;Cancelled&quot; and it can no longer be used for redemptions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedCard && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Card Code</span>
                <span className="font-mono font-bold">{selectedCard.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining Balance</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {formatKES(selectedCard.currentBalance)}
                </span>
              </div>
              {selectedCard.currentBalance > 0 && (
                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300 text-xs mt-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    This card still has a remaining balance of {formatKES(selectedCard.currentBalance)}.
                    Cancelling will forfeit this amount. Consider redeeming or adjusting the balance first.
                  </span>
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Card Active</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelMutation.mutate()}
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              CANCEL CARD
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HARD DELETE CONFIRMATION DIALOG                            */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Permanently Delete Gift Card
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The gift card and all its redemption history will be permanently removed from the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedCard && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Card Code</span>
                <span className="font-mono font-bold">{selectedCard.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={selectedCard.status as GiftCardStatus} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Initial Balance</span>
                <span className="font-semibold">{formatKES(selectedCard.initialBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Balance</span>
                <span className="font-semibold">{formatKES(selectedCard.currentBalance)}</span>
              </div>
              {selectedCard.redemptions && selectedCard.redemptions.length > 0 && (
                <div className="flex items-start gap-2 text-destructive text-xs mt-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    This card has {selectedCard.redemptions.length} redemption record(s) that will also be permanently deleted.
                  </span>
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Card</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => hardDeleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={hardDeleteMutation.isPending}
            >
              {hardDeleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              DELETE PERMANENTLY
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
