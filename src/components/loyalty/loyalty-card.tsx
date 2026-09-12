'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Sparkles,
  Crown,
  Gem,
  Medal,
  Shield,
  Trophy,
  TrendingUp,
  HandCoins,
  Clock,
  Settings2,
  Gift,
  ChevronRight,
  Star,
  History,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
// R8 FIX (v2.5): friendly, branch-aware lookup error messages.
import { ApiRequestError, friendlyLookupError } from '@/lib/error-handler';

import { formatKES, formatDateTime, formatRelativeTime, authorizedFetchJson } from '@/lib/api';
import {
  TIER_CONFIG,
  type LoyaltyTierName,
  type LoyaltyTransactionType,
  type TierProgress,
} from '@/lib/loyalty-utils';
import { RedeemDialog } from '@/components/loyalty/redeem-dialog';

// ─── Types matching the GET /api/customers/[id]/loyalty response ──────────────

export interface LoyaltyTransactionItem {
  id: string;
  type: LoyaltyTransactionType;
  points: number;
  balanceAfter: number;
  reason: string | null;
  transactionId: string | null;
  createdAt: string;
}

export interface CustomerLoyaltyData {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  storeId: string;
  points: number;
  tier: LoyaltyTierName;
  storedTier: string;
  totalEarned: number;
  totalRedeemed: number;
  joinedAt: string;
  createdAt: string;
  nextTierProgress: TierProgress;
  transactions: LoyaltyTransactionItem[];
}

interface RedeemResponse {
  customerId: string;
  redeemedPoints: number;
  discountAmount: number;
  newBalance: number;
  reason: string;
  loyaltyTransactionId: string;
}

// ─── Tier icon helper ────────────────────────────────────────────────────────
//
// Returns the JSX for a tier icon directly (instead of a component type) so
// we avoid the react/no-unstable-nested-components lint rule, which flags
// `const TierIcon = getTierIcon(tier)` followed by `<TierIcon />` as a
// nested component definition.

function renderTierIcon(
  tier: LoyaltyTierName,
  className: string,
): React.ReactElement {
  const iconClass = className;
  switch (tier) {
    case 'PLATINUM':
      return <Gem className={iconClass} />;
    case 'GOLD':
      return <Crown className={iconClass} />;
    case 'SILVER':
      return <Medal className={iconClass} />;
    case 'BRONZE':
    default:
      return <Shield className={iconClass} />;
  }
}

// ─── Transaction type config ─────────────────────────────────────────────────

const TX_TYPE_CONFIG: Record<
  LoyaltyTransactionType,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  EARNED: {
    label: 'Earned',
    color: 'text-green-700 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
    icon: TrendingUp,
  },
  REDEEMED: {
    label: 'Redeemed',
    color: 'text-amber-700 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    icon: HandCoins,
  },
  ADJUSTED: {
    label: 'Adjusted',
    color: 'text-blue-700 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    icon: Settings2,
  },
  EXPIRED: {
    label: 'Expired',
    color: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800/50',
    icon: Clock,
  },
};

// ─── Animated counter hook ───────────────────────────────────────────────────

function useAnimatedNumber(target: number, durationMs = 800): number {
  const [display, setDisplay] = useState(0);
  const startRef = React.useRef<number | null>(null);
  const fromRef = React.useRef(0);

  React.useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    if (target === fromRef.current) return;

    let rafId = 0;
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setDisplay(next);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}

// ─── Component props ─────────────────────────────────────────────────────────

