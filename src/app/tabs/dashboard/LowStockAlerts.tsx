'use client';

/**
 * LowStockAlerts — alerts & notifications panel.
 *
 * Extracted from `dashboard-tab.tsx` to slim down the orchestrator. Aggregates
 * low-stock / out-of-stock notifications, overdue rentals, and overdue debt
 * into a single scrollable alerts list. Clicking an alert with a `targetTab`
 * invokes `onTabSwitch` to navigate the user to the relevant tab.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BellRing, Bell, AlertCircle, AlertOctagon, PackageX,
  KeyRound, CircleDollarSign, CheckCircle2, ChevronRight,
} from 'lucide-react';

import { notificationsApi, debtApi, rentalsApi } from '@/lib/api';
import type { AppTab } from '@/lib/stores';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

export interface LowStockAlertsProps {
  storeId: string;
  onTabSwitch: (tab: AppTab) => void;
}

export function LowStockAlerts({ storeId, onTabSwitch }: LowStockAlertsProps) {
  const { data: notifications, isLoading: notifLoading } = useQuery({
    queryKey: ['notifications', storeId],
    queryFn: async () => {
      const res = await notificationsApi.list(storeId);
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 30000,
  });

  const { data: debtData, isLoading: debtLoading } = useQuery({
    queryKey: ['overdue-debt', storeId],
    queryFn: async () => {
      const res = await debtApi.list({ storeId, status: 'OVERDUE', limit: 5 });
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 60000,
  });

  const { data: rentalsData, isLoading: rentLoading } = useQuery({
    queryKey: ['overdue-rentals-alert', storeId],
    queryFn: async () => {
      const res = await rentalsApi.list({ storeId, status: 'OVERDUE', limit: 5 });
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 60000,
  });

  const isLoading = notifLoading || debtLoading || rentLoading;

  // Aggregate alerts
  const alerts = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'low_stock' | 'overdue_rental' | 'overdue_debt' | 'notification';
      severity: 'critical' | 'warning' | 'info';
      title: string;
      description: string;
      icon: React.ElementType;
      color: string;
      badgeVariant: 'destructive' | 'secondary' | 'default';
      targetTab?: AppTab;
      count?: number;
    }> = [];

    // Low stock notifications
    const lowStockNotifs = notifications?.filter(n => n.type === 'low_stock' || n.type === 'out_of_stock') ?? [];
    if (lowStockNotifs.length > 0) {
      items.push({
        id: 'low-stock',
        type: 'low_stock',
        severity: 'warning',
        title: 'Low Stock Products',
        description: `${lowStockNotifs.length} product${lowStockNotifs.length > 1 ? 's' : ''} below reorder level`,
        icon: PackageX,
        color: 'text-amber-600',
        badgeVariant: 'secondary',
        targetTab: 'inventory',
        count: lowStockNotifs.length,
      });
    }

    // Out of stock
    const outOfStockNotifs = notifications?.filter(n => n.type === 'out_of_stock') ?? [];
    if (outOfStockNotifs.length > 0) {
      items.push({
        id: 'out-of-stock',
        type: 'low_stock',
        severity: 'critical',
        title: 'Out of Stock',
        description: `${outOfStockNotifs.length} product${outOfStockNotifs.length > 1 ? 's' : ''} completely out of stock`,
        icon: AlertOctagon,
        color: 'text-red-600',
        badgeVariant: 'destructive',
        targetTab: 'inventory',
        count: outOfStockNotifs.length,
      });
    }

    // Overdue rentals
    if (rentalsData && rentalsData.length > 0) {
      items.push({
        id: 'overdue-rentals',
        type: 'overdue_rental',
        severity: 'warning',
        title: 'Overdue Rentals',
        description: `${rentalsData.length} rental${rentalsData.length > 1 ? 's' : ''} past due date`,
        icon: KeyRound,
        color: 'text-amber-600',
        badgeVariant: 'secondary',
        targetTab: 'rentals',
        count: rentalsData.length,
      });
    }

    // Overdue debt
    if (debtData && debtData.length > 0) {
      items.push({
        id: 'overdue-debt',
        type: 'overdue_debt',
        severity: 'critical',
        title: 'Overdue Debt Payments',
        description: `${debtData.length} debt record${debtData.length > 1 ? 's' : ''} past due`,
        icon: CircleDollarSign,
        color: 'text-red-600',
        badgeVariant: 'destructive',
        targetTab: 'financial',
        count: debtData.length,
      });
    }

    // Other notifications
    const otherNotifs = notifications?.filter(
      n => n.type !== 'low_stock' && n.type !== 'out_of_stock'
    )?.slice(0, 3) ?? [];
    otherNotifs.forEach((n) => {
      items.push({
        id: n.id,
        type: 'notification',
        severity: n.severity as 'critical' | 'warning' | 'info',
        title: n.title,
        description: n.description,
        icon: n.severity === 'info' ? Bell : AlertCircle,
        color: n.severity === 'critical' ? 'text-red-600' : n.severity === 'warning' ? 'text-amber-600' : 'text-blue-600',
        badgeVariant: n.severity === 'critical' ? 'destructive' : 'secondary',
        targetTab: (n.targetTab as AppTab) || undefined,
      });
    });

    return items;
  }, [notifications, debtData, rentalsData]);

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-500" />
            Alerts & Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2 w-48" />
                </div>
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
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-500" />
            Alerts & Notifications
          </CardTitle>
          {alerts.length > 0 && (
            <Badge variant="destructive" className="text-[10px] px-2">
              {alerts.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {alerts.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500 opacity-50" />
            <p className="text-sm">All clear! No active alerts.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="space-y-2">
              {alerts.map((alert) => {
                const Icon = alert.icon;
                return (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors ${
                      alert.severity === 'critical'
                        ? 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20'
                        : alert.severity === 'warning'
                        ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20'
                        : 'border-border/50 bg-muted/30'
                    } ${alert.targetTab ? 'cursor-pointer hover:bg-muted/60' : ''}`}
                    onClick={alert.targetTab ? () => onTabSwitch(alert.targetTab!) : undefined}
                    role={alert.targetTab ? 'button' : undefined}
                    tabIndex={alert.targetTab ? 0 : undefined}
                  >
                    <div className={`shrink-0 p-1.5 rounded-full ${
                      alert.severity === 'critical' ? 'bg-red-100 dark:bg-red-900/30' :
                      alert.severity === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30' :
                      'bg-muted'
                    }`}>
                      <Icon className={`h-4 w-4 ${alert.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{alert.title}</span>
                        {alert.count !== undefined && (
                          <Badge variant={alert.badgeVariant} className="text-[9px] px-1.5 py-0">
                            {alert.count}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                    </div>
                    {alert.targetTab && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* System Health Indicator */}
        <Separator className="my-3" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            System Healthy
          </span>
          <span className="text-[10px] text-muted-foreground">
            Last sync: just now
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default LowStockAlerts;
