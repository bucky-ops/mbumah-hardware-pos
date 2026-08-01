'use client';

/**
 * Shared helpers for the Debt Plans UI: status badges, frequency labels,
 * color tokens. Kept tiny so it can be imported from any debt-plans
 * component without pulling React-Query or other heavy deps.
 */

import type {
  DebtPlanStatus,
  DebtInstallmentStatus,
  DebtPlanFrequency,
} from '@/lib/api';
import {
  PLAN_STATUS_LABELS,
  INSTALLMENT_STATUS_LABELS,
  FREQUENCY_LABELS,
} from '@/lib/debt-plan-utils';

export function getPlanStatusLabel(status: DebtPlanStatus): string {
  return PLAN_STATUS_LABELS[status] ?? status;
}

export function getInstallmentStatusLabel(status: DebtInstallmentStatus): string {
  return INSTALLMENT_STATUS_LABELS[status] ?? status;
}

export function getFrequencyLabel(frequency: DebtPlanFrequency): string {
  return FREQUENCY_LABELS[frequency] ?? frequency;
}

/**
 * Tailwind classes (background + text + border) for each plan status.
 * Matches the colour spec in the task:
 *   PENDING_APPROVAL = amber
 *   ACTIVE           = emerald
 *   COMPLETED        = green
 *   DEFAULTED        = red
 *   CANCELLED        = gray
 *   PAUSED           = blue
 */
export function getPlanStatusBadgeClasses(status: DebtPlanStatus): string {
  switch (status) {
    case 'PENDING_APPROVAL':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
    case 'ACTIVE':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
    case 'DEFAULTED':
      return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-700';
    case 'PAUSED':
      return 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function getInstallmentStatusBadgeClasses(status: DebtInstallmentStatus): string {
  switch (status) {
    case 'SCHEDULED':
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700';
    case 'PAID':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
    case 'PARTIAL':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
    case 'OVERDUE':
      return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800';
    case 'MISSED':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800';
    case 'WAIVED':
      return 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}
