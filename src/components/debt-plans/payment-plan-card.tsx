'use client';

import React from 'react';
import {
  CalendarClock,
  CheckCircle2,
  PauseCircle,
  AlertTriangle,
  Eye,
  Banknote,
} from 'lucide-react';

import type { DebtPaymentPlanItem } from '@/lib/api';
import { formatKES, formatDate } from '@/lib/api';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  getPlanStatusLabel,
  getPlanStatusBadgeClasses,
  getFrequencyLabel,
} from './plan-status-helpers';

interface PaymentPlanCardProps {
  plan: DebtPaymentPlanItem;
  onViewDetails?: (plan: DebtPaymentPlanItem) => void;
}

/**
 * Compact summary card for a single debt payment plan.
 * Shows customer, progress bar, status badge, next due date, monthly amount.
 */
export function PaymentPlanCard({ plan, onViewDetails }: PaymentPlanCardProps) {
  const total = plan.totalAmount || 0;
  const paid = plan.amountPaid || 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

  // Next due installment = first non-paid, non-waived installment.
  // Task 12-d: the list API now returns `nextInstallment` directly (the list
  // payload has no installments array, so the old `find` here was always
  // undefined and the next-due date / overdue date / Payable badge below
  // never rendered). The `find` fallback keeps the detail-view usage working.
  const upcomingInstallment =
    plan.nextInstallment ??
    plan.installments?.find((i) => i.status !== 'PAID' && i.status !== 'WAIVED') ??
    null;

  const isOverdue = (plan.installmentsOverdue ?? 0) > 0;
  const isPaused = plan.status === 'PAUSED';
  const isCompleted = plan.status === 'COMPLETED';

  return (
    <Card
      className="glass-card hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden"
      role="button"
      tabIndex={0}
      aria-label={`View payment plan for ${plan.customer?.name ?? 'customer'}`}
      onClick={() => onViewDetails?.(plan)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onViewDetails?.(plan);
        }
      }}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: customer + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate" title={plan.customer?.name}>
              {plan.customer?.name ?? 'Unknown customer'}
            </h3>
            <p className="text-xs text-muted-foreground truncate">
              {plan.customer?.phone ?? 'No phone'}
            </p>
          </div>
          <Badge
            variant="outline"
            className={`shrink-0 ${getPlanStatusBadgeClasses(plan.status)}`}
          >
            {getPlanStatusLabel(plan.status)}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">
              {formatKES(paid)} / {formatKES(total)}
            </span>
          </div>
          <Progress
            value={progressPct}
            className={`h-2 ${isCompleted ? '[&>div]:bg-emerald-500' : isOverdue ? '[&>div]:bg-rose-500' : '[&>div]:bg-emerald-500'}`}
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {plan.installmentsPaid ?? 0} / {plan.installmentCount} installments
            </span>
            <span>{progressPct}%</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <p className="text-[10px] text-muted-foreground">Per installment</p>
            <p className="font-semibold">{formatKES(plan.installmentAmount)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <p className="text-[10px] text-muted-foreground">Balance</p>
            <p className={`font-semibold ${plan.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {formatKES(plan.balance)}
            </p>
          </div>
        </div>

        {/* Next due / status indicators */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
          {isCompleted ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {plan.completedAt
                ? `Completed ${formatDate(plan.completedAt)}`
                : 'Completed'}
            </span>
          ) : isPaused ? (
            <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
              <PauseCircle className="h-3.5 w-3.5" />
              Plan paused
            </span>
          ) : isOverdue ? (
            <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {plan.installmentsOverdue} overdue ·{' '}
              {upcomingInstallment ? formatDate(upcomingInstallment.dueDate) : '—'}
            </span>
          ) : upcomingInstallment ? (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              Next: {formatDate(upcomingInstallment.dueDate)}
              <span className="text-muted-foreground/70">
                · {getFrequencyLabel(plan.frequency)}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {getFrequencyLabel(plan.frequency)}
            </span>
          )}
        </div>
      </CardContent>

      <CardFooter className="p-3 pt-0 gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails?.(plan);
          }}
        >
          <Eye className="h-3.5 w-3.5 mr-1" />
          View Details
        </Button>
        {upcomingInstallment && !isCompleted && !isPaused && plan.status === 'ACTIVE' && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 px-2">
            <Banknote className="h-3 w-3" />
            Payable
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
