'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore, type AppTab } from '@/lib/stores';
import { notificationsApi, formatDateTime, formatRelativeTime, type NotificationItem } from '@/lib/api';
import { useNotificationReadState } from '@/lib/notification-read-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PackageX, AlertTriangle, AlertOctagon, CircleDollarSign,
  UserPlus, Receipt, CheckCheck, BellRing, Filter, X,
  MoreVertical, Eye, EyeOff, RotateCcw,
} from 'lucide-react';

type NotificationFilter = 'all' | 'critical' | 'warning' | 'info';

export function NotificationCenter({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}) {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const { setActiveTab } = useAppStore();
  const queryClient = useQueryClient();

  // Shared external store — the sidebar/top-bar badge mirrors every change instantly.
  const {
    readIds, dismissedIds,
    markRead, markAllRead, dismiss, restore, restoreDismissed, reset,
  } = useNotificationReadState();

  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['notifications', storeId],
    queryFn: async () => {
      const res = await notificationsApi.list(storeId);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: open,
  });

  const allNotifications = useMemo(() => notificationsData || [], [notificationsData]);

  // Filter out dismissed notifications
  const activeNotifications = useMemo(
    () => allNotifications.filter((n) => !dismissedIds.has(n.id)),
    [allNotifications, dismissedIds]
  );

  const dismissedNotifications = useMemo(
    () => allNotifications.filter((n) => dismissedIds.has(n.id)),
    [allNotifications, dismissedIds]
  );

  // Apply severity filter
  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return activeNotifications;
    return activeNotifications.filter((n) => n.severity === filter);
  }, [activeNotifications, filter]);

  const filteredDismissedNotifications = useMemo(() => {
    if (filter === 'all') return dismissedNotifications;
    return dismissedNotifications.filter((n) => n.severity === filter);
  }, [dismissedNotifications, filter]);

  const visibleNotifications = showDismissed ? filteredDismissedNotifications : filteredNotifications;

  const unreadCount = activeNotifications.filter((n) => !readIds.has(n.id)).length;

  // Vibrate on new critical notifications
  useEffect(() => {
    if (open && activeNotifications.length > 0) {
      const criticalUnread = activeNotifications.filter(
        (n) => n.severity === 'critical' && !readIds.has(n.id)
      );
      if (criticalUnread.length > 0 && navigator.vibrate) {
        navigator.vibrate(200);
      }
    }
  }, [open, activeNotifications, readIds]);

  const invalidateNotificationQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['notification-count', storeId] });
    queryClient.invalidateQueries({ queryKey: ['notifications', storeId] });
  };

  const handleMarkAllRead = () => {
    // Mark EVERYTHING active — the severity filter must not hide unread items.
    markAllRead(activeNotifications.map((n) => n.id));
    // Re-pull from the server so the list also picks up brand-new notifications.
    invalidateNotificationQueries();
  };

  const handleNotificationClick = (notification: NotificationItem) => {
    markRead(notification.id);
    const targetTab = notification.targetTab as AppTab | undefined;
    if (targetTab) {
      setActiveTab(targetTab);
      onOpenChange(false);
    }
  };

  const handleDismiss = (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation();
    dismiss(notificationId);
  };

  const handleRestore = (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation();
    restore(notificationId);
  };

  const toggleShowDismissed = () => {
    // Reset the severity filter so the dismissed list isn't silently narrowed.
    if (!showDismissed) setFilter('all');
    setShowDismissed(!showDismissed);
  };

  const getNotificationIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'out_of_stock': return <PackageX className="h-4 w-4 text-red-500" />;
      case 'low_stock': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'overdue_rental': return <AlertOctagon className="h-4 w-4 text-red-500" />;
      case 'large_debt': return <CircleDollarSign className="h-4 w-4 text-amber-500" />;
      case 'new_customer': return <UserPlus className="h-4 w-4 text-green-500" />;
      case 'recent_transaction': return <Receipt className="h-4 w-4 text-blue-500" />;
    }
  };

  const getSeverityBg = (severity: NotificationItem['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40';
      case 'warning': return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40';
      case 'info': return 'bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30';
    }
  };

  const filterTabs: { id: NotificationFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: activeNotifications.length },
    { id: 'critical', label: 'Critical', count: activeNotifications.filter((n) => n.severity === 'critical').length },
    { id: 'warning', label: 'Warnings', count: activeNotifications.filter((n) => n.severity === 'warning').length },
    { id: 'info', label: 'Info', count: activeNotifications.filter((n) => n.severity === 'info').length },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg">Notifications</SheetTitle>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 animate-pulse-slow">
                  {unreadCount}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Notification actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={handleMarkAllRead} disabled={unreadCount === 0}>
                    <CheckCheck />
                    Mark all as read
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={toggleShowDismissed}
                    disabled={dismissedNotifications.length === 0 && !showDismissed}
                  >
                    {showDismissed ? <EyeOff /> : <Eye />}
                    {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
                  </DropdownMenuItem>
                  {readIds.size > 0 && (
                    <DropdownMenuItem variant="destructive" onClick={reset}>
                      <RotateCcw />
                      Reset read state
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleMarkAllRead}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>
          </div>
          <SheetDescription>
            Stay updated on stock, rentals, debts and sales — mark all as read from the ⋮ menu
          </SheetDescription>
        </SheetHeader>

        {/* Filter Tabs / Dismissed banner */}
        {showDismissed ? (
          <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground mr-1" />
            <span className="text-[11px] text-muted-foreground">Showing dismissed notifications</span>
            {dismissedNotifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-xs h-7 text-muted-foreground"
                onClick={restoreDismissed}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Restore all
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0">
            <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  filter === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1 opacity-70">({tab.count})</span>
                )}
              </button>
            ))}
          </div>
        )}

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="p-8 text-center">
              <BellRing className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {showDismissed
                  ? 'No dismissed notifications'
                  : filter === 'all'
                    ? 'No notifications'
                    : `No ${filter} notifications`}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">You&apos;re all caught up!</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {visibleNotifications.map((notification) => {
                if (showDismissed) {
                  return (
                    <div
                      key={notification.id}
                      className="w-full text-left p-3 rounded-lg border bg-muted/50 dark:bg-muted/20 border-border opacity-60 group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">{getNotificationIcon(notification.type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{notification.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notification.description}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1" title={formatDateTime(notification.timestamp)}>
                            {formatRelativeTime(notification.timestamp)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 p-1 rounded-md hover:bg-muted/80 transition-all"
                          onClick={(e) => handleRestore(e, notification.id)}
                          aria-label="Restore notification"
                        >
                          <RotateCcw className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  );
                }

                const isUnread = !readIds.has(notification.id);
                return (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNotificationClick(notification); } }}
                    tabIndex={0}
                    className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm cursor-pointer group ${getSeverityBg(notification.severity)} ${isUnread ? 'ring-1 ring-primary/20' : 'opacity-70'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">{getNotificationIcon(notification.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{notification.title}</p>
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notification.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1" title={formatDateTime(notification.timestamp)}>
                          {formatRelativeTime(notification.timestamp)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted/80 transition-all"
                        onClick={(e) => handleDismiss(e, notification.id)}
                        aria-label="Dismiss notification"
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
