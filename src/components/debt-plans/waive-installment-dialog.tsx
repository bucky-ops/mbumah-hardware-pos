'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ShieldOff } from 'lucide-react';

import {
  debtPaymentPlansApi,
  formatKES,
  formatDate,
  formatDateTime,
  type DebtPaymentPlanItem,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface WaiveInstallmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  installment: DebtPlanInstallmentItem | null;
  onWaived?: () => void;
}

export function WaiveInstallmentDialog({
  open,
  onOpenChange,
  planId,
  installment,
  onWaived,
}: WaiveInstallmentDialogProps) {
  const queryClient = useQueryClient();
  const [waiverReason, setWaiverReason] = useState<string>('');

  // Reset the waiver reason when the dialog opens — event-driven (not
  // effect-driven) to avoid the set-state-in-effect lint rule.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setWaiverReason('');
    }
    onOpenChange(next);
  };

  const waiveMutation = useMutation({
    mutationFn: async () => {
      if (!installment) throw new Error('No installment selected.');
      return debtPaymentPlansApi.waiveInstallment(planId, installment.id, {
        waiverReason: waiverReason.trim(),
      });
    },
    onSuccess: () => {
      toast.success('Installment waived', {
        description: `Installment #${installment?.installmentNumber} has been waived.`,
      });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plans-stats'] });
      queryClient.invalidateQueries({ queryKey: ['debt-payment-plan', planId] });
      onWaived?.();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = handleError(err, 'Waive installment');
      toast.error('Failed to waive installment', { description: msg });
    },
  });

  const handleSubmit = () => {
    if (!waiverReason.trim()) {
      toast.error('A waiver reason is required.');
      return;
    }
    waiveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldOff className="h-5 w-5 text-violet-500" />
            Waive Installment
          </DialogTitle>
          <DialogDescription>
            Waiving removes the installment from the customer's outstanding
            balance. This action is irreversible and will be logged in the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg bg-muted/50 p-2 text-xs space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Installment</span>
              <span className="font-semibold">#{installment?.installmentNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Due date</span>
              <span className="font-semibold">
                {installment ? formatDate(installment.dueDate) : ''}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount to waive</span>
              <span className="font-semibold text-violet-600 dark:text-violet-400">
                {formatKES(installment?.amountDue ?? 0)}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="waiver-reason">Waiver Reason</Label>
            <Textarea
              id="waiver-reason"
              placeholder="e.g. Customer dispute resolved, goodwill gesture, etc."
              value={waiverReason}
              onChange={(e) => setWaiverReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={waiveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={waiveMutation.isPending || !waiverReason.trim()}
            className="bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white"
          >
            {waiveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <ShieldOff className="h-4 w-4 mr-1" />
            )}
            Confirm Waiver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small helper to keep the parent component readable. */
export function getPaymentHistory(installments: DebtPlanInstallmentItem[] | undefined) {
  if (!installments) return [];
  return installments
    .filter((i) => i.paidAt || i.status === 'WAIVED')
    .sort((a, b) => {
      const aDate = a.paidAt ? new Date(a.paidAt).getTime() : 0;
      const bDate = b.paidAt ? new Date(b.paidAt).getTime() : 0;
      return bDate - aDate;
    });
}

/** Status badge label shorthand used in the details table. */
export function getInstallmentDateLabel(installment: DebtPlanInstallmentItem): string {
  if (installment.paidAt) {
    return `Paid ${formatDateTime(installment.paidAt)}`;
  }
  return `Due ${formatDate(installment.dueDate)}`;
}

/** Inline type-only re-export for consumers. */
export type { DebtPaymentPlanItem };
