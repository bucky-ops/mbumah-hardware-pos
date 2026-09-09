'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Coins,
  Loader2,
  PauseCircle,
  PlayCircle,
  Receipt,
  ShieldOff,
  Trash2,
  User,
} from 'lucide-react';

import {
  debtPaymentPlansApi,
  formatKES,
  formatDate,
  formatDateTime,
  type DebtPaymentPlanItem,
  type DebtPlanInstallmentItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import { useAuthStore } from '@/lib/stores';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

import { RecordPaymentDialog } from './record-payment-dialog';
import { WaiveInstallmentDialog } from './waive-installment-dialog';
import {
  getPlanStatusLabel,
  getPlanStatusBadgeClasses,
  getInstallmentStatusLabel,
  getInstallmentStatusBadgeClasses,
  getFrequencyLabel,
} from './plan-status-helpers';

interface PlanDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: DebtPaymentPlanItem | null;
}

export function PlanDetailsDialog({
  open,
  onOpenChange,
  plan,
}: PlanDetailsDialogProps) {
  const queryClient = useQueryClient();
  const [payInstallment, setPayInstallment] = useState<DebtPlanInstallmentItem | null>(null);
  const [waiveInstallment, setWaiveInstallment] = useState<DebtPlanInstallmentItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Task 12-d: current user id — used to hide the Approve button from the
  // plan creator (the server 409s self-approval; showing the button was a
  // guaranteed-failure UX trap).
  const sessionUserId = useAuthStore((s) => s.user?.id ?? null);

  // Fetch the full plan (with installments) when the dialog opens.
  const { data: fullPlan, isLoading } = useQuery({
    queryKey: ['debt-payment-plan', plan?.id],
    queryFn: async () => {
      if (!plan) return null;
      const res = await debtPaymentPlansApi.get(plan.id);
      return res.data ?? null;
    },
    enabled: open && Boolean(plan?.id),
    staleTime: 5_000,
  });

  // Reset child dialogs whenever the parent closes — event-driven (not
  // useEffect-driven) to avoid the set-state-in-effect lint rule.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPayInstallment(null);
      setWaiveInstallment(null);
      setConfirmDelete(false);
      setConfirmCancel(false);
    }
    onOpenChange(next);
  };

  const current: DebtPaymentPlanItem | null = fullPlan ?? plan;

  const progressPct = useMemo(() => {
    if (!current) return 0;
    const total = current.totalAmount || 0;
    const paid = current.amountPaid || 0;
    return total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  }, [current]);

  // ── Mutations: approve / pause / resume / cancel / delete ──────────────
  const approveMutation = useMutation({
    mutationFn: async () => debtPaymentPlansApi.approve(current!.id),
    onSuccess: () => {
      toast.success('Plan approved', { description: 'The plan is now ACTIVE.' });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plan', current?.id] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans-stats'] });
    },
    onError: (err) => toast.error('Failed to approve plan', { description: handleError(err) }),
  });

  const pauseMutation = useMutation({
    mutationFn: async () =>
      debtPaymentPlansApi.update(current!.id, { status: 'PAUSED' }),
    onSuccess: () => {
      toast.success('Plan paused');
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plan', current?.id] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
    },
    onError: (err) => toast.error('Failed to pause plan', { description: handleError(err) }),
  });

  const resumeMutation = useMutation({
    mutationFn: async () =>
      debtPaymentPlansApi.update(current!.id, { status: 'ACTIVE' }),
    onSuccess: () => {
      toast.success('Plan resumed');
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plan', current?.id] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
    },
    onError: (err) => toast.error('Failed to resume plan', { description: handleError(err) }),
  });

  const cancelMutation = useMutation({
    mutationFn: async () =>
      debtPaymentPlansApi.update(current!.id, { status: 'CANCELLED' }),
    onSuccess: () => {
      toast.success('Plan cancelled');
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plan', current?.id] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans-stats'] });
    },
    onError: (err) => toast.error('Failed to cancel plan', { description: handleError(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => debtPaymentPlansApi.delete(current!.id),
    onSuccess: () => {
      toast.success('Plan deleted');
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans-stats'] });
      setConfirmDelete(false);
      handleOpenChange(false);
    },
    onError: (err) => toast.error('Failed to delete plan', { description: handleError(err) }),
  });

  if (!current) {
    return null;
  }

  const installments = current.installments ?? [];
  // Task 12-d: the plan creator cannot approve (segregation of duties — the
  // server returns 409). Hide the button and explain why instead of showing
  // a guaranteed-failing action.
  const isCreator = Boolean(current.createdById && sessionUserId && current.createdById === sessionUserId);
  const canApprove = current.status === 'PENDING_APPROVAL' && !isCreator;
  const canPause = current.status === 'ACTIVE';
  const canResume = current.status === 'PAUSED';
  // Task 12-d: DEFAULTED plans can now be cancelled (the old state machine
  // left them with no exit — payments/waivers were blocked server-side too).
  const canCancel =
    current.status === 'ACTIVE' || current.status === 'PAUSED' || current.status === 'DEFAULTED';
  const canDelete = current.status === 'PENDING_APPROVAL' || current.status === 'CANCELLED';
  // Task 12-d: DEFAULTED plans accept catch-up payments and waivers again.
  const canActOnInstallments =
    current.status === 'ACTIVE' || current.status === 'PAUSED' || current.status === 'DEFAULTED';

  // Next due installment = first SCHEDULED/OVERDUE/PARTIAL.
  const nextDue = installments.find(
    (i) => i.status !== 'PAID' && i.status !== 'WAIVED',
  );

  // Payment history = installments that have been paid or waived, sorted desc.
  const paymentHistory = installments
    .filter((i) => i.paidAt || i.status === 'WAIVED')
    .sort((a, b) => {
      const aDate = a.paidAt ? new Date(a.paidAt).getTime() : 0;
      const bDate = b.paidAt ? new Date(b.paidAt).getTime() : 0;
      return bDate - aDate;
    });

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-500" />
                Payment Plan Details
              </span>
              <Badge
                variant="outline"
                className={getPlanStatusBadgeClasses(current.status)}
              >
                {getPlanStatusLabel(current.status)}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {current.customer?.name} ·{' '}
              {current.customer?.phone ?? 'No phone'} · Plan created{' '}
              {formatDate(current.createdAt)}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-3 p-1">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              {/* Header summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-1">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground">Total Amount</p>
                  <p className="text-lg font-bold">{formatKES(current.totalAmount)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground">Collected</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {formatKES(current.amountPaid)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground">Balance</p>
                  <p className="text-lg font-bold text-rose-600 dark:text-rose-400">
                    {formatKES(current.balance)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground">Frequency</p>
                  <p className="text-lg font-bold">{getFrequencyLabel(current.frequency)}</p>
                </div>
              </div>

              {/* Progress */}
              <div className="space-y-1 px-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {current.installmentsPaid} / {current.installmentCount} installments paid
                    {current.installmentsOverdue > 0 && (
                      <span className="ml-2 text-rose-600 dark:text-rose-400">
                        · {current.installmentsOverdue} overdue
                      </span>
                    )}
                  </span>
                  <span className="font-semibold">{progressPct}%</span>
                </div>
                <Progress
                  value={progressPct}
                  className={`h-2 ${current.status === 'COMPLETED' ? '[&>div]:bg-emerald-500' : current.installmentsOverdue > 0 ? '[&>div]:bg-rose-500' : '[&>div]:bg-emerald-500'}`}
                />
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2 px-1">
                {canApprove && (
                  <Button
                    size="sm"
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                    className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
                  >
                    {approveMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Approve Plan
                  </Button>
                )}
                {current.status === 'PENDING_APPROVAL' && isCreator && (
                  <span
                    className="text-xs text-muted-foreground border border-dashed rounded-md px-2.5 py-1.5"
                    title="Segregation of duties: the plan creator cannot approve their own plan."
                  >
                    Awaiting approval by another manager (creator cannot self-approve)
                  </span>
                )}
                {canPause && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pauseMutation.mutate()}
                    disabled={pauseMutation.isPending}
                  >
                    <PauseCircle className="h-3.5 w-3.5 mr-1" />
                    Pause
                  </Button>
                )}
                {canResume && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resumeMutation.mutate()}
                    disabled={resumeMutation.isPending}
                  >
                    <PlayCircle className="h-3.5 w-3.5 mr-1" />
                    Resume
                  </Button>
                )}
                {canCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmCancel(true)}
                    disabled={cancelMutation.isPending}
                    className="text-rose-600 hover:text-rose-700 hover:border-rose-300"
                  >
                    <Ban className="h-3.5 w-3.5 mr-1" />
                    Cancel Plan
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDelete(true)}
                    className="text-rose-600 hover:text-rose-700 hover:border-rose-300 ml-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                )}
              </div>

              {/* Tabs: Schedule / History / Overview */}
              <Tabs defaultValue="schedule" className="flex-1 overflow-hidden flex flex-col">
                <TabsList className="mx-1">
                  <TabsTrigger value="schedule">Installment Schedule</TabsTrigger>
                  <TabsTrigger value="history">Payment History</TabsTrigger>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                </TabsList>

                <TabsContent value="schedule" className="flex-1 overflow-hidden mt-2">
                  <ScrollArea className="h-[320px] pr-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead className="text-right">Amount Due</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {installments.map((inst) => {
                          // Task 12-d: PAUSED and DEFAULTED plans also accept
                          // payments/waivers server-side (catch-up + cure).
                          const isActionable =
                            canActOnInstallments &&
                            inst.status !== 'PAID' &&
                            inst.status !== 'WAIVED';
                          return (
                            <TableRow key={inst.id}>
                              <TableCell className="font-medium">
                                {inst.installmentNumber}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1 text-xs">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  {formatDate(inst.dueDate)}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatKES(inst.amountDue)}
                              </TableCell>
                              <TableCell className="text-right">
                                {inst.amountPaid > 0 ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    {formatKES(inst.amountPaid)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={getInstallmentStatusBadgeClasses(inst.status)}
                                >
                                  {getInstallmentStatusLabel(inst.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {isActionable ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-emerald-600 hover:text-emerald-700"
                                      onClick={() => setPayInstallment(inst)}
                                    >
                                      <Receipt className="h-3 w-3 mr-0.5" />
                                      Pay
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-violet-600 hover:text-violet-700"
                                      onClick={() => setWaiveInstallment(inst)}
                                    >
                                      <ShieldOff className="h-3 w-3 mr-0.5" />
                                      Waive
                                    </Button>
                                  </div>
                                ) : inst.status === 'PARTIAL' && canActOnInstallments ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-emerald-600 hover:text-emerald-700"
                                    onClick={() => setPayInstallment(inst)}
                                  >
                                    <Receipt className="h-3 w-3 mr-0.5" />
                                    Pay balance
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="history" className="flex-1 overflow-hidden mt-2">
                  <ScrollArea className="h-[320px] pr-2">
                    {paymentHistory.length === 0 ? (
                      <div className="text-center text-sm text-muted-foreground py-12">
                        <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        No payments recorded yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {paymentHistory.map((inst) => (
                          <div
                            key={inst.id}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">
                                  Installment #{inst.installmentNumber}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={getInstallmentStatusBadgeClasses(inst.status)}
                                >
                                  {getInstallmentStatusLabel(inst.status)}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {inst.paidAt
                                  ? `Paid ${formatDateTime(inst.paidAt)} · ${inst.paymentMethod ?? 'N/A'}`
                                  : `Waived on ${formatDate(inst.updatedAt)}`}
                                {inst.paymentReference ? ` · Ref: ${inst.paymentReference}` : ''}
                              </p>
                              {inst.waiverReason && (
                                <p className="text-xs text-violet-600 dark:text-violet-400">
                                  Reason: {inst.waiverReason}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                                {formatKES(inst.amountPaid)}
                              </p>
                              {inst.lateFeeApplied > 0 && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                  +{formatKES(inst.lateFeeApplied)} late fee
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="overview" className="flex-1 overflow-hidden mt-2">
                  <ScrollArea className="h-[320px] pr-2">
                    <div className="space-y-3 text-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border p-3">
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <User className="h-3 w-3" /> Created By
                          </p>
                          <p className="font-medium">
                            {current.createdBy?.name ?? 'System'}
                          </p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Approved By
                          </p>
                          <p className="font-medium">
                            {current.approvedBy?.name ?? '—'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border p-3">
                          <p className="text-[10px] text-muted-foreground">Start Date</p>
                          <p className="font-medium">{formatDate(current.startDate)}</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-[10px] text-muted-foreground">End Date</p>
                          <p className="font-medium">{formatDate(current.endDate)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border p-3">
                          <p className="text-[10px] text-muted-foreground">Per Installment</p>
                          <p className="font-medium">{formatKES(current.installmentAmount)}</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-[10px] text-muted-foreground">Interest Rate</p>
                          <p className="font-medium">{current.interestRate}%</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-[10px] text-muted-foreground">Late Fee</p>
                          <p className="font-medium">{formatKES(current.lateFee)}</p>
                        </div>
                      </div>

                      {nextDue && canActOnInstallments && (
                        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3 flex items-center gap-2">
                          <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-sm">
                            Next installment due{' '}
                            <strong>{formatDate(nextDue.dueDate)}</strong> —{' '}
                            {formatKES(Math.max(0, nextDue.amountDue - nextDue.amountPaid))}
                          </span>
                        </div>
                      )}

                      {current.installmentsOverdue > 0 && (
                        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 p-3 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                          <span className="text-sm">
                            <strong>{current.installmentsOverdue}</strong> installment
                            {current.installmentsOverdue === 1 ? '' : 's'} overdue. Follow up with the customer.
                          </span>
                        </div>
                      )}

                      {current.status === 'DEFAULTED' && (
                        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          <span className="text-sm">
                            This plan has <strong>defaulted</strong> (≥25% of
                            installments overdue). Catch-up payments and
                            waivers are still accepted, and the plan
                            automatically returns to ACTIVE once the overdue
                            ratio drops below the threshold.
                          </span>
                        </div>
                      )}

                      {current.autoCharge && (
                        <div className="rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 p-3 text-xs text-sky-700 dark:text-sky-300">
                          Auto-charge via M-Pesa is enabled — STK push will be
                          attempted on each due date.
                        </div>
                      )}

                      {current.notes && (
                        <>
                          <Separator />
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Notes</p>
                            <p className="text-sm whitespace-pre-wrap">{current.notes}</p>
                          </div>
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Sub-dialogs — keyed per open so each opens with fresh state
          (Task 12-d: stale payment amount / waiver reason reset). */}
      <RecordPaymentDialog
        key={payInstallment?.id ?? 'none'}
        open={Boolean(payInstallment)}
        onOpenChange={(o) => !o && setPayInstallment(null)}
        planId={current.id}
        installment={payInstallment}
      />

      <WaiveInstallmentDialog
        key={waiveInstallment?.id ?? 'none'}
        open={Boolean(waiveInstallment)}
        onOpenChange={(o) => !o && setWaiveInstallment(null)}
        planId={current.id}
        installment={waiveInstallment}
      />

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this payment plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling stops the installment schedule. Amounts already
              collected are kept, and the underlying debt remains collectible
              through the debt ledger. Cancelled plans can be deleted
              afterwards. This action will be recorded in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              Keep Plan
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Ban className="h-4 w-4 mr-1" />
              )}
              Cancel Plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the plan and all its installments.
              The underlying debt ledger entry will not be affected. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Delete Plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
