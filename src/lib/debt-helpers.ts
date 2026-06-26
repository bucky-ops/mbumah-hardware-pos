// ════════════════════════════════════════════════════════════════════════════
// src/lib/debt-helpers.ts
// ════════════════════════════════════════════════════════════════════════════
//
// Debt management & customer-reminder helpers.
//
// This module contains the core business logic for:
//   • Calculating debt aging buckets (CURRENT / DAYS_30 / DAYS_60 / DAYS_90_PLUS)
//   • Identifying overdue customers based on a configurable days-threshold
//   • Determining which reminders are due based on escalation rules
//   • Scheduling (queueing) reminder tasks for the notification service
//
// It depends on the Prisma client (db) for data access and the
// notification-helpers module for actual message delivery. It does NOT
// depend on any specific notification provider (Twilio/Resend) — that's
// abstracted behind INotificationService.
//
// Escalation rules (configurable via REMINDER_RULES):
//   • CURRENT (0–due date)     → no reminder (grace period)
//   • DAYS_30 (1–30 days late) → weekly reminder
//   • DAYS_60 (31–60 days late)→ every 3 days
//   • DAYS_90_PLUS (61+ days)  → daily + manager alert

import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

// ── Constants ────────────────────────────────────────────────────────────────

export const AgingBucket = {
  CURRENT: 'CURRENT',
  DAYS_30: 'DAYS_30',
  DAYS_60: 'DAYS_60',
  DAYS_90_PLUS: 'DAYS_90_PLUS',
} as const;
export type AgingBucket = (typeof AgingBucket)[keyof typeof AgingBucket];

export const ReminderType = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  WHATSAPP: 'WHATSAPP',
  IN_APP: 'IN_APP',
} as const;
export type ReminderType = (typeof ReminderType)[keyof typeof ReminderType];

export const ReminderStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DELIVERED: 'DELIVERED',
} as const;
export type ReminderStatus = (typeof ReminderStatus)[keyof typeof ReminderStatus];

/**
 * Escalation rules per aging bucket. `minIntervalHours` is the minimum time
 * that must have elapsed since the last reminder before another is sent.
 * `channels` is the ordered list of channels to attempt (first success wins).
 */
export const REMINDER_RULES: Record<
  AgingBucket,
  { minIntervalHours: number; channels: ReminderType[]; escalateToManager: boolean }
