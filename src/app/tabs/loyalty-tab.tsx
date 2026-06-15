'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sparkles, Plus, Search, Star, Crown, Award, Users,
  Eye, Loader2, Settings2, TrendingUp, Calendar,
  ArrowUpDown, Filter, Gift, Zap, ChevronUp, Clock,
  HandCoins, Target, Megaphone, Edit, History,
  ChevronRight, CheckCircle2, XCircle, Play, Pause,
  Trophy, Gem, Medal, Shield, Palette, Save, X,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  loyaltyApi, customersApi,
  formatKES, formatDate, formatDateTime,
  type LoyaltyTierItem,
  type LoyaltyTransactionItem,
  type LoyaltyCampaignItem,
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ─── Sub-tab type ────────────────────────────────────────────────────────────
type LoyaltySubTab = 'tiers' | 'members' | 'transactions' | 'campaigns';

// ─── Tier color presets ──────────────────────────────────────────────────────
const TIER_COLOR_PRESETS = [
  { label: 'Bronze', value: '#CD7F32', tw: 'bg-[#CD7F32]' },
  { label: 'Silver', value: '#C0C0C0', tw: 'bg-[#C0C0C0]' },
  { label: 'Gold', value: '#FFD700', tw: 'bg-[#FFD700]' },
  { label: 'Platinum', value: '#E5E4E2', tw: 'bg-[#E5E4E2]' },
  { label: 'Emerald', value: '#50C878', tw: 'bg-[#50C878]' },
  { label: 'Sapphire', value: '#0F52BA', tw: 'bg-[#0F52BA]' },
  { label: 'Ruby', value: '#E0115F', tw: 'bg-[#E0115F]' },
  { label: 'Amethyst', value: '#9966CC', tw: 'bg-[#9966CC]' },
  { label: 'Rose', value: '#FF007F', tw: 'bg-[#FF007F]' },
  { label: 'Obsidian', value: '#3D3D3D', tw: 'bg-[#3D3D3D]' },
];

