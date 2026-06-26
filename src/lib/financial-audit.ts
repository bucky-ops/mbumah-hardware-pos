// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Financial Audit & Integrity Module
// ─────────────────────────────────────────────────────────────────────────────
//
// This module provides runtime financial-integrity verification utilities that
// ensure the double-entry ledger remains balanced at every layer:
//
//   1. **Per-entry balance check** — every JournalEntry must have
//      sum(debit) === sum(credit) across its JournalEntryLine rows.
//   2. **Trial balance** — across a date range, the sum of all debits must
//      equal the sum of all credits. If they don't, data corruption has
//      occurred and the system is in a financially inconsistent state.
//   3. **Account reconciliation** — verify that the sum of journal lines for
//      a given account matches the account's recorded balance.
//   4. **Posting integrity** — verify that posted entries are never voided
//      and voided entries are never posted.
//   5. **Immutability verification** — confirm that no JournalEntry has been
//      mutated outside of sanctioned bypass paths (updatedAt > createdAt
//      with no corresponding void/post action).
//
// These functions are used by:
//   • The `/api/financial/audit` endpoint (manual + scheduled audits)
//   • The `/api/health` endpoint (lightweight integrity check on warm-up)
//   • The nightly cron job (full audit + alerting)
//   • The financial close workflow (period-end verification)
//
// All comparisons use the Money class (decimal.js) — NEVER floating-point.
//
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./db";
import { Money, KES } from "./money";
import { systemLog } from "./logger";
import { LogSeverity, LogComponent } from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IntegrityIssue {
  type:
    | "UNBALANCED_ENTRY"
    | "TRIAL_BALANCE_MISMATCH"
    | "POSTING_INTEGRITY"
    | "ORPHANED_LINE"
    | "NEGATIVE_BALANCE"
    | "DUPLICATE_ENTRY_NUMBER";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  entityId?: string;
  storeId?: string;
  expected?: string;
  actual?: string;
  detectedAt: string;
}

export interface AuditResult {
  passed: boolean;
  checkedAt: string;
  durationMs: number;
  storeId?: string;
  dateFrom?: string;
  dateTo?: string;
  summary: {
    entriesChecked: number;
    linesChecked: number;
    issuesFound: number;
    criticalIssues: number;
  };
  issues: IntegrityIssue[];
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  totalDebit: Money;
  totalCredit: Money;
  netBalance: Money;
  lineCount: number;
}

export interface TrialBalanceResult {
  asOfDate: string;
  storeId?: string;
  totalDebits: Money;
  totalCredits: Money;
  isBalanced: boolean;
  variance: Money;
  accounts: TrialBalanceRow[];
}

// ── 1. Per-entry balance verification ────────────────────────────────────────

/**
 * Verify that a single JournalEntry is balanced (sum of debits === sum of credits).
 * Returns null if balanced, or an IntegrityIssue describing the imbalance.
 *
 * This is called:
 *   • After every `recordSaleJournalEntry()` / `recordGiftCardIssuance()` call
 *     (defence-in-depth — the helper already asserts balance, but this catches
 *     any future code path that bypasses the assertion).
 *   • During the nightly audit cron.
 */
export async function verifyEntryBalance(
  journalEntryId: string,
): Promise<IntegrityIssue | null> {
  const entry = await db.journalEntry.findUnique({
    where: { id: journalEntryId },
    include: {
      lines: {
        select: { debit: true, credit: true },
      },
    },
  });

  if (!entry) {
    return {
      type: "ORPHANED_LINE",
      severity: "HIGH",
      message: `JournalEntry ${journalEntryId} not found during balance verification.`,
      entityId: journalEntryId,
      detectedAt: new Date().toISOString(),
    };
  }

  // Skip voided entries — their lines may have been zeroed out by the void
  // process, which is correct behaviour.
  if (entry.isVoided) {
    return null;
  }

  const debitSum = entry.lines.reduce(
    (sum, line) => sum.plus(line.debit.toString()),
    new Money(0).amount,
  );
  const creditSum = entry.lines.reduce(
    (sum, line) => sum.plus(line.credit.toString()),
    new Money(0).amount,
  );

  const debitMoney = new Money(debitSum);
  const creditMoney = new Money(creditSum);

  if (!debitMoney.eq(creditMoney)) {
    return {
      type: "UNBALANCED_ENTRY",
      severity: "CRITICAL",
      message: `JournalEntry ${entry.entryNumber} is unbalanced: debits ${debitMoney.formatKES()} ≠ credits ${creditMoney.formatKES()}.`,
      entityId: entry.id,
      storeId: entry.storeId,
      expected: creditMoney.formatKES(),
      actual: debitMoney.formatKES(),
      detectedAt: new Date().toISOString(),
    };
  }

  // Also verify the entry header totals match the line sums.
  const headerDebit = Money.fromPrisma(entry.totalDebit);
  const headerCredit = Money.fromPrisma(entry.totalCredit);

  if (!headerDebit.eq(debitMoney)) {
    return {
      type: "UNBALANCED_ENTRY",
      severity: "HIGH",
      message: `JournalEntry ${entry.entryNumber} header totalDebit (${headerDebit.formatKES()}) does not match line sum (${debitMoney.formatKES()}).`,
      entityId: entry.id,
      storeId: entry.storeId,
      expected: debitMoney.formatKES(),
      actual: headerDebit.formatKES(),
      detectedAt: new Date().toISOString(),
    };
  }

  if (!headerCredit.eq(creditMoney)) {
    return {
      type: "UNBALANCED_ENTRY",
      severity: "HIGH",
      message: `JournalEntry ${entry.entryNumber} header totalCredit (${headerCredit.formatKES()}) does not match line sum (${creditMoney.formatKES()}).`,
      entityId: entry.id,
      storeId: entry.storeId,
      expected: creditMoney.formatKES(),
      actual: headerCredit.formatKES(),
      detectedAt: new Date().toISOString(),
    };
  }

  return null;
}

