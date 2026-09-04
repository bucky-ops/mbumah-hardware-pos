// ─────────────────────────────────────────────────────────────────────────────
// Debt management helpers tests
// ─────────────────────────────────────────────────────────────────────────────
//
// Tests for:
//   • debt-helpers: calculateAgingBucket, shouldSendReminder, buildReminderMessage, REMINDER_RULES
//   • debt-plan-utils: calculateInstallmentSchedule, calculateEndDate,
//     calculateInstallmentAmount, getPlanStatus, markOverdueInstallments,
//     recalculatePlanTotals, toNumber, round2, display labels
//
// All tests are pure-logic (no database).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  calculateAgingBucket,
  shouldSendReminder,
  buildReminderMessage,
  REMINDER_RULES,
  AgingBucket,
  ReminderType,
} from '@/lib/debt-helpers';
import {
  calculateInstallmentSchedule,
  calculateEndDate,
  calculateInstallmentAmount,
  getPlanStatus,
  markOverdueInstallments,
  recalculatePlanTotals,
  toNumber,
  round2,
  FREQUENCY_LABELS,
  PLAN_STATUS_LABELS,
  INSTALLMENT_STATUS_LABELS,
  type PlanLike,
  type InstallmentLike,
} from '@/lib/debt-plan-utils';

