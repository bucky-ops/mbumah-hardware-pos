'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays,
  Coins,
  Loader2,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import {
  customersApi,
  debtApi,
  debtPaymentPlansApi,
  formatKES,
  formatDate,
  type CustomerItem,
  type DebtLedgerItem,
  type DebtPlanFrequency,
  type CreateDebtPaymentPlanPayload,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import { calculateInstallmentAmount, calculateEndDate } from '@/lib/debt-plan-utils';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CreatePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  onCreated?: () => void;
  /** Pre-selected customer (e.g. when launched from the Customers tab). */
  presetCustomerId?: string;
}

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  currentDebtBalance: number;
}

export function CreatePlanDialog({
  open,
  onOpenChange,
  storeId,
  onCreated,
  presetCustomerId,
}: CreatePlanDialogProps) {
  const queryClient = useQueryClient();

  // ── Form state ───────────────────────────────────────────────────────────
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [debtLedgerId, setDebtLedgerId] = useState<string>('');
  const [totalAmount, setTotalAmount] = useState<string>('');
  const [installmentCount, setInstallmentCount] = useState<number>(6);
  const [frequency, setFrequency] = useState<DebtPlanFrequency>('MONTHLY');
  const [startDate, setStartDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [interestRate, setInterestRate] = useState<string>('0');
  const [lateFee, setLateFee] = useState<string>('0');
  const [notes, setNotes] = useState<string>('');
  const [autoCharge, setAutoCharge] = useState<boolean>(false);

  // ── Customer search query (debounced via React-Query's staleTime) ───────
  const { data: customersData, isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers-search', 'debt-plans', customerSearch, storeId],
    queryFn: async () => {
      const res = await customersApi.list({
        storeId,
        search: customerSearch || undefined,
        limit: 30,
      });
      return res.data ?? [];
    },
    enabled: open,
    staleTime: 15_000,
  });

  const customerOptions: CustomerOption[] = useMemo(() => {
    if (!Array.isArray(customersData)) return [];
    return customersData.map((c: CustomerItem) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      currentDebtBalance: c.currentDebtBalance ?? 0,
    }));
  }, [customersData]);

  // ── Selected customer's outstanding debts ──────────────────────────────
  const { data: customerDebts, isLoading: isLoadingDebts } = useQuery({
    queryKey: ['customer-outstanding-debts', customerId, storeId],
    queryFn: async () => {
      const res = await debtApi.list({ storeId, customerId });
      return res.data ?? [];
    },
    enabled: open && Boolean(customerId),
    staleTime: 30_000,
  });

  const outstandingDebts: DebtLedgerItem[] = useMemo(() => {
    if (!Array.isArray(customerDebts)) return [];
    return customerDebts.filter(
      (d) => d.status !== 'SETTLED' && d.status !== 'WRITTEN_OFF' && d.balance > 0,
    );
  }, [customerDebts]);

  // Wrap the parent onOpenChange so we can reset the form when the dialog
  // closes (without setState-in-effect) and pre-select a customer when it
  // opens. This avoids the cascading-render pattern flagged by the
  // react-hooks/set-state-in-effect rule.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset the form.
      setCustomerSearch('');
      setCustomerId('');
      setDebtLedgerId('');
      setTotalAmount('');
      setInstallmentCount(6);
      setFrequency('MONTHLY');
      setStartDate(new Date().toISOString().slice(0, 10));
      setInterestRate('0');
      setLateFee('0');
      setNotes('');
      setAutoCharge(false);
    } else if (presetCustomerId) {
      setCustomerId(presetCustomerId);
    }
    onOpenChange(next);
  };

  // Auto-fill totalAmount when the user picks a debt ledger (event-driven,
  // not effect-driven).
  const handleDebtLedgerChange = (v: string) => {
    setDebtLedgerId(v);
    const debt = outstandingDebts.find((d) => d.id === v);
    if (debt) {
      setTotalAmount(String(debt.balance));
    }
  };

  // ── Live preview of installment amount + end date ──────────────────────
  const preview = useMemo(() => {
    const total = parseFloat(totalAmount);
    const rate = parseFloat(interestRate) || 0;
    if (!Number.isFinite(total) || total <= 0) {
      return { installmentAmount: 0, endDate: null as Date | null };
    }
    const start = startDate ? new Date(startDate) : new Date();
    return {
      installmentAmount: calculateInstallmentAmount(total, installmentCount, rate),
      endDate: calculateEndDate(start, installmentCount, frequency),
    };
  }, [totalAmount, installmentCount, interestRate, startDate, frequency]);

  // ── Validation ──────────────────────────────────────────────────────────
  const validationError = useMemo<string | null>(() => {
    if (!customerId) return 'Please select a customer.';
    if (!debtLedgerId) return 'Please select an outstanding debt to repay.';
    const total = parseFloat(totalAmount);
    if (!Number.isFinite(total) || total <= 0) {
      return 'Total amount must be greater than zero.';
    }
    if (installmentCount < 1 || installmentCount > 24) {
      return 'Installment count must be between 1 and 24.';
    }
    if (!startDate) return 'Start date is required.';
    const start = new Date(startDate);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (start.getTime() < yesterday.getTime()) {
      return 'Start date cannot be in the past.';
    }
    return null;
  }, [customerId, debtLedgerId, totalAmount, installmentCount, startDate]);

  // ── Create mutation ────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (payload: CreateDebtPaymentPlanPayload) =>
      debtPaymentPlansApi.create(payload),
    onSuccess: () => {
      toast.success('Payment plan created', {
        description: 'It is now pending approval. A manager can approve it to activate.',
      });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans-stats'] });
      onCreated?.();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = handleError(err, 'Create debt payment plan');
      toast.error('Failed to create plan', { description: msg });
    },
  });

  const handleSubmit = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const payload: CreateDebtPaymentPlanPayload = {
      storeId,
      customerId,
      debtLedgerId,
      totalAmount: parseFloat(totalAmount),
      installmentCount,
      frequency,
      startDate: new Date(startDate).toISOString(),
      interestRate: parseFloat(interestRate) || 0,
      lateFee: parseFloat(lateFee) || 0,
      notes: notes.trim() || undefined,
      autoCharge,
    };
    createMutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-500" />
            Create Debt Payment Plan
          </DialogTitle>
          <DialogDescription>
            Set up an installment-based repayment schedule for an outstanding
            customer debt. The plan starts in PENDING_APPROVAL status.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-4 px-1 pb-2">
            {/* Customer search + select */}
            <div className="space-y-1.5">
              <Label htmlFor="customer-search">Customer</Label>
              <Input
                id="customer-search"
                placeholder="Search by name or phone…"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
              <Select
                value={customerId}
                onValueChange={(v) => {
                  setCustomerId(v);
                  setDebtLedgerId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isLoadingCustomers
                        ? 'Loading customers…'
                        : customerOptions.length === 0
                          ? 'No customers found'
                          : 'Select a customer'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-60">
                    {customerOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {c.phone ?? 'No phone'} · Debt:{' '}
                            {formatKES(c.currentDebtBalance)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            {/* Debt ledger select */}
            {customerId && (
              <div className="space-y-1.5">
                <Label>Outstanding Debt</Label>
                {isLoadingDebts ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading debts…
                  </p>
                ) : outstandingDebts.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    This customer has no outstanding debts eligible for a plan.
                  </p>
                ) : (
                  <Select value={debtLedgerId} onValueChange={handleDebtLedgerChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a debt to repay" />
                    </SelectTrigger>
                    <SelectContent>
                      {outstandingDebts.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {formatKES(d.balance)} · Due {formatDate(d.dueDate)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              Status: {d.status} · Original: {formatKES(d.amountOwed)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Total amount + start date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="total-amount">Total Amount (KES)</Label>
                <Input
                  id="total-amount"
                  type="number"
                  min={1}
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="start-date" className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Start Date
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>

            {/* Installment count slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Installment Count</Label>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {installmentCount} × {formatKES(preview.installmentAmount)}
                </span>
              </div>
              <Slider
                value={[installmentCount]}
                min={1}
                max={24}
                step={1}
                onValueChange={(v) => setInstallmentCount(v[0] ?? 6)}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>1</span>
                <span>24</span>
              </div>
            </div>

            {/* Frequency + interest rate */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select
                  value={frequency}
                  onValueChange={(v) => setFrequency(v as DebtPlanFrequency)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="BI_WEEKLY">Bi-Weekly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="interest-rate">Interest Rate % (annual)</Label>
                <Input
                  id="interest-rate"
                  type="number"
                  min={0}
                  step="0.01"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                />
              </div>
            </div>

            {/* Late fee */}
            <div className="space-y-1.5">
              <Label htmlFor="late-fee">Late Fee per Missed Installment (KES)</Label>
              <Input
                id="late-fee"
                type="number"
                min={0}
                step="0.01"
                value={lateFee}
                onChange={(e) => setLateFee(e.target.value)}
              />
            </div>

            {/* Auto-charge switch */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="auto-charge" className="cursor-pointer">
                  Auto-charge via M-Pesa
                </Label>
                <p className="text-xs text-muted-foreground">
                  Attempt STK push on each due date (requires customer consent).
                </p>
              </div>
              <Switch
                id="auto-charge"
                checked={autoCharge}
                onCheckedChange={setAutoCharge}
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes / Terms</Label>
              <Textarea
                id="notes"
                placeholder="Optional notes about this repayment arrangement…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Live preview */}
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Plan Preview
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Per installment</p>
                  <p className="font-semibold">
                    {formatKES(preview.installmentAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Final due date</p>
                  <p className="font-semibold">
                    {preview.endDate ? formatDate(preview.endDate) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total payable</p>
                  <p className="font-semibold flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {formatKES(
                      preview.installmentAmount * installmentCount,
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || Boolean(validationError)}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Create Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