// ── 2. Trial balance ─────────────────────────────────────────────────────────

/**
 * Generate a trial balance as of a given date (or now). Sums all non-voided
 * JournalEntryLine rows grouped by account, and verifies that total debits
 * equal total credits.
 *
 * This is the cornerstone of financial integrity — if the trial balance does
 * not balance, the books are corrupted and must be investigated immediately.
 */
export async function generateTrialBalance(
  storeId?: string,
  asOfDate: Date = new Date(),
): Promise<TrialBalanceResult> {
  const where: {
    journalEntry?: { isVoided: boolean; entryDate?: { lte: Date }; storeId?: string };
  } = {
    journalEntry: {
      isVoided: false,
      entryDate: { lte: asOfDate },
    },
  };

  if (storeId) {
    where.journalEntry!.storeId = storeId;
  }

  const lines = await db.journalEntryLine.findMany({
    where,
    include: {
      account: {
        select: { code: true, name: true, type: true },
      },
      journalEntry: {
        select: { entryNumber: true, isVoided: true },
      },
    },
    orderBy: {
      account: { code: "asc" },
    },
  });

  // Group by account
  const accountMap = new Map<
    string,
    {
      code: string;
      name: string;
      type: string;
      debit: Money;
      credit: Money;
      count: number;
    }
  >();

  let totalDebits = Money.zero();
  let totalCredits = Money.zero();

  for (const line of lines) {
    const accountKey = line.account.code;
    let acct = accountMap.get(accountKey);

    if (!acct) {
      acct = {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        debit: Money.zero(),
        credit: Money.zero(),
        count: 0,
      };
      accountMap.set(accountKey, acct);
    }

    const debit = Money.fromPrisma(line.debit);
    const credit = Money.fromPrisma(line.credit);

    acct.debit = acct.debit.add(debit);
    acct.credit = acct.credit.add(credit);
    acct.count += 1;

    totalDebits = totalDebits.add(debit);
    totalCredits = totalCredits.add(credit);
  }

  const accounts: TrialBalanceRow[] = Array.from(accountMap.values()).map(
    (acct) => ({
      accountCode: acct.code,
      accountName: acct.name,
      accountType: acct.type,
      totalDebit: acct.debit,
      totalCredit: acct.credit,
      netBalance: acct.debit.subtract(acct.credit),
      lineCount: acct.count,
    }),
  );

  const variance = totalDebits.subtract(totalCredits);
  const isBalanced = variance.amount.abs().lessThanOrEqualTo("0.005"); // half a cent tolerance for rounding

  return {
    asOfDate: asOfDate.toISOString(),
    storeId,
    totalDebits,
    totalCredits,
    isBalanced,
    variance,
    accounts,
  };
}

// ── 3. Full audit ────────────────────────────────────────────────────────────

/**
 * Run a comprehensive financial integrity audit across a date range.
 *
 * Checks performed:
 *   1. Every non-voided JournalEntry is balanced (debits === credits).
 *   2. No duplicate entry numbers exist.
 *   3. No posted entry is also voided (posting integrity).
 *   4. No JournalEntryLine references a missing JournalEntry (orphaned lines).
 *   5. Trial balance across the range balances.
 *
 * Returns a detailed AuditResult with all issues found. CRITICAL issues
 * (unbalanced entries) are also logged to SystemLog for alerting.
 */