// ─────────────────────────────────────────────────────────────────────────────
// 1. calculateAgingBucket
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateAgingBucket', () => {
  it('returns CURRENT for future due dates', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30); // 30 days in the future
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.CURRENT);
  });

  it('returns CURRENT for today', () => {
    const now = new Date();
    expect(calculateAgingBucket(now)).toBe(AgingBucket.CURRENT);
  });

  it('returns DAYS_30 for 1-30 days overdue', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 15); // 15 days ago
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.DAYS_30);
  });

  it('returns DAYS_30 for exactly 1 day overdue', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 1);
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.DAYS_30);
  });

  it('returns DAYS_30 for exactly 30 days overdue', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 30);
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.DAYS_30);
  });

  it('returns DAYS_60 for 31-60 days overdue', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 45);
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.DAYS_60);
  });

  it('returns DAYS_60 for exactly 60 days overdue', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 60);
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.DAYS_60);
  });

  it('returns DAYS_90_PLUS for 61+ days overdue', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 90);
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.DAYS_90_PLUS);
  });

  it('returns DAYS_90_PLUS for 365+ days overdue', () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 365);
    expect(calculateAgingBucket(dueDate)).toBe(AgingBucket.DAYS_90_PLUS);
  });

  it('accepts a custom currentDate for testing', () => {
    const dueDate = new Date('2025-01-15');
    const currentDate = new Date('2025-02-01'); // 17 days after
    expect(calculateAgingBucket(dueDate, currentDate)).toBe(AgingBucket.DAYS_30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. shouldSendReminder
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldSendReminder', () => {
  it('never sends reminder for CURRENT debts', () => {
    expect(shouldSendReminder(AgingBucket.CURRENT, null)).toBe(false);
    expect(shouldSendReminder(AgingBucket.CURRENT, new Date('2020-01-01'))).toBe(false);
  });

  it('sends reminder for DAYS_30 when never reminded before', () => {
    expect(shouldSendReminder(AgingBucket.DAYS_30, null)).toBe(true);
  });

  it('does NOT send DAYS_30 reminder within 7-day interval', () => {
    const recent = new Date();
    recent.setHours(recent.getHours() - 3); // 3 hours ago
    expect(shouldSendReminder(AgingBucket.DAYS_30, recent)).toBe(false);
  });

  it('sends DAYS_30 reminder after 7-day interval', () => {
    const old = new Date();
    old.setDate(old.getDate() - 8); // 8 days ago
    expect(shouldSendReminder(AgingBucket.DAYS_30, old)).toBe(true);
  });

  it('does NOT send DAYS_60 reminder within 3-day interval', () => {
    const recent = new Date();
    recent.setHours(recent.getHours() - 48); // 2 days ago
    expect(shouldSendReminder(AgingBucket.DAYS_60, recent)).toBe(false);
  });

  it('sends DAYS_60 reminder after 3-day interval', () => {
    const old = new Date();
    old.setDate(old.getDate() - 4); // 4 days ago
    expect(shouldSendReminder(AgingBucket.DAYS_60, old)).toBe(true);
  });

  it('sends DAYS_90_PLUS reminder after 24-hour interval', () => {
    const old = new Date();
    old.setHours(old.getHours() - 25); // 25 hours ago
    expect(shouldSendReminder(AgingBucket.DAYS_90_PLUS, old)).toBe(true);
  });

  it('does NOT send DAYS_90_PLUS reminder within 24 hours', () => {
    const recent = new Date();
    recent.setHours(recent.getHours() - 12); // 12 hours ago
    expect(shouldSendReminder(AgingBucket.DAYS_90_PLUS, recent)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REMINDER_RULES structure
// ─────────────────────────────────────────────────────────────────────────────

describe('REMINDER_RULES', () => {
  it('defines rules for all 4 aging buckets', () => {
    expect(REMINDER_RULES[AgingBucket.CURRENT]).toBeDefined();
    expect(REMINDER_RULES[AgingBucket.DAYS_30]).toBeDefined();
    expect(REMINDER_RULES[AgingBucket.DAYS_60]).toBeDefined();
    expect(REMINDER_RULES[AgingBucket.DAYS_90_PLUS]).toBeDefined();
  });

  it('CURRENT bucket has Infinity interval and no channels', () => {
    const rule = REMINDER_RULES[AgingBucket.CURRENT];
    expect(rule.minIntervalHours).toBe(Infinity);
    expect(rule.channels).toEqual([]);
    expect(rule.escalateToManager).toBe(false);
  });

  it('DAYS_30 escalation does not alert manager', () => {
    expect(REMINDER_RULES[AgingBucket.DAYS_30].escalateToManager).toBe(false);
  });

  it('DAYS_90_PLUS escalates to manager', () => {
    expect(REMINDER_RULES[AgingBucket.DAYS_90_PLUS].escalateToManager).toBe(true);
  });

  it('escalation intervals increase with severity', () => {
    const d30 = REMINDER_RULES[AgingBucket.DAYS_30].minIntervalHours;
    const d60 = REMINDER_RULES[AgingBucket.DAYS_60].minIntervalHours;
    const d90 = REMINDER_RULES[AgingBucket.DAYS_90_PLUS].minIntervalHours;
    expect(d90).toBeLessThan(d60); // Daily < 3-day
    expect(d60).toBeLessThan(d30); // 3-day < 7-day
  });

  it('DAYS_90_PLUS uses all 3 channels', () => {
    const channels = REMINDER_RULES[AgingBucket.DAYS_90_PLUS].channels;
    expect(channels).toContain(ReminderType.SMS);
    expect(channels).toContain(ReminderType.WHATSAPP);
    expect(channels).toContain(ReminderType.EMAIL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. buildReminderMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReminderMessage', () => {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() - 15);

  it('includes customer name', () => {
    const msg = buildReminderMessage('John Doe', 5000, dueDate, AgingBucket.DAYS_30);
    expect(msg).toContain('John Doe');
  });

  it('includes the balance formatted as currency', () => {
    const msg = buildReminderMessage('Jane', 1234, dueDate, AgingBucket.DAYS_30);
    // Intl.NumberFormat with currency: 'KES' uses "Ksh" prefix
    expect(msg).toContain('Ksh');
  });

  it('includes the due date', () => {
    const msg = buildReminderMessage('Test', 1000, dueDate, AgingBucket.DAYS_30);
    const formattedDue = dueDate.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    expect(msg).toContain(formattedDue);
  });

  it('DAYS_30 uses friendly tone', () => {
    const msg = buildReminderMessage('Test', 1000, dueDate, AgingBucket.DAYS_30);
    expect(msg).toContain('friendly reminder');
  });

  it('DAYS_60 uses second reminder tone', () => {
    const msg = buildReminderMessage('Test', 1000, dueDate, AgingBucket.DAYS_60);
    expect(msg).toContain('second reminder');
  });

  it('DAYS_90_PLUS uses URGENT tone', () => {
    const msg = buildReminderMessage('Test', 1000, dueDate, AgingBucket.DAYS_90_PLUS);
    expect(msg).toContain('URGENT');
  });

  it('includes MBUMAH HARDWARE signature', () => {
    const msg = buildReminderMessage('Test', 1000, dueDate, AgingBucket.DAYS_30);
    expect(msg).toContain('MBUMAH HARDWARE');
  });

  it('mentions M-Pesa as payment method', () => {
    const msg = buildReminderMessage('Test', 1000, dueDate, AgingBucket.DAYS_30);
    expect(msg).toContain('M-Pesa');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. toNumber and round2 (debt-plan-utils)
// ─────────────────────────────────────────────────────────────────────────────

describe('toNumber', () => {
  it('converts a plain number', () => {
    expect(toNumber(42.5)).toBe(42.5);
  });

  it('returns 0 for null', () => {
    expect(toNumber(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(toNumber(undefined)).toBe(0);
  });

  it('parses numeric strings', () => {
    expect(toNumber('99.99')).toBe(99.99);
    expect(toNumber('0')).toBe(0);
  });

  it('returns 0 for non-numeric strings', () => {
    expect(toNumber('abc')).toBe(0);
    expect(toNumber('')).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(toNumber(NaN)).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });

  it('handles Prisma Decimal-like objects with toNumber method', () => {
    const mockDecimal = { toNumber: () => 123.45 };
    expect(toNumber(mockDecimal)).toBe(123.45);
  });
});

describe('round2', () => {
  it('rounds to 2 decimal places', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
  });

  it('handles negative numbers', () => {
    // Task 12-c: round2 is now the canonical financialMath implementation
    // (decimal.js HALF_UP, half AWAY FROM ZERO). The old local float hack
    // (`Math.round((n + EPSILON) * 100)/100`) returned -1.0 for -1.005 only
    // because -1.005 + EPSILON lands just inside the -1.00 bucket — a float
    // artifact, not a rounding policy. Canonical HALF_UP: -1.005 → -1.01.
    // Negative half-cents never occur in schedule math (balances clamp ≥ 0);
    // this assertion pins the canonical policy, not the old artifact.
    expect(round2(-1.005)).toBe(-1.01);
  });

  it('handles zero', () => {
    expect(round2(0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. calculateInstallmentSchedule
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateInstallmentSchedule', () => {
  const startDate = new Date('2025-01-01');

  it('creates the correct number of installments', () => {
    const schedule = calculateInstallmentSchedule(10000, 4, 'MONTHLY', startDate);
    expect(schedule).toHaveLength(4);
  });

  it('each installment has correct fields', () => {
    const schedule = calculateInstallmentSchedule(10000, 3, 'MONTHLY', startDate);
    for (let i = 0; i < schedule.length; i++) {
      expect(schedule[i].installmentNumber).toBe(i + 1);
      expect(schedule[i].amountDue).toBeGreaterThan(0);
      expect(schedule[i].dueDate).toBeInstanceOf(Date);
    }
  });

  it('first installment is on the start date', () => {
    const schedule = calculateInstallmentSchedule(10000, 3, 'MONTHLY', startDate);
    expect(schedule[0].dueDate.getTime()).toBe(startDate.getTime());
  });

  it('installments sum to the total (no lost pennies)', () => {
    const schedule = calculateInstallmentSchedule(1000, 3, 'MONTHLY', startDate);
    const total = schedule.reduce((sum, inst) => sum + inst.amountDue, 0);
    expect(round2(total)).toBeCloseTo(1000, 1); // No interest, so total = 1000
  });

  it('zero interest produces equal installments', () => {
    const schedule = calculateInstallmentSchedule(10000, 4, 'MONTHLY', startDate, 0);
    const amounts = schedule.map((s) => s.amountDue);
    // All amounts should be 2500, except possibly the last (rounding adjustment)
    expect(amounts[0]).toBe(2500);
    expect(amounts[1]).toBe(2500);
  });

  it('interest increases total amount', () => {
    const noInterest = calculateInstallmentSchedule(10000, 12, 'MONTHLY', startDate, 0);
    const withInterest = calculateInstallmentSchedule(10000, 12, 'MONTHLY', startDate, 10);
    const totalNoInterest = noInterest.reduce((s, i) => s + i.amountDue, 0);
    const totalWithInterest = withInterest.reduce((s, i) => s + i.amountDue, 0);
    expect(totalWithInterest).toBeGreaterThan(totalNoInterest);
  });

  it('WEEKLY frequency increments dates by 7 days', () => {
    const schedule = calculateInstallmentSchedule(1000, 3, 'WEEKLY', startDate);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const diff = schedule[1].dueDate.getTime() - schedule[0].dueDate.getTime();
    expect(diff).toBe(weekMs);
  });

  it('BI_WEEKLY frequency increments dates by 14 days', () => {
    const schedule = calculateInstallmentSchedule(1000, 3, 'BI_WEEKLY', startDate);
    const twoWeekMs = 14 * 24 * 60 * 60 * 1000;
    const diff = schedule[1].dueDate.getTime() - schedule[0].dueDate.getTime();
    expect(diff).toBe(twoWeekMs);
  });

  it('MONTHLY frequency increments by 1 month', () => {
    const schedule = calculateInstallmentSchedule(1000, 3, 'MONTHLY', startDate);
    const expected2nd = new Date('2025-02-01');
    const expected3rd = new Date('2025-03-01');
    expect(schedule[1].dueDate.getTime()).toBe(expected2nd.getTime());
    expect(schedule[2].dueDate.getTime()).toBe(expected3rd.getTime());
  });

  it('handles minimum count of 1', () => {
    const schedule = calculateInstallmentSchedule(5000, 0, 'MONTHLY', startDate);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].amountDue).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. calculateEndDate
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateEndDate', () => {
  const startDate = new Date('2025-01-01');

  it('returns the start date for 1 installment', () => {
    const end = calculateEndDate(startDate, 1, 'MONTHLY');
    expect(end.getTime()).toBe(startDate.getTime());
  });

  it('returns 3 months later for 3 MONTHLY installments', () => {
    const end = calculateEndDate(startDate, 3, 'MONTHLY');
    expect(end).toEqual(new Date('2025-03-01'));
  });

  it('returns 2 weeks later for 2 BI_WEEKLY installments', () => {
    const end = calculateEndDate(startDate, 2, 'BI_WEEKLY');
    const expected = new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
    expect(end).toEqual(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. calculateInstallmentAmount
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateInstallmentAmount', () => {
  it('divides evenly without interest', () => {
    expect(calculateInstallmentAmount(1000, 4, 0)).toBe(250);
  });

  it('adds interest to the amount', () => {
    const withInterest = calculateInstallmentAmount(1000, 12, 10);
    const without = calculateInstallmentAmount(1000, 12, 0);
    expect(withInterest).toBeGreaterThan(without);
  });

  it('handles minimum count of 1', () => {
    expect(calculateInstallmentAmount(5000, 0, 0)).toBe(5000);
  });

  it('rounds to 2 decimal places', () => {
    const amount = calculateInstallmentAmount(1000, 3, 0);
    // 1000 / 3 = 333.333... → should be 333.33
    expect(round2(amount * 3)).toBeCloseTo(1000, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. getPlanStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('getPlanStatus', () => {
  it('preserves PENDING_APPROVAL', () => {
    const plan = { status: 'PENDING_APPROVAL', installmentCount: 6, installmentsPaid: 0, installmentsOverdue: 0, amountPaid: 0, balance: 10000, totalAmount: 10000 };
    expect(getPlanStatus(plan as PlanLike)).toBe('PENDING_APPROVAL');
  });

  it('preserves CANCELLED', () => {
    const plan = { status: 'CANCELLED', installmentCount: 6, installmentsPaid: 2, installmentsOverdue: 0, amountPaid: 5000, balance: 5000, totalAmount: 10000 };
    expect(getPlanStatus(plan as PlanLike)).toBe('CANCELLED');
  });

  it('preserves PAUSED', () => {
    const plan = { status: 'PAUSED', installmentCount: 6, installmentsPaid: 3, installmentsOverdue: 0, amountPaid: 5000, balance: 5000, totalAmount: 10000 };
    expect(getPlanStatus(plan as PlanLike)).toBe('PAUSED');
  });

  it('returns COMPLETED when balance <= 0.001', () => {
    const plan = { status: 'ACTIVE', installmentCount: 6, installmentsPaid: 6, installmentsOverdue: 0, amountPaid: 10000, balance: 0, totalAmount: 10000 };
    expect(getPlanStatus(plan as PlanLike)).toBe('COMPLETED');
  });

  it('returns COMPLETED when balance is tiny (rounding residual)', () => {
    const plan = { status: 'ACTIVE', installmentCount: 6, installmentsPaid: 6, installmentsOverdue: 0, amountPaid: 9999.999, balance: 0.001, totalAmount: 10000 };
    expect(getPlanStatus(plan as PlanLike)).toBe('COMPLETED');
  });

  it('returns DEFAULTED when 25%+ installments are overdue', () => {
    const plan = { status: 'ACTIVE', installmentCount: 4, installmentsPaid: 1, installmentsOverdue: 2, amountPaid: 2500, balance: 7500, totalAmount: 10000 };
    // 2/4 = 50% overdue → DEFAULTED
    expect(getPlanStatus(plan as PlanLike)).toBe('DEFAULTED');
  });

  it('returns ACTIVE when less than 25% installments are overdue', () => {
    const plan = { status: 'ACTIVE', installmentCount: 8, installmentsPaid: 3, installmentsOverdue: 1, amountPaid: 3750, balance: 6250, totalAmount: 10000 };
    // 1/8 = 12.5% overdue → still ACTIVE
    expect(getPlanStatus(plan as PlanLike)).toBe('ACTIVE');
  });

  it('returns ACTIVE when no overdue installments', () => {
    const plan = { status: 'ACTIVE', installmentCount: 6, installmentsPaid: 3, installmentsOverdue: 0, amountPaid: 5000, balance: 5000, totalAmount: 10000 };
    expect(getPlanStatus(plan as PlanLike)).toBe('ACTIVE');
  });

  it('exactly 25% overdue triggers DEFAULTED', () => {
    const plan = { status: 'ACTIVE', installmentCount: 4, installmentsPaid: 2, installmentsOverdue: 1, amountPaid: 5000, balance: 5000, totalAmount: 10000 };
    // 1/4 = 0.25 → 0.25 >= 0.25 → DEFAULTED
    expect(getPlanStatus(plan as PlanLike)).toBe('DEFAULTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. markOverdueInstallments
// ─────────────────────────────────────────────────────────────────────────────

describe('markOverdueInstallments', () => {
  const pastDate = new Date('2025-01-01');
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);

  it('marks past-due SCHEDULED installments as OVERDUE', () => {
    const installments = [
      { id: '1', status: 'SCHEDULED', dueDate: pastDate, amountDue: 1000, amountPaid: 0 },
      { id: '2', status: 'SCHEDULED', dueDate: futureDate, amountDue: 1000, amountPaid: 0 },
    ] as InstallmentLike[];

    const result = markOverdueInstallments(installments);
    expect(result[0].status).toBe('OVERDUE');
    expect(result[1].status).toBe('SCHEDULED');
  });

  it('does not mutate the input array', () => {
    const installments = [
      { id: '1', status: 'SCHEDULED', dueDate: pastDate, amountDue: 1000, amountPaid: 0 },
    ] as InstallmentLike[];

    markOverdueInstallments(installments);
    expect(installments[0].status).toBe('SCHEDULED'); // unchanged
  });

  it('skips PAID installments', () => {
    const installments = [
      { id: '1', status: 'PAID', dueDate: pastDate, amountDue: 1000, amountPaid: 1000 },
    ] as InstallmentLike[];

    const result = markOverdueInstallments(installments);
    expect(result[0].status).toBe('PAID');
  });

  it('skips WAIVED installments', () => {
    const installments = [
      { id: '1', status: 'WAIVED', dueDate: pastDate, amountDue: 1000, amountPaid: 1000 },
    ] as InstallmentLike[];

    const result = markOverdueInstallments(installments);
    expect(result[0].status).toBe('WAIVED');
  });

  it('does not double-mark already OVERDUE installments', () => {
    const installments = [
      { id: '1', status: 'OVERDUE', dueDate: pastDate, amountDue: 1000, amountPaid: 0 },
    ] as InstallmentLike[];

    const result = markOverdueInstallments(installments);
    expect(result[0].status).toBe('OVERDUE');
  });

  it('accepts a custom now date for testing', () => {
    const dueDate = new Date('2025-01-15');
    const now = new Date('2025-01-20');

    const installments = [
      { id: '1', status: 'SCHEDULED', dueDate, amountDue: 1000, amountPaid: 0 },
    ] as InstallmentLike[];

    const result = markOverdueInstallments(installments, now);
    expect(result[0].status).toBe('OVERDUE');
  });

  it('does not mark as overdue if not yet due', () => {
    const dueDate = new Date('2025-01-15');
    const now = new Date('2025-01-10'); // before due date

    const installments = [
      { id: '1', status: 'SCHEDULED', dueDate, amountDue: 1000, amountPaid: 0 },
    ] as InstallmentLike[];

    const result = markOverdueInstallments(installments, now);
    expect(result[0].status).toBe('SCHEDULED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. recalculatePlanTotals
// ─────────────────────────────────────────────────────────────────────────────

describe('recalculatePlanTotals', () => {
  const plan = {
    status: 'ACTIVE',
    installmentCount: 4,
    installmentsPaid: 0,
    installmentsOverdue: 0,
    amountPaid: 0,
    balance: 10000,
    totalAmount: 10000,
  } as PlanLike;

  it('counts PAID installments correctly', () => {
    const installments = [
      { id: '1', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 2500 },
      { id: '2', status: 'SCHEDULED', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
      { id: '3', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 2500 },
      { id: '4', status: 'OVERDUE', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
    ] as InstallmentLike[];

    const totals = recalculatePlanTotals(plan, installments);
    expect(totals.installmentsPaid).toBe(2);
  });

  it('counts OVERDUE installments correctly', () => {
    const installments = [
      { id: '1', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 2500 },
      { id: '2', status: 'OVERDUE', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
      { id: '3', status: 'OVERDUE', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
      { id: '4', status: 'SCHEDULED', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
    ] as InstallmentLike[];

    const totals = recalculatePlanTotals(plan, installments);
    expect(totals.installmentsOverdue).toBe(2);
  });

  it('sums amountPaid from all installments', () => {
    const installments = [
      { id: '1', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 2500 },
      { id: '2', status: 'PARTIAL', dueDate: new Date(), amountDue: 2500, amountPaid: 1000 },
      { id: '3', status: 'SCHEDULED', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
      { id: '4', status: 'SCHEDULED', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
    ] as InstallmentLike[];

    const totals = recalculatePlanTotals(plan, installments);
    expect(totals.amountPaid).toBe(3500);
  });

  it('computes balance as totalAmount - amountPaid', () => {
    const installments = [
      { id: '1', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 2500 },
      { id: '2', status: 'SCHEDULED', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
      { id: '3', status: 'SCHEDULED', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
      { id: '4', status: 'SCHEDULED', dueDate: new Date(), amountDue: 2500, amountPaid: 0 },
    ] as InstallmentLike[];

    const totals = recalculatePlanTotals(plan, installments);
    expect(totals.balance).toBe(7500);
  });

  it('clamps balance to >= 0', () => {
    const installments = [
      { id: '1', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 3000 },
      { id: '2', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 3000 },
      { id: '3', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 3000 },
      { id: '4', status: 'PAID', dueDate: new Date(), amountDue: 2500, amountPaid: 3000 },
    ] as InstallmentLike[];

    const totals = recalculatePlanTotals(plan, installments);
    expect(totals.balance).toBeGreaterThanOrEqual(0);
  });

  it('handles empty installments array', () => {
    const totals = recalculatePlanTotals(plan, []);
    expect(totals.amountPaid).toBe(0);
    expect(totals.balance).toBe(10000);
    expect(totals.installmentsPaid).toBe(0);
    expect(totals.installmentsOverdue).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Display labels
// ─────────────────────────────────────────────────────────────────────────────

describe('Display labels', () => {
  it('FREQUENCY_LABELS has all frequencies', () => {
    expect(FREQUENCY_LABELS.WEEKLY).toBe('Weekly');
    expect(FREQUENCY_LABELS.BI_WEEKLY).toBe('Bi-Weekly');
    expect(FREQUENCY_LABELS.MONTHLY).toBe('Monthly');
  });

  it('PLAN_STATUS_LABELS has all statuses', () => {
    expect(PLAN_STATUS_LABELS.PENDING_APPROVAL).toBe('Pending Approval');
    expect(PLAN_STATUS_LABELS.ACTIVE).toBe('Active');
    expect(PLAN_STATUS_LABELS.COMPLETED).toBe('Completed');
    expect(PLAN_STATUS_LABELS.DEFAULTED).toBe('Defaulted');
    expect(PLAN_STATUS_LABELS.CANCELLED).toBe('Cancelled');
    expect(PLAN_STATUS_LABELS.PAUSED).toBe('Paused');
  });

  it('INSTALLMENT_STATUS_LABELS has all statuses', () => {
    expect(INSTALLMENT_STATUS_LABELS.SCHEDULED).toBe('Scheduled');
    expect(INSTALLMENT_STATUS_LABELS.PAID).toBe('Paid');
    expect(INSTALLMENT_STATUS_LABELS.PARTIAL).toBe('Partial');
    expect(INSTALLMENT_STATUS_LABELS.OVERDUE).toBe('Overdue');
    expect(INSTALLMENT_STATUS_LABELS.MISSED).toBe('Missed');
    expect(INSTALLMENT_STATUS_LABELS.WAIVED).toBe('Waived');
  });
});
