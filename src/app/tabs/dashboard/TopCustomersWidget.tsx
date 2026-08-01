'use client';

/**
 * TopCustomersWidget — leaderboard of top customers by total spend.
 *
 * Pulls from /api/customers/top. Shows top 5 customers with rank badge,
 * avatar initials, name, order count, total spend, loyalty tier badge, and
 * a proportional spend bar. Falls back to an empty state when no data.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Crown, Medal, Award, TrendingUp, Users, ArrowRight,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

import { formatKES } from '@/lib/api';
import type { AppTab } from '@/lib/stores';

// ── Types ────────────────────────────────────────────────────────────────────

interface TopCustomer {
  rank: number;
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  loyaltyTier: string;
  loyaltyPoints: number;
  currentDebtBalance: number;
  totalSpend: number;
  orderCount: number;
  avgOrderValue: number;
  firstPurchaseAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIER_BADGE_STYLES: Record<string, string> = {
  BRONZE: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  SILVER: 'bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  GOLD: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400',
  PLATINUM: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="h-4 w-4 text-yellow-500" />;
  if (rank === 2) return <Medal className="h-4 w-4 text-slate-400" />;
  if (rank === 3) return <Award className="h-4 w-4 text-orange-600" />;
  return <span className="text-xs font-bold text-muted-foreground">#{rank}</span>;
}

// ── Component ────────────────────────────────────────────────────────────────

export interface TopCustomersWidgetProps {
  storeId: string;
  onSeeMore?: () => void;
  onTabSwitch?: (tab: AppTab) => void;
}

export function TopCustomersWidget({ storeId, onSeeMore, onTabSwitch }: TopCustomersWidgetProps) {
  const { data, isLoading } = useQuery<{ success: boolean; data: TopCustomer[]; totalSpendAll?: number }>({
    queryKey: ['top-customers', storeId],
    queryFn: async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(
        `/api/customers/top?storeId=${encodeURIComponent(storeId)}&limit=5&period=all`,
        { headers, credentials: 'same-origin' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const customers = data?.data ?? [];
  const totalAll = data?.totalSpendAll ?? 0;
  const maxSpend = customers.length > 0 ? customers[0].totalSpend : 1;

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-violet-600" />
            Top Customers
          </CardTitle>
          <CardDescription className="text-xs">Highest spenders</CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-1.5 w-full" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-violet-600" />
              Top Customers
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {customers.length > 0 ? (
                <>
                  Top 5 by total spend · <strong>{formatKES(totalAll)}</strong> all-time
                </>
              ) : (
                'No customer data yet'
              )}
            </CardDescription>
          </div>
          {onSeeMore && (
            <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={onSeeMore}>
              All
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Users className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No customers with purchases yet.</p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              Customers will appear here once they make purchases.
            </p>
            {onTabSwitch && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-7 text-xs"
                onClick={() => onTabSwitch('customers')}
              >
                <Users className="h-3 w-3 mr-1" />
                View Customers
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {customers.map((customer) => {
              const sharePct = maxSpend > 0 ? (customer.totalSpend / maxSpend) * 100 : 0;
              const tierClass = TIER_BADGE_STYLES[customer.loyaltyTier] || TIER_BADGE_STYLES.BRONZE;
              return (
                <div
                  key={customer.customerId}
                  className="group flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2 hover:bg-muted/40 hover:shadow-sm transition-all duration-200"
                >
                  {/* Rank icon */}
                  <div className="shrink-0 flex items-center justify-center h-7 w-7">
                    <RankIcon rank={customer.rank} />
                  </div>

                  {/* Avatar */}
                  <div className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs font-bold shadow-sm">
                    {getInitials(customer.name)}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{customer.name}</span>
                      <Badge className={`text-[9px] px-1 py-0 h-3.5 ${tierClass}`}>
                        {customer.loyaltyTier}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {customer.orderCount} orders
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">·</span>
                      <span className="text-[10px] text-muted-foreground">
                        Avg {formatKES(customer.avgOrderValue)}
                      </span>
                      {customer.currentDebtBalance > 0 && (
                        <>
                          <span className="text-[10px] text-muted-foreground/50">·</span>
                          <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                            Owes {formatKES(customer.currentDebtBalance)}
                          </span>
                        </>
                      )}
                    </div>
                    {/* Spend bar */}
                    <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500"
                        style={{ width: `${sharePct}%` }}
                      />
                    </div>
                  </div>

                  {/* Total spend */}
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">{formatKES(customer.totalSpend)}</p>
                    <div className="flex items-center justify-end gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <TrendingUp className="h-2.5 w-2.5" />
                      <span>{customer.loyaltyPoints} pts</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TopCustomersWidget;