export interface LoyaltyCardProps {
  customerId: string;
  /** Optional callback after a successful redemption (e.g. to refresh parent state) */
  onRedeemed?: (result: RedeemResponse) => void;
  /** Compact mode hides the transactions list (useful in POS side-panels) */
  compact?: boolean;
  className?: string;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function LoyaltyCard({
  customerId,
  onRedeemed,
  compact = false,
  className,
}: LoyaltyCardProps) {
  const queryClient = useQueryClient();
  const [redeemOpen, setRedeemOpen] = useState(false);

  const queryKey = useMemo(() => ['customer-loyalty', customerId] as const, [customerId]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      // QA FIX (Kenya Plumbing Co. incident): this app authenticates with a
      // Bearer token (localStorage) — a bare same-origin fetch has no session
      // cookie, so the loyalty card 401'd forever with "Authentication
      // required." and the redeem button always failed.
      const res = await authorizedFetchJson(`/api/customers/${customerId}/loyalty`);
      if (!res.ok || !res.json?.success) {
        // R8: carry the real status so friendlyLookupError can tell
        // "belongs to another branch" (403/404) apart from transient faults.
        throw new ApiRequestError(res.json?.error || 'Failed to load loyalty data', res.status);
      }
      return res.json.data as CustomerLoyaltyData;
    },
    enabled: !!customerId,
    staleTime: 30_000,
  });

  const redeemMutation = useMutation({
    mutationFn: async (points: number) => {
      const res = await authorizedFetchJson(`/api/customers/${customerId}/loyalty/redeem`, {
        method: 'POST',
        body: JSON.stringify({ points }),
      });
      if (!res.ok || !res.json?.success) {
        throw new ApiRequestError(res.json?.error || 'Redemption failed', res.status);
      }
      return res.json.data as RedeemResponse;
    },
    onSuccess: (result) => {
      toast.success(
        `Redeemed ${result.redeemedPoints} points for ${formatKES(result.discountAmount)} discount!`,
      );
      void queryClient.invalidateQueries({ queryKey });
      onRedeemed?.(result);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Redemption failed';
      toast.error(msg);
    },
  });

  // Hooks must run unconditionally — call the animated-number hook with 0
  // until we have data so we don't violate rules-of-hooks.
  const animatedPoints = useAnimatedNumber(data?.points ?? 0);

  // ─── Loading skeleton ──
  if (isLoading) {
    return <LoyaltyCardSkeleton className={className} />;
  }

  // ─── Error state ──
  if (isError) {
    // R8 FIX (v2.5): branch-blocked lookups (record lives in another store)
    // used to render the raw API text ("Customer not found.") with a Retry
    // button that could never succeed. Classify and phrase them humanely.
    const friendly = friendlyLookupError(error);
    return (
      <Card className={className}>
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-sm font-medium text-destructive">{friendly.title}</p>
          {friendly.detail ? (
            <p className="text-xs text-muted-foreground">{friendly.detail}</p>
          ) : null}
          {friendly.retryable ? (
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const tierCfg = TIER_CONFIG[data.tier];
  const canRedeem = data.points >= 100;
  const progress = data.nextTierProgress;

  return (
    <Card className={`overflow-hidden border-0 shadow-lg ${className ?? ''}`}>
      {/* ── Tier gradient header ── */}
      <div className={`relative bg-gradient-to-br ${tierCfg.gradient} p-5 text-white`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_60%)]" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {renderTierIcon(data.tier, 'h-5 w-5 drop-shadow')}
              <span className="text-xs font-semibold uppercase tracking-wider opacity-90">
                {tierCfg.name} Member
              </span>
            </div>
            <p className="text-lg font-bold leading-tight">{data.customerName}</p>
            {data.phone && (
              <p className="text-xs opacity-90">{data.phone}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs opacity-90 uppercase tracking-wide">Points</div>
            <div className="text-3xl font-extrabold tabular-nums drop-shadow-sm">
              {animatedPoints.toLocaleString()}
            </div>
            <div className="text-[10px] opacity-90 mt-0.5">
              ≈ {formatKES((data.points / 100) * 10)}
            </div>
          </div>
        </div>
      </div>

      <CardContent className="p-5 space-y-5">
        {/* ── Tier progress bar ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">
              {tierCfg.name} tier
            </span>
            {progress.next ? (
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {progress.pointsNeeded.toLocaleString()}
                </span>{' '}
                pts to {progress.next}
              </span>
            ) : (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Trophy className="h-3 w-3" /> Max tier reached
              </Badge>
            )}
          </div>
          <Progress
            value={progress.percentage}
            className={`h-2.5 bg-muted [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:${tierCfg.gradient}`}
          />
          {progress.next && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{tierCfg.pointsRequired.toLocaleString()} pts</span>
              <span>
                {TIER_CONFIG[progress.next].pointsRequired.toLocaleString()} pts
              </span>
            </div>
          )}
        </div>

        {/* ── Lifetime stats ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-gradient-to-br from-green-50 to-green-100/30 dark:from-green-950/30 dark:to-green-900/10 p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-green-600" /> Earned
            </div>
            <div className="text-lg font-bold text-green-700 dark:text-green-400 tabular-nums">
              {data.totalEarned.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">lifetime points</div>
          </div>
          <div className="rounded-lg border bg-gradient-to-br from-amber-50 to-amber-100/30 dark:from-amber-950/30 dark:to-amber-900/10 p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <HandCoins className="h-3 w-3 text-amber-600" /> Redeemed
            </div>
            <div className="text-lg font-bold text-amber-700 dark:text-amber-400 tabular-nums">
              {data.totalRedeemed.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">
              ≈ {formatKES((data.totalRedeemed / 100) * 10)} saved
            </div>
          </div>
        </div>

        {/* ── Quick redeem CTA ── */}
        {canRedeem ? (
          <Button
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md"
            onClick={() => setRedeemOpen(true)}
          >
            <Gift className="mr-2 h-4 w-4" />
            Redeem Points
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-center">
            <Star className="mx-auto h-4 w-4 text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground">
              Earn{' '}
              <span className="font-semibold text-foreground">
                {(100 - data.points).toLocaleString()}
              </span>{' '}
              more points to unlock redemption
            </p>
          </div>
        )}

        {/* ── Recent transactions ── */}
        {!compact && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" /> Recent Activity
              </h4>
              <span className="text-[10px] text-muted-foreground">
                Last {Math.min(5, data.transactions.length)} transactions
              </span>
            </div>
            {data.transactions.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/20 py-6 text-center">
                <Sparkles className="mx-auto h-5 w-5 text-muted-foreground/50 mb-1" />
                <p className="text-xs text-muted-foreground">No loyalty activity yet</p>
              </div>
            ) : (
              <ScrollArea className="max-h-72 pr-2">
                <div className="space-y-1.5">
                  {data.transactions.slice(0, 5).map((tx) => (
                    <LoyaltyTxRow key={tx.id} tx={tx} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {/* ── Member since ── */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t pt-3">
          <span>Member since {formatDateTime(data.joinedAt)}</span>
          <span>Tier: {data.tier}</span>
        </div>
      </CardContent>

      {/* ── Redeem dialog ── */}
      <RedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        customerName={data.customerName}
        currentPoints={data.points}
        tier={data.tier}
        isRedeeming={redeemMutation.isPending}
        onConfirm={async (points) => {
          await redeemMutation.mutateAsync(points);
          setRedeemOpen(false);
        }}
      />
    </Card>
  );
}

// ─── Transaction row ─────────────────────────────────────────────────────────

function LoyaltyTxRow({ tx }: { tx: LoyaltyTransactionItem }) {
  const cfg = TX_TYPE_CONFIG[tx.type] ?? TX_TYPE_CONFIG.EARNED;
  const Icon = cfg.icon;
  const isPositive = tx.points > 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5 hover:bg-muted/40 transition-colors">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${cfg.bg} shrink-0`}>
        <Icon className={`h-4 w-4 ${cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold uppercase ${cfg.color}`}>
            {cfg.label}
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(tx.createdAt)}
          </span>
        </div>
        <p className="text-xs truncate text-foreground">
          {tx.reason ?? `${cfg.label} transaction`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-sm font-bold tabular-nums ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {isPositive ? '+' : ''}
          {tx.points.toLocaleString()}
        </div>
        <div className="text-[10px] text-muted-foreground">
          bal: {tx.balanceAfter.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function LoyaltyCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <div className="h-28 bg-gradient-to-br from-muted to-muted/50" />
      <CardContent className="p-5 space-y-4">
        <Skeleton className="h-2.5 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <Skeleton className="h-9 w-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