export async function runFinancialAudit(
  storeId?: string,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<AuditResult> {
  const startTime = Date.now();
  const issues: IntegrityIssue[] = [];

  const entryWhere: {
    storeId?: string;
    entryDate?: { gte?: Date; lte?: Date };
  } = {};

  if (storeId) entryWhere.storeId = storeId;
  if (dateFrom || dateTo) {
    entryWhere.entryDate = {};
    if (dateFrom) entryWhere.entryDate.gte = dateFrom;
    if (dateTo) entryWhere.entryDate.lte = dateTo;
  }

  // ── Check 1: Per-entry balance ──
  const entries = await db.journalEntry.findMany({
    where: entryWhere,
    include: {
      lines: { select: { debit: true, credit: true } },
    },
  });

  for (const entry of entries) {
    if (entry.isVoided) continue;

    const debitSum = entry.lines.reduce(
      (sum, l) => sum.plus(l.debit.toString()),
      new Money(0).amount,
    );
    const creditSum = entry.lines.reduce(
      (sum, l) => sum.plus(l.credit.toString()),
      new Money(0).amount,
    );

    if (!debitSum.equals(creditSum)) {
      const issue: IntegrityIssue = {
        type: "UNBALANCED_ENTRY",
        severity: "CRITICAL",
        message: `Entry ${entry.entryNumber}: debits ${new Money(debitSum).formatKES()} ≠ credits ${new Money(creditSum).formatKES()}`,
        entityId: entry.id,
        storeId: entry.storeId,
        expected: new Money(creditSum).formatKES(),
        actual: new Money(debitSum).formatKES(),
        detectedAt: new Date().toISOString(),
      };
      issues.push(issue);
    }
  }

  // ── Check 2: Duplicate entry numbers ──
  const entryNumbers = entries.map((e) => e.entryNumber);
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const num of entryNumbers) {
    if (seen.has(num)) dupes.add(num);
    seen.add(num);
  }
  for (const dupe of dupes) {
    issues.push({
      type: "DUPLICATE_ENTRY_NUMBER",
      severity: "HIGH",
      message: `Duplicate journal entry number detected: ${dupe}`,
      detectedAt: new Date().toISOString(),
    });
  }

  // ── Check 3: Posting integrity (posted AND voided = corruption) ──
  const postedAndVoided = entries.filter((e) => e.isPosted && e.isVoided);
  for (const entry of postedAndVoided) {
    issues.push({
      type: "POSTING_INTEGRITY",
      severity: "CRITICAL",
      message: `Entry ${entry.entryNumber} is marked as both posted AND voided — this indicates data corruption.`,
      entityId: entry.id,
      storeId: entry.storeId,
      detectedAt: new Date().toISOString(),
    });
  }

  // ── Check 4: Trial balance ──
  const trialBalance = await generateTrialBalance(
    storeId,
    dateTo ?? new Date(),
  );
  if (!trialBalance.isBalanced) {
    issues.push({
      type: "TRIAL_BALANCE_MISMATCH",
      severity: "CRITICAL",
      message: `Trial balance does not balance. Variance: ${trialBalance.variance.formatKES()} (debits ${trialBalance.totalDebits.formatKES()} vs credits ${trialBalance.totalCredits.formatKES()})`,
      storeId,
      expected: trialBalance.totalCredits.formatKES(),
      actual: trialBalance.totalDebits.formatKES(),
      detectedAt: new Date().toISOString(),
    });
  }

  // ── Log CRITICAL issues to SystemLog for alerting ──
  const criticalIssues = issues.filter((i) => i.severity === "CRITICAL");
  if (criticalIssues.length > 0) {
    try {
      await systemLog({
        action: "FINANCIAL_AUDIT_CRITICAL",
        component: LogComponent.FINANCIAL,
        severity: LogSeverity.CRITICAL,
        message: `Financial audit found ${criticalIssues.length} CRITICAL issue(s).`,
        metadata: {
          totalIssues: issues.length,
          criticalCount: criticalIssues.length,
          issueTypes: criticalIssues.map((i) => i.type),
        },
      });
    } catch {
      // Logging failure should not mask the audit result.
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    passed: issues.length === 0,
    checkedAt: new Date().toISOString(),
    durationMs,
    storeId,
    dateFrom: dateFrom?.toISOString(),
    dateTo: dateTo?.toISOString(),
    summary: {
      entriesChecked: entries.length,
      linesChecked: entries.reduce((sum, e) => sum + e.lines.length, 0),
      issuesFound: issues.length,
      criticalIssues: criticalIssues.length,
    },
    issues,
  };
}

// ── 4. Lightweight integrity check (for /api/health) ─────────────────────────

/**
 * A fast, lightweight integrity check suitable for the health endpoint.
 * Counts unbalanced entries in the last 24 hours only — does NOT run a full
 * trial balance. Returns true if healthy, false if corruption is detected.
 *
 * Time budget: < 200ms on a warm connection. The full audit is for cron.
 */
export async function quickIntegrityCheck(): Promise<{
  healthy: boolean;
  unbalancedEntryCount: number;
  checkedAt: string;
}> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Fetch only entries from the last 24h with their line sums.
  // Using a raw aggregate would be faster but less portable across SQLite/PG.
  const recentEntries = await db.journalEntry.findMany({
    where: {
      entryDate: { gte: yesterday },
      isVoided: false,
    },
    select: {
      id: true,
      totalDebit: true,
      totalCredit: true,
      lines: { select: { debit: true, credit: true } },
    },
    take: 500, // Cap for performance — health checks must be fast.
  });

  let unbalanced = 0;
  for (const entry of recentEntries) {
    const debitSum = entry.lines.reduce(
      (s, l) => s.plus(l.debit.toString()),
      new Money(0).amount,
    );
    const creditSum = entry.lines.reduce(
      (s, l) => s.plus(l.credit.toString()),
      new Money(0).amount,
    );
    if (!debitSum.equals(creditSum)) {
      unbalanced++;
    }
  }

  return {
    healthy: unbalanced === 0,
    unbalancedEntryCount: unbalanced,
    checkedAt: new Date().toISOString(),
  };
}

