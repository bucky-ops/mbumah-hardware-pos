'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, Loader2, Smartphone } from 'lucide-react';

import {
  debtPaymentPlansApi,
  formatKES,
  type DebtPlanInstallmentItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  installment: DebtPlanInstallmentItem | null;
  onPaid?: () => void;
}

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash', icon: Banknote },
  { value: 'MPESA', label: 'M-Pesa', icon: Smartphone },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer', icon: Banknote },
  { value: 'CHEQUE', label: 'Cheque', icon: Banknote },
] as const;

export function RecordPaymentDialog({
  open,
  onOpenChange,
  planId,
  installment,
  onPaid,
}: RecordPaymentDialogProps) {
  const queryClient = useQueryClient();

  const remaining = useMemo(() => {
    if (!installment) return 0;
    const due = installment.amountDue ?? 0;
    const paid = installment.amountPaid ?? 0;
    return Math.max(0, due - paid);
  }, [installment]);

  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [paymentReference, setPaymentReference] = useState<string>('');

  // Pre-fill amount with the remaining balance whenever the dialog opens.
  // Event-driven (not effect-driven) to avoid the set-state-in-effect rule.
  const handleOpenChange = (next: boolean) => {
    if (next && installment) {
      setAmount(remaining.toFixed(2));
      setPaymentMethod('CASH');
      setPaymentReference('');
    }
    onOpenChange(next);
  };

  const validationError = useMemo<string | null>(() => {
    if (!installment) return 'No installment selected.';
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return 'Amount must be greater than zero.';
    }
    if (amt > remaining + 0.01) {
      return `Amount cannot exceed the remaining balance (${formatKES(remaining)}).`;
    }
    return null;
  }, [installment, amount, remaining]);

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!installment) throw new Error('No installment selected.');
      return debtPaymentPlansApi.payInstallment(planId, installment.id, {
        amount: parseFloat(amount),
        paymentMethod,
        paymentReference: paymentReference.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Payment recorded', {
        description: `${formatKES(parseFloat(amount))} applied to installment #${installment?.installmentNumber}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans-stats'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plan', planId] });
      onPaid?.();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = handleError(err, 'Record installment payment');
      toast.error('Failed to record payment', { description: msg });
    },
  });

  const handleSubmit = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    payMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-emerald-500" />
            Record Installment Payment
          </DialogTitle>
          <DialogDescription>
            Installment #{installment?.installmentNumber} · Due{' '}
            {installment
              ? new Date(installment.dueDate).toLocaleDateString('en-KE')
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-muted-foreground">Amount Due</p>
              <p className="font-semibold">{formatKES(installment?.amountDue ?? 0)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-muted-foreground">Already Paid</p>
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                {formatKES(installment?.amountPaid ?? 0)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="text-muted-foreground">Remaining</p>
              <p className="font-semibold text-rose-600 dark:text-rose-400">
                {formatKES(remaining)}
              </p>
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Payment Amount (KES)</Label>
            <Input
              id="pay-amount"
              type="number"
              min={0.01}
              max={remaining}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {parseFloat(amount) < remaining && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                This will be recorded as a partial payment.
              </p>
            )}
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    <span className="flex items-center gap-2">
                      <m.icon className="h-3.5 w-3.5" />
                      {m.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reference */}
          <div className="space-y-1.5">
            <Label htmlFor="pay-reference">Reference (optional)</Label>
            <Input
              id="pay-reference"
              placeholder="M-Pesa code, receipt #, etc."
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={payMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={payMutation.isPending || Boolean(validationError)}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
          >
            {payMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Banknote className="h-4 w-4 mr-1" />
            )}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
