'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Tag, Search, Plus, Loader2,
  Percent, DollarSign, Package, Gift,
  TrendingUp, Clock, CalendarDays, Megaphone,
  Eye, Pencil, Trash2, Copy, CheckCircle2,
  ChevronDown, Filter, ArrowUpDown, Users,
  BarChart3, Receipt, Ticket, ShoppingBag,
  AlertCircle,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  vouchersApi, voucherCampaignsApi,
  formatKES, formatDate, formatDateTime,
  type VoucherItem,
  type VoucherCampaignItem,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';

// ─── Types ───────────────────────────────────────────────────────────────────

type VoucherType = VoucherItem['voucherType'];
type VoucherStatus = VoucherItem['status'];
type CampaignType = VoucherCampaignItem['campaignType'];
type CampaignStatus = VoucherCampaignItem['status'];
type InnerTab = 'vouchers' | 'campaigns' | 'redemptions';

// ─── Badge Helpers ───────────────────────────────────────────────────────────

function getVoucherStatusBadge(status: VoucherStatus) {
  switch (status) {
    case 'ACTIVE':
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 border-green-200 dark:border-green-800">
          <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Active
        </Badge>
      );
    case 'PAUSED':
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 border-amber-200 dark:border-amber-800">
          <span className="mr-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
          Paused
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
        <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 border-gray-200 dark:border-gray-700">
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getVoucherTypeBadge(type: VoucherType) {
  switch (type) {
    case 'FIXED':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800">
          <DollarSign className="h-3 w-3 mr-1" /> Fixed
        </Badge>
      );
    case 'PERCENTAGE':
      return (
        <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 border-cyan-200 dark:border-cyan-800">
          <Percent className="h-3 w-3 mr-1" /> Percentage
        </Badge>
      );
    case 'FREE_PRODUCT':
      return (
        <Badge className="bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-900/30 border-pink-200 dark:border-pink-800">
          <Gift className="h-3 w-3 mr-1" /> Free Product
        </Badge>
      );
    case 'BUNDLE':
      return (
        <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 border-violet-200 dark:border-violet-800">
          <Package className="h-3 w-3 mr-1" /> Bundle
        </Badge>
      );
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

function getCampaignStatusBadge(status: CampaignStatus) {
  switch (status) {
    case 'ACTIVE':
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 border-green-200 dark:border-green-800">
          <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Active
        </Badge>
      );
    case 'DRAFT':
      return (
        <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 border-gray-200 dark:border-gray-700">
          Draft
        </Badge>
      );
    case 'COMPLETED':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 border-red-200 dark:border-red-800">
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getCampaignTypeBadge(type: CampaignType) {
  switch (type) {
    case 'PROMOTION':
      return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 border-orange-200 dark:border-orange-800">Promotion</Badge>;
    case 'SEASONAL':
      return <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/30 border-teal-200 dark:border-teal-800">Seasonal</Badge>;
    case 'LOYALTY':
      return <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 border-violet-200 dark:border-violet-800">Loyalty</Badge>;
    case 'REFERRAL':
      return <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 border-cyan-200 dark:border-cyan-800">Referral</Badge>;
    case 'FLASH_SALE':
      return <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 border-rose-200 dark:border-rose-800">Flash Sale</Badge>;
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

function formatVoucherValue(voucher: VoucherItem): string {
  if (voucher.voucherType === 'FIXED') return formatKES(voucher.value);
  if (voucher.voucherType === 'PERCENTAGE') return `${voucher.value}%`;
  if (voucher.voucherType === 'FREE_PRODUCT') return 'Free Product';
  if (voucher.voucherType === 'BUNDLE') return formatKES(voucher.value);
  return String(voucher.value);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VouchersTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();

  // ─── Local State ──────────────────────────────────────────────────────────

  const [innerTab, setInnerTab] = useState<InnerTab>('vouchers');

  // Voucher filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Campaign filters
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<string>('all');
  const [campaignTypeFilter, setCampaignTypeFilter] = useState<string>('all');

  // Create voucher dialog
  const [createVoucherOpen, setCreateVoucherOpen] = useState(false);
  const [editVoucherOpen, setEditVoucherOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<VoucherItem | null>(null);
  const [deleteVoucherOpen, setDeleteVoucherOpen] = useState(false);
  const [deletingVoucher, setDeletingVoucher] = useState<VoucherItem | null>(null);

  // Create campaign dialog
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);

  // Voucher form state
  const [vFormName, setVFormName] = useState('');
  const [vFormType, setVFormType] = useState<VoucherType>('FIXED');
  const [vFormValue, setVFormValue] = useState('');
  const [vFormMinPurchase, setVFormMinPurchase] = useState('');
  const [vFormMaxDiscount, setVFormMaxDiscount] = useState('');
  const [vFormMaxUses, setVFormMaxUses] = useState('');
  const [vFormMaxUsesPerUser, setVFormMaxUsesPerUser] = useState('');
  const [vFormStartDate, setVFormStartDate] = useState('');
  const [vFormEndDate, setVFormEndDate] = useState('');
  const [vFormDescription, setVFormDescription] = useState('');
  const [vFormCampaignId, setVFormCampaignId] = useState('');

  // Campaign form state
  const [cFormName, setCFormName] = useState('');
  const [cFormType, setCFormType] = useState<CampaignType>('PROMOTION');
  const [cFormDescription, setCFormDescription] = useState('');
  const [cFormBudget, setCFormBudget] = useState('');
  const [cFormStartDate, setCFormStartDate] = useState('');
  const [cFormEndDate, setCFormEndDate] = useState('');
  const [cFormTargetAudience, setCFormTargetAudience] = useState('');

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: vouchersData, isLoading: vouchersLoading } = useQuery({
    queryKey: ['vouchers', currentStoreId, statusFilter, typeFilter],
    queryFn: () =>
      vouchersApi.list({
        storeId: currentStoreId,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        voucherType: typeFilter !== 'all' ? typeFilter : undefined,
      }),
  });

  const { data: campaignsData, isLoading: campaignsLoading } = useQuery({
    queryKey: ['voucher-campaigns', currentStoreId, campaignStatusFilter, campaignTypeFilter],
    queryFn: () =>
      voucherCampaignsApi.list({
        storeId: currentStoreId,
        status: campaignStatusFilter !== 'all' ? campaignStatusFilter : undefined,
        campaignType: campaignTypeFilter !== 'all' ? campaignTypeFilter : undefined,
      }),
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const createVoucherMutation = useMutation({
    mutationFn: vouchersApi.create,
    onSuccess: (res) => {
      const code = res.data?.code;
      toast.success(`Voucher created! Code: ${code}`);
      setCreateVoucherOpen(false);
      resetVoucherForm();
      queryClient.invalidateQueries({ queryKey: ['vouchers', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create voucher'),
  });

  const updateVoucherMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      vouchersApi.update(id, data),
    onSuccess: () => {
      toast.success('Voucher updated successfully');
      setEditVoucherOpen(false);
      setEditingVoucher(null);
      queryClient.invalidateQueries({ queryKey: ['vouchers', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update voucher'),
  });

  const deleteVoucherMutation = useMutation({
    mutationFn: vouchersApi.delete,
    onSuccess: () => {
      toast.success('Voucher deleted successfully');
      setDeleteVoucherOpen(false);
      setDeletingVoucher(null);
      queryClient.invalidateQueries({ queryKey: ['vouchers', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete voucher'),
  });

  const createCampaignMutation = useMutation({
    mutationFn: voucherCampaignsApi.create,
    onSuccess: () => {
      toast.success('Campaign created successfully');
      setCreateCampaignOpen(false);
      resetCampaignForm();
      queryClient.invalidateQueries({ queryKey: ['voucher-campaigns', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create campaign'),
  });

  // ─── Derived Data ────────────────────────────────────────────────────────

  const vouchers: VoucherItem[] = vouchersData?.data || [];
  const campaigns: VoucherCampaignItem[] = campaignsData?.data || [];

  // Filtered vouchers
  const filteredVouchers = useMemo(() => {
    let result = vouchers;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (v) =>
          v.code.toLowerCase().includes(q) ||
          v.name.toLowerCase().includes(q) ||
          v.voucherType.toLowerCase().includes(q) ||
          v.description?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [vouchers, searchQuery]);

  // Collect all redemptions from vouchers
  const allRedemptions = useMemo(() => {
    return vouchers
      .filter((v) => v.redemptions && v.redemptions.length > 0)
      .flatMap((v) =>
        (v.redemptions || []).map((r) => ({
          ...r,
          voucherCode: v.code,
          voucherName: v.name,
          voucherType: v.voucherType,
        }))
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [vouchers]);

  // Stats
  const stats = useMemo(() => {
    const activeVouchers = vouchers.filter((v) => v.status === 'ACTIVE').length;
    const totalRedemptions = vouchers.reduce((sum, v) => sum + v.currentUses, 0);

    const totalDiscountValue = allRedemptions.reduce(
      (sum, r) => sum + r.discountAmount,
      0
    );

    const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length;

    return {
      activeVouchers,
      totalRedemptions,
      totalDiscountValue,
      activeCampaigns,
    };
  }, [vouchers, campaigns, allRedemptions]);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function resetVoucherForm() {
    setVFormName('');
    setVFormType('FIXED');
    setVFormValue('');
    setVFormMinPurchase('');
    setVFormMaxDiscount('');
    setVFormMaxUses('');
    setVFormMaxUsesPerUser('');
    setVFormStartDate('');
    setVFormEndDate('');
    setVFormDescription('');
    setVFormCampaignId('');
  }

  function resetCampaignForm() {
    setCFormName('');
    setCFormType('PROMOTION');
    setCFormDescription('');
    setCFormBudget('');
    setCFormStartDate('');
    setCFormEndDate('');
    setCFormTargetAudience('');
  }

  function handleCreateVoucher() {
    if (!vFormName.trim()) {
      toast.error('Please enter a voucher name.');
      return;
    }
    if (!vFormValue || parseFloat(vFormValue) <= 0) {
      toast.error('Please enter a valid value.');
      return;
    }
    if (!vFormStartDate) {
      toast.error('Please set a start date.');
      return;
    }

    createVoucherMutation.mutate({
      storeId: currentStoreId,
      name: vFormName.trim(),
      voucherType: vFormType,
      value: parseFloat(vFormValue),
      minimumPurchase: vFormMinPurchase ? parseFloat(vFormMinPurchase) : undefined,
      maxDiscount: vFormMaxDiscount ? parseFloat(vFormMaxDiscount) : undefined,
      maxUses: vFormMaxUses ? parseInt(vFormMaxUses, 10) : undefined,
      maxUsesPerUser: vFormMaxUsesPerUser ? parseInt(vFormMaxUsesPerUser, 10) : undefined,
      startDate: vFormStartDate,
      endDate: vFormEndDate || undefined,
      description: vFormDescription || undefined,
      campaignId: vFormCampaignId || undefined,
    });
  }

  function handleEditVoucher() {
    if (!editingVoucher) return;
    if (!vFormName.trim()) {
      toast.error('Please enter a voucher name.');
      return;
    }

    updateVoucherMutation.mutate({
      id: editingVoucher.id,
      data: {
        name: vFormName.trim(),
        voucherType: vFormType,
        value: parseFloat(vFormValue) || editingVoucher.value,
        minimumPurchase: vFormMinPurchase ? parseFloat(vFormMinPurchase) : editingVoucher.minimumPurchase,
        maxDiscount: vFormMaxDiscount ? parseFloat(vFormMaxDiscount) : editingVoucher.maxDiscount,
        maxUses: vFormMaxUses ? parseInt(vFormMaxUses, 10) : editingVoucher.maxUses,
        maxUsesPerUser: vFormMaxUsesPerUser ? parseInt(vFormMaxUsesPerUser, 10) : editingVoucher.maxUsesPerUser,
        startDate: vFormStartDate || editingVoucher.startDate,
        endDate: vFormEndDate || editingVoucher.endDate,
        description: vFormDescription || editingVoucher.description,
        status: editingVoucher.status,
      },
    });
  }

  function handleDeleteVoucher() {
    if (!deletingVoucher) return;
    deleteVoucherMutation.mutate(deletingVoucher.id);
  }

  function handleCreateCampaign() {
    if (!cFormName.trim()) {
      toast.error('Please enter a campaign name.');
      return;
    }
    if (!cFormStartDate) {
      toast.error('Please set a start date.');
      return;
    }

    createCampaignMutation.mutate({
      storeId: currentStoreId,
      name: cFormName.trim(),
      campaignType: cFormType,
      description: cFormDescription || undefined,
      budget: cFormBudget ? parseFloat(cFormBudget) : undefined,
      startDate: cFormStartDate,
      endDate: cFormEndDate || undefined,
      targetAudience: cFormTargetAudience || undefined,
    });
  }

  function openEditVoucher(voucher: VoucherItem) {
    setEditingVoucher(voucher);
    setVFormName(voucher.name);
    setVFormType(voucher.voucherType);
    setVFormValue(String(voucher.value));
    setVFormMinPurchase(String(voucher.minimumPurchase || ''));
    setVFormMaxDiscount(String(voucher.maxDiscount || ''));
    setVFormMaxUses(String(voucher.maxUses || ''));
    setVFormMaxUsesPerUser(String(voucher.maxUsesPerUser || ''));
    setVFormStartDate(voucher.startDate ? voucher.startDate.split('T')[0] : '');
    setVFormEndDate(voucher.endDate ? voucher.endDate.split('T')[0] : '');
    setVFormDescription(voucher.description || '');
    setVFormCampaignId(voucher.campaignId || '');
    setEditVoucherOpen(true);
  }

  function openDeleteVoucher(voucher: VoucherItem) {
    setDeletingVoucher(voucher);
    setDeleteVoucherOpen(true);
  }

  function toggleVoucherStatus(voucher: VoucherItem) {
    const newStatus = voucher.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    updateVoucherMutation.mutate({
      id: voucher.id,
      data: { status: newStatus },
    });
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      toast.success(`Copied ${code} to clipboard`);
    }).catch(() => {
      toast.error('Failed to copy code');
    });
  }

  // ─── Loading State ───────────────────────────────────────────────────────

  if (vouchersLoading || campaignsLoading) {
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

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="space-y-6 p-4 md:p-6 max-w-[1600px] mx-auto">
        {/* ─── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
              <Tag className="h-7 w-7 text-emerald-500" />
              Vouchers
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage discount vouchers, promotional campaigns, and track redemptions
            </p>
          </div>
          <Button
            onClick={() => {
              resetVoucherForm();
              setCreateVoucherOpen(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Voucher
          </Button>
        </div>

        {/* ─── Stats Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-emerald-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Active Vouchers</p>
                  <p className="text-2xl font-bold mt-1">{stats.activeVouchers}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {vouchers.length} total created
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <Ticket className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-cyan-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Total Redemptions</p>
                  <p className="text-2xl font-bold mt-1">{stats.totalRedemptions}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All-time voucher uses
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
                  <Receipt className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-rose-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Total Discount Value</p>
                  <p className="text-2xl font-bold mt-1">{formatKES(stats.totalDiscountValue)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    From all redemptions
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                  <DollarSign className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Active Campaigns</p>
                  <p className="text-2xl font-bold mt-1">{stats.activeCampaigns}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {campaigns.length} total campaigns
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <Megaphone className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Inner Tabs ─────────────────────────────────────────────────── */}
        <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as InnerTab)}>
          <TabsList className="h-9">
            <TabsTrigger value="vouchers" className="text-xs px-3">
              <Tag className="h-3.5 w-3.5 mr-1.5" />
              Vouchers
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="text-xs px-3">
              <Megaphone className="h-3.5 w-3.5 mr-1.5" />
              Campaigns
            </TabsTrigger>
            <TabsTrigger value="redemptions" className="text-xs px-3">
              <Receipt className="h-3.5 w-3.5 mr-1.5" />
              Redemptions
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════ VOUCHERS SUB-TAB ═══════════════════ */}
          <TabsContent value="vouchers" className="mt-4 space-y-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Tag className="h-5 w-5 text-emerald-500" />
                      Vouchers
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {filteredVouchers.length} voucher{filteredVouchers.length !== 1 ? 's' : ''} found
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by code, name, type..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 w-[220px] h-9"
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
                  <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground whitespace-nowrap">Status:</Label>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="PAUSED">Paused</SelectItem>
                          <SelectItem value="EXPIRED">Expired</SelectItem>
                          <SelectItem value="CANCELLED">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground whitespace-nowrap">Type:</Label>
                      <Select value={typeFilter} onValueChange={setTypeFilter}>
                        <SelectTrigger className="w-[150px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="FIXED">Fixed Discount</SelectItem>
                          <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                          <SelectItem value="FREE_PRODUCT">Free Product</SelectItem>
                          <SelectItem value="BUNDLE">Bundle</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardHeader>

              <CardContent>
                {filteredVouchers.length === 0 ? (
                  <div className="text-center py-12">
                    <Tag className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No vouchers found</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Create your first voucher to get started
                    </p>
                    <Button
                      size="sm"
                      className="mt-4 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        resetVoucherForm();
                        setCreateVoucherOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Create Voucher
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Code</TableHead>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs text-right">Value</TableHead>
                          <TableHead className="text-xs text-right">Min Purchase</TableHead>
                          <TableHead className="text-xs text-center">Uses</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Start Date</TableHead>
                          <TableHead className="text-xs">End Date</TableHead>
                          <TableHead className="text-xs text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredVouchers.map((voucher) => (
                          <TableRow key={voucher.id} className="group hover:bg-muted/50">
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                  {voucher.code}
                                </code>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={() => copyCode(voucher.code)}
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Copy code</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium text-sm max-w-[180px] truncate">
                              {voucher.name}
                            </TableCell>
                            <TableCell>{getVoucherTypeBadge(voucher.voucherType)}</TableCell>
                            <TableCell className="text-right text-sm font-semibold">
                              {formatVoucherValue(voucher)}
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {voucher.minimumPurchase > 0 ? formatKES(voucher.minimumPurchase) : '—'}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center">
                                <span className="text-sm font-medium">
                                  {voucher.currentUses}/{voucher.maxUses || '∞'}
                                </span>
                                {voucher.maxUses > 0 && (
                                  <Progress
                                    value={(voucher.currentUses / voucher.maxUses) * 100}
                                    className="h-1.5 w-16 mt-1"
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{getVoucherStatusBadge(voucher.status)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDate(voucher.startDate)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {voucher.endDate ? formatDate(voucher.endDate) : '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => toggleVoucherStatus(voucher)}
                                    >
                                      {voucher.status === 'ACTIVE' ? (
                                        <Clock className="h-3.5 w-3.5 text-amber-500" />
                                      ) : (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {voucher.status === 'ACTIVE' ? 'Pause voucher' : 'Activate voucher'}
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => openEditVoucher(voucher)}
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit voucher</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => openDeleteVoucher(voucher)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete voucher</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════════════ CAMPAIGNS SUB-TAB ═══════════════════ */}
          <TabsContent value="campaigns" className="mt-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Select value={campaignStatusFilter} onValueChange={setCampaignStatusFilter}>
                  <SelectTrigger className="w-[140px] h-9 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={campaignTypeFilter} onValueChange={setCampaignTypeFilter}>
                  <SelectTrigger className="w-[150px] h-9 text-xs">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="PROMOTION">Promotion</SelectItem>
                    <SelectItem value="SEASONAL">Seasonal</SelectItem>
                    <SelectItem value="LOYALTY">Loyalty</SelectItem>
                    <SelectItem value="REFERRAL">Referral</SelectItem>
                    <SelectItem value="FLASH_SALE">Flash Sale</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => {
                  resetCampaignForm();
                  setCreateCampaignOpen(true);
                }}
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Plus className="h-4 w-4 mr-1" /> New Campaign
              </Button>
            </div>

            {campaigns.length === 0 ? (
              <Card className="shadow-sm">
                <CardContent className="py-12 text-center">
                  <Megaphone className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No campaigns found</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create your first campaign to organize vouchers
                  </p>
                  <Button
                    size="sm"
                    className="mt-4 bg-amber-600 hover:bg-amber-700"
                    onClick={() => {
                      resetCampaignForm();
                      setCreateCampaignOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Create Campaign
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {campaigns.map((campaign) => {
                  const budgetUsed = campaign.budget > 0
                    ? (campaign.spentAmount / campaign.budget) * 100
                    : 0;
                  return (
                    <Card key={campaign.id} className="shadow-sm hover:shadow-md transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate">{campaign.name}</CardTitle>
                            <div className="flex items-center gap-2 mt-1.5">
                              {getCampaignTypeBadge(campaign.campaignType)}
                              {getCampaignStatusBadge(campaign.status)}
                            </div>
                          </div>
                          <BarChart3 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        </div>
                        {campaign.description && (
                          <CardDescription className="mt-2 text-xs line-clamp-2">
                            {campaign.description}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Budget Progress */}
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-muted-foreground">Budget Used</span>
                            <span className="font-medium">
                              {formatKES(campaign.spentAmount)} / {formatKES(campaign.budget)}
                            </span>
                          </div>
                          <Progress value={Math.min(budgetUsed, 100)} className="h-2" />
                        </div>

                        {/* Stats Row */}
                        <div className="grid grid-cols-3 gap-3 pt-2">
                          <div className="text-center">
                            <p className="text-lg font-bold">{campaign.totalRedemptions}</p>
                            <p className="text-xs text-muted-foreground">Redemptions</p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                              {formatKES(campaign.totalRevenue)}
                            </p>
                            <p className="text-xs text-muted-foreground">Revenue</p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-bold text-rose-600 dark:text-rose-400">
                              {formatKES(campaign.spentAmount)}
                            </p>
                            <p className="text-xs text-muted-foreground">Spent</p>
                          </div>
                        </div>

                        <Separator />

                        {/* Dates */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {formatDate(campaign.startDate)}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {campaign.endDate ? formatDate(campaign.endDate) : 'No end date'}
                          </div>
                        </div>

                        {/* Target Audience */}
                        {campaign.targetAudience && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="h-3 w-3" />
                            <span>{campaign.targetAudience}</span>
                          </div>
                        )}

                        {/* Voucher Count */}
                        {campaign.vouchers && campaign.vouchers.length > 0 && (
                          <div className="flex items-center gap-1 text-xs">
                            <Tag className="h-3 w-3 text-emerald-500" />
                            <span className="font-medium">{campaign.vouchers.length}</span>
                            <span className="text-muted-foreground">voucher{campaign.vouchers.length !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ═══════════════════ REDEMPTIONS SUB-TAB ═══════════════════ */}
          <TabsContent value="redemptions" className="mt-4 space-y-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Receipt className="h-5 w-5 text-cyan-500" />
                  Recent Redemptions
                </CardTitle>
                <CardDescription>
                  {allRedemptions.length} redemption{allRedemptions.length !== 1 ? 's' : ''} recorded
                </CardDescription>
              </CardHeader>
              <CardContent>
                {allRedemptions.length === 0 ? (
                  <div className="text-center py-12">
                    <Receipt className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No redemptions yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Redemptions will appear here when customers use vouchers
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Voucher Code</TableHead>
                          <TableHead className="text-xs">Voucher Name</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Customer</TableHead>
                          <TableHead className="text-xs text-right">Original Total</TableHead>
                          <TableHead className="text-xs text-right">Discount</TableHead>
                          <TableHead className="text-xs text-right">Final Total</TableHead>
                          <TableHead className="text-xs">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allRedemptions.map((redemption) => (
                          <TableRow key={redemption.id} className="hover:bg-muted/50">
                            <TableCell>
                              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                {redemption.voucherCode}
                              </code>
                            </TableCell>
                            <TableCell className="text-sm max-w-[160px] truncate">
                              {redemption.voucherName}
                            </TableCell>
                            <TableCell>{getVoucherTypeBadge(redemption.voucherType)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {redemption.redeemedBy || '—'}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {formatKES(redemption.originalTotal)}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                                -{formatKES(redemption.discountAmount)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {formatKES(redemption.finalTotal)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(redemption.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ═══════════════════ CREATE VOUCHER DIALOG ═══════════════════ */}
        <Dialog open={createVoucherOpen} onOpenChange={setCreateVoucherOpen}>
          <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-emerald-500" />
                Create New Voucher
              </DialogTitle>
              <DialogDescription>
                Set up a new discount voucher. The code will be auto-generated.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Name */}
              <div className="grid gap-2">
                <Label htmlFor="v-name" className="text-sm font-medium">
                  Voucher Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="v-name"
                  placeholder="e.g. Summer Sale Discount"
                  value={vFormName}
                  onChange={(e) => setVFormName(e.target.value)}
                />
              </div>

              {/* Code notice */}
              <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
                <Tag className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Voucher code will be auto-generated in the format <code className="font-mono bg-muted px-1 py-0.5 rounded">MH-VC-XXXXXXXX</code>
                </p>
              </div>

              {/* Type */}
              <div className="grid gap-2">
                <Label className="text-sm font-medium">
                  Discount Type <span className="text-red-500">*</span>
                </Label>
                <Select value={vFormType} onValueChange={(v) => setVFormType(v as VoucherType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-emerald-500" />
                        Fixed Amount
                      </div>
                    </SelectItem>
                    <SelectItem value="PERCENTAGE">
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-cyan-500" />
                        Percentage Discount
                      </div>
                    </SelectItem>
                    <SelectItem value="FREE_PRODUCT">
                      <div className="flex items-center gap-2">
                        <Gift className="h-4 w-4 text-pink-500" />
                        Free Product
                      </div>
                    </SelectItem>
                    <SelectItem value="BUNDLE">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-violet-500" />
                        Bundle Deal
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Value */}
              <div className="grid gap-2">
                <Label htmlFor="v-value" className="text-sm font-medium">
                  Value <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {vFormType === 'PERCENTAGE' ? '%' : 'KES'}
                  </span>
                  <Input
                    id="v-value"
                    type="number"
                    placeholder={vFormType === 'PERCENTAGE' ? '10' : '500'}
                    value={vFormValue}
                    onChange={(e) => setVFormValue(e.target.value)}
                    className="pl-14"
                    min="0"
                    step={vFormType === 'PERCENTAGE' ? '1' : '100'}
                  />
                </div>
              </div>

              {/* Min Purchase & Max Discount */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="v-min-purchase" className="text-sm font-medium">
                    Minimum Purchase
                  </Label>
                  <Input
                    id="v-min-purchase"
                    type="number"
                    placeholder="0"
                    value={vFormMinPurchase}
                    onChange={(e) => setVFormMinPurchase(e.target.value)}
                    min="0"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-max-discount" className="text-sm font-medium">
                    Max Discount
                  </Label>
                  <Input
                    id="v-max-discount"
                    type="number"
                    placeholder="No limit"
                    value={vFormMaxDiscount}
                    onChange={(e) => setVFormMaxDiscount(e.target.value)}
                    min="0"
                  />
                </div>
              </div>

              {/* Max Uses & Max Uses Per User */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="v-max-uses" className="text-sm font-medium">
                    Max Total Uses
                  </Label>
                  <Input
                    id="v-max-uses"
                    type="number"
                    placeholder="Unlimited"
                    value={vFormMaxUses}
                    onChange={(e) => setVFormMaxUses(e.target.value)}
                    min="1"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-max-uses-user" className="text-sm font-medium">
                    Max Uses Per User
                  </Label>
                  <Input
                    id="v-max-uses-user"
                    type="number"
                    placeholder="Unlimited"
                    value={vFormMaxUsesPerUser}
                    onChange={(e) => setVFormMaxUsesPerUser(e.target.value)}
                    min="1"
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="v-start" className="text-sm font-medium">
                    Start Date <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="v-start"
                    type="date"
                    value={vFormStartDate}
                    onChange={(e) => setVFormStartDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-end" className="text-sm font-medium">
                    End Date
                  </Label>
                  <Input
                    id="v-end"
                    type="date"
                    value={vFormEndDate}
                    onChange={(e) => setVFormEndDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Campaign */}
              {campaigns.length > 0 && (
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Campaign</Label>
                  <Select value={vFormCampaignId} onValueChange={setVFormCampaignId}>
                    <SelectTrigger>
                      <SelectValue placeholder="No campaign" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No campaign</SelectItem>
                      {campaigns
                        .filter((c) => c.status === 'ACTIVE' || c.status === 'DRAFT')
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Description */}
              <div className="grid gap-2">
                <Label htmlFor="v-desc" className="text-sm font-medium">
                  Description
                </Label>
                <Textarea
                  id="v-desc"
                  placeholder="Optional description for this voucher..."
                  value={vFormDescription}
                  onChange={(e) => setVFormDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateVoucherOpen(false)}
                disabled={createVoucherMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateVoucher}
                disabled={createVoucherMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {createVoucherMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Voucher
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══════════════════ EDIT VOUCHER DIALOG ═══════════════════ */}
        <Dialog open={editVoucherOpen} onOpenChange={setEditVoucherOpen}>
          <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-emerald-500" />
                Edit Voucher
              </DialogTitle>
              <DialogDescription>
                {editingVoucher && (
                  <span>
                    Editing <code className="font-mono bg-muted px-1 py-0.5 rounded">{editingVoucher.code}</code>
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Name */}
              <div className="grid gap-2">
                <Label htmlFor="ve-name" className="text-sm font-medium">
                  Voucher Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ve-name"
                  value={vFormName}
                  onChange={(e) => setVFormName(e.target.value)}
                />
              </div>

              {/* Type */}
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Discount Type</Label>
                <Select value={vFormType} onValueChange={(v) => setVFormType(v as VoucherType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-emerald-500" />
                        Fixed Amount
                      </div>
                    </SelectItem>
                    <SelectItem value="PERCENTAGE">
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-cyan-500" />
                        Percentage Discount
                      </div>
                    </SelectItem>
                    <SelectItem value="FREE_PRODUCT">
                      <div className="flex items-center gap-2">
                        <Gift className="h-4 w-4 text-pink-500" />
                        Free Product
                      </div>
                    </SelectItem>
                    <SelectItem value="BUNDLE">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-violet-500" />
                        Bundle Deal
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Value */}
              <div className="grid gap-2">
                <Label htmlFor="ve-value" className="text-sm font-medium">Value</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {vFormType === 'PERCENTAGE' ? '%' : 'KES'}
                  </span>
                  <Input
                    id="ve-value"
                    type="number"
                    value={vFormValue}
                    onChange={(e) => setVFormValue(e.target.value)}
                    className="pl-14"
                    min="0"
                  />
                </div>
              </div>

              {/* Min Purchase & Max Discount */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="ve-min-purchase" className="text-sm font-medium">Minimum Purchase</Label>
                  <Input
                    id="ve-min-purchase"
                    type="number"
                    value={vFormMinPurchase}
                    onChange={(e) => setVFormMinPurchase(e.target.value)}
                    min="0"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ve-max-discount" className="text-sm font-medium">Max Discount</Label>
                  <Input
                    id="ve-max-discount"
                    type="number"
                    value={vFormMaxDiscount}
                    onChange={(e) => setVFormMaxDiscount(e.target.value)}
                    min="0"
                  />
                </div>
              </div>

              {/* Max Uses & Max Uses Per User */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="ve-max-uses" className="text-sm font-medium">Max Total Uses</Label>
                  <Input
                    id="ve-max-uses"
                    type="number"
                    value={vFormMaxUses}
                    onChange={(e) => setVFormMaxUses(e.target.value)}
                    min="1"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ve-max-uses-user" className="text-sm font-medium">Max Uses Per User</Label>
                  <Input
                    id="ve-max-uses-user"
                    type="number"
                    value={vFormMaxUsesPerUser}
                    onChange={(e) => setVFormMaxUsesPerUser(e.target.value)}
                    min="1"
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="ve-start" className="text-sm font-medium">Start Date</Label>
                  <Input
                    id="ve-start"
                    type="date"
                    value={vFormStartDate}
                    onChange={(e) => setVFormStartDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ve-end" className="text-sm font-medium">End Date</Label>
                  <Input
                    id="ve-end"
                    type="date"
                    value={vFormEndDate}
                    onChange={(e) => setVFormEndDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="grid gap-2">
                <Label htmlFor="ve-desc" className="text-sm font-medium">Description</Label>
                <Textarea
                  id="ve-desc"
                  value={vFormDescription}
                  onChange={(e) => setVFormDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setEditVoucherOpen(false);
                  setEditingVoucher(null);
                }}
                disabled={updateVoucherMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleEditVoucher}
                disabled={updateVoucherMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {updateVoucherMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══════════════════ DELETE VOUCHER DIALOG ═══════════════════ */}
        <Dialog open={deleteVoucherOpen} onOpenChange={setDeleteVoucherOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="h-5 w-5" />
                Delete Voucher
              </DialogTitle>
              <DialogDescription>
                {deletingVoucher && (
                  <span>
                    Are you sure you want to delete voucher{' '}
                    <code className="font-mono bg-muted px-1 py-0.5 rounded">{deletingVoucher.code}</code>
                    {' '}({deletingVoucher.name})? This action cannot be undone.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {deletingVoucher && deletingVoucher.currentUses > 0 && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  This voucher has {deletingVoucher.currentUses} redemption{deletingVoucher.currentUses !== 1 ? 's' : ''}.
                  Vouchers with redemptions may not be deletable.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteVoucherOpen(false);
                  setDeletingVoucher(null);
                }}
                disabled={deleteVoucherMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteVoucher}
                disabled={deleteVoucherMutation.isPending}
              >
                {deleteVoucherMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Delete Voucher
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══════════════════ CREATE CAMPAIGN DIALOG ═══════════════════ */}
        <Dialog open={createCampaignOpen} onOpenChange={setCreateCampaignOpen}>
          <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-amber-500" />
                Create New Campaign
              </DialogTitle>
              <DialogDescription>
                Set up a promotional campaign to organize and track your vouchers.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Name */}
              <div className="grid gap-2">
                <Label htmlFor="c-name" className="text-sm font-medium">
                  Campaign Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="c-name"
                  placeholder="e.g. Holiday Season Promo"
                  value={cFormName}
                  onChange={(e) => setCFormName(e.target.value)}
                />
              </div>

              {/* Type */}
              <div className="grid gap-2">
                <Label className="text-sm font-medium">
                  Campaign Type <span className="text-red-500">*</span>
                </Label>
                <Select value={cFormType} onValueChange={(v) => setCFormType(v as CampaignType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PROMOTION">Promotion</SelectItem>
                    <SelectItem value="SEASONAL">Seasonal</SelectItem>
                    <SelectItem value="LOYALTY">Loyalty</SelectItem>
                    <SelectItem value="REFERRAL">Referral</SelectItem>
                    <SelectItem value="FLASH_SALE">Flash Sale</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Budget */}
              <div className="grid gap-2">
                <Label htmlFor="c-budget" className="text-sm font-medium">Budget (KES)</Label>
                <Input
                  id="c-budget"
                  type="number"
                  placeholder="e.g. 50000"
                  value={cFormBudget}
                  onChange={(e) => setCFormBudget(e.target.value)}
                  min="0"
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="c-start" className="text-sm font-medium">
                    Start Date <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="c-start"
                    type="date"
                    value={cFormStartDate}
                    onChange={(e) => setCFormStartDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="c-end" className="text-sm font-medium">End Date</Label>
                  <Input
                    id="c-end"
                    type="date"
                    value={cFormEndDate}
                    onChange={(e) => setCFormEndDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Target Audience */}
              <div className="grid gap-2">
                <Label htmlFor="c-audience" className="text-sm font-medium">Target Audience</Label>
                <Input
                  id="c-audience"
                  placeholder="e.g. All customers, New users, Gold tier"
                  value={cFormTargetAudience}
                  onChange={(e) => setCFormTargetAudience(e.target.value)}
                />
              </div>

              {/* Description */}
              <div className="grid gap-2">
                <Label htmlFor="c-desc" className="text-sm font-medium">Description</Label>
                <Textarea
                  id="c-desc"
                  placeholder="Campaign details and objectives..."
                  value={cFormDescription}
                  onChange={(e) => setCFormDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateCampaignOpen(false)}
                disabled={createCampaignMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateCampaign}
                disabled={createCampaignMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {createCampaignMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Campaign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