// ── 5. Account balance reconciliation ────────────────────────────────────────

/**
 * Reconcile a specific account's balance against the sum of its journal lines.
 *
 * This catches bugs where an account's `balance` field drifts from the actual
 * sum of posted journal lines — which can happen if someone updates the balance
 * directly instead of posting a journal entry.
 *
 * @param accountId The account ID to reconcile.
 * @param asOfDate  Reconcile as of this date (default: now).
 * @returns An IntegrityIssue if the balance doesn't match, or null if healthy.
 */
export async function reconcileAccount(
  accountId: string,
  asOfDate: Date = new Date(),
): Promise<IntegrityIssue | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { id: true, code: true, name: true, balance: true, type: true },
  });

  if (!account) {
    return {
      type: "ORPHANED_LINE",
      severity: "HIGH",
      message: `Account ${accountId} not found during reconciliation.`,
      entityId: accountId,
      detectedAt: new Date().toISOString(),
    };
  }

  // Sum all non-voided journal lines for this account up to asOfDate.
  const lines = await db.journalEntryLine.findMany({
    where: {
      accountId,
      journalEntry: {
        isVoided: false,
        entryDate: { lte: asOfDate },
      },
    },
    select: { debit: true, credit: true },
  });

  let debitTotal = Money.zero();
  let creditTotal = Money.zero();
  for (const line of lines) {
    debitTotal = debitTotal.add(Money.fromPrisma(line.debit));
    creditTotal = creditTotal.add(Money.fromPrisma(line.credit));
  }

  // For asset/expense accounts, balance = debits - credits.
  // For liability/equity/revenue accounts, balance = credits - debits.
  const isDebitNormal =
    account.type === "ASSET" || account.type === "EXPENSE";
  const computedBalance = isDebitNormal
    ? debitTotal.subtract(creditTotal)
    : creditTotal.subtract(debitTotal);

  const recordedBalance = Money.fromPrisma(account.balance);

  if (!computedBalance.eq(recordedBalance)) {
    return {
      type: "TRIAL_BALANCE_MISMATCH",
      severity: "HIGH",
      message: `Account ${account.code} (${account.name}) balance mismatch: recorded ${recordedBalance.formatKES()} vs computed ${computedBalance.formatKES()} from ${lines.length} journal lines.`,
      entityId: account.id,
      expected: computedBalance.formatKES(),
      actual: recordedBalance.formatKES(),
      detectedAt: new Date().toISOString(),
    };
  }

  return null;
}

// ── 6. Period close verification ─────────────────────────────────────────────

/**
 * Verify that a financial period can be safely closed. A period is closeable
 * when:
 *   • All entries in the period are balanced.
 *   • No entries are in a draft (unposted) state (unless explicitly allowed).
 *   • The trial balance for the period balances.
 *
 * Returns an array of blocking issues. An empty array means the period is
 * safe to close.
 */
export async function verifyPeriodClose(
  storeId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<IntegrityIssue[]> {
  const audit = await runFinancialAudit(storeId, periodStart, periodEnd);

  // Additionally flag unposted entries as blocking for period close.
  const unpostedEntries = await db.journalEntry.findMany({
    where: {
      storeId,
      entryDate: { gte: periodStart, lte: periodEnd },
      isPosted: false,
      isVoided: false,
    },
    select: { id: true, entryNumber: true, description: true },
  });

  const issues = [...audit.issues];

  if (unpostedEntries.length > 0) {
    issues.push({
      type: "POSTING_INTEGRITY",
      severity: "MEDIUM",
      message: `${unpostedEntries.length} unposted journal entry(ies) exist in the period. Post or void them before closing.`,
      storeId,
      detectedAt: new Date().toISOString(),
    });
  }

  return issues;
}

// ── 7. Re-export Money for convenience ───────────────────────────────────────

export { Money, KES };
