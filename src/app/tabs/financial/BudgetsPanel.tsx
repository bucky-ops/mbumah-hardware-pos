'use client';

/**
 * BudgetsPanel — Phase 3 sub-tab.
 *
 * Provides:
 *   • Period selector (dropdown of OPEN/CLOSED periods for the current store).
 *   • List of budgets for the selected period: account code/name, budgeted
 *     amount, actual amount, variance, variance %. Variance is colour-coded:
 *       - For EXPENSE accounts, positive variance (under budget) is favourable
 *         (green); negative (over budget) is unfavourable (red).
 *       - For REVENUE accounts, the reverse.
 *       - For other types, neutral.
 *   • Set Budget dialog (select account, enter budgetedAmount, notes).
 *   • Edit / Delete per budget row (dropdown menu).
 *   • Recalculate Actuals button (POST /api/financial/budgets/recalculate).
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Wallet, Plus, RefreshCw, Trash2, Edit2, MoreHorizontal, Loader2, CheckCircle2, PiggyBank,
} from 'lucide-react';

import {
  financialApi, formatKES,
  type AccountItem, type BudgetItem, type FinancialPeriodItem,
} from '@/lib/api';
import { useAppStore, useAuthStore } from '@/lib/stores';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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

function varianceClass(budget: BudgetItem): string {
  if (budget.budgetedAmount === 0) return 'text-muted-foreground';
  const favorable = budget.account?.type === 'REVENUE'
    ? budget.variance < 0   // revenue over budget (variance = budgeted - actual < 0)
    : budget.account?.type === 'EXPENSE'
    ? budget.variance > 0   // expense under budget
    : true;                  // neutral positive variance for asset/liability/equity
  return favorable ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
}

export default function BudgetsPanel() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const authUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [showBudgetDialog, setShowBudgetDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<BudgetItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BudgetItem | null>(null);
  const [budgetForm, setBudgetForm] = useState<{ accountId: string; budgetedAmount: string; notes: string }>({
    accountId: '',
    budgetedAmount: '',
    notes: '',
  });

  // Load periods
  const { data: periodsResponse } = useQuery({
    queryKey: ['financial-periods', currentStoreId],
    queryFn: () => financialApi.listPeriods(currentStoreId),
    enabled: !!currentStoreId,
  });
  const periods: FinancialPeriodItem[] = Array.isArray(periodsResponse?.data)
    ? periodsResponse.data
    : [];

  // Auto-select the most recent OPEN/CLOSED period on first load.
  React.useEffect(() => {
    if (!selectedPeriodId && periods.length > 0) {
      const firstEligible = periods.find((p) => p.status !== 'LOCKED') || periods[0];
      setSelectedPeriodId(firstEligible.id);
    }
  }, [periods, selectedPeriodId]);

  // Load accounts (for the Add/Edit dropdowns)
  const { data: accountsResponse } = useQuery({
    queryKey: ['accounts', currentStoreId],
    queryFn: () => financialApi.listAccounts(currentStoreId),
    enabled: !!currentStoreId,
  });
  const accounts: AccountItem[] = Array.isArray(accountsResponse?.data)
    ? accountsResponse.data
    : [];

  // Load budgets for selected period
  const { data: budgetsResponse, isLoading: budgetsLoading } = useQuery({
    queryKey: ['budgets', currentStoreId, selectedPeriodId],
    queryFn: () => financialApi.listBudgets(currentStoreId, selectedPeriodId || undefined),
    enabled: !!currentStoreId && !!selectedPeriodId,
  });
  const budgets: BudgetItem[] = Array.isArray(budgetsResponse?.data)
    ? budgetsResponse.data
    : [];

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) || null;

  const setBudgetMutation = useMutation({
    mutationFn: (data: {
      storeId: string;
      periodId: string;
      accountId: string;
      budgetedAmount: number | string;
      notes?: string;
      createdById: string;
    }) => financialApi.setBudget(data),
    onSuccess: () => {
      toast.success('Budget saved');
      queryClient.invalidateQueries({ queryKey: ['budgets', currentStoreId, selectedPeriodId] });
      setShowBudgetDialog(false);
      setBudgetForm({ accountId: '', budgetedAmount: '', notes: '' });
    },
    onError: (error: Error) => toast.error(`Failed to save budget: ${error.message}`),
  });

  const updateBudgetMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      data: { budgetedAmount?: number | string; notes?: string; updatedById: string };
    }) => financialApi.updateBudget(vars.id, vars.data),
    onSuccess: () => {
      toast.success('Budget updated');
      queryClient.invalidateQueries({ queryKey: ['budgets', currentStoreId, selectedPeriodId] });
      setEditTarget(null);
    },
    onError: (error: Error) => toast.error(`Failed to update budget: ${error.message}`),
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (id: string) => financialApi.deleteBudget(id),
    onSuccess: () => {
      toast.success('Budget deleted');
      queryClient.invalidateQueries({ queryKey: ['budgets', currentStoreId, selectedPeriodId] });
      setDeleteTarget(null);
    },
    onError: (error: Error) => toast.error(`Failed to delete budget: ${error.message}`),
  });

  const recalculateMutation = useMutation({
    mutationFn: () => financialApi.recalculateBudgets(currentStoreId, selectedPeriodId),
    onSuccess: (response) => {
      const updated = response.data?.updated ?? 0;
      toast.success(`Recalculated actuals for ${updated} budget${updated === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['budgets', currentStoreId, selectedPeriodId] });
    },
    onError: (error: Error) => toast.error(`Recalculate failed: ${error.message}`),
  });

  const handleSaveBudget = () => {
    if (!authUser) {
      toast.error('You must be logged in');
      return;
    }
    if (!budgetForm.accountId) {
      toast.error('Please select an account');
      return;
    }
    const amount = parseFloat(budgetForm.budgetedAmount);
    if (isNaN(amount) || amount < 0) {
      toast.error('Please enter a valid budget amount');
      return;
    }
    setBudgetMutation.mutate({
      storeId: currentStoreId,
      periodId: selectedPeriodId,
      accountId: budgetForm.accountId,
      budgetedAmount: amount,
      notes: budgetForm.notes || undefined,
      createdById: authUser.id,
    });
  };

  const handleUpdateBudget = () => {
    if (!editTarget || !authUser) return;
    const amount = parseFloat(budgetForm.budgetedAmount);
    if (isNaN(amount) || amount < 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    updateBudgetMutation.mutate({
      id: editTarget.id,
      data: {
        budgetedAmount: amount,
        notes: budgetForm.notes || undefined,
        updatedById: authUser.id,
      },
    });
  };

  const openCreate = () => {
    setBudgetForm({ accountId: '', budgetedAmount: '', notes: '' });
    setShowBudgetDialog(true);
  };

  const openEdit = (budget: BudgetItem) => {
    setEditTarget(budget);
    setBudgetForm({
      accountId: budget.accountId,
      budgetedAmount: String(budget.budgetedAmount),
      notes: budget.notes || '',
    });
  };

  // Summary stats
  const totals = useMemo(() => {
    const budgeted = budgets.reduce((s, b) => s + b.budgetedAmount, 0);
    const actual = budgets.reduce((s, b) => s + b.actualAmount, 0);
    const variance = budgets.reduce((s, b) => s + b.variance, 0);
    return { budgeted, actual, variance };
  }, [budgets]);

  const periodLocked = selectedPeriod?.status === 'LOCKED';

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PiggyBank className="h-4 w-4" /> Budgets
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
              <SelectTrigger className="h-8 text-xs w-48">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.periodName} ({p.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => recalculateMutation.mutate()}
              disabled={recalculateMutation.isPending || !selectedPeriodId || budgets.length === 0}
            >
              {recalculateMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Recalculate Actuals
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={openCreate}
              disabled={!selectedPeriodId || periodLocked}
            >
              <Plus className="mr-1 h-3 w-3" /> Set Budget
            </Button>
          </div>
        </div>
        {periodLocked && (
          <p className="text-xs text-red-600 mt-1">
            This period is LOCKED — budget mutations are blocked.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        {budgets.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="text-[10px] text-muted-foreground uppercase">Total Budgeted</p>
              <p className="text-sm font-bold font-mono">{formatKES(totals.budgeted)}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="text-[10px] text-muted-foreground uppercase">Total Actual</p>
              <p className="text-sm font-bold font-mono">{formatKES(totals.actual)}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="text-[10px] text-muted-foreground uppercase">Total Variance</p>
              <p className={`text-sm font-bold font-mono ${totals.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatKES(Math.abs(totals.variance))} {totals.variance >= 0 ? '↗' : '↘'}
              </p>
            </div>
          </div>
        )}

        {/* Budgets Table */}
        {!selectedPeriodId ? (
          <div className="py-12 text-center">
            <PiggyBank className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">Select a financial period to view its budgets</p>
          </div>
        ) : budgetsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : budgets.length === 0 ? (
          <div className="py-12 text-center">
            <Wallet className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">No budgets set for this period</p>
            <p className="text-xs text-muted-foreground mt-1">Click &ldquo;Set Budget&rdquo; to allocate amounts per account.</p>
            {!periodLocked && (
              <Button size="sm" variant="outline" className="mt-3" onClick={openCreate}>
                <Plus className="mr-1 h-3 w-3" /> Set First Budget
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Budgeted</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Variance %</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => {
                  const pct = b.budgetedAmount > 0
                    ? (b.variance / b.budgetedAmount) * 100
                    : 0;
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{b.account?.code || '—'}</span>
                          <span className="text-sm">{b.account?.name || b.accountId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {b.account?.type && (
                          <Badge variant="outline" className="text-[9px]">{b.account.type}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">{formatKES(b.budgetedAmount)}</TableCell>
                      <TableCell className="text-right text-sm font-mono">{formatKES(b.actualAmount)}</TableCell>
                      <TableCell className={`text-right text-sm font-mono font-bold ${varianceClass(b)}`}>
                        {formatKES(Math.abs(b.variance))} {b.variance >= 0 ? '↗' : '↘'}
                      </TableCell>
                      <TableCell className={`text-right text-xs ${varianceClass(b)}`}>
                        {pct.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={b.notes || ''}>
                        {b.notes || '—'}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                              onClick={() => openEdit(b)}
                              className="gap-2 cursor-pointer"
                              disabled={periodLocked}
                            >
                              <Edit2 className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget(b)}
                              className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                              disabled={periodLocked}
                            >
                              <Trash2 className="h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Set Budget Dialog */}
      <Dialog open={showBudgetDialog} onOpenChange={setShowBudgetDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" /> Set Budget
            </DialogTitle>
            <DialogDescription>
              Allocate a budgeted amount for an account in the selected period.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Account</Label>
              <Select
                value={budgetForm.accountId}
                onValueChange={(v) => setBudgetForm((prev) => ({ ...prev, accountId: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {accounts
                    .filter((a) => a.isActive)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} - {a.name} ({a.type})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Budgeted Amount (KES)</Label>
              <Input
                type="number"
                placeholder="0.00"
                min="0"
                value={budgetForm.budgetedAmount}
                onChange={(e) => setBudgetForm((prev) => ({ ...prev, budgetedAmount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="e.g. Quarterly allocation approved by board."
                value={budgetForm.notes}
                onChange={(e) => setBudgetForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBudgetDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSaveBudget}
              disabled={setBudgetMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {setBudgetMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Save Budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Budget Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-orange-600" /> Edit Budget
            </DialogTitle>
            <DialogDescription>
              {editTarget?.account ? `${editTarget.account.code} - ${editTarget.account.name}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Budgeted Amount (KES)</Label>
              <Input
                type="number"
                placeholder="0.00"
                min="0"
                value={budgetForm.budgetedAmount}
                onChange={(e) => setBudgetForm((prev) => ({ ...prev, budgetedAmount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Additional notes..."
                value={budgetForm.notes}
                onChange={(e) => setBudgetForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-muted/30">
                <p className="text-muted-foreground">Current Actual</p>
                <p className="font-mono font-bold">{editTarget ? formatKES(editTarget.actualAmount) : '—'}</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/30">
                <p className="text-muted-foreground">Current Variance</p>
                <p className="font-mono font-bold">{editTarget ? formatKES(editTarget.variance) : '—'}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              onClick={handleUpdateBudget}
              disabled={updateBudgetMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {updateBudgetMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Update Budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" /> Delete Budget
            </AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete the budget for &ldquo;{deleteTarget?.account?.name || 'this account'}&rdquo;?
              The journal entries that informed the actual amount remain untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteBudgetMutation.mutate(deleteTarget.id)}
              disabled={deleteBudgetMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteBudgetMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
