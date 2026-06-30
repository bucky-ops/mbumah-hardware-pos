'use client';

/**
 * FinancialPeriodsPanel — Phase 3 sub-tab.
 *
 * Lists all financial periods for the current store, ordered by start date
 * descending. Provides:
 *   • Create period dialog (periodName, startDate, endDate).
 *   • Lifecycle actions per period via dropdown menu:
 *       OPEN  → CLOSE  (reason required)
 *       CLOSED → LOCK  (reason required)
 *       CLOSED → REOPEN (reason required by helper)
 *   • Status badge: OPEN=green, CLOSED=amber, LOCKED=red.
 *   • Per-period entry count + posted totals (driven by /api/financial/periods
 *     GET handler enrichment).
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays, Plus, Lock, Unlock, CheckCircle2, Loader2, MoreHorizontal,
  AlertTriangle, Ban,
} from 'lucide-react';

import {
  financialApi, formatKES, formatDate,
  type FinancialPeriodItem,
} from '@/lib/api';
import { useAppStore, useAuthStore } from '@/lib/stores';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PeriodActionState {
  period: FinancialPeriodItem;
  action: 'CLOSE' | 'LOCK' | 'REOPEN';
}

const statusBadgeClass: Record<string, string> = {
  OPEN: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
  CLOSED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  LOCKED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
};

export default function FinancialPeriodsPanel() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({
    periodName: '',
    startDate: '',
    endDate: '',
  });
  const [actionState, setActionState] = useState<PeriodActionState | null>(null);
  const [actionReason, setActionReason] = useState('');

  const { data: periodsResponse, isLoading } = useQuery({
    queryKey: ['financial-periods', currentStoreId],
    queryFn: () => financialApi.listPeriods(currentStoreId),
    enabled: !!currentStoreId,
  });
  const periods: FinancialPeriodItem[] = Array.isArray(periodsResponse?.data)
    ? periodsResponse.data
    : [];

  const createMutation = useMutation({
    mutationFn: (data: {
      organizationId: string;
      storeId: string;
      periodName: string;
      startDate: string;
      endDate: string;
      createdByUserId: string;
    }) => financialApi.createPeriod(data),
    onSuccess: () => {
      toast.success('Financial period created');
      queryClient.invalidateQueries({ queryKey: ['financial-periods', currentStoreId] });
      setShowCreateDialog(false);
      setCreateForm({ periodName: '', startDate: '', endDate: '' });
    },
    onError: (error: Error) => toast.error(`Failed to create period: ${error.message}`),
  });

  const actionMutation = useMutation({
    mutationFn: (vars: { id: string; action: 'CLOSE' | 'LOCK' | 'REOPEN'; userId: string; reason: string }) =>
      financialApi.updatePeriodAction(vars.id, {
        action: vars.action,
        userId: vars.userId,
        reason: vars.reason,
      }),
    onSuccess: (_data, vars) => {
      const verb = vars.action === 'CLOSE' ? 'closed' : vars.action === 'LOCK' ? 'locked' : 'reopened';
      toast.success(`Period ${verb} successfully`);
      queryClient.invalidateQueries({ queryKey: ['financial-periods', currentStoreId] });
      setActionState(null);
      setActionReason('');
    },
    onError: (error: Error) => toast.error(`Action failed: ${error.message}`),
  });

  const handleCreate = () => {
    if (!authUser) {
      toast.error('You must be logged in to create a period');
      return;
    }
    if (!createForm.periodName.trim()) {
      toast.error('Period name is required');
      return;
    }
    if (!createForm.startDate || !createForm.endDate) {
      toast.error('Start and end dates are required');
      return;
    }
    if (new Date(createForm.endDate) <= new Date(createForm.startDate)) {
      toast.error('End date must be after start date');
      return;
    }
    createMutation.mutate({
      organizationId: authUser.organizationId,
      storeId: currentStoreId,
      periodName: createForm.periodName.trim(),
      startDate: createForm.startDate,
      endDate: createForm.endDate,
      createdByUserId: authUser.id,
    });
  };

  const openAction = (period: FinancialPeriodItem, action: 'CLOSE' | 'LOCK' | 'REOPEN') => {
    setActionState({ period, action });
    setActionReason('');
  };

  const submitAction = () => {
    if (!actionState || !authUser) return;
    if (actionReason.trim().length < 3) {
      toast.error('A reason (≥ 3 characters) is required');
      return;
    }
    actionMutation.mutate({
      id: actionState.period.id,
      action: actionState.action,
      userId: authUser.id,
      reason: actionReason.trim(),
    });
  };

  const actionLabel = actionState?.action === 'CLOSE'
    ? 'Close Period'
    : actionState?.action === 'LOCK'
    ? 'Lock Period'
    : 'Reopen Period';

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Financial Periods
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{periods.length} periods</Badge>
            <Button size="sm" className="h-7 text-xs" onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-1 h-3 w-3" /> Add Period
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : periods.length === 0 ? (
          <div className="py-12 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">No financial periods defined</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create a period to enable period-close discipline and budgeting.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-1 h-3 w-3" /> Add First Period
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">Posted Total</TableHead>
                  <TableHead>Budgets</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">{p.periodName}</TableCell>
                    <TableCell className="text-sm">{formatDate(p.startDate)}</TableCell>
                    <TableCell className="text-sm">{formatDate(p.endDate)}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${statusBadgeClass[p.status] || ''}`}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {p.postedEntryCount ?? 0} / {p.entryCount ?? 0}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono text-blue-600 dark:text-blue-400">
                      {formatKES(p.postedTotalDebit ?? 0)}
                    </TableCell>
                    <TableCell className="text-sm">{p.budgetCount ?? 0}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          {p.status === 'OPEN' && (
                            <DropdownMenuItem
                              onClick={() => openAction(p, 'CLOSE')}
                              className="gap-2 cursor-pointer text-amber-600 focus:text-amber-600"
                            >
                              <CheckCircle2 className="h-4 w-4" /> Close Period
                            </DropdownMenuItem>
                          )}
                          {p.status === 'CLOSED' && (
                            <>
                              <DropdownMenuItem
                                onClick={() => openAction(p, 'LOCK')}
                                className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                              >
                                <Lock className="h-4 w-4" /> Lock Period
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openAction(p, 'REOPEN')}
                                className="gap-2 cursor-pointer text-blue-600 focus:text-blue-600"
                              >
                                <Unlock className="h-4 w-4" /> Reopen Period
                              </DropdownMenuItem>
                            </>
                          )}
                          {p.status === 'LOCKED' && (
                            <DropdownMenuItem disabled className="gap-2 opacity-50">
                              <Ban className="h-4 w-4" /> Locked — terminal
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Create Period Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" /> Create Financial Period
            </DialogTitle>
            <DialogDescription>
              Periods cannot overlap. New periods are created in the OPEN state.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Period Name</Label>
              <Input
                placeholder="e.g. January 2026, Q1 2026, FY 2026"
                value={createForm.periodName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, periodName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={createForm.startDate}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={createForm.endDate}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, endDate: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="bg-green-600 hover:bg-green-700">
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Create Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lifecycle Action Confirmation */}
      <AlertDialog open={!!actionState} onOpenChange={(open) => { if (!open) { setActionState(null); setActionReason(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> {actionLabel}
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to <strong>{actionState?.action.toLowerCase()}</strong> the period
              &ldquo;{actionState?.period.periodName}&rdquo;. This action is recorded in the audit
              trail with your user ID and the reason provided below.
              {actionState?.action === 'LOCK' && ' LOCK is terminal — locked periods cannot be reopened.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="period-reason">Reason</Label>
            <Textarea
              id="period-reason"
              placeholder="e.g. Period-close audit passed; locking for archival."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={submitAction}
              disabled={actionMutation.isPending || actionReason.trim().length < 3}
              className={
                actionState?.action === 'LOCK'
                  ? 'bg-red-600 hover:bg-red-700'
                  : actionState?.action === 'CLOSE'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }
            >
              {actionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm {actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
