'use client';

/**
 * Debt Management Tab — overdue customer board + reminder pipeline controls.
 *
 * Three sub-sections (tabs):
 *   1. Overdue Board  — customers with overdue debts, sorted by aging bucket
 *                       (worst first) + total overdue. Shows pending-reminder
 *                       count per customer.
 *   2. Pipeline       — the two-phase reminder scheduler:
 *                       (a) Schedule: scan overdue debts → create PENDING rows
 *                       (b) Process:  send PENDING reminders via SMS/WA/Email
 *                       Plus a live summary of reminder status counts.
 *   3. History        — full DebtReminder audit log with filters.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, AlertOctagon, Clock, CheckCircle, XCircle,
  Loader2, RefreshCw, Send, Zap, Users, DollarSign,
  Mail, MessageSquare, Smartphone, Bell, ChevronDown, ChevronRight,
  Calendar, Phone, TrendingDown, Activity, History, Play,
} from 'lucide-react';

import { useAppStore, useAuthStore } from '@/lib/stores';
import {
  debtRemindersApi,
  type OverdueCustomerItem,
  type DebtReminderItem,
  type ReminderScheduleResult,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';

// ── Constants ────────────────────────────────────────────────────────────────

const SENIOR_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

const AGING_BUCKET_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ElementType; description: string }
> = {
  CURRENT: {
    label: 'Current',
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: CheckCircle,
    description: 'Not yet due',
  },
  DAYS_30: {
    label: '1–30 days',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    icon: Clock,
    description: 'Weekly reminders (SMS + WhatsApp)',
  },
  DAYS_60: {
    label: '31–60 days',
    color: 'text-orange-700 dark:text-orange-300',
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    icon: AlertTriangle,
    description: 'Every 3 days (SMS + WhatsApp + Email)',
  },
  DAYS_90_PLUS: {
    label: '61+ days',
    color: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-100 dark:bg-rose-900/30',
    icon: AlertOctagon,
    description: 'Daily + manager escalation',
  },
};

const REMINDER_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  SMS: {
    label: 'SMS',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: Smartphone,
  },
  WHATSAPP: {
    label: 'WhatsApp',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    icon: MessageSquare,
  },
  EMAIL: {
    label: 'Email',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    icon: Mail,
  },
  IN_APP: {
    label: 'In-App',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
    icon: Bell,
  },
};

const REMINDER_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  PENDING: {
    label: 'Pending',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
    icon: Clock,
  },
  SENT: {
    label: 'Sent',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: CheckCircle,
  },
  DELIVERED: {
    label: 'Delivered',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: CheckCircle,
  },
  FAILED: {
    label: 'Failed',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    icon: XCircle,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatKESLocal(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function daysSince(date: string | Date): number {
  const d = new Date(date);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Overdue Board Section ────────────────────────────────────────────────────

function OverdueBoardSection({ storeId }: { storeId: string }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['debt-overdue', storeId],
    queryFn: () => debtRemindersApi.listOverdue(storeId),
    enabled: !!storeId,
  });

  const customers = data?.data ?? [];
  const summary = data?.summary;

  const summaryCards = useMemo(() => {
    if (!summary) return [];
    return [
      {
        label: 'Overdue Customers',
        value: summary.customerCount,
        color: 'text-rose-600 dark:text-rose-400',
        icon: Users,
      },
      {
        label: 'Total Overdue',
        value: formatKESLocal(summary.totalOverdue),
        color: 'text-rose-600 dark:text-rose-400',
        icon: DollarSign,
      },
      {
        label: '1–60 days',
        value: (summary.byBucket.DAYS_30 ?? 0) + (summary.byBucket.DAYS_60 ?? 0),
        color: 'text-amber-600 dark:text-amber-400',
        icon: Clock,
      },
      {
        label: '61+ days',
        value: summary.byBucket.DAYS_90_PLUS ?? 0,
        color: 'text-rose-600 dark:text-rose-400',
        icon: AlertOctagon,
      },
    ];
  }, [summary]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summaryCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryCards.map((card) => (
            <Card key={card.label} className="py-3">
              <CardContent className="px-3 flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-muted ${card.color}`}>
                  <card.icon className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Customer list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Overdue Customers
              </CardTitle>
              <CardDescription>Sorted by aging severity (worst first) and overdue amount</CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <CheckCircle className="h-10 w-10 text-emerald-500/60 mx-auto" />
              <p className="text-sm font-medium text-foreground">No overdue customers 🎉</p>
              <p className="text-xs text-muted-foreground">All customer debts are current. Great job!</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[700px]">
              <div className="space-y-3">
                {customers.map((customer) => (
                  <OverdueCustomerCard key={customer.customerId} customer={customer} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OverdueCustomerCard({ customer }: { customer: OverdueCustomerItem }) {
  const [expanded, setExpanded] = useState(false);
  const bucketCfg = AGING_BUCKET_CONFIG[customer.agingBucket] || AGING_BUCKET_CONFIG.DAYS_30;
  const BucketIcon = bucketCfg.icon;
  const daysLate = daysSince(customer.oldestDueDate);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={`rounded-lg border ${expanded ? 'border-foreground/30' : ''} overflow-hidden`}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left">
            <div className={`p-2 rounded-lg ${bucketCfg.bg}`}>
              <BucketIcon className={`h-4 w-4 ${bucketCfg.color}`} />
            </div>
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-foreground">{customer.customerName}</span>
                <Badge className={`${bucketCfg.bg} ${bucketCfg.color} border-0`}>
                  {bucketCfg.label}
                </Badge>
                {customer.pendingReminders > 0 && (
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    <Clock className="h-3 w-3 mr-1" />
                    {customer.pendingReminders} pending
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {customer.phone || 'No phone'}
                </span>
                <span>•</span>
                <span>{customer.debts.length} {customer.debts.length === 1 ? 'debt' : 'debts'}</span>
                <span>•</span>
                <span>Oldest: {daysLate}d overdue</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold text-rose-600 dark:text-rose-400 font-mono">
                {formatKESLocal(customer.totalOverdue)}
              </p>
              <p className="text-xs text-muted-foreground">total overdue</p>
            </div>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t bg-muted/30 p-3 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">DEBT BREAKDOWN</p>
              <div className="rounded-md border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-xs">Debt ID</TableHead>
                      <TableHead className="h-8 text-xs text-right">Balance</TableHead>
                      <TableHead className="h-8 text-xs">Due Date</TableHead>
                      <TableHead className="h-8 text-xs">Days Late</TableHead>
                      <TableHead className="h-8 text-xs">Bucket</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customer.debts.map((debt) => {
                      const cfg = AGING_BUCKET_CONFIG[debt.agingBucket] || AGING_BUCKET_CONFIG.DAYS_30;
                      const late = daysSince(debt.dueDate);
                      return (
                        <TableRow key={debt.debtLedgerId}>
                          <TableCell className="font-mono text-xs py-2">{debt.debtLedgerId}</TableCell>
                          <TableCell className="font-mono text-sm py-2 text-right font-medium">
                            {formatKESLocal(debt.balance)}
                          </TableCell>
                          <TableCell className="text-xs py-2">{formatDate(debt.dueDate)}</TableCell>
                          <TableCell className="text-xs py-2">{late}d</TableCell>
                          <TableCell className="py-2">
                            <Badge className={`${cfg.bg} ${cfg.color} border-0 text-xs`}>{cfg.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              <span>{customer.email || 'No email on file'}</span>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Pipeline Section ─────────────────────────────────────────────────────────

function PipelineSection({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const canRun = authUser ? SENIOR_ROLES.includes(authUser.role) : false;

  const [showScheduleResult, setShowScheduleResult] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<ReminderScheduleResult | null>(null);

  // Live reminder status counts.
  const { data: remindersData, isLoading } = useQuery({
    queryKey: ['debt-reminders-summary', storeId],
    queryFn: () => debtRemindersApi.list({ storeId, limit: 1 }),
    enabled: !!storeId,
    refetchInterval: 15_000, // Auto-refresh every 15s while the pipeline runs
  });

  const summary = remindersData?.summary;
  const byStatus = summary?.byStatus ?? {};
  const byChannel = summary?.byChannel ?? {};

  const scheduleMutation = useMutation({
    mutationFn: () => debtRemindersApi.schedule(storeId),
    onSuccess: (data) => {
      const result = data.data;
      setScheduleResult(result);
      setShowScheduleResult(true);
      toast.success(data.message || `Scheduled ${result.scheduled} reminder(s).`);
      queryClient.invalidateQueries({ queryKey: ['debt-reminders-summary', storeId] });
      queryClient.invalidateQueries({ queryKey: ['debt-overdue', storeId] });
      queryClient.invalidateQueries({ queryKey: ['debt-reminders', storeId] });
    },
    onError: (err) => handleError(err),
  });

  const processMutation = useMutation({
    mutationFn: () => debtRemindersApi.process(storeId),
    onSuccess: (data) => {
      const result = data.data;
      toast.success(data.message || `Processed ${result.total} reminders: ${result.sent} sent, ${result.failed} failed.`);
      queryClient.invalidateQueries({ queryKey: ['debt-reminders-summary', storeId] });
      queryClient.invalidateQueries({ queryKey: ['debt-reminders', storeId] });
    },
    onError: (err) => handleError(err),
  });

  const pendingCount = byStatus.PENDING ?? 0;
  const sentCount = byStatus.SENT ?? 0;
  const deliveredCount = byStatus.DELIVERED ?? 0;
  const failedCount = byStatus.FAILED ?? 0;
  const totalReminders = summary?.total ?? 0;

  const successRate = sentCount + deliveredCount + failedCount > 0
    ? Math.round(((sentCount + deliveredCount) / (sentCount + deliveredCount + failedCount)) * 100)
    : 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pipeline cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Schedule card */}
        <Card className="border-blue-200 dark:border-blue-900/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              Step 1: Schedule Reminders
            </CardTitle>
            <CardDescription>
              Scan overdue debts and create PENDING reminder tasks based on aging escalation rules.
              Fast — no network calls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>• <span className="font-medium">1–30 days late</span>: weekly (SMS + WhatsApp)</p>
              <p>• <span className="font-medium">31–60 days late</span>: every 3 days (SMS + WhatsApp + Email)</p>
              <p>• <span className="font-medium">61+ days late</span>: daily + manager escalation</p>
            </div>
            <Button
              className="w-full"
              onClick={() => scheduleMutation.mutate()}
              disabled={!canRun || scheduleMutation.isPending}
            >
              {scheduleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Scheduling...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-1.5" />
                  Schedule Reminders Now
                </>
              )}
            </Button>
            {!canRun && (
              <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                Manager+ role required to run the scheduler.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Process card */}
        <Card className="border-emerald-200 dark:border-emerald-900/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <Send className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              Step 2: Process Pending
            </CardTitle>
            <CardDescription>
              Send all PENDING reminders via SMS (Twilio), WhatsApp (Twilio), and Email (Resend).
              Network-bound — batches of 100.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <p className="text-xs text-muted-foreground">Pending in queue</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{pendingCount}</p>
              </div>
              <Activity className="h-8 w-8 text-blue-600/40 dark:text-blue-400/40" />
            </div>
            <Button
              className="w-full"
              variant="default"
              onClick={() => processMutation.mutate()}
              disabled={!canRun || processMutation.isPending || pendingCount === 0}
            >
              {processMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1.5" />
                  Process {pendingCount > 0 ? `${pendingCount} ` : ''}Pending
                </>
              )}
            </Button>
            {pendingCount === 0 && (
              <p className="text-xs text-muted-foreground text-center">
                No pending reminders. Run Step 1 first.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Reminder Status Overview
          </CardTitle>
          <CardDescription>Live counts across all reminders for this store</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatusTile label="Pending" value={pendingCount} icon={Clock} color="text-slate-600 dark:text-slate-300" bg="bg-slate-100 dark:bg-slate-900/40" />
            <StatusTile label="Sent" value={sentCount} icon={CheckCircle} color="text-blue-600 dark:text-blue-400" bg="bg-blue-100 dark:bg-blue-900/30" />
            <StatusTile label="Delivered" value={deliveredCount} icon={CheckCircle} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100 dark:bg-emerald-900/30" />
            <StatusTile label="Failed" value={failedCount} icon={XCircle} color="text-rose-600 dark:text-rose-400" bg="bg-rose-100 dark:bg-rose-900/30" />
          </div>

          {/* Success rate */}
          {totalReminders > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Delivery success rate</span>
                <span className="font-medium">{successRate}%</span>
              </div>
              <Progress value={successRate} className="h-2" />
            </div>
          )}

          {/* Channel breakdown */}
          {Object.keys(byChannel).length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground">BY CHANNEL</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(byChannel).map(([channel, count]) => {
                  const cfg = REMINDER_TYPE_CONFIG[channel] || REMINDER_TYPE_CONFIG.IN_APP;
                  const Icon = cfg.icon;
                  return (
                    <Badge key={channel} className={cfg.color}>
                      <Icon className="h-3 w-3 mr-1" />
                      {cfg.label}: {count}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {totalReminders === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No reminders have been scheduled yet. Run Step 1 to begin.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule result dialog */}
      <Dialog open={showScheduleResult} onOpenChange={setShowScheduleResult}>
        <DialogContent className="sm:max-w-[525px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
              Scheduling Complete
            </DialogTitle>
            <DialogDescription>
              {scheduleResult?.scheduled} reminder(s) queued for {scheduleResult?.totalEligible} eligible debt(s).
            </DialogDescription>
          </DialogHeader>
          {scheduleResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-center">
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{scheduleResult.scheduled}</p>
                  <p className="text-xs text-muted-foreground">Scheduled</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/20 border text-center">
                  <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">{scheduleResult.skipped}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-center">
                  <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{scheduleResult.errors}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>
              {scheduleResult.details.length > 0 && (
                <ScrollArea className="max-h-64">
                  <div className="space-y-1">
                    {scheduleResult.details.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs p-2 rounded border">
                        {d.scheduled ? (
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className="font-mono text-muted-foreground">{d.debtLedgerId}</span>
                        <span className="text-muted-foreground truncate flex-1">
                          {d.reason || 'Scheduled'}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              <p className="text-xs text-muted-foreground">
                Run <span className="font-medium">Step 2: Process Pending</span> to actually send the queued reminders.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowScheduleResult(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusTile({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  bg: string;
}) {
  return (
    <div className={`p-3 rounded-lg border ${bg}`}>
      <div className="flex items-center justify-between mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

// ── History Section ──────────────────────────────────────────────────────────

function HistorySection({ storeId }: { storeId: string }) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['debt-reminders', storeId, statusFilter, typeFilter, page],
    queryFn: () =>
      debtRemindersApi.list({
        storeId,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        reminderType: typeFilter !== 'all' ? typeFilter : undefined,
        page,
        limit: pageSize,
      }),
    enabled: !!storeId,
  });

  const reminders = data?.data ?? [];
  const pagination = data?.pagination;
  const summary = data?.summary;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              Reminder History
            </CardTitle>
            <CardDescription>
              Audit log of every reminder sent (or scheduled / failed)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="SENT">Sent</SelectItem>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="SMS">SMS</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="IN_APP">In-App</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : reminders.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <History className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No reminders found.</p>
            <p className="text-xs text-muted-foreground/60">
              Run the scheduler in the Pipeline tab to create reminders.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Channel</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Message Preview</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reminders.map((r) => {
                    const typeCfg = REMINDER_TYPE_CONFIG[r.reminderType] || REMINDER_TYPE_CONFIG.IN_APP;
                    const statusCfg = REMINDER_STATUS_CONFIG[r.status] || REMINDER_STATUS_CONFIG.PENDING;
                    const TypeIcon = typeCfg.icon;
                    const StatusIcon = statusCfg.icon;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Badge className={typeCfg.color}>
                            <TypeIcon className="h-3 w-3 mr-1" />
                            {typeCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusCfg.color}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.customer?.name || '—'}
                          {r.customer?.phone && (
                            <p className="text-xs text-muted-foreground">{r.customer.phone}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.debtLedger ? formatKESLocal(r.debtLedger.balance) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs">
                          <p className="truncate" title={r.message}>{r.message}</p>
                          {r.errorMessage && (
                            <p className="text-rose-600 dark:text-rose-400 mt-0.5">{r.errorMessage}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(r.sentAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-3">
                <p className="text-xs text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages} • {pagination.total} total
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DebtManagementTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [activeTab, setActiveTab] = useState('board');

  if (!currentStoreId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Please select a store to manage debt reminders.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
            Debt Management
          </h2>
          <p className="text-sm text-muted-foreground">
            Track overdue customers and automate reminder escalation across SMS, WhatsApp, and Email.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="board" className="gap-1.5">
            <Users className="h-4 w-4" />
            Overdue Board
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-1.5">
            <Zap className="h-4 w-4" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="mt-4">
          <OverdueBoardSection storeId={currentStoreId} />
        </TabsContent>
        <TabsContent value="pipeline" className="mt-4">
          <PipelineSection storeId={currentStoreId} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistorySection storeId={currentStoreId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
