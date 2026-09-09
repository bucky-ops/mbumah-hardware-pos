'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ShieldOff } from 'lucide-react';

import {
  debtPaymentPlansApi,
  formatKES,
  formatDate,
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
}

export function WaiveInstallmentDialog({
  open,
  onOpenChange,
  planId,
  installment,
}: WaiveInstallmentDialogProps) {
  const queryClient = useQueryClient();
  // Reset the reason on each open. Task 12-d: the old event-driven reset in
  // an onOpenChange wrapper never ran because the parent opens this dialog
  // programmatically, so the previous waiver's reason text persisted into the
  // next open. The parent remounts this dialog per open via a `key`, so the
  // initializer below runs fresh every time — no effects needed.
  const [waiverReason, setWaiverReason] = useState<string>('');

  // Remaining (unpaid) balance on the installment. Task 12-d (debt-plan
  // audit, HIGH): only this remainder is actually forgiven — the server
  // waives `amountDue − amountPaid` and leaves the already-collected portion
  // untouched. The dialog previously displayed the full `amountDue`, which
  // misrepresented partial installments.
  const remainingToWaive = useMemo(() => {
    if (!installment) return 0;
    return Math.max(0, (installment.amountDue ?? 0) - (installment.amountPaid ?? 0));
  }, [installment]);

  const isPartial = Boolean(
    installment && (installment.amountPaid ?? 0) > 0.001 && installment.status !== 'PAID',
  );

  // Reset the reason on each open — handled by the parent's per-open
  // remount (`key`), no effects needed.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldOff className="h-5 w-5 text-violet-500" />
            Waive Installment
          </DialogTitle>
          <DialogDescription>
            Waiving removes the unpaid remainder of the installment from the
            customer&apos;s outstanding balance. This action is irreversible and
            will be logged in the audit trail.
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
            {isPartial && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already collected</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatKES(installment?.amountPaid ?? 0)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount to waive</span>
              <span className="font-semibold text-violet-600 dark:text-violet-400">
                {formatKES(remainingToWaive)}
              </span>
            </div>
          </div>

          {isPartial && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              This installment was partially paid — only the unpaid remainder
              ({formatKES(remainingToWaive)}) will be forgiven; the collected
              portion stays in the ledger.
            </p>
          )}

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
            onClick={() => onOpenChange(false)}
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
