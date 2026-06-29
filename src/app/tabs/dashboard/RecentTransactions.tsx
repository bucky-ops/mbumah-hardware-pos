'use client';

/**
 * RecentTransactions — recent activity feed (sales + system activity).
 *
 * Extracted from `dashboard-tab.tsx` to slim down the orchestrator. Renders
 * the latest 5 transactions and the latest 8 system activities in a single
 * scrollable feed.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, ShoppingCart, Banknote, Smartphone, CreditCard,
  Wallet, CircleDollarSign, Clock, Package, BarChart3,
} from 'lucide-react';

import {
  dashboardApi, transactionsApi,
  formatKES, formatRelativeTime,
} from '@/lib/api';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

export interface RecentTransactionsProps {
  storeId: string;
}

export function RecentTransactions({ storeId }: RecentTransactionsProps) {
  const { data: dashboardData, isLoading: dashLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      const d = res.data;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        return {
          ...d,
          salesByHour: Array.isArray(d.salesByHour) ? d.salesByHour : [],
          paymentMethodBreakdown: Array.isArray(d.paymentMethodBreakdown) ? d.paymentMethodBreakdown : [],
          recentTransactions: Array.isArray(d.recentTransactions) ? d.recentTransactions : [],
          topProducts: Array.isArray(d.topProducts) ? d.topProducts : [],
          topSellingCategories: Array.isArray(d.topSellingCategories) ? d.topSellingCategories : [],
          hourlySalesBreakdown: Array.isArray(d.hourlySalesBreakdown) ? d.hourlySalesBreakdown : [],
          lowStockItems: Array.isArray(d.lowStockItems) ? d.lowStockItems : [],
          recentActivities: Array.isArray(d.recentActivities) ? d.recentActivities : [],
        };
      }
      return d ?? null;
    },
    refetchInterval: 30000,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['recent-transactions', storeId],
    queryFn: async () => {
      const res = await transactionsApi.list({ storeId, limit: 5 });
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 30000,
  });

  const isLoading = dashLoading || txLoading;

  const getPaymentIcon = (method: string) => {
    switch (method?.toUpperCase()) {
      case 'CASH': return <Banknote className="h-3.5 w-3.5 text-green-600" />;
      case 'MPESA': return <Smartphone className="h-3.5 w-3.5 text-amber-600" />;
      case 'DEBT': return <CircleDollarSign className="h-3.5 w-3.5 text-red-600" />;
      case 'SPLIT': return <CreditCard className="h-3.5 w-3.5 text-purple-600" />;
      default: return <Wallet className="h-3.5 w-3.5" />;
    }
  };

  // Map activity action types to icons and colors
  const getActivityIcon = (action: string) => {
    const actionUpper = action?.toUpperCase() || '';
    if (actionUpper.includes('LOGIN')) return { icon: Activity, bg: 'bg-blue-100 dark:bg-blue-900/30', color: 'text-blue-600' };
    if (actionUpper.includes('PURCHASE_ORDER') || actionUpper.includes('PO_')) return { icon: Package, bg: 'bg-purple-100 dark:bg-purple-900/30', color: 'text-purple-600' };
    if (actionUpper.includes('SUPPLIER')) return { icon: BarChart3, bg: 'bg-teal-100 dark:bg-teal-900/30', color: 'text-teal-600' };
    if (actionUpper.includes('BUNDLE')) return { icon: Package, bg: 'bg-cyan-100 dark:bg-cyan-900/30', color: 'text-cyan-600' };
    if (actionUpper.includes('CASH_DRAWER') || actionUpper.includes('EXPENSE')) return { icon: Banknote, bg: 'bg-amber-100 dark:bg-amber-900/30', color: 'text-amber-600' };
    return { icon: Activity, bg: 'bg-gray-100 dark:bg-gray-900/30', color: 'text-gray-600' };
  };

  // Recent activities from dashboard API
  const recentActivities = (dashboardData as unknown as Record<string, unknown>)?.recentActivities as Array<{
    id: string; action: string; component: string; severity: string;
    message: string; createdAt: string; user?: { name: string; role: string } | null;
  }> | undefined;

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-green-600" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-2 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-1">
              {/* Recent Transactions */}
              {transactions && transactions.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-1">
                    <ShoppingCart className="h-3.5 w-3.5 text-green-600" />
                    <span className="text-xs font-semibold text-green-600">Recent Sales</span>
                  </div>
                  {transactions.slice(0, 5).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="shrink-0 p-1.5 rounded-full bg-green-100 dark:bg-green-900/30">
                        <ShoppingCart className="h-3.5 w-3.5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {tx.receiptNumber || `TX-${tx.id.slice(-6)}`}
                          </span>
                          <span className="flex items-center gap-0.5">
                            {getPaymentIcon(tx.paymentMethod)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {tx.paymentMethod} • {formatRelativeTime(tx.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold">{formatKES(tx.totalAmount)}</p>
                        <Badge
                          variant={tx.paymentStatus === 'COMPLETED' ? 'default' : 'secondary'}
                          className="text-[9px] px-1.5 py-0"
                        >
                          {tx.paymentStatus}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Separator */}
              {transactions && transactions.length > 0 && recentActivities && recentActivities.length > 0 && (
                <Separator className="my-2" />
              )}

              {/* Other Recent Activities */}
              {recentActivities && recentActivities.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-1">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground">System Activity</span>
                  </div>
                  {recentActivities.slice(0, 8).map((activity) => {
                    const iconConfig = getActivityIcon(activity.action);
                    const Icon = iconConfig.icon;
                    return (
                      <div
                        key={activity.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className={`shrink-0 p-1.5 rounded-full ${iconConfig.bg}`}>
                          <Icon className={`h-3.5 w-3.5 ${iconConfig.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{activity.message}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {activity.user?.name || 'System'} • {formatRelativeTime(activity.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Empty state */}
              {(!transactions || transactions.length === 0) && (!recentActivities || recentActivities.length === 0) && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No recent activity
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default RecentTransactions;
