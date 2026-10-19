'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore, useAuthStore, type AppTab } from '@/lib/stores';
import { notificationsApi, formatDateTime, formatRelativeTime, type NotificationItem } from '@/lib/api';
import { isFailedEmailDigest, isRetryableDigestFailure } from '@/lib/hr/digest-notification-view';
// v2.57.0: the bell's Retry delivery calls the SAME server-governed re-send
// endpoint the schedule card uses (lean JSON helper, CSRF-safe headers).
import { apiSend } from '@/components/hr/self-service-ui';
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
  MoreVertical, Eye, EyeOff, RotateCcw, ShieldAlert, Shield, BarChart3, ArrowRight,
  CalendarSync, MailX, CalendarCheck2, CalendarX2, CalendarPlus, CalendarOff, UserCheck,
  PenLine, FilePenLine, Banknote, BookOpenCheck, Wallet, HandCoins, ScanEye, BadgeCheck,
  Sunrise,
} from 'lucide-react';

type NotificationFilter = 'all' | 'critical' | 'warning' | 'info' | 'security' | 'email_failed';

// v2.12.7 (PR C): Security filter tab
// Roles allowed to see the Security tab + the merged recent SecurityEvent feed
// (mirrors the /api/security/events role gate). SUPER_ADMIN/STORE_OWNER/
// BRANCH_MANAGER.
const SECURITY_TAB_ROLES: readonly string[] = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

/** The abuse eventTypes merged as read-only entries under the Security tab. */
const ABUSE_EVENT_TYPES = [
  'PERMISSION_DENIED',
  'HIGH_RISK_ATTEMPT',
  'BRUTE_FORCE',
  'ACCOUNT_LOCKED',
  'PRIVILEGE_ABUSE_PATTERN',
] as const;

const EVENT_TYPE_LABELS: Record<string, string> = {
  PERMISSION_DENIED: 'Permission Denied',
  HIGH_RISK_ATTEMPT: 'High-Risk Attempt',
  BRUTE_FORCE: 'Brute Force',
  ACCOUNT_LOCKED: 'Account Locked',
  PRIVILEGE_ABUSE_PATTERN: 'Privilege Abuse Pattern',
  UNAUTHORIZED_ACCESS: 'Unauthorized Access',
  MANAGER_AUTHORIZED: 'Manager Authorized',
};

/** One merged SecurityEvent row (read-only - from /api/security/events). */
interface SecurityEventEntry {
  id: string;
  eventType: string;
  resource: string | null;
  ipAddress: string | null;
  details: { email?: string; role?: string; permission?: string } | null;
  createdAt: string;
}

async function fetchRecentSecurityEvents(): Promise<SecurityEventEntry[]> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const res = await fetch(
    `/api/security/events?limit=10&eventTypes=${ABUSE_EVENT_TYPES.join(',')}`,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'same-origin',
    }
  );
  if (!res.ok) return []; // managers without access just see the notifications
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.data) ? (json.data as SecurityEventEntry[]) : [];
}

/**
 * v2.12.7 (PR C): merged recent SecurityEvent rows (limit 10, abuse event set)
 * shown as READ-ONLY entries below the SECURITY notifications on the Security
 * tab. Red-tinted rows, red shield icon, who/what/when (time-ago).
 */