> = {
  [AgingBucket.CURRENT]: {
    minIntervalHours: Infinity, // Never remind current debts
    channels: [],
    escalateToManager: false,
  },
  [AgingBucket.DAYS_30]: {
    minIntervalHours: 24 * 7, // Weekly
    channels: [ReminderType.SMS, ReminderType.WHATSAPP],
    escalateToManager: false,
  },
  [AgingBucket.DAYS_60]: {
    minIntervalHours: 24 * 3, // Every 3 days
    channels: [ReminderType.SMS, ReminderType.WHATSAPP, ReminderType.EMAIL],
    escalateToManager: false,
  },
  [AgingBucket.DAYS_90_PLUS]: {
    minIntervalHours: 24, // Daily
    channels: [ReminderType.SMS, ReminderType.WHATSAPP, ReminderType.EMAIL],
    escalateToManager: true,
  },
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface OverdueCustomer {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  totalOverdue: number;
  oldestDueDate: Date;
  agingBucket: AgingBucket;
  debts: Array<{
    debtLedgerId: string;
    balance: number;
    dueDate: Date;
    agingBucket: AgingBucket;
  }>;
}

export interface ReminderScheduleResult {
  totalEligible: number;
  scheduled: number;
  skipped: number;
  errors: number;
  details: Array<{
    customerId: string;
    debtLedgerId: string;
    scheduled: boolean;
    reason?: string;
  }>;
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Calculate the aging bucket for a debt based on its due date.
 *
 * @param dueDate - The debt's due date.
 * @param currentDate - Override "now" (useful for testing). Defaults to new Date().
 * @returns One of CURRENT, DAYS_30, DAYS_60, DAYS_90_PLUS.
 */
export function calculateAgingBucket(
  dueDate: Date,
  currentDate: Date = new Date(),
): AgingBucket {
  const due = new Date(dueDate);
  const diffMs = currentDate.getTime() - due.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return AgingBucket.CURRENT;
  if (diffDays <= 30) return AgingBucket.DAYS_30;
  if (diffDays <= 60) return AgingBucket.DAYS_60;
  return AgingBucket.DAYS_90_PLUS;
}

/**
 * Identify customers with debts overdue by more than `daysThreshold` days.
 *
 * Aggregates all overdue DebtLedger rows per customer, returning the customer
 * info, total overdue amount, oldest due date, and the worst aging bucket.
 *
 * @param storeId - The store to scope the query to.
 * @param daysThreshold - Minimum days past due to be included (default 1).
 * @returns Array of OverdueCustomer objects, sorted by totalOverdue desc.
 */
export async function identifyOverdueCustomers(
  storeId: string,
  daysThreshold: number = 1,
): Promise<OverdueCustomer[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);

  // Fetch all outstanding/partial/overdue debt ledgers past the cutoff.
  const debts = await db.debtLedger.findMany({
    where: {
      storeId,
      dueDate: { lt: cutoff },
      status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] },
      balance: { gt: 0 },
    },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  // Group by customer.
  const byCustomer = new Map<string, OverdueCustomer>();
  for (const debt of debts) {
    const bucket = calculateAgingBucket(debt.dueDate);
    let entry = byCustomer.get(debt.customerId);
    if (!entry) {
      entry = {
        customerId: debt.customerId,
        customerName: debt.customer.name,
        phone: debt.customer.phone,
        email: debt.customer.email,
        totalOverdue: 0,
        oldestDueDate: debt.dueDate,
        agingBucket: bucket,
        debts: [],
      };
      byCustomer.set(debt.customerId, entry);
    }
    entry.totalOverdue += debt.balance;
    entry.debts.push({
      debtLedgerId: debt.id,
      balance: debt.balance,
      dueDate: debt.dueDate,
      agingBucket: bucket,
    });
    // Track the worst (oldest) aging bucket.
    if (debt.dueDate < entry.oldestDueDate) {
      entry.oldestDueDate = debt.dueDate;
    }
    const order = [AgingBucket.CURRENT, AgingBucket.DAYS_30, AgingBucket.DAYS_60, AgingBucket.DAYS_90_PLUS];
    if (order.indexOf(bucket) > order.indexOf(entry.agingBucket)) {
      entry.agingBucket = bucket;
    }
  }

  return Array.from(byCustomer.values()).sort((a, b) => b.totalOverdue - a.totalOverdue);
}

/**
 * Determine whether a reminder should be sent for a specific debt, based on
 * its aging bucket and the time elapsed since the last reminder.
 *
 * @param agingBucket - The debt's current aging bucket.
 * @param lastReminderAt - When the last reminder was sent (null = never).
 * @returns True if a reminder is due now.
 */
export function shouldSendReminder(
  agingBucket: AgingBucket,
  lastReminderAt: Date | null,
): boolean {
  const rule = REMINDER_RULES[agingBucket];
  if (rule.minIntervalHours === Infinity || rule.channels.length === 0) {
    return false; // Current debts: never remind.
  }
  if (!lastReminderAt) {
    return true; // Never reminded before.
  }
  const hoursSinceLast = (Date.now() - lastReminderAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceLast >= rule.minIntervalHours;
}

/**
 * Schedule reminder tasks for all eligible overdue debts in a store.
 *
 * This function does NOT send the reminders directly — it creates DebtReminder
 * rows with status PENDING, which are then picked up by the notification
 * service (see src/lib/notification-helpers.ts). This separation allows the
 * scheduling logic to run quickly (no network calls) while the actual message
 * delivery happens asynchronously.
 *
 * @param storeId - The store to process.
 * @returns Summary of scheduled/skipped/errors.
 */
export async function scheduleReminders(storeId: string): Promise<ReminderScheduleResult> {
  const overdueCustomers = await identifyOverdueCustomers(storeId, 1);

  const result: ReminderScheduleResult = {
    totalEligible: 0,
    scheduled: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const customer of overdueCustomers) {
    for (const debt of customer.debts) {
      result.totalEligible++;

      try {
        // Fetch the debt ledger to get lastReminderAt.
        const ledger = await db.debtLedger.findUnique({
          where: { id: debt.debtLedgerId },
          select: { lastReminderAt: true },
        });

        if (!shouldSendReminder(debt.agingBucket, ledger?.lastReminderAt ?? null)) {
          result.skipped++;
          result.details.push({
            customerId: customer.customerId,
            debtLedgerId: debt.debtLedgerId,
            scheduled: false,
            reason: 'Reminder not yet due (interval not elapsed)',
          });
          continue;
        }

        // Create a PENDING DebtReminder row for each channel in the escalation rule.
        const rule = REMINDER_RULES[debt.agingBucket];
        const message = buildReminderMessage(customer.customerName, debt.balance, debt.dueDate, debt.agingBucket);

        for (const channel of rule.channels) {
          await db.debtReminder.create({
            data: {
              storeId,
              customerId: customer.customerId,
              debtLedgerId: debt.debtLedgerId,
              reminderType: channel,
              status: ReminderStatus.PENDING,
              message,
            },
          });
        }

        // Update lastReminderAt on the debt ledger.
        await db.debtLedger.update({
          where: { id: debt.debtLedgerId },
          data: { lastReminderAt: new Date() },
        });

        result.scheduled++;
        result.details.push({
          customerId: customer.customerId,
          debtLedgerId: debt.debtLedgerId,
          scheduled: true,
        });
      } catch (err) {
        result.errors++;
        result.details.push({
          customerId: customer.customerId,
          debtLedgerId: debt.debtLedgerId,
          scheduled: false,
          reason: (err as Error).message,
        });
      }
    }
  }

  await systemLog({
    action: 'DEBT_REMINDERS_SCHEDULED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Scheduled ${result.scheduled} debt reminder(s) for store ${storeId} (${result.skipped} skipped, ${result.errors} errors)`,
    storeId,
    metadata: result,
  });

  return result;
}

/**
 * Build the human-readable reminder message for a debt.
 */
export function buildReminderMessage(
  customerName: string,
  balance: number,
  dueDate: Date,
  agingBucket: AgingBucket,
): string {
  const formattedBalance = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
  }).format(balance);
  const formattedDue = new Date(dueDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const urgency =
    agingBucket === AgingBucket.DAYS_90_PLUS
      ? 'URGENT: Your account is significantly overdue. Please settle immediately to avoid further action.'
      : agingBucket === AgingBucket.DAYS_60
        ? 'This is a second reminder. Please settle your outstanding balance promptly.'
        : 'This is a friendly reminder.';

  return (
    `Dear ${customerName}, ` +
    `${urgency} ` +
    `Your outstanding balance of ${formattedBalance} was due on ${formattedDue}. ` +
    `Please make payment via M-Pesa or visit our store. ` +
    `For queries, call us. Thank you. — MBUMAH HARDWARE`
  );
}