// ─── Transaction type config ─────────────────────────────────────────────────
const TX_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  EARN:    { label: 'Earn',    color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30', icon: TrendingUp },
  REDEEM:  { label: 'Redeem',  color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-100 dark:bg-blue-900/30',   icon: HandCoins },
  BONUS:   { label: 'Bonus',   color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30', icon: Gift },
  EXPIRE:  { label: 'Expire',  color: 'text-gray-600 dark:text-gray-400',   bg: 'bg-gray-100 dark:bg-gray-800/50',   icon: Clock },
  ADJUST:  { label: 'Adjust',  color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30', icon: Settings2 },
};

// ─── Campaign type config ────────────────────────────────────────────────────
const CAMPAIGN_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  BONUS_POINTS:   { label: 'Bonus Points',   color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30', icon: Gift },
  DOUBLE_POINTS:  { label: 'Double Points',  color: 'text-amber-700 dark:text-amber-400',   bg: 'bg-amber-100 dark:bg-amber-900/30',   icon: Zap },
  TIER_UPGRADE:   { label: 'Tier Upgrade',   color: 'text-cyan-700 dark:text-cyan-400',     bg: 'bg-cyan-100 dark:bg-cyan-900/30',     icon: ChevronUp },
  SPECIAL_EVENT:  { label: 'Special Event',  color: 'text-rose-700 dark:text-rose-400',     bg: 'bg-rose-100 dark:bg-rose-900/30',     icon: Megaphone },
};

// ─── Campaign status config ──────────────────────────────────────────────────
const CAMPAIGN_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT:     { label: 'Draft',     color: 'text-gray-600 dark:text-gray-400',   bg: 'bg-gray-100 dark:bg-gray-800/50' },
  ACTIVE:    { label: 'Active',    color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' },
  COMPLETED: { label: 'Completed', color: 'text-blue-700 dark:text-blue-400',   bg: 'bg-blue-100 dark:bg-blue-900/30' },
  CANCELLED: { label: 'Cancelled', color: 'text-red-700 dark:text-red-400',     bg: 'bg-red-100 dark:bg-red-900/30' },
};

// ─── Helper: get tier icon component ─────────────────────────────────────────
function getTierIcon(name: string): React.ElementType {
  const lower = name.toLowerCase();
  if (lower.includes('platinum')) return Gem;
  if (lower.includes('gold')) return Crown;
  if (lower.includes('silver')) return Medal;
  if (lower.includes('bronze')) return Shield;
  return Trophy;
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function LoyaltyTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();

  // Sub-tab state
  const [activeSubTab, setActiveSubTab] = useState<LoyaltySubTab>('tiers');

  // ─── Tier dialog state ───────────────────────────────────────────────────
  const [tierDialogOpen, setTierDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<LoyaltyTierItem | null>(null);
  const [tierForm, setTierForm] = useState({
    name: '',
    minPoints: 0,
    maxPoints: '',
    discountPercent: 0,
    pointsMultiplier: 1,
    benefits: '',
    color: '#CD7F32',
    icon: '',
    sortOrder: 0,
    isActive: true,
  });

  // ─── Member state ────────────────────────────────────────────────────────
  const [memberSearch, setMemberSearch] = useState('');
  const [memberTierFilter, setMemberTierFilter] = useState<string>('all');
  const [adjustPointsOpen, setAdjustPointsOpen] = useState(false);
  const [adjustPointsCustomer, setAdjustPointsCustomer] = useState<CustomerItem | null>(null);
  const [adjustPointsForm, setAdjustPointsForm] = useState({ points: '', type: 'ADJUST', description: '' });
  const [memberHistoryOpen, setMemberHistoryOpen] = useState(false);
  const [memberHistoryCustomerId, setMemberHistoryCustomerId] = useState<string>('');

  // ─── Transaction state ───────────────────────────────────────────────────
  const [txTypeFilter, setTxTypeFilter] = useState<string>('all');
  const [txDateFrom, setTxDateFrom] = useState('');
  const [txDateTo, setTxDateTo] = useState('');
  const [txSearch, setTxSearch] = useState('');
  const [manualAdjustOpen, setManualAdjustOpen] = useState(false);
  const [manualAdjustForm, setManualAdjustForm] = useState({
    customerId: '',
    points: '',
    transactionType: 'ADJUST',
    reference: '',
    description: '',
  });

  // ─── Campaign state ─────────────────────────────────────────────────────
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState<string>('all');
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    description: '',
    campaignType: 'BONUS_POINTS' as const,
    bonusPoints: 0,
    multiplier: 1,
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    targetTierId: 'all',
  });

  // ─── Queries ─────────────────────────────────────────────────────────────
  const { data: tiersData, isLoading: tiersLoading } = useQuery({
    queryKey: ['loyalty-tiers', currentStoreId],
    queryFn: () => loyaltyApi.tiers.list({ storeId: currentStoreId, limit: 50 }),
  });

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['loyalty-customers', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 200 }),
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['loyalty-transactions', currentStoreId, txTypeFilter, txDateFrom, txDateTo],
    queryFn: () => loyaltyApi.transactions.list({
      storeId: currentStoreId,
      transactionType: txTypeFilter !== 'all' ? txTypeFilter : undefined,
      dateFrom: txDateFrom || undefined,
      dateTo: txDateTo || undefined,
      limit: 100,
    }),
  });

  const { data: campaignsData, isLoading: campaignsLoading } = useQuery({
    queryKey: ['loyalty-campaigns', currentStoreId, campaignFilter],
    queryFn: () => loyaltyApi.campaigns.list({
      storeId: currentStoreId,
      status: campaignFilter !== 'all' ? campaignFilter : undefined,
      limit: 50,
    }),
  });

  // ─── Member history query ────────────────────────────────────────────────
  const { data: memberHistoryData, isLoading: memberHistoryLoading } = useQuery({
    queryKey: ['loyalty-member-history', currentStoreId, memberHistoryCustomerId],
    queryFn: () => loyaltyApi.transactions.list({
      storeId: currentStoreId,
      customerId: memberHistoryCustomerId,
      limit: 50,
    }),
    enabled: !!memberHistoryCustomerId,
  });

  // ─── Mutations ───────────────────────────────────────────────────────────
  const createTierMutation = useMutation({
    mutationFn: (data: Parameters<typeof loyaltyApi.tiers.create>[0]) => loyaltyApi.tiers.create(data),
    onSuccess: () => {
      toast.success('Tier created successfully');
      queryClient.invalidateQueries({ queryKey: ['loyalty-tiers'] });
      setTierDialogOpen(false);
      resetTierForm();
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create tier'),
  });

  const createTxMutation = useMutation({
    mutationFn: (data: Parameters<typeof loyaltyApi.transactions.create>[0]) => loyaltyApi.transactions.create(data),
    onSuccess: () => {
      toast.success('Points adjusted successfully');
      queryClient.invalidateQueries({ queryKey: ['loyalty-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['loyalty-customers'] });
      setManualAdjustOpen(false);
      setAdjustPointsOpen(false);
      setManualAdjustForm({ customerId: '', points: '', transactionType: 'ADJUST', reference: '', description: '' });
      setAdjustPointsForm({ points: '', type: 'ADJUST', description: '' });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to adjust points'),
  });

  const createCampaignMutation = useMutation({
    mutationFn: (data: Parameters<typeof loyaltyApi.campaigns.create>[0]) => loyaltyApi.campaigns.create(data),
    onSuccess: () => {
      toast.success('Campaign created successfully');
      queryClient.invalidateQueries({ queryKey: ['loyalty-campaigns'] });
      setCampaignDialogOpen(false);
      resetCampaignForm();
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create campaign'),
  });

  // ─── Derived data ────────────────────────────────────────────────────────
  const tiers = Array.isArray((tiersData as any)?.data) ? (tiersData as any).data : [];
  const customers = Array.isArray((customersData as any)?.data) ? (customersData as any).data : [];
  const transactions = Array.isArray((txData as any)?.data) ? (txData as any).data : [];
  const campaigns = Array.isArray((campaignsData as any)?.data) ? (campaignsData as any).data : [];
  const memberHistory = Array.isArray((memberHistoryData as any)?.data) ? (memberHistoryData as any).data : [];

  // Stats
  const totalMembers = customers.length;
  const totalPointsIssued = transactions
    .filter((t: LoyaltyTransactionItem) => ['EARN', 'BONUS'].includes(t.transactionType))
    .reduce((sum: number, t: LoyaltyTransactionItem) => sum + t.points, 0);
  const totalPointsRedeemed = transactions
    .filter((t: LoyaltyTransactionItem) => t.transactionType === 'REDEEM')
    .reduce((sum: number, t: LoyaltyTransactionItem) => sum + t.points, 0);
  const activeCampaigns = campaigns.filter((c: LoyaltyCampaignItem) => c.status === 'ACTIVE').length;

  // Filtered members
  const filteredCustomers = (() => {
    let result = [...customers] as CustomerItem[];
    if (memberSearch) {
      const q = memberSearch.toLowerCase();
      result = result.filter(
        (c) => c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q)
      );
    }
    if (memberTierFilter !== 'all') {
      const tierId = memberTierFilter;
      result = result.filter((c) => {
        const pts = c.loyaltyPoints ?? 0;
        const matchingTier = tiers.find((t: LoyaltyTierItem) => t.id === tierId);
        if (!matchingTier) return false;
        return pts >= matchingTier.minPoints && (matchingTier.maxPoints === null || pts < matchingTier.maxPoints);
      });
    }
    return result.sort((a, b) => (b.loyaltyPoints ?? 0) - (a.loyaltyPoints ?? 0));
  })();

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function resetTierForm() {
    setTierForm({
      name: '', minPoints: 0, maxPoints: '', discountPercent: 0,
      pointsMultiplier: 1, benefits: '', color: '#CD7F32', icon: '',
      sortOrder: 0, isActive: true,
    });
    setEditingTier(null);
  }

  function resetCampaignForm() {
    setCampaignForm({
      name: '', description: '', campaignType: 'BONUS_POINTS',
      bonusPoints: 0, multiplier: 1,
      startDate: new Date().toISOString().split('T')[0],
      endDate: '', targetTierId: 'all',
    });
  }

  function getCustomerTierInfo(loyaltyPoints: number): { tier: LoyaltyTierItem | null; nextTier: LoyaltyTierItem | null; progress: number } {
    const sortedTiers = [...tiers]
      .filter((t: LoyaltyTierItem) => t.isActive)
      .sort((a: LoyaltyTierItem, b: LoyaltyTierItem) => a.minPoints - b.minPoints);

    let currentTier: LoyaltyTierItem | null = null;
    let nextTier: LoyaltyTierItem | null = null;

    for (let i = sortedTiers.length - 1; i >= 0; i--) {
      if (loyaltyPoints >= sortedTiers[i].minPoints) {
        currentTier = sortedTiers[i];
        nextTier = sortedTiers[i + 1] ?? null;
        break;
      }
    }

    if (!currentTier && sortedTiers.length > 0) {
      currentTier = null;
      nextTier = sortedTiers[0];
    }

    let progress = 100;
    if (currentTier && nextTier) {
      const range = nextTier.minPoints - currentTier.minPoints;
      const gained = loyaltyPoints - currentTier.minPoints;
      progress = range > 0 ? Math.min(100, Math.round((gained / range) * 100)) : 100;
    } else if (!currentTier && nextTier) {
      progress = nextTier.minPoints > 0 ? Math.min(100, Math.round((loyaltyPoints / nextTier.minPoints) * 100)) : 0;
    }

    return { tier: currentTier, nextTier, progress };
  }

  function openEditTier(tier: LoyaltyTierItem) {
    setEditingTier(tier);
    setTierForm({
      name: tier.name,
      minPoints: tier.minPoints,
      maxPoints: tier.maxPoints != null ? String(tier.maxPoints) : '',
      discountPercent: tier.discountPercent,
      pointsMultiplier: tier.pointsMultiplier,
      benefits: tier.benefits ?? '',
      color: tier.color || '#CD7F32',
      icon: tier.icon ?? '',
      sortOrder: tier.sortOrder,
      isActive: tier.isActive,
    });
    setTierDialogOpen(true);
  }

  function openCreateTier() {
    resetTierForm();
    setTierForm(prev => ({ ...prev, sortOrder: tiers.length }));
    setTierDialogOpen(true);
  }

  // ─── Render: Stats Cards ─────────────────────────────────────────────────
  function renderStatsCards() {
    const stats = [
      { title: 'Total Members', value: totalMembers.toLocaleString(), icon: Users, color: 'text-emerald-600' },
      { title: 'Points Issued', value: totalPointsIssued.toLocaleString(), icon: Sparkles, color: 'text-purple-600' },
      { title: 'Points Redeemed', value: totalPointsRedeemed.toLocaleString(), icon: Award, color: 'text-green-600' },
      { title: 'Active Campaigns', value: String(activeCampaigns), icon: Target, color: 'text-rose-600' },
    ];
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                  <p className="text-lg font-bold mt-1">{stat.value}</p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ─── Render: Tiers Sub-tab ───────────────────────────────────────────────
  function renderTiers() {
    if (tiersLoading) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      );
    }

    const sortedTiers = [...tiers].sort((a: LoyaltyTierItem, b: LoyaltyTierItem) => a.sortOrder - b.sortOrder);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Loyalty Tiers</h3>
          <Button size="sm" className="h-8" onClick={openCreateTier}>
            <Plus className="mr-1.5 h-4 w-4" /> Add Tier
          </Button>
        </div>

        {sortedTiers.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Trophy className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No loyalty tiers configured yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Create your first tier to start the loyalty program.</p>
              <Button size="sm" className="h-8 mt-3" onClick={openCreateTier}>
                <Plus className="mr-1.5 h-4 w-4" /> Create First Tier
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {sortedTiers.map((tier: LoyaltyTierItem) => {
              const TierIcon = getTierIcon(tier.name);
              const memberCount = tier.customerTiers?.length ?? 0;
              return (
                <Card
                  key={tier.id}
                  className="relative overflow-hidden border-2 hover:shadow-md transition-shadow"
                  style={{ borderColor: tier.color || '#CD7F32' }}
                >
                  {/* Top accent bar */}
                  <div className="h-2 w-full" style={{ backgroundColor: tier.color || '#CD7F32' }} />
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${tier.color || '#CD7F32'}20` }}
                        >
                          <TierIcon className="h-5 w-5" style={{ color: tier.color || '#CD7F32' }} />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{tier.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {tier.minPoints.toLocaleString()} pts minimum
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => openEditTier(tier)}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Discount</p>
                        <p className="font-semibold">{tier.discountPercent}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Multiplier</p>
                        <p className="font-semibold">{tier.pointsMultiplier}x</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Members</p>
                        <p className="font-semibold">{memberCount}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Status</p>
                        <Badge variant={tier.isActive ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                          {tier.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>

                    {tier.benefits && (
                      <p className="text-[10px] text-muted-foreground line-clamp-2">{tier.benefits}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Render: Members Sub-tab ─────────────────────────────────────────────
  function renderMembers() {
    if (customersLoading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members by name or phone..."
              className="pl-9 h-9"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
          </div>
          <Select value={memberTierFilter} onValueChange={setMemberTierFilter}>
            <SelectTrigger className="h-9 w-full sm:w-[160px]">
              <SelectValue placeholder="Filter by tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              {tiers
                .filter((t: LoyaltyTierItem) => t.isActive)
                .sort((a: LoyaltyTierItem, b: LoyaltyTierItem) => a.minPoints - b.minPoints)
                .map((tier: LoyaltyTierItem) => (
                  <SelectItem key={tier.id} value={tier.id}>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tier.color }} />
                      {tier.name}
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Members list */}
        {filteredCustomers.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {memberSearch || memberTierFilter !== 'all'
                  ? 'No members match your filters.'
                  : 'No loyalty members yet.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="max-h-[520px] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Member</TableHead>
                  <TableHead className="text-xs">Tier</TableHead>
                  <TableHead className="text-xs text-right">Points Balance</TableHead>
                  <TableHead className="text-xs text-right">Lifetime Points</TableHead>
                  <TableHead className="text-xs">Next Tier</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((customer: CustomerItem) => {
                  const { tier, nextTier, progress } = getCustomerTierInfo(customer.loyaltyPoints ?? 0);
                  const TierIcon = tier ? getTierIcon(tier.name) : Shield;
                  return (
                    <TableRow key={customer.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-[10px] font-semibold" style={tier ? { backgroundColor: `${tier.color}20`, color: tier.color } : undefined}>
                              {customer.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-xs font-medium">{customer.name}</p>
                            <p className="text-[10px] text-muted-foreground">{customer.phone ?? '—'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {tier ? (
                          <Badge
                            className="text-[10px] font-semibold gap-1 px-2"
                            style={{ backgroundColor: `${tier.color}20`, color: tier.color, borderColor: `${tier.color}40` }}
                            variant="outline"
                          >
                            <TierIcon className="h-3 w-3" />
                            {tier.name}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">No tier</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs font-semibold">{(customer.loyaltyPoints ?? 0).toLocaleString()}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-muted-foreground">{(customer.loyaltyPoints ?? 0).toLocaleString()}</span>
                      </TableCell>
                      <TableCell>
                        {nextTier ? (
                          <div className="space-y-0.5 min-w-[80px]">
                            <p className="text-[10px] text-muted-foreground">{nextTier.name}</p>
                            <Progress value={progress} className="h-1.5" />
                          </div>
                        ) : (
                          <span className="text-[10px] text-emerald-600 font-medium">Max Tier</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => {
                                    setAdjustPointsCustomer(customer);
                                    setAdjustPointsForm({ points: '', type: 'ADJUST', description: '' });
                                    setAdjustPointsOpen(true);
                                  }}
                                >
                                  <Settings2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Adjust Points</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => {
                                    setMemberHistoryCustomerId(customer.id);
                                    setMemberHistoryOpen(true);
                                  }}
                                >
                                  <History className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View History</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }

  // ─── Render: Transactions Sub-tab ────────────────────────────────────────
  function renderTransactions() {
    if (txLoading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
            <SelectTrigger className="h-9 w-full sm:w-[150px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="EARN">Earn</SelectItem>
              <SelectItem value="REDEEM">Redeem</SelectItem>
              <SelectItem value="BONUS">Bonus</SelectItem>
              <SelectItem value="EXPIRE">Expire</SelectItem>
              <SelectItem value="ADJUST">Adjust</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            className="h-9 w-full sm:w-auto"
            value={txDateFrom}
            onChange={(e) => setTxDateFrom(e.target.value)}
            placeholder="From"
          />
          <Input
            type="date"
            className="h-9 w-full sm:w-auto"
            value={txDateTo}
            onChange={(e) => setTxDateTo(e.target.value)}
            placeholder="To"
          />
          <div className="flex-1" />
          <Button size="sm" className="h-9" onClick={() => {
            setManualAdjustForm({ customerId: '', points: '', transactionType: 'ADJUST', reference: '', description: '' });
            setManualAdjustOpen(true);
          }}>
            <Settings2 className="mr-1.5 h-4 w-4" /> Manual Adjustment
          </Button>
        </div>

        {/* Transaction table */}
        {transactions.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <History className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No loyalty transactions recorded yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="max-h-[520px] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs text-right">Points</TableHead>
                  <TableHead className="text-xs">Reference</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx: LoyaltyTransactionItem) => {
                  const config = TX_TYPE_CONFIG[tx.transactionType] ?? TX_TYPE_CONFIG.ADJUST;
                  const TxIcon = config.icon;
                  return (
                    <TableRow key={tx.id} className="hover:bg-muted/50">
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDateTime(tx.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs">{tx.customerId.slice(0, 8)}…</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] font-semibold gap-1 ${config.bg} ${config.color}`} variant="outline">
                          <TxIcon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-xs font-semibold ${
                          ['EARN', 'BONUS'].includes(tx.transactionType) ? 'text-green-600' :
                          tx.transactionType === 'REDEEM' ? 'text-blue-600' :
                          tx.transactionType === 'EXPIRE' ? 'text-gray-500' : 'text-amber-600'
                        }`}>
                          {['EARN', 'BONUS'].includes(tx.transactionType) ? '+' : tx.transactionType === 'EXPIRE' ? '-' : ''}
                          {tx.points.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                        {tx.reference ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                        {tx.description ?? '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }

  // ─── Render: Campaigns Sub-tab ───────────────────────────────────────────
  function renderCampaigns() {
    if (campaignsLoading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Filters & Create */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="h-9 w-full sm:w-[150px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button size="sm" className="h-9" onClick={() => {
            resetCampaignForm();
            setCampaignDialogOpen(true);
          }}>
            <Plus className="mr-1.5 h-4 w-4" /> New Campaign
          </Button>
        </div>

        {/* Campaign list */}
        {campaigns.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Megaphone className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No loyalty campaigns yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Create a campaign to boost engagement.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign: LoyaltyCampaignItem) => {
              const typeConfig = CAMPAIGN_TYPE_CONFIG[campaign.campaignType] ?? CAMPAIGN_TYPE_CONFIG.BONUS_POINTS;
              const statusConfig = CAMPAIGN_STATUS_CONFIG[campaign.status] ?? CAMPAIGN_STATUS_CONFIG.DRAFT;
              const TypeIcon = typeConfig.icon;
              return (
                <Card key={campaign.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${typeConfig.bg}`}>
                          <TypeIcon className={`h-5 w-5 ${typeConfig.color}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold">{campaign.name}</p>
                            <Badge className={`text-[10px] font-semibold ${typeConfig.bg} ${typeConfig.color}`} variant="outline">
                              {typeConfig.label}
                            </Badge>
                            <Badge className={`text-[10px] font-semibold ${statusConfig.bg} ${statusConfig.color}`} variant="outline">
                              {statusConfig.label}
                            </Badge>
                          </div>
                          {campaign.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{campaign.description}</p>
                          )}
                          <div className="flex items-center gap-4 mt-1.5 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(campaign.startDate)} — {campaign.endDate ? formatDate(campaign.endDate) : 'No end'}
                            </span>
                            {campaign.bonusPoints > 0 && (
                              <span className="flex items-center gap-1">
                                <Gift className="h-3 w-3" />
                                {campaign.bonusPoints.toLocaleString()} bonus pts
                              </span>
                            )}
                            {campaign.multiplier > 1 && (
                              <span className="flex items-center gap-1">
                                <Zap className="h-3 w-3" />
                                {campaign.multiplier}x multiplier
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {campaign.totalParticipants} participants
                            </span>
                            <span className="flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              {campaign.totalPointsAwarded.toLocaleString()} pts awarded
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Main Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Loyalty Program</h2>
          <p className="text-sm text-muted-foreground">Manage loyalty tiers, points, and campaigns</p>
        </div>
      </div>

      {/* Stats Cards */}
      {renderStatsCards()}

      {/* Sub-tabs */}
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as LoyaltySubTab)}>
        <TabsList className="h-9">
          <TabsTrigger value="tiers" className="text-xs px-3">
            <Crown className="mr-1.5 h-3.5 w-3.5" /> Tiers
          </TabsTrigger>
          <TabsTrigger value="members" className="text-xs px-3">
            <Users className="mr-1.5 h-3.5 w-3.5" /> Members
          </TabsTrigger>
          <TabsTrigger value="transactions" className="text-xs px-3">
            <History className="mr-1.5 h-3.5 w-3.5" /> Transactions
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs px-3">
            <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Campaigns
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tiers" className="mt-4">
          {renderTiers()}
        </TabsContent>
        <TabsContent value="members" className="mt-4">
          {renderMembers()}
        </TabsContent>
        <TabsContent value="transactions" className="mt-4">
          {renderTransactions()}
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4">
          {renderCampaigns()}
        </TabsContent>
      </Tabs>

      {/* ─── Create / Edit Tier Dialog ──────────────────────────────────── */}
      <Dialog open={tierDialogOpen} onOpenChange={(open) => { setTierDialogOpen(open); if (!open) resetTierForm(); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingTier ? 'Edit Tier' : 'Create Loyalty Tier'}</DialogTitle>
            <DialogDescription>
              {editingTier ? 'Update tier configuration.' : 'Define a new loyalty tier with benefits and thresholds.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Tier Name</Label>
                <Input
                  className="h-9 mt-1"
                  placeholder="e.g. Gold"
                  value={tierForm.name}
                  onChange={(e) => setTierForm({ ...tierForm, name: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Min Points</Label>
                <Input
                  type="number"
                  className="h-9 mt-1"
                  value={tierForm.minPoints}
                  onChange={(e) => setTierForm({ ...tierForm, minPoints: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Max Points (optional)</Label>
                <Input
                  className="h-9 mt-1"
                  placeholder="Leave blank for no max"
                  value={tierForm.maxPoints}
                  onChange={(e) => setTierForm({ ...tierForm, maxPoints: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Discount %</Label>
                <Input
                  type="number"
                  className="h-9 mt-1"
                  min={0}
                  max={100}
                  value={tierForm.discountPercent}
                  onChange={(e) => setTierForm({ ...tierForm, discountPercent: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Points Multiplier</Label>
                <Input
                  type="number"
                  className="h-9 mt-1"
                  min={0.1}
                  step={0.1}
                  value={tierForm.pointsMultiplier}
                  onChange={(e) => setTierForm({ ...tierForm, pointsMultiplier: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Sort Order</Label>
                <Input
                  type="number"
                  className="h-9 mt-1"
                  value={tierForm.sortOrder}
                  onChange={(e) => setTierForm({ ...tierForm, sortOrder: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Active</Label>
                <Select
                  value={tierForm.isActive ? 'true' : 'false'}
                  onValueChange={(v) => setTierForm({ ...tierForm, isActive: v === 'true' })}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Benefits */}
            <div>
              <Label className="text-xs">Benefits Description</Label>
              <Textarea
                className="mt-1 min-h-[60px]"
                placeholder="e.g. Free delivery, priority support..."
                value={tierForm.benefits}
                onChange={(e) => setTierForm({ ...tierForm, benefits: e.target.value })}
              />
            </div>

            {/* Color Picker */}
            <div>
              <Label className="text-xs flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5" /> Tier Color
              </Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {TIER_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`h-8 w-8 rounded-lg border-2 transition-all ${
                      tierForm.color === preset.value ? 'border-primary ring-2 ring-primary/30 scale-110' : 'border-transparent hover:border-muted-foreground/30'
                    }`}
                    style={{ backgroundColor: preset.value }}
                    onClick={() => setTierForm({ ...tierForm, color: preset.value })}
                    title={preset.label}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Input
                  className="h-9 w-32"
                  value={tierForm.color}
                  onChange={(e) => setTierForm({ ...tierForm, color: e.target.value })}
                  placeholder="#CD7F32"
                />
                <div
                  className="h-9 w-9 rounded-md border"
                  style={{ backgroundColor: tierForm.color }}
                />
                <span className="text-xs text-muted-foreground">{tierForm.color}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8" onClick={() => { setTierDialogOpen(false); resetTierForm(); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!tierForm.name || createTierMutation.isPending}
              onClick={() => {
                const payload: any = {
                  storeId: currentStoreId,
                  name: tierForm.name,
                  minPoints: tierForm.minPoints,
                  discountPercent: tierForm.discountPercent,
                  pointsMultiplier: tierForm.pointsMultiplier,
                  color: tierForm.color,
                  sortOrder: tierForm.sortOrder,
                  isActive: tierForm.isActive,
                };
                if (tierForm.maxPoints) payload.maxPoints = Number(tierForm.maxPoints);
                if (tierForm.benefits) payload.benefits = tierForm.benefits;
                if (tierForm.icon) payload.icon = tierForm.icon;
                createTierMutation.mutate(payload);
              }}
            >
              {createTierMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editingTier ? 'Update Tier' : 'Create Tier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Adjust Points Dialog (from member row) ────────────────────── */}
      <Dialog open={adjustPointsOpen} onOpenChange={setAdjustPointsOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Adjust Points</DialogTitle>
            <DialogDescription>
              Manually adjust loyalty points for {adjustPointsCustomer?.name ?? 'customer'}.
              Current balance: {(adjustPointsCustomer?.loyaltyPoints ?? 0).toLocaleString()} pts
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Adjustment Type</Label>
              <Select value={adjustPointsForm.type} onValueChange={(v) => setAdjustPointsForm({ ...adjustPointsForm, type: v })}>
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADJUST">Adjust (add/subtract)</SelectItem>
                  <SelectItem value="BONUS">Bonus Points</SelectItem>
                  <SelectItem value="REDEEM">Redeem</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Points</Label>
              <Input
                type="number"
                className="h-9 mt-1"
                placeholder="Enter points (negative to subtract)"
                value={adjustPointsForm.points}
                onChange={(e) => setAdjustPointsForm({ ...adjustPointsForm, points: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input
                className="h-9 mt-1"
                placeholder="Reason for adjustment"
                value={adjustPointsForm.description}
                onChange={(e) => setAdjustPointsForm({ ...adjustPointsForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setAdjustPointsOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!adjustPointsForm.points || createTxMutation.isPending}
              onClick={() => {
                if (!adjustPointsCustomer) return;
                createTxMutation.mutate({
                  storeId: currentStoreId,
                  customerId: adjustPointsCustomer.id,
                  points: Number(adjustPointsForm.points),
                  transactionType: adjustPointsForm.type,
                  description: adjustPointsForm.description || undefined,
                });
              }}
            >
              {createTxMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Adjust Points
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Member History Dialog ─────────────────────────────────────── */}
      <Dialog open={memberHistoryOpen} onOpenChange={setMemberHistoryOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Points History</DialogTitle>
            <DialogDescription>Loyalty transaction history for this member</DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {memberHistoryLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : memberHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No transaction history yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs text-right">Points</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberHistory.map((tx: LoyaltyTransactionItem) => {
                    const config = TX_TYPE_CONFIG[tx.transactionType] ?? TX_TYPE_CONFIG.ADJUST;
                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(tx.createdAt)}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${config.bg} ${config.color}`} variant="outline">
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold">
                          <span className={
                            ['EARN', 'BONUS'].includes(tx.transactionType) ? 'text-green-600' :
                            tx.transactionType === 'REDEEM' ? 'text-blue-600' : 'text-amber-600'
                          }>
                            {['EARN', 'BONUS'].includes(tx.transactionType) ? '+' : ''}
                            {tx.points.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {tx.description ?? '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setMemberHistoryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Manual Adjustment Dialog (from transactions tab) ──────────── */}
      <Dialog open={manualAdjustOpen} onOpenChange={setManualAdjustOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Manual Points Adjustment</DialogTitle>
            <DialogDescription>Manually add, subtract, or bonus points to a customer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Customer</Label>
              <Select
                value={manualAdjustForm.customerId}
                onValueChange={(v) => setManualAdjustForm({ ...manualAdjustForm, customerId: v })}
              >
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {(customers as CustomerItem[]).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select
                  value={manualAdjustForm.transactionType}
                  onValueChange={(v) => setManualAdjustForm({ ...manualAdjustForm, transactionType: v })}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADJUST">Adjust</SelectItem>
                    <SelectItem value="BONUS">Bonus</SelectItem>
                    <SelectItem value="EARN">Earn</SelectItem>
                    <SelectItem value="REDEEM">Redeem</SelectItem>
                    <SelectItem value="EXPIRE">Expire</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Points</Label>
                <Input
                  type="number"
                  className="h-9 mt-1"
                  placeholder="Negative to subtract"
                  value={manualAdjustForm.points}
                  onChange={(e) => setManualAdjustForm({ ...manualAdjustForm, points: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Reference (optional)</Label>
              <Input
                className="h-9 mt-1"
                placeholder="e.g. POS-TRX-001"
                value={manualAdjustForm.reference}
                onChange={(e) => setManualAdjustForm({ ...manualAdjustForm, reference: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                className="mt-1 min-h-[60px]"
                placeholder="Reason for adjustment..."
                value={manualAdjustForm.description}
                onChange={(e) => setManualAdjustForm({ ...manualAdjustForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setManualAdjustOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!manualAdjustForm.customerId || !manualAdjustForm.points || createTxMutation.isPending}
              onClick={() => {
                createTxMutation.mutate({
                  storeId: currentStoreId,
                  customerId: manualAdjustForm.customerId,
                  points: Number(manualAdjustForm.points),
                  transactionType: manualAdjustForm.transactionType,
                  reference: manualAdjustForm.reference || undefined,
                  description: manualAdjustForm.description || undefined,
                });
              }}
            >
              {createTxMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Apply Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Create Campaign Dialog ────────────────────────────────────── */}
      <Dialog open={campaignDialogOpen} onOpenChange={(open) => { setCampaignDialogOpen(open); if (!open) resetCampaignForm(); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Create Loyalty Campaign</DialogTitle>
            <DialogDescription>Launch a campaign to boost engagement and reward loyalty.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Campaign Name</Label>
              <Input
                className="h-9 mt-1"
                placeholder="e.g. Holiday Bonus Week"
                value={campaignForm.name}
                onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                className="mt-1 min-h-[60px]"
                placeholder="Describe the campaign..."
                value={campaignForm.description}
                onChange={(e) => setCampaignForm({ ...campaignForm, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Campaign Type</Label>
                <Select
                  value={campaignForm.campaignType}
                  onValueChange={(v) => setCampaignForm({ ...campaignForm, campaignType: v as any })}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BONUS_POINTS">Bonus Points</SelectItem>
                    <SelectItem value="DOUBLE_POINTS">Double Points</SelectItem>
                    <SelectItem value="TIER_UPGRADE">Tier Upgrade</SelectItem>
                    <SelectItem value="SPECIAL_EVENT">Special Event</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Target Tier</Label>
                <Select
                  value={campaignForm.targetTierId}
                  onValueChange={(v) => setCampaignForm({ ...campaignForm, targetTierId: v })}
                >
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tiers</SelectItem>
                    {tiers
                      .filter((t: LoyaltyTierItem) => t.isActive)
                      .map((tier: LoyaltyTierItem) => (
                        <SelectItem key={tier.id} value={tier.id}>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tier.color }} />
                            {tier.name}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Bonus Points</Label>
                <Input
                  type="number"
                  className="h-9 mt-1"
                  min={0}
                  value={campaignForm.bonusPoints}
                  onChange={(e) => setCampaignForm({ ...campaignForm, bonusPoints: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Points Multiplier</Label>
                <Input
                  type="number"
                  className="h-9 mt-1"
                  min={0.1}
                  step={0.1}
                  value={campaignForm.multiplier}
                  onChange={(e) => setCampaignForm({ ...campaignForm, multiplier: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  className="h-9 mt-1"
                  value={campaignForm.startDate}
                  onChange={(e) => setCampaignForm({ ...campaignForm, startDate: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">End Date (optional)</Label>
                <Input
                  type="date"
                  className="h-9 mt-1"
                  value={campaignForm.endDate}
                  onChange={(e) => setCampaignForm({ ...campaignForm, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8" onClick={() => { setCampaignDialogOpen(false); resetCampaignForm(); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!campaignForm.name || createCampaignMutation.isPending}
              onClick={() => {
                const payload: any = {
                  storeId: currentStoreId,
                  name: campaignForm.name,
                  campaignType: campaignForm.campaignType,
                  startDate: campaignForm.startDate,
                };
                if (campaignForm.description) payload.description = campaignForm.description;
                if (campaignForm.bonusPoints > 0) payload.bonusPoints = campaignForm.bonusPoints;
                if (campaignForm.multiplier > 1) payload.multiplier = campaignForm.multiplier;
                if (campaignForm.endDate) payload.endDate = campaignForm.endDate;
                if (campaignForm.targetTierId !== 'all') payload.targetTierId = campaignForm.targetTierId;
                createCampaignMutation.mutate(payload);
              }}
            >
              {createCampaignMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