function SecurityEventsFeed({
  events,
  isLoading,
}: {
  events: SecurityEventEntry[] | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <>
        <div className="flex items-center gap-1.5 pt-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          <Shield className="h-3 w-3 text-red-500" />
          Recent security events
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </>
    );
  }
  if (!events || events.length === 0) {
    return (
      <p className="pt-1 text-xs text-muted-foreground">
        No recent security events
      </p>
    );
  }
  return (
    <>
      <div className="flex items-center gap-1.5 pt-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        <Shield className="h-3 w-3 text-red-500" />
        Recent security events
      </div>
      {events.map((event) => {
        const who = event.details?.email || 'Unknown user';
        const what = event.details?.permission || event.resource || '';
        return (
          <div
            key={event.id}
            className="w-full p-3 rounded-lg border bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <ShieldAlert className="h-4 w-4 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {who}
                  {what ? ` - ${what}` : ''}
                  {event.ipAddress ? ` · ${event.ipAddress}` : ''}
                </p>
                <p
                  className="text-[10px] text-muted-foreground mt-1"
                  title={formatDateTime(event.createdAt)}
                >
                  {formatRelativeTime(event.createdAt)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

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
  // v2.24.0: deep links (HR digest copies) navigate via the app router.
  const router = useRouter();

  // v2.12.7 (PR C): Security tab is role-gated (SUPER_ADMIN/STORE_OWNER/
  // BRANCH_MANAGER) and merges recent SecurityEvent rows as read-only entries.
  const role = useAuthStore((s) => s.user?.role || '');
  const canSeeSecurity = SECURITY_TAB_ROLES.includes(role);

  // Shared external store - the sidebar/top-bar badge mirrors every change instantly.
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

  // v2.12.7 (PR C): recent SecurityEvents (limit 10, abuse set) - only fetched
  // while the Security tab is open for a manager-role viewer.
  const { data: securityEvents, isLoading: securityEventsLoading } = useQuery({
    queryKey: ['security-events-feed'],
    queryFn: fetchRecentSecurityEvents,
    enabled: open && canSeeSecurity && filter === 'security',
    staleTime: 30_000,
  });

  // Filter out dismissed notifications
  const activeNotifications = useMemo(
    () => allNotifications.filter((n) => !dismissedIds.has(n.id)),
    [allNotifications, dismissedIds]
  );

  const dismissedNotifications = useMemo(
    () => allNotifications.filter((n) => dismissedIds.has(n.id)),
    [allNotifications, dismissedIds]
  );

  // Apply severity filter - 'security' narrows to SECURITY-category items,
  // 'email_failed' (v2.28.0) narrows to digest copies whose email FAILED.
  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return activeNotifications;
    if (filter === 'security') {
      return activeNotifications.filter(
        (n) => n.category === 'SECURITY' || n.type === 'security'
      );
    }
    if (filter === 'email_failed') {
      return activeNotifications.filter((n) => isFailedEmailDigest(n));
    }
    return activeNotifications.filter((n) => n.severity === filter);
  }, [activeNotifications, filter]);

  const filteredDismissedNotifications = useMemo(() => {
    if (filter === 'all') return dismissedNotifications;
    if (filter === 'security') {
      return dismissedNotifications.filter(
        (n) => n.category === 'SECURITY' || n.type === 'security'
      );
    }
    if (filter === 'email_failed') {
      return dismissedNotifications.filter((n) => isFailedEmailDigest(n));
    }
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
    // Mark EVERYTHING active - the severity filter must not hide unread items.
    markAllRead(activeNotifications.map((n) => n.id));
    // Re-pull from the server so the list also picks up brand-new notifications.
    invalidateNotificationQueries();
  };

  const handleNotificationClick = (notification: NotificationItem) => {
    markRead(notification.id);
    // v2.24.0: rows carrying a deep link (HR digest copies) navigate to the
    // exact surface (e.g. /hr/reports?tab=cost&storeId=...) - the POS tab
    // switch only applies to rows that map onto this workspace's tabs.
    if (notification.actionUrl) {
      markAllRead([notification.id]);
      onOpenChange(false);
      router.push(notification.actionUrl);
      return;
    }
    const targetTab = notification.targetTab as AppTab | undefined;
    if (targetTab) {
      setActiveTab(targetTab);
      onOpenChange(false);
    }
  };

  // v2.27.0: digest rows expose the schedule behind the copy — jump straight
  // to the Schedules tab and highlight the card (?schedule=<id>). Nested
  // affordance: the click must not bubble into the row's own deep link.
  const handleManageSchedule = (e: React.MouseEvent, notification: NotificationItem) => {
    e.stopPropagation();
    if (!notification.scheduleId) return;
    markRead(notification.id);
    onOpenChange(false);
    router.push(`/hr/reports?tab=schedules&schedule=${encodeURIComponent(notification.scheduleId)}`);
  };

  // v2.57.0: the bell closes the loop — a FAILED digest row that still names
  // its schedule carries its own "Retry delivery" action, calling the SAME
  // server-governed re-send the schedule card uses (POST …/resend): the
  // target set is derived SERVER-SIDE from the NotificationLog (delivered-
  // wins), the digest is recomputed fresh, the cadence never moves. The
  // honest outcome renders inline on the row — SENT (emerald), PARTIAL /
  // FAILED / SKIPPED (amber), 409 nothing-to-re-send (amber note, not an
  // error), 403/404 (rose, scope refused). Per-row state keeps sibling rows
  // independent while one is in flight.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryNotes, setRetryNotes] = useState<Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }>>({});

  const handleRetryDelivery = async (e: React.MouseEvent, notification: NotificationItem) => {
    e.stopPropagation();
    if (!notification.scheduleId || retryingId !== null) return;
    setRetryingId(notification.id);
    setRetryNotes((prev) => {
      const next = { ...prev };
      delete next[notification.id];
      return next;
    });
    try {
      const res = await apiSend<{
        outcome: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
        reSentTo: string[];
        digestSummary: { reportLabel: string } | null;
        email: { success: boolean; error?: string };
      }>(`/api/hr/reports/schedules/${notification.scheduleId}/resend`, 'POST');
      const label = res.digestSummary?.reportLabel ?? notification.title;
      const n = res.reSentTo.length;
      if (res.outcome === 'SENT') {
        setRetryNotes((prev) => ({ ...prev, [notification.id]: { tone: 'ok', text: `${label} digest re-sent to ${n} recipient${n === 1 ? '' : 's'} who missed it — email delivered. A fresh copy lands in your bell.` } }));
      } else if (res.outcome === 'SKIPPED') {
        setRetryNotes((prev) => ({ ...prev, [notification.id]: { tone: 'warn', text: `${label} digest not re-sent: ${res.email.error ?? 'no data for the period'}. Nothing was emailed.` } }));
      } else if (res.outcome === 'PARTIAL') {
        setRetryNotes((prev) => ({ ...prev, [notification.id]: { tone: 'warn', text: `${label} re-send delivered to some of the ${n} missed recipient${n === 1 ? '' : 's'} (${res.email.error ?? 'partial delivery'}) — the per-recipient rows are on the schedule's delivery history.` } }));
      } else {
        setRetryNotes((prev) => ({ ...prev, [notification.id]: { tone: 'warn', text: `${label} re-send failed (${res.email.error ?? 'delivery error'}) — the per-recipient failure rows are on the schedule's delivery history.` } }));
      }
    } catch (err) {
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      const message = err instanceof Error ? err.message : 'Could not re-send the digest.';
      if (status === 409 || message.toLowerCase().includes('nothing to re-send')) {
        setRetryNotes((prev) => ({ ...prev, [notification.id]: { tone: 'warn', text: 'Nothing to re-send — the latest delivery already reached every recipient.' } }));
      } else if (status === 403 || status === 404) {
        setRetryNotes((prev) => ({ ...prev, [notification.id]: { tone: 'error', text: 'Retry refused — this schedule sits outside your desk\u2019s scope.' } }));
      } else {
        setRetryNotes((prev) => ({ ...prev, [notification.id]: { tone: 'error', text: message } }));
      }
    } finally {
      setRetryingId(null);
      // A manual re-send writes a fresh manual copy into the feed — pull it
      // in (and refresh the badge) so the bell tells the whole story.
      queryClient.invalidateQueries({ queryKey: ['notification-count', storeId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', storeId] });
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

  const getNotificationIcon = (type: NotificationItem['type'], leaveStatus?: NotificationItem['leaveStatus']) => {
    switch (type) {
      case 'out_of_stock': return <PackageX className="h-4 w-4 text-red-500" />;
      case 'low_stock': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'overdue_rental': return <AlertOctagon className="h-4 w-4 text-red-500" />;
      case 'large_debt': return <CircleDollarSign className="h-4 w-4 text-amber-500" />;
      case 'new_customer': return <UserPlus className="h-4 w-4 text-green-500" />;
      case 'recent_transaction': return <Receipt className="h-4 w-4 text-blue-500" />;
      // v2.12.7 (PR C): security rows - red shield.
      case 'security': return <ShieldAlert className="h-4 w-4 text-red-500" />;
      // v2.24.0: HR report digest copies - violet chart.
      case 'hr_digest': return <BarChart3 className="h-4 w-4 text-violet-500" />;
      // v2.31.0: leave decisions - emerald check / amber cross, mirroring the
      // status rails on the HR Leave desk rows.
      case 'leave_decision':
        return leaveStatus === 'REJECTED'
          ? <CalendarX2 className="h-4 w-4 text-amber-500" />
          : <CalendarCheck2 className="h-4 w-4 text-emerald-500" />;
      // v2.32.0: new leave requests - sky calendar-plus, the "action needed"
      // direction (employee → manager).
      case 'leave_request':
        return <CalendarPlus className="h-4 w-4 text-sky-700" />;
      // v2.33.0: cancellations - violet calendar-off, the "nothing to do"
      // surface (the balance already healed on cancel).
      case 'leave_cancel':
        return <CalendarOff className="h-4 w-4 text-violet-600" />;
      // v2.38.0: on-behalf filings - violet user-check, matching the
      // "Entered by HR" chip language on every surface.
      case 'leave_on_behalf':
        return <UserCheck className="h-4 w-4 text-violet-600" />;
      // v2.40.0: HR corrections (edit window) - indigo pencil, matching the
      // "Corrected by HR" chip language; no action needed by the employee.
      case 'leave_edited':
        return <PenLine className="h-4 w-4 text-indigo-600" />;
      // v2.43.0: approver-side correction rows - amber file-pen, the
      // "re-check before deciding" direction (the request they were
      // notified of changed under them).
      case 'leave_corrected':
        return <FilePenLine className="h-4 w-4 text-amber-700" />;
      // v2.61.0: "your correction was seen" - cyan scan-eye, the receipt
      // moment (a person at the desk read your corrected request; nothing
      // to do). Distinct from the amber correction rail it answers.
      case 'leave_review_seen':
        return <ScanEye className="h-4 w-4 text-cyan-600" />;
      // v2.62.0: "the correction you were told about was answered" -
      // emerald badge-check, the green-light moment for the APPROVER (the
      // marker is cleared; decide on the corrected details). Distinct from
      // the cyan employee receipt and from the amber question it closes.
      case 'leave_review_answered':
        return <BadgeCheck className="h-4 w-4 text-emerald-700" />;
      // v2.48.0 (QA fix: the type existed in the feed since v2.47.0 but this
      // switch had no case, so approval rows rendered WITHOUT an icon):
      // payroll approvals - emerald banknote, the money decision.
      case 'payroll_approved':
        return <Banknote className="h-4 w-4 text-emerald-700" />;
      // v2.48.0: payroll postings - sky open-book-check, the moment the
      // journal entry lands in the books and payslip numbers are issued.
      case 'payroll_posted':
        return <BookOpenCheck className="h-4 w-4 text-sky-700" />;
      // v2.49.0: "your payslip is issued" - teal wallet, the personal
      // "your money is ready" moment (never looks like the group's
      // emerald approval or sky posting).
      case 'payslip_issued':
        return <Wallet className="h-4 w-4 text-teal-600" />;
      // v2.50.0: disbursement - amber dollar-circle, money actually left
      // the door (M-Pesa B2C batch or manual bank-run confirmation).
      case 'payroll_disbursed':
        return <CircleDollarSign className="h-4 w-4 text-amber-700" />;
      // v2.51.0: "you've been paid" - emerald hand-coins, the personal
      // settled-money moment (own receipt in hand) — the completion of the
      // teal payslip-issued family, never confused with the group's amber
      // disbursement digest or the emerald approval row (different icon,
      // different rail).
      case 'payroll_paid':
        return <HandCoins className="h-4 w-4 text-emerald-700" />;
      // v2.68.0: the desk's morning note - orange sunrise, the same dawn
      // voice the org dashboard's strip carries (amber morning → emerald
      // answered); orange keeps the row distinct from the amber correction
      // rails it shares the feed with.
      case 'desk_digest':
        return <Sunrise className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
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
    // v2.12.7 (PR C): Security tab - red shield, manager roles only. Existing
    // tabs stay intact for every role.
    ...(canSeeSecurity
      ? [{
          id: 'security' as NotificationFilter,
          label: 'Security',
          count: activeNotifications.filter(
            (n) => n.category === 'SECURITY' || n.type === 'security'
          ).length,
        }]
      : []),
    // v2.28.0: "Email failed" tab — appears only when the feed actually
    // carries digest copies (it is meaningless otherwise), narrowing to the
    // rows whose email delivery FAILED so a broken send is one tap away.
    ...(activeNotifications.some((n) => n.type === 'hr_digest')
      ? [{
          id: 'email_failed' as NotificationFilter,
          label: 'Email failed',
          count: activeNotifications.filter((n) => isFailedEmailDigest(n)).length,
        }]
      : []),
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
            Stay updated on stock, rentals, debts and sales - mark all as read from the ⋮ menu
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
          <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors inline-flex items-center ${
                  filter === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {/* v2.12.7 (PR C): red shield marker on the Security tab. */}
                {tab.id === 'security' && (
                  <Shield className={`h-3 w-3 mr-1 ${filter === tab.id ? 'text-primary-foreground' : 'text-red-500'}`} />
                )}
                {/* v2.28.0: mail-x marker on the Email failed tab. */}
                {tab.id === 'email_failed' && (
                  <MailX className={`h-3 w-3 mr-1 ${filter === tab.id ? 'text-primary-foreground' : 'text-rose-500'}`} />
                )}
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
          ) : visibleNotifications.length === 0 && !(filter === 'security' && canSeeSecurity) ? (
            <div className="p-8 text-center">
              <BellRing className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {showDismissed
                  ? 'No dismissed notifications'
                  : filter === 'all'
                    ? 'No notifications'
                    : `No ${filter} notifications`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">You&apos;re all caught up!</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {visibleNotifications.length === 0 && filter === 'security' && (
                <p className="text-xs text-muted-foreground py-1">
                  No security notifications
                </p>
              )}
              {/* v2.57.0: the Email failed tab explains itself — the rows below
                  are failed digest copies, and the ones naming their schedule
                  carry the one-tap fix right on the row. */}
              {filter === 'email_failed' && !showDismissed && visibleNotifications.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  These digest copies failed to deliver. Rows that name their schedule carry a Retry delivery action — one tap re-sends to exactly who missed it.
                </div>
              )}
              {visibleNotifications.map((notification) => {
                if (showDismissed) {
                  return (
                    <div
                      key={notification.id}
                      className="w-full text-left p-3 rounded-lg border bg-muted/50 dark:bg-muted/20 border-border opacity-60 group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">{getNotificationIcon(notification.type, notification.leaveStatus)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{notification.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notification.description}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1" title={formatDateTime(notification.timestamp)}>
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
                    className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm cursor-pointer group ${getSeverityBg(notification.severity)} ${isUnread ? 'ring-1 ring-primary/20' : 'opacity-70'} ${notification.type === 'hr_digest' ? 'border-l-[3px] border-l-violet-400 dark:border-l-violet-500' : ''} ${notification.type === 'leave_decision' ? (notification.leaveStatus === 'REJECTED' ? 'border-l-[3px] border-l-amber-400 dark:border-l-amber-500' : 'border-l-[3px] border-l-emerald-400 dark:border-l-emerald-500') : ''} ${notification.type === 'leave_request' ? 'border-l-[3px] border-l-sky-400 dark:border-l-sky-500' : ''} ${notification.type === 'leave_cancel' ? 'border-l-[3px] border-l-violet-400 dark:border-l-violet-500' : ''} ${notification.type === 'leave_on_behalf' ? 'border-l-[3px] border-l-violet-400 dark:border-l-violet-500' : ''} ${notification.type === 'leave_edited' ? 'border-l-[3px] border-l-indigo-400 dark:border-l-indigo-500' : ''} ${notification.type === 'leave_corrected' ? 'border-l-[3px] border-l-amber-400 dark:border-l-amber-500' : ''} ${notification.type === 'leave_review_seen' ? 'border-l-[3px] border-l-cyan-400 dark:border-l-cyan-500' : ''} ${notification.type === 'leave_review_answered' ? 'border-l-[3px] border-l-emerald-400 dark:border-l-emerald-500' : ''} ${notification.type === 'payroll_approved' ? 'border-l-[3px] border-l-emerald-400 dark:border-l-emerald-500' : ''} ${notification.type === 'payroll_posted' ? 'border-l-[3px] border-l-sky-400 dark:border-l-sky-500' : ''} ${notification.type === 'payslip_issued' ? 'border-l-[3px] border-l-teal-400 dark:border-l-teal-500' : ''} ${notification.type === 'payroll_disbursed' ? 'border-l-[3px] border-l-amber-400 dark:border-l-amber-500' : ''} ${notification.type === 'payroll_paid' ? 'border-l-[3px] border-l-green-400 dark:border-l-green-500' : ''} ${notification.type === 'desk_digest' ? 'border-l-[3px] border-l-orange-400 dark:border-l-orange-500' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">{getNotificationIcon(notification.type, notification.leaveStatus)}</div>
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
                        {/* v2.31.0: leave decisions surface the outcome as a
                            tiny chip (mirrors the HR desk's status accents) so
                            an approval and a decline never look alike. */}
                        {notification.type === 'leave_decision' && notification.leaveStatus ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[10px] font-medium ${
                                notification.leaveStatus === 'APPROVED'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                              }`}
                            >
                              {notification.leaveStatus === 'APPROVED' ? 'Approved' : 'Declined'}
                            </span>
                          </div>
                        ) : null}
                        {/* v2.32.0: submission rows carry the "New request" chip
                            so an unreviewed request is one glance away. */}
                        {notification.type === 'leave_request' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-sky-200 bg-sky-50 px-1 py-0 text-[10px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                              New request
                            </span>
                          </div>
                        ) : null}
                        {/* v2.33.0: cancellation rows carry a violet "Cancelled"
                            chip ("Withdrawn" when the employee self-cancelled)
                            so the terminal state reads at a glance. */}
                        {notification.type === 'leave_cancel' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-violet-200 bg-violet-50 px-1 py-0 text-[10px] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                              {notification.title.includes('withdrawn') ? 'Withdrawn' : 'Cancelled'}
                            </span>
                          </div>
                        ) : null}
                        {/* v2.38.0: on-behalf rows carry a violet "Entered by
                            HR" chip so the employee can tell these apart
                            from requests they authored. */}
                        {notification.type === 'leave_on_behalf' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-violet-200 bg-violet-50 px-1 py-0 text-[10px] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                              Entered by HR
                            </span>
                          </div>
                        ) : null}
                        {/* v2.40.0: correction rows carry an indigo "Corrected
                            by HR" chip — the row body already carries the
                            before → after summary from the copy builder. */}
                        {notification.type === 'leave_edited' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1 py-0 text-[10px] font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">
                              Corrected by HR
                            </span>
                          </div>
                        ) : null}
                        {/* v2.43.0: approver-facing correction rows carry an
                            amber "Corrected - re-review" chip - the row body
                            already carries the before → after summary; the
                            chip says why this row deserves a second look. */}
                        {notification.type === 'leave_corrected' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1 py-0 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                              Corrected - re-review
                            </span>
                          </div>
                        ) : null}
                        {/* v2.61.0: review-seen rows carry a cyan "Correction
                            seen" chip - the receipt counterpart of the amber
                            "Corrected - re-review" chip above: the loop that
                            chip opened, this one closes. */}
                        {notification.type === 'leave_review_seen' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-cyan-200 bg-cyan-50 px-1 py-0 text-[10px] font-medium text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300">
                              Correction seen
                            </span>
                          </div>
                        ) : null}
                        {/* v2.68.0: desk-digest rows carry an orange "Morning
                            note" chip - the bell row of the v2.67.0 dawn
                            strip, in the feed's own chip language. */}
                        {notification.type === 'desk_digest' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-orange-200 bg-orange-50 px-1 py-0 text-[10px] font-medium text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300">
                              Morning note
                            </span>
                          </div>
                        ) : null}
                        {/* v2.62.0: review-answered rows carry an emerald
                            "Correction answered" chip - the green-light
                            counterpart of the amber "Corrected - re-review"
                            chip the approvals group got: the question that
                            chip raised, this one answers. */}
                        {notification.type === 'leave_review_answered' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1 py-0 text-[10px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                              Correction answered
                            </span>
                          </div>
                        ) : null}
                        {/* v2.48.0: payroll digest rows carry a status chip
                            (emerald "Approved" / sky "Posted") plus the
                            honest delivery chip - the run dialog had the
                            banner, the bell row stayed mute about whether
                            the email actually left. */}
                        {(notification.type === 'payroll_approved' || notification.type === 'payroll_posted') ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[10px] font-medium ${
                                notification.type === 'payroll_approved'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300'
                              }`}
                            >
                              {notification.type === 'payroll_approved' ? 'Approved' : 'Posted'}
                            </span>
                            {notification.emailStatus ? (
                              <span
                                className={`inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[10px] font-medium ${
                                  notification.emailStatus === 'SENT'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                                }`}
                              >
                                {notification.emailStatus === 'SENT' ? 'Email sent' : 'Email failed'}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {/* v2.49.0: personal payslip rows carry a teal "Payslip
                            ready" chip — the employee's own good news is one
                            glance away, and the row's "View payslip" action
                            deep-links the portal page. */}
                        {notification.type === 'payslip_issued' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-teal-200 bg-teal-50 px-1 py-0 text-[10px] font-medium text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
                              Payslip ready
                            </span>
                          </div>
                        ) : null}
                        {/* v2.50.0: disbursement rows carry an amber "Disbursed"
                            chip + the honest delivery chip - the money-moved
                            record deserves the same glance-ability as the
                            approval/posting rows. */}
                        {notification.type === 'payroll_disbursed' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1 py-0 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                              Disbursed
                            </span>
                            {notification.emailStatus ? (
                              <span
                                className={`inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[10px] font-medium ${
                                  notification.emailStatus === 'SENT'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                                }`}
                              >
                                {notification.emailStatus === 'SENT' ? 'Email sent' : 'Email failed'}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {/* v2.51.0: personal paid rows carry a green "Paid"
                            chip — the settled-money moment is one glance
                            away, and the row's "View payslip" action
                            deep-links the portal page (personal rows carry
                            no delivery chip — no group audience). */}
                        {notification.type === 'payroll_paid' ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 rounded border border-green-200 bg-green-50 px-1 py-0 text-[10px] font-medium text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                              Paid
                            </span>
                          </div>
                        ) : null}
                        {/* v2.27.0: digest rows surface the delivery outcome
                            (was the email actually delivered?) and the manual
                            marker as tiny chips - the feed row previously made
                            FAILED copies look identical to healthy ones. */}
                        {notification.type === 'hr_digest' && (notification.emailStatus || notification.manual) ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {notification.emailStatus ? (
                              <span
                                className={`inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[10px] font-medium ${
                                  notification.emailStatus === 'SENT'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                                }`}
                              >
                                {notification.emailStatus === 'SENT' ? 'Email sent' : 'Email failed'}
                              </span>
                            ) : null}
                            {notification.manual ? (
                              <span className="rounded border border-sky-200 bg-sky-50 px-1 py-0 text-[10px] font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                                manual
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {/* v2.24.0: digest rows carry a deep link - make the
                            affordance visible (not hover-only) since opening
                            the report IS the action for this row type.
                            v2.27.0: scheduleId adds a second affordance that
                            opens the Schedules tab with the card highlighted. */}
                        {notification.actionUrl ? (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <p className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400">
                              {notification.actionLabel ?? 'Open'} <ArrowRight className="h-3 w-3" aria-hidden />
                            </p>
                            {notification.scheduleId ? (
                              <button
                                type="button"
                                onClick={(e) => handleManageSchedule(e, notification)}
                                className="inline-flex items-center gap-1 rounded-sm px-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 hover:underline dark:hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                                aria-label={`Manage the schedule behind ${notification.title}`}
                              >
                                <CalendarSync className="h-3 w-3" aria-hidden /> Manage schedule
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {/* v2.57.0: the bell closes the loop — a FAILED digest
                            row naming its schedule offers the SAME server-
                            governed re-send the schedule card uses, with the
                            honest outcome rendered inline on the row (the
                            button never bubbles into the row's deep link). */}
                        {isRetryableDigestFailure(notification) ? (
                          <div className="mt-1.5 space-y-1">
                            <button
                              type="button"
                              onClick={(e) => void handleRetryDelivery(e, notification)}
                              disabled={retryingId !== null}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                              aria-label={`Retry delivery of ${notification.title}`}
                            >
                              <RotateCcw
                                className={`h-3 w-3 ${retryingId === notification.id ? 'animate-spin' : ''}`}
                                aria-hidden
                              />
                              {retryingId === notification.id ? 'Retrying…' : 'Retry delivery'}
                            </button>
                            {retryNotes[notification.id] ? (
                              <p
                                role="status"
                                className={`rounded-md border px-2 py-1 text-[11px] leading-snug ${
                                  retryNotes[notification.id].tone === 'ok'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                                    : retryNotes[notification.id].tone === 'warn'
                                      ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                                      : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
                                }`}
                              >
                                {retryNotes[notification.id].text}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        <p className="text-[10px] text-muted-foreground mt-1" title={formatDateTime(notification.timestamp)}>
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

              {/* v2.12.7 (PR C): merged recent SecurityEvents - read-only feed
                  below the SECURITY notifications, manager roles only. */}
              {filter === 'security' && canSeeSecurity && (
                <SecurityEventsFeed events={securityEvents} isLoading={securityEventsLoading} />
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
