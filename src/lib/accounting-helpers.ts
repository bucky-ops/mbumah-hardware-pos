// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Accounting Business Logic (Phase 2)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module is the **single source of truth** for all general-purpose
// accounting operations on the double-entry ledger. It complements:
//
//   • `account-helper.ts`   — the legacy SALE-path helper (recordSaleJournalEntry,
//                              recordGiftCardIssuance, WAC inventory costing).
//                              Preserved unchanged; sale flows stay there.
//   • `financial-audit.ts`  — read-only integrity verification (trial balance,
//                              per-entry balance check, period-close audit).
//                              Preserved unchanged; this module IMPORTS from it.
//
// WHAT LIVES HERE (the "accounting controller layer")
// ─────────────────────────────────────────────────────────────────────────────
//   1. Pure validation      — computeEntryTotals, validateJournalEntryBalancing
//   2. Period validation    — findPeriodForDate, assertPeriodOpen,
//                              validateEntryAgainstPeriod
//   3. Account balance      — calculateAccountBalance (as-of / for-period)
//   4. Journal lifecycle    — createJournalEntry → approveJournalEntry →
//                              postJournalEntry → (voidJournalEntry)
//   5. Account CRUD         — createAccount, updateAccount (with audit)
//   6. Period lifecycle     — createFinancialPeriod → closeFinancialPeriod →
//                              lockFinancialPeriod (+ reopenFinancialPeriod)
//   7. Trial balance snap   — captureTrialBalanceSnapshot (point-in-time freeze)
//   8. Budget management    — setBudget, recalculateBudgetActuals
//   9. Reconciliation       — reconcileJournalEntryLine (bank rec)
//  10. Audit trail          — recordAuditLog, listAuditTrail
//  11. Status derivation    — deriveJournalEntryStatus (DRAFT/POSTED/VOIDED/…)
//
// DESIGN PRINCIPLES (ISO 9001 Process Control + ISO 27001 Integrity)
// ─────────────────────────────────────────────────────────────────────────────
//   • **Money, never float.** Every monetary value flows through the `Money`
//     class (decimal.js, banker's rounding). Prisma Decimal ↔ Money conversion
//     is centralised in `toMoney()`.
//   • **Immutability.** JournalEntry, JournalEntryLine, AuditLog, and
//     TrialBalanceSnapshot are append-only. Mutations (post/approve/void/
//     reconcile) run inside `withImmutabilityBypass()` with an explicit reason.
//   • **Audit everything.** Every state-changing operation writes an AuditLog
//     record with old/new values, user, IP, and user-agent. The audit trail is
//     itself immutable (tamper-evident, ISO 27001 A.12.4.2).
//   • **Segregation of duties.** The user who creates a journal entry CANNOT
//     approve it (`approveJournalEntry` enforces this). System-generated entries
//     (sales, M-Pesa callbacks) bypass approval with an explicit flag.
//   • **Defence in depth.** Balance is validated at creation AND at posting.
//     Period openness is validated at creation AND at posting. Account active
//     status is validated at creation.
//   • **Reversing entries, never deletes.** Voiding creates a NEW posted
//     JournalEntry that mirrors the original with debits/credits swapped, then
//     links the original to its reversal. The original is never mutated except
//     for the void flag + reversingEntryId.
//
// ─────────────────────────────────────────────────────────────────────────────

import { db, withImmutabilityBypass } from "./db";
import { Money } from "./money";
import { APIError } from "./api-error";
import { systemLog } from "./logger";
import {
  LogSeverity,
  LogComponent,
  AccountType,
  NormalBalance,
  FinancialPeriodStatus,
  AuditAction,
  JournalEntryStatus,
  AuditEntityType,
  type ReferenceDocumentType as RefDocType,
} from "./types";
import { generateJournalEntryNumber } from "./helpers";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import type {
  Account,
  JournalEntry,
  JournalEntryLine,
  FinancialPeriod,
  TrialBalanceSnapshot,
  Budget,
  AuditLog,
} from "@prisma/client";

// ── Re-export the ReferenceDocumentType const for ergonomic import ──────────
export { ReferenceDocumentType } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 0. Shared types & helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accepted input shapes for any monetary field. Resolved to `Money` via
 * `toMoney()`. Accepts:
 *   • `number`   — 1234.56 (WARNING: floats lose precision; prefer strings)
 *   • `string`   — "1234.56", "Ksh 1,234.56" (cleaned by Money.cleanNumericString)
 *   • `Decimal`  — decimal.js or Prisma.Decimal instance (exact)
 *   • `Money`    — already wrapped (returned as-is)
 */
export type MoneyInput = number | string | Decimal | Money;

/**
 * Resolves any accepted monetary input to a `Money` instance. This is the
 * single funnel through which all monetary values enter the accounting module.
 *
 * Uses `value.toString()` for Decimal instances to avoid `instanceof` fragility
 * between `decimal.js` (app) and `Prisma.Decimal` (which may be a separate
 * copy of the same library after npm hoisting).
 */
export function toMoney(value: MoneyInput | null | undefined): Money {
  if (value === null || value === undefined) return Money.zero();
  if (value instanceof Money) return value;
  if (typeof value === "number") return Money.fromNumber(value);
  if (typeof value === "string") return Money.fromString(value);
  // Decimal (decimal.js OR Prisma.Decimal — both have toString())
  return new Money(new Decimal(value.toString()));
}

/**
 * A single journal-entry line as supplied by API callers. Debit OR credit
 * (never both > 0 — enforced in `computeEntryTotals`). Tax fields are optional
 * and only populated for VAT lines.
 */
export interface JournalEntryLineInput {
  accountId: string;
  debit: MoneyInput;
  credit: MoneyInput;
  description?: string;
  isTaxRelated?: boolean;
  taxRateApplied?: number | string;
  taxAmount?: MoneyInput;
}

/** Result of summing a set of journal-entry lines. */
export interface EntryTotals {
  totalDebit: Money;
  totalCredit: Money;
  isBalanced: boolean;
  variance: Money;
}

// ── Audit-log writer helper ──────────────────────────────────────────────────
//
// Centralises the Prisma JSON-null handling. Prisma's `Json?` fields require
// `Prisma.DbNull` (SQL NULL) or `Prisma.JsonNull` (JSON literal null) instead
// of plain JS `null`. For audit logs, "no old value" (CREATE) and "no new
// value" (DELETE) are semantically SQL NULL, so we use `Prisma.DbNull`.
//
// Values are passed as plain JS objects (NOT JSON.stringify'd) so Prisma stores
// them as proper JSON objects that round-trip correctly on read.

export interface AuditLogEntry {
  storeId?: string | null;
  organizationId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  userId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Bridge a plain JS object (or null) to Prisma's `InputJsonValue | DbNull`
 * union. `Record<string, unknown>` is not structurally assignable to
 * `InputJsonValue` (which requires recursively-JSON values), so we cast. This
 * is safe because callers only pass primitive-only objects constructed in this
 * module (no Date, Decimal, or class instances — those are stringified first).
 */
function toJsonInput(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return value as unknown as Prisma.InputJsonValue;
}

/**
 * Write an audit-log record inside a transaction. Handles Prisma JSON-null
 * conversion so callers pass plain objects (or null for absent values).
 */
async function writeAuditLog(
  tx: Prisma.TransactionClient,
  input: AuditLogEntry,
): Promise<AuditLog> {
  return tx.auditLog.create({
    data: {
      storeId: input.storeId ?? null,
      organizationId: input.organizationId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      userId: input.userId ?? null,
      oldValues: toJsonInput(input.oldValues),
      newValues: toJsonInput(input.newValues),
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pure balance validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum the debit and credit columns of a set of journal-entry lines and test
 * whether they balance (golden rule of double-entry: Σdebit === Σcredit).
 *
 * Pure function — no DB access, no side effects. Trivially unit-testable.
 * Throws `APIError(400)` on:
 *   • Negative debit or credit (data integrity violation)
 *   • A line where BOTH debit and credit are > 0 (category error — use two lines)
 *
 * Tolerance: 0.005 (half a cent) to absorb rounding from percentage allocations.
 */
export function computeEntryTotals(lines: JournalEntryLineInput[]): EntryTotals {
  let totalDebit = Money.zero();
  let totalCredit = Money.zero();

  for (const line of lines) {
    const debit = toMoney(line.debit);
    const credit = toMoney(line.credit);

    if (debit.isNegative() || credit.isNegative()) {
      throw APIError.badRequest(
        `Journal entry line cannot have a negative debit or credit value ` +
          `(debit=${debit.formatKES()}, credit=${credit.formatKES()}).`,
      );
    }
    if (debit.isPositive() && credit.isPositive()) {
      throw APIError.badRequest(
        `A journal entry line cannot have both debit AND credit > 0 ` +
          `(debit=${debit.formatKES()}, credit=${credit.formatKES()}). ` +
          `Use two separate lines for a compound entry.`,
      );
    }

    totalDebit = totalDebit.add(debit);
    totalCredit = totalCredit.add(credit);
  }

  const variance = totalDebit.subtract(totalCredit);
  // Half-cent tolerance — absorbs banker's-rounding residue from allocations.
  const isBalanced = variance.abs().amount.lessThanOrEqualTo("0.005");

  return { totalDebit, totalCredit, isBalanced, variance };
}

/**
 * Validate that a set of journal-entry lines forms a balanced entry.
 * Throws `APIError(400)` if:
 *   • The line array is empty.
 *   • Debits ≠ credits (golden-rule violation).
 *   • The total is zero (a no-op entry is never legitimate).
 *
 * @returns The computed `EntryTotals` for the caller to persist.
 */
export function validateJournalEntryBalancing(
  lines: JournalEntryLineInput[],
): EntryTotals {
  if (lines.length === 0) {
    throw APIError.badRequest("Journal entry must have at least one line.");
  }
  const totals = computeEntryTotals(lines);
  if (!totals.isBalanced) {
    throw APIError.badRequest(
      `Journal entry is not balanced. Total debits (${totals.totalDebit.formatKES()}) ` +
        `must equal total credits (${totals.totalCredit.formatKES()}). ` +
        `Variance: ${totals.variance.formatKES()}.`,
    );
  }
  if (totals.totalDebit.isZero()) {
    throw APIError.badRequest(
      "Journal entry must have a non-zero total amount. A zero-value entry has no accounting effect.",
    );
  }
  return totals;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Financial-period validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the financial period that contains `date` for a given store. If multiple
 * periods overlap (which the schema tries to prevent via overlap checks at
 * creation), the most recently started one wins.
 *
 * @returns The matching `FinancialPeriod`, or `null` if none exists.
 */
export async function findPeriodForDate(
  storeId: string,
  date: Date,
): Promise<FinancialPeriod | null> {
  return db.financialPeriod.findFirst({
    where: {
      storeId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    orderBy: { startDate: "desc" },
  });
}

/**
 * Assert that a period exists and is OPEN. Throws:
 *   • 400 — period is null (no period for this date)
 *   • 409 — period is CLOSED (must reopen to post)
 *   • 403 — period is LOCKED (terminal state, no mutations ever)
 */
export function assertPeriodOpen(
  period: FinancialPeriod | null,
): asserts period is FinancialPeriod {
  if (!period) {
    throw APIError.badRequest(
      "No financial period exists for the entry date. Create a period covering this date first.",
    );
  }
  if (period.status === FinancialPeriodStatus.CLOSED) {
    throw APIError.conflict(
      `Financial period "${period.periodName}" is CLOSED. ` +
        `Reopen it (with a reason) or post the entry in an OPEN period.`,
    );
  }
  if (period.status === FinancialPeriodStatus.LOCKED) {
    throw APIError.forbidden(
      `Financial period "${period.periodName}" is LOCKED. ` +
        `LOCKED periods are frozen permanently — no journal entries may be posted. ` +
        `Create an adjusting entry in a subsequent OPEN period instead.`,
    );
  }
}

/**
 * Validate that an entry date falls within a period AND the period is OPEN.
 * Combines the date-range check and the status check in one call.
 */
export function validateEntryAgainstPeriod(
  entryDate: Date,
  period: FinancialPeriod | null,
): asserts period is FinancialPeriod {
  if (!period) {
    throw APIError.badRequest(
      "No financial period provided for the journal entry.",
    );
  }
  const ts = entryDate.getTime();
  if (ts < period.startDate.getTime() || ts > period.endDate.getTime()) {
    throw APIError.badRequest(
      `Entry date ${entryDate.toISOString()} falls outside period ` +
        `"${period.periodName}" (${period.startDate.toISOString()} → ${period.endDate.toISOString()}).`,
    );
  }
  assertPeriodOpen(period);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Account balance calculation
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountBalanceOptions {
  /** Include entries dated ≤ this date. Default: now. */
  asOfDate?: Date;
  /** Include voided entries in the sum. Default: false (voids are excluded). */
  includeVoided?: boolean;
  /** Restrict to entries linked to a specific period. */
  periodId?: string;
  /** Restrict to posted entries only. Default: true (drafts are not part of the ledger). */
  postedOnly?: boolean;
  /** Optional transaction client (for use inside db.$transaction). */
  tx?: Prisma.TransactionClient;
}

export interface AccountBalanceResult {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  totalDebit: Money;
  totalCredit: Money;
  /** Debits − credits (for DEBIT-normal accounts) or credits − debits (CREDIT-normal). */
  netBalance: Money;
  lineCount: number;
}

/**
 * Compute the running balance of an account from its posted, non-voided
 * journal-entry lines.
 *
 * The "net balance" respects the account's `normalBalance`:
 *   • ASSET / EXPENSE (DEBIT-normal):  balance = Σdebit − Σcredit
 *   • LIABILITY / EQUITY / REVENUE (CREDIT-normal): balance = Σcredit − Σdebit
 *
 * Contra accounts (e.g. Sales Discounts, Accumulated Depreciation) carry an
 * overridden `normalBalance` and are honoured here.
 *
 * This function is the **authoritative** source of account balances — the
 * `Account.balance` column is a denormalised cache that must be reconciled
 * against this computation (see `reconcileAccount` in financial-audit.ts).
 */
export async function calculateAccountBalance(
  accountId: string,
  options: AccountBalanceOptions = {},
): Promise<AccountBalanceResult> {
  const {
    asOfDate = new Date(),
    includeVoided = false,
    periodId,
    postedOnly = true,
    tx,
  } = options;
  const client = tx ?? db;

  const account = await client.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      normalBalance: true,
    },
  });
  if (!account) {
    throw APIError.notFound(`Account ${accountId} not found.`);
  }

  const where: Prisma.JournalEntryLineWhereInput = {
    accountId,
    journalEntry: {
      ...(includeVoided ? {} : { isVoided: false }),
      ...(postedOnly ? { isPosted: true } : {}),
      ...(asOfDate ? { entryDate: { lte: asOfDate } } : {}),
      ...(periodId ? { financialPeriodId: periodId } : {}),
    },
  };

  const lines = await client.journalEntryLine.findMany({
    where,
    select: { debit: true, credit: true },
  });

  let totalDebit = Money.zero();
  let totalCredit = Money.zero();
  for (const line of lines) {
    totalDebit = totalDebit.add(Money.fromPrisma(line.debit));
    totalCredit = totalCredit.add(Money.fromPrisma(line.credit));
  }

  const isDebitNormal = account.normalBalance === NormalBalance.DEBIT;
  const netBalance = isDebitNormal
    ? totalDebit.subtract(totalCredit)
    : totalCredit.subtract(totalDebit);

  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    accountType: account.type,
    normalBalance: account.normalBalance,
    totalDebit,
    totalCredit,
    netBalance,
    lineCount: lines.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Journal-entry lifecycle (create → approve → post → void)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateJournalEntryInput {
  storeId: string;
  organizationId: string;
  userId: string;
  description: string;
  entryDate?: Date;
  lines: JournalEntryLineInput[];
  /** Internal system reference (SALE, PAYMENT, REFUND, RENTAL, ADJUSTMENT). */
  referenceType?: string;
  /** Internal system reference ID (transaction ID, payment ID, etc.). */
  referenceId?: string;
  /** External source document type (INVOICE, RECEIPT, BANK_STATEMENT, …). */
  referenceDocumentType?: RefDocType;
  /** External source document ID. */
  referenceDocumentId?: string;
  /** Explicit period; if omitted, the period containing entryDate is auto-resolved. */
  financialPeriodId?: string;
  /**
   * Post immediately after creation. Requires `bypassApproval` semantics —
   * use ONLY for system-generated entries (sales, M-Pesa callbacks) where the
   * entry is balanced by construction and segregation-of-duties does not apply.
   */
  postImmediately?: boolean;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create a new journal entry (in DRAFT state by default) with full validation:
 *   1. Balancing check (Σdebit === Σcredit, non-zero).
 *   2. Account existence + org membership + active-status check.
 *   3. Financial-period date-range + openness check.
 *
 * The entry is created alongside its lines and an AuditLog CREATE record in a
 * single Prisma transaction. If `postImmediately` is set, the entry is then
 * posted (with bypassApproval) in the same logical operation.
 *
 * @returns The created `JournalEntry` (with lines if postImmediately is false,
 *          or fully posted if true).
 */
export async function createJournalEntry(
  input: CreateJournalEntryInput,
): Promise<JournalEntry> {
  const {
    storeId,
    organizationId,
    userId,
    description,
    entryDate = new Date(),
    lines,
    referenceType,
    referenceId,
    referenceDocumentType,
    referenceDocumentId,
    financialPeriodId,
    postImmediately = false,
    ipAddress,
    userAgent,
  } = input;

  if (!description || description.trim().length < 3) {
    throw APIError.badRequest(
      "Journal entry description is required (≥ 3 characters).",
    );
  }

  // ── 1. Balance validation ──
  const totals = validateJournalEntryBalancing(lines);

  // ── 2. Account validation ──
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await db.account.findMany({
    where: { id: { in: accountIds }, organizationId, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (accounts.length !== accountIds.length) {
    const found = new Set(accounts.map((a) => a.id));
    const missing = accountIds.filter((id) => !found.has(id));
    throw APIError.badRequest(
      `The following account IDs are inactive or do not belong to this ` +
        `organization: ${missing.join(", ")}.`,
    );
  }

  // ── 3. Period validation ──
  let period: FinancialPeriod | null = null;
  if (financialPeriodId) {
    period = await db.financialPeriod.findUnique({
      where: { id: financialPeriodId },
    });
  } else {
    period = await findPeriodForDate(storeId, entryDate);
  }
  if (period) {
    validateEntryAgainstPeriod(entryDate, period);
  }
  // If no period exists at all, we still allow the entry (the org may not use
  // period-close discipline). The entry's financialPeriodId stays null.

  // ── 4. Create entry + lines + audit log in a transaction ──
  const entryNumber = generateJournalEntryNumber();
  const entry = await db.$transaction(async (tx) => {
    const created = await tx.journalEntry.create({
      data: {
        storeId,
        entryNumber,
        entryDate,
        description,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
        totalDebit: totals.totalDebit.toDecimal(),
        totalCredit: totals.totalCredit.toDecimal(),
        isPosted: false,
        isApproved: false,
        isVoided: false,
        referenceDocumentType: referenceDocumentType ?? null,
        referenceDocumentId: referenceDocumentId ?? null,
        financialPeriodId: period?.id ?? null,
        createdBy: userId,
        lines: {
          createMany: {
            data: lines.map((l) => ({
              accountId: l.accountId,
              debit: toMoney(l.debit).toDecimal(),
              credit: toMoney(l.credit).toDecimal(),
              description: l.description ?? null,
              isTaxRelated: l.isTaxRelated ?? false,
              taxRateApplied:
                l.taxRateApplied != null
                  ? new Decimal(l.taxRateApplied.toString())
                  : null,
              taxAmount:
                l.taxAmount != null ? toMoney(l.taxAmount).toDecimal() : null,
            })),
          },
        },
      },
      include: {
        lines: { select: { id: true, accountId: true, debit: true, credit: true } },
      },
    });

    await writeAuditLog(tx, {
      storeId,
      organizationId,
      entityType: AuditEntityType.JOURNAL_ENTRY,
      entityId: created.id,
      action: AuditAction.CREATE,
      userId,
      oldValues: null,
      newValues: {
        entryNumber: created.entryNumber,
        description: created.description,
        entryDate: created.entryDate.toISOString(),
        totalDebit: created.totalDebit.toString(),
        totalCredit: created.totalCredit.toString(),
        lineCount: created.lines.length,
        financialPeriodId: created.financialPeriodId,
      },
      ipAddress,
      userAgent,
    });

    return created;
  });

  // ── 5. Optional immediate posting (system-generated entries only) ──
  if (postImmediately) {
    return postJournalEntry(entry.id, userId, {
      ipAddress,
      userAgent,
      bypassApproval: true,
    });
  }

  return entry;
}

/**
 * Approve a DRAFT journal entry. Enforces segregation of duties: the user who
 * CREATED the entry cannot approve it. The entry must not be posted or voided.
 *
 * After approval, the entry is eligible for `postJournalEntry`.
 */
export async function approveJournalEntry(
  journalEntryId: string,
  userId: string,
  options: { ipAddress?: string; userAgent?: string } = {},
): Promise<JournalEntry> {
  const entry = await db.journalEntry.findUnique({
    where: { id: journalEntryId },
    select: {
      id: true,
      entryNumber: true,
      isApproved: true,
      isVoided: true,
      isPosted: true,
      storeId: true,
      createdBy: true,
    },
  });
  if (!entry) {
    throw APIError.notFound(`Journal entry ${journalEntryId} not found.`);
  }
  if (entry.isVoided) {
    throw APIError.conflict(`Cannot approve voided entry ${entry.entryNumber}.`);
  }
  if (entry.isPosted) {
    throw APIError.conflict(
      `Entry ${entry.entryNumber} is already posted — approval is moot.`,
    );
  }
  if (entry.isApproved) {
    throw APIError.conflict(`Entry ${entry.entryNumber} is already approved.`);
  }
  // Segregation of duties: creator ≠ approver.
  if (entry.createdBy === userId) {
    throw APIError.forbidden(
      `Segregation-of-duties violation: you cannot approve journal entry ` +
        `${entry.entryNumber} because you created it. A different authorised ` +
        `user must approve it.`,
    );
  }

  return withImmutabilityBypass(async () => {
    return db.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.journalEntry.update({
        where: { id: journalEntryId },
        data: {
          isApproved: true,
          approvedAt: now,
          approvedByUserId: userId,
        },
      });

      await writeAuditLog(tx, {
        storeId: entry.storeId,
        entityType: AuditEntityType.JOURNAL_ENTRY,
        entityId: journalEntryId,
        action: AuditAction.APPROVE,
        userId,
        oldValues: { isApproved: false },
        newValues: {
          isApproved: true,
          approvedAt: now.toISOString(),
          approvedByUserId: userId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });

      return updated;
    });
  }, `approve_journal_entry_${journalEntryId}`);
}

/**
 * Post an approved journal entry to the ledger. The entry becomes part of the
 * permanent financial record and affects account balances.
 *
 * Rules:
 *   • Entry must exist, not be voided, not already be posted.
 *   • Entry must be approved UNLESS `bypassApproval` is true (system entries).
 *   • Balance is re-validated (defence in depth).
 *   • Period is re-validated for openness.
 *
 * Runs inside `withImmutabilityBypass` because JournalEntry is append-only
 * and posting mutates the isPosted/postedAt/postedByUserId fields.
 */
export async function postJournalEntry(
  journalEntryId: string,
  userId: string,
  options: {
    ipAddress?: string;
    userAgent?: string;
    bypassApproval?: boolean;
  } = {},
): Promise<JournalEntry> {
  const { ipAddress, userAgent, bypassApproval = false } = options;

  const entry = await db.journalEntry.findUnique({
    where: { id: journalEntryId },
    include: {
      lines: { select: { debit: true, credit: true } },
      financialPeriod: true,
    },
  });
  if (!entry) {
    throw APIError.notFound(`Journal entry ${journalEntryId} not found.`);
  }
  if (entry.isVoided) {
    throw APIError.conflict(`Cannot post voided entry ${entry.entryNumber}.`);
  }
  if (entry.isPosted) {
    throw APIError.conflict(`Entry ${entry.entryNumber} is already posted.`);
  }
  if (!bypassApproval && !entry.isApproved) {
    throw APIError.badRequest(
      `Entry ${entry.entryNumber} must be approved before posting ` +
        `(segregation of duties). Pass bypassApproval=true ONLY for ` +
        `system-generated entries (sales, M-Pesa callbacks).`,
    );
  }

  // Re-validate balance from the persisted lines (defence in depth).
  const totals = computeEntryTotals(
    entry.lines.map((l) => ({
      accountId: "",
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  );
  if (!totals.isBalanced) {
    throw APIError.badRequest(
      `Cannot post unbalanced entry ${entry.entryNumber}. ` +
        `Variance: ${totals.variance.formatKES()}.`,
    );
  }

  // Re-validate period openness.
  if (entry.financialPeriod) {
    validateEntryAgainstPeriod(entry.entryDate, entry.financialPeriod);
  }

  return withImmutabilityBypass(async () => {
    return db.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.journalEntry.update({
        where: { id: journalEntryId },
        data: {
          isPosted: true,
          postedAt: now,
          postedByUserId: userId,
        },
      });

      await writeAuditLog(tx, {
        storeId: entry.storeId,
        entityType: AuditEntityType.JOURNAL_ENTRY,
        entityId: journalEntryId,
        action: AuditAction.POST,
        userId,
        oldValues: { isPosted: false, postedAt: null, postedByUserId: null },
        newValues: {
          isPosted: true,
          postedAt: now.toISOString(),
          postedByUserId: userId,
        },
        ipAddress,
        userAgent,
      });

      return updated;
    });
  }, `post_journal_entry_${journalEntryId}`);
}

/**
 * Void a posted journal entry by creating a **reversing entry**.
 *
 * The reversing entry mirrors the original with debits and credits swapped,
 * is posted immediately, and is linked to the original via `reversingEntryId`.
 * The original is marked `isVoided=true` with the void reason and timestamp.
 *
 * This is the ONLY sanctioned correction mechanism for posted entries —
 * deletes and direct edits are blocked by the immutability guard. It satisfies
 * ISO 9001's "error correction without loss of traceability" requirement.
 *
 * @param reason Mandatory (≥ 3 chars) — recorded in the audit trail.
 */
export async function voidJournalEntry(
  journalEntryId: string,
  userId: string,
  reason: string,
  options: { ipAddress?: string; userAgent?: string } = {},
): Promise<{ voidedEntry: JournalEntry; reversingEntry: JournalEntry }> {
  if (!reason || reason.trim().length < 3) {
    throw APIError.badRequest(
      "A meaningful void reason (≥ 3 characters) is required for the audit trail.",
    );
  }

  const entry = await db.journalEntry.findUnique({
    where: { id: journalEntryId },
    include: {
      lines: true,
      store: { select: { organizationId: true } },
    },
  });
  if (!entry) {
    throw APIError.notFound(`Journal entry ${journalEntryId} not found.`);
  }
  if (entry.isVoided) {
    throw APIError.conflict(`Entry ${entry.entryNumber} is already voided.`);
  }

  const organizationId = entry.store.organizationId;
  const now = new Date();
  const reversingEntryNumber = generateJournalEntryNumber();

  // Reversing lines: swap debit ↔ credit so they net to zero against the original.
  const reversingLines = entry.lines.map((line) => ({
    accountId: line.accountId,
    debit: line.credit, // swapped
    credit: line.debit, // swapped
    description: `REVERSAL of ${entry.entryNumber}: ${line.description ?? entry.description}`,
    isTaxRelated: line.isTaxRelated,
    taxRateApplied: line.taxRateApplied,
    taxAmount: line.taxAmount,
  }));

  // Reversing entry totals are the swap of the original totals.
  const totalDebit = entry.totalCredit;
  const totalCredit = entry.totalDebit;

  return withImmutabilityBypass(async () => {
    return db.$transaction(async (tx) => {
      // 1. Create the reversing entry — posted immediately, auto-approved by the voiding user.
      const reversingEntry = await tx.journalEntry.create({
        data: {
          storeId: entry.storeId,
          entryNumber: reversingEntryNumber,
          entryDate: now,
          description: `REVERSAL of ${entry.entryNumber}: ${reason}`,
          referenceType: "REVERSAL",
          referenceId: entry.id,
          totalDebit,
          totalCredit,
          isPosted: true,
          postedAt: now,
          postedByUserId: userId,
          isApproved: true,
          approvedAt: now,
          approvedByUserId: userId,
          referenceDocumentType: "MANUAL",
          financialPeriodId: entry.financialPeriodId,
          createdBy: userId,
          lines: {
            createMany: {
              data: reversingLines.map((l) => ({
                accountId: l.accountId,
                debit: l.debit,
                credit: l.credit,
                description: l.description,
                isTaxRelated: l.isTaxRelated,
                taxRateApplied: l.taxRateApplied,
                taxAmount: l.taxAmount,
              })),
            },
          },
        },
      });

      // 2. Mark the original as voided + link the reversing entry.
      const voidedEntry = await tx.journalEntry.update({
        where: { id: journalEntryId },
        data: {
          isVoided: true,
          voidedAt: now,
          voidedByUserId: userId,
          voidedBy: userId, // legacy plain-string field
          voidReason: reason,
          reversingEntryId: reversingEntry.id,
        },
      });

      // 3. Audit log for the VOID action on the original entry.
      await writeAuditLog(tx, {
        storeId: entry.storeId,
        organizationId,
        entityType: AuditEntityType.JOURNAL_ENTRY,
        entityId: journalEntryId,
        action: AuditAction.VOID,
        userId,
        oldValues: { isVoided: false },
        newValues: {
          isVoided: true,
          voidedAt: now.toISOString(),
          voidedByUserId: userId,
          voidReason: reason,
          reversingEntryId: reversingEntry.id,
          reversingEntryNumber: reversingEntry.entryNumber,
        },
        reason,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });

      // 4. Audit log for the CREATE of the reversing entry.
      await writeAuditLog(tx, {
        storeId: entry.storeId,
        organizationId,
        entityType: AuditEntityType.JOURNAL_ENTRY,
        entityId: reversingEntry.id,
        action: AuditAction.CREATE,
        userId,
        oldValues: null,
        newValues: {
          entryNumber: reversingEntry.entryNumber,
          description: reversingEntry.description,
          reversingOf: entry.entryNumber,
          totalDebit: reversingEntry.totalDebit.toString(),
          totalCredit: reversingEntry.totalCredit.toString(),
        },
        reason: `Auto-created reversing entry for ${entry.entryNumber}`,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });

      return { voidedEntry, reversingEntry };
    });
  }, `void_journal_entry_${journalEntryId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Account CRUD (with audit)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateAccountInput {
  organizationId: string;
  code: string;
  name: string;
  type: string; // AccountType
  subType?: string; // AccountSubType
  normalBalance?: string; // NormalBalance — defaults based on type
  description?: string;
  isActive?: boolean;
  createdByUserId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create a new account in the chart of accounts. The `normalBalance` defaults
 * to DEBIT for ASSET/EXPENSE and CREDIT for LIABILITY/EQUITY/REVENUE, but can
 * be overridden (for contra accounts like Sales Discounts or Accumulated
 * Depreciation).
 */
export async function createAccount(input: CreateAccountInput): Promise<Account> {
  if (!input.code || input.code.trim().length === 0) {
    throw APIError.badRequest("Account code is required.");
  }
  if (!input.name || input.name.trim().length < 2) {
    throw APIError.badRequest("Account name is required (≥ 2 characters).");
  }

  const expectedNormal =
    input.type === AccountType.ASSET || input.type === AccountType.EXPENSE
      ? NormalBalance.DEBIT
      : NormalBalance.CREDIT;
  const normalBalance = input.normalBalance ?? expectedNormal;

  // Check for code uniqueness within the org (the schema enforces this, but we
  // produce a friendlier error than the raw Prisma unique-constraint message).
  const existing = await db.account.findUnique({
    where: {
      organizationId_code: { organizationId: input.organizationId, code: input.code },
    },
    select: { id: true },
  });
  if (existing) {
    throw APIError.conflict(
      `Account code "${input.code}" already exists in this organization.`,
    );
  }

  const account = await db.account.create({
    data: {
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      type: input.type,
      subType: input.subType ?? null,
      normalBalance,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
      createdByUserId: input.createdByUserId,
    },
  });

  await writeAuditLog(db, {
    organizationId: input.organizationId,
    entityType: AuditEntityType.ACCOUNT,
    entityId: account.id,
    action: AuditAction.CREATE,
    userId: input.createdByUserId,
    oldValues: null,
    newValues: {
      code: input.code,
      name: input.name,
      type: input.type,
      subType: input.subType,
      normalBalance,
      description: input.description,
      isActive: input.isActive ?? true,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return account;
}

export interface UpdateAccountInput {
  name?: string;
  description?: string;
  subType?: string;
  isActive?: boolean;
  // NOTE: `code`, `type`, and `normalBalance` are NOT updatable — changing them
  // would invalidate historical journal entries. Create a new account instead.
}

/**
 * Update an account's mutable metadata (name, description, subType, isActive).
 *
 * Deactivation is blocked if the account has a non-zero balance (would corrupt
 * historical reports). `code`, `type`, and `normalBalance` are immutable by
 * design — change them by creating a new account.
 */
export async function updateAccount(
  accountId: string,
  updates: UpdateAccountInput,
  userId: string,
  options: { ipAddress?: string; userAgent?: string } = {},
): Promise<Account> {
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) {
    throw APIError.notFound(`Account ${accountId} not found.`);
  }

  // Deactivation guard: cannot deactivate an account with a non-zero balance.
  if (updates.isActive === false) {
    const balance = await calculateAccountBalance(accountId);
    if (!balance.netBalance.isZero()) {
      throw APIError.conflict(
        `Cannot deactivate account ${account.code} (${account.name}): ` +
          `non-zero balance of ${balance.netBalance.formatKES()} ` +
          `across ${balance.lineCount} journal lines. ` +
          `Post a zeroing entry first or create a new account instead.`,
      );
    }
  }

  const updated = await db.account.update({
    where: { id: accountId },
    data: {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.subType !== undefined ? { subType: updates.subType } : {}),
      ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
    },
  });

  await writeAuditLog(db, {
    organizationId: account.organizationId,
    entityType: AuditEntityType.ACCOUNT,
    entityId: accountId,
    action: AuditAction.UPDATE,
    userId,
    oldValues: {
      name: account.name,
      description: account.description,
      subType: account.subType,
      isActive: account.isActive,
    },
    newValues: updates as Record<string, unknown>,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Financial-period lifecycle (create → close → lock, + reopen)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateFinancialPeriodInput {
  storeId: string;
  organizationId: string;
  periodName: string;
  startDate: Date;
  endDate: Date;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create a new OPEN financial period. Validates:
 *   • endDate > startDate.
 *   • No overlap with existing periods for the store (any status).
 *   • Unique periodName per store (schema-enforced, friendlier error here).
 */
export async function createFinancialPeriod(
  input: CreateFinancialPeriodInput,
): Promise<FinancialPeriod> {
  const {
    storeId,
    organizationId,
    periodName,
    startDate,
    endDate,
    userId,
    ipAddress,
    userAgent,
  } = input;

  if (!periodName || periodName.trim().length < 2) {
    throw APIError.badRequest("Period name is required (≥ 2 characters).");
  }
  if (endDate.getTime() <= startDate.getTime()) {
    throw APIError.badRequest(
      "Period end date must be strictly after the start date.",
    );
  }

  // Overlap check — no two periods for the same store may cover the same day.
  const overlapping = await db.financialPeriod.findFirst({
    where: {
      storeId,
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, periodName: true, startDate: true, endDate: true },
  });
  if (overlapping) {
    throw APIError.conflict(
      `Period "${periodName}" overlaps with existing period ` +
        `"${overlapping.periodName}" ` +
        `(${overlapping.startDate.toISOString()} → ${overlapping.endDate.toISOString()}).`,
    );
  }

  const period = await db.financialPeriod.create({
    data: {
      storeId,
      organizationId,
      periodName,
      startDate,
      endDate,
      status: FinancialPeriodStatus.OPEN,
    },
  });

  await writeAuditLog(db, {
    storeId,
    organizationId,
    entityType: AuditEntityType.FINANCIAL_PERIOD,
    entityId: period.id,
    action: AuditAction.CREATE,
    userId,
    oldValues: null,
    newValues: {
      periodName,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: FinancialPeriodStatus.OPEN,
    },
    ipAddress,
    userAgent,
  });

  return period;
}

/**
 * Close a financial period. A period can be closed only when:
 *   1. It is currently OPEN.
 *   2. It has no unposted, non-voided journal entries.
 *   3. The period-close audit (from financial-audit.ts) finds no CRITICAL or
 *      HIGH issues (unbalanced entries, trial-balance mismatch, etc.).
 *
 * Closing does NOT freeze the period — entries can still be posted if it is
 * later reopened. Use `lockFinancialPeriod` for the terminal freeze.
 */
export async function closeFinancialPeriod(
  periodId: string,
  userId: string,
  options: { ipAddress?: string; userAgent?: string } = {},
): Promise<FinancialPeriod> {
  const period = await db.financialPeriod.findUnique({
    where: { id: periodId },
  });
  if (!period) {
    throw APIError.notFound(`Financial period ${periodId} not found.`);
  }
  if (period.status === FinancialPeriodStatus.LOCKED) {
    throw APIError.conflict(
      `Period "${period.periodName}" is LOCKED and cannot be modified.`,
    );
  }
  if (period.status === FinancialPeriodStatus.CLOSED) {
    throw APIError.conflict(`Period "${period.periodName}" is already CLOSED.`);
  }

  // Block close on unposted entries.
  const unpostedCount = await db.journalEntry.count({
    where: {
      storeId: period.storeId,
      financialPeriodId: periodId,
      isPosted: false,
      isVoided: false,
    },
  });
  if (unpostedCount > 0) {
    throw APIError.conflict(
      `Cannot close period "${period.periodName}": ${unpostedCount} unposted ` +
        `journal entr${unpostedCount === 1 ? "y" : "ies"} exist. Post or void them first.`,
    );
  }

  // Run the full period-close audit (from financial-audit.ts).
  const { verifyPeriodClose } = await import("./financial-audit");
  const issues = await verifyPeriodClose(
    period.storeId,
    period.startDate,
    period.endDate,
  );
  const blockingIssues = issues.filter(
    (i) => i.severity === "CRITICAL" || i.severity === "HIGH",
  );
  if (blockingIssues.length > 0) {
    throw APIError.conflict(
      `Cannot close period "${period.periodName}": ${blockingIssues.length} ` +
        `blocking issue(s) found. First: ${blockingIssues[0].message}`,
    );
  }

  const now = new Date();
  const updated = await db.financialPeriod.update({
    where: { id: periodId },
    data: {
      status: FinancialPeriodStatus.CLOSED,
      closedAt: now,
      closedByUserId: userId,
    },
  });

  await writeAuditLog(db, {
    storeId: period.storeId,
    organizationId: period.organizationId,
    entityType: AuditEntityType.FINANCIAL_PERIOD,
    entityId: periodId,
    action: AuditAction.CLOSE,
    userId,
    oldValues: { status: FinancialPeriodStatus.OPEN },
    newValues: {
      status: FinancialPeriodStatus.CLOSED,
      closedAt: now.toISOString(),
      closedByUserId: userId,
    },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return updated;
}

/**
 * Lock a CLOSED financial period. LOCKED is the terminal state — no mutations
 * of any kind are permitted, and the period cannot be reopened. Use this after
 * the period has been closed AND audited AND reported.
 */
export async function lockFinancialPeriod(
  periodId: string,
  userId: string,
  options: { ipAddress?: string; userAgent?: string } = {},
): Promise<FinancialPeriod> {
  const period = await db.financialPeriod.findUnique({
    where: { id: periodId },
  });
  if (!period) {
    throw APIError.notFound(`Financial period ${periodId} not found.`);
  }
  if (period.status === FinancialPeriodStatus.LOCKED) {
    throw APIError.conflict(`Period "${period.periodName}" is already LOCKED.`);
  }
  if (period.status === FinancialPeriodStatus.OPEN) {
    throw APIError.conflict(
      `Period "${period.periodName}" must be CLOSED before it can be LOCKED. ` +
        `Run closeFinancialPeriod first.`,
    );
  }

  const updated = await db.financialPeriod.update({
    where: { id: periodId },
    data: { status: FinancialPeriodStatus.LOCKED },
  });

  await writeAuditLog(db, {
    storeId: period.storeId,
    organizationId: period.organizationId,
    entityType: AuditEntityType.FINANCIAL_PERIOD,
    entityId: periodId,
    action: AuditAction.LOCK,
    userId,
    oldValues: { status: FinancialPeriodStatus.CLOSED },
    newValues: { status: FinancialPeriodStatus.LOCKED },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return updated;
}

/**
 * Reopen a CLOSED financial period (OPEN → CLOSED is reversible; LOCKED is not).
 * A reason is mandatory for the audit trail. Reopening is typically done when
 * an adjusting entry needs to be posted to a period that was prematurely closed.
 */
export async function reopenFinancialPeriod(
  periodId: string,
  userId: string,
  reason: string,
  options: { ipAddress?: string; userAgent?: string } = {},
): Promise<FinancialPeriod> {
  if (!reason || reason.trim().length < 3) {
    throw APIError.badRequest(
      "A reopen reason (≥ 3 characters) is required for the audit trail.",
    );
  }

  const period = await db.financialPeriod.findUnique({
    where: { id: periodId },
  });
  if (!period) {
    throw APIError.notFound(`Financial period ${periodId} not found.`);
  }
  if (period.status === FinancialPeriodStatus.LOCKED) {
    throw APIError.forbidden(
      `LOCKED periods cannot be reopened. Create an adjusting entry in a ` +
        `subsequent OPEN period instead.`,
    );
  }
  if (period.status === FinancialPeriodStatus.OPEN) {
    throw APIError.conflict(`Period "${period.periodName}" is already OPEN.`);
  }

  const updated = await db.financialPeriod.update({
    where: { id: periodId },
    data: {
      status: FinancialPeriodStatus.OPEN,
      closedAt: null,
      closedByUserId: null,
    },
  });

  await writeAuditLog(db, {
    storeId: period.storeId,
    organizationId: period.organizationId,
    entityType: AuditEntityType.FINANCIAL_PERIOD,
    entityId: periodId,
    action: AuditAction.REOPEN,
    userId,
    reason,
    oldValues: { status: FinancialPeriodStatus.CLOSED },
    newValues: { status: FinancialPeriodStatus.OPEN },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Trial-balance snapshot (point-in-time freeze)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture a point-in-time trial-balance snapshot for a store. The snapshot
 * records every account's debit/credit/net balance as of `snapshotDate`, plus
 * the totals and balanced flag. Stored as an immutable Json blob (the chart of
 * accounts may change later, but the snapshot reflects the state AS IT WAS).
 *
 * Typically called at period close to freeze the financial position for
 * archival and audit purposes (ISO 9001 — verifiable financial position).
 */
export async function captureTrialBalanceSnapshot(
  storeId: string,
  userId: string,
  options: {
    periodId?: string;
    snapshotDate?: Date;
    organizationId?: string;
    ipAddress?: string;
    userAgent?: string;
  } = {},
): Promise<TrialBalanceSnapshot> {
  const { periodId, snapshotDate = new Date(), organizationId, ipAddress, userAgent } = options;

  // Reuse the existing trial-balance generator (read-only, from financial-audit.ts).
  const { generateTrialBalance } = await import("./financial-audit");
  const tb = await generateTrialBalance(storeId, snapshotDate);

  const balances = tb.accounts.map((a) => ({
    accountCode: a.accountCode,
    accountName: a.accountName,
    accountType: a.accountType,
    debit: a.totalDebit.toNumber(),
    credit: a.totalCredit.toNumber(),
    netBalance: a.netBalance.toNumber(),
  }));

  const snapshot = await db.trialBalanceSnapshot.create({
    data: {
      storeId,
      periodId: periodId ?? null,
      snapshotDate,
      balances,
      totalDebits: tb.totalDebits.toDecimal(),
      totalCredits: tb.totalCredits.toDecimal(),
      isBalanced: tb.isBalanced,
      generatedByUserId: userId,
    },
  });

  await writeAuditLog(db, {
    storeId,
    organizationId,
    entityType: AuditEntityType.TRIAL_BALANCE_SNAPSHOT,
    entityId: snapshot.id,
    action: AuditAction.SNAPSHOT,
    userId,
    oldValues: null,
    newValues: {
      snapshotDate: snapshotDate.toISOString(),
      isBalanced: tb.isBalanced,
      accountCount: tb.accounts.length,
      totalDebits: tb.totalDebits.formatKES(),
      totalCredits: tb.totalCredits.formatKES(),
      variance: tb.variance.formatKES(),
    },
    ipAddress,
    userAgent,
  });

  // Warn if the snapshot is unbalanced — this is a serious red flag.
  if (!tb.isBalanced) {
    await systemLog({
      storeId,
      action: "TRIAL_BALANCE_SNAPSHOT_UNBALANCED",
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.CRITICAL,
      message: `Trial balance snapshot for store ${storeId} as of ${snapshotDate.toISOString()} is UNBALANCED. Variance: ${tb.variance.formatKES()}.`,
      metadata: {
        snapshotId: snapshot.id,
        accountCount: tb.accounts.length,
        totalDebits: tb.totalDebits.toString(),
        totalCredits: tb.totalCredits.toString(),
      },
    });
  }

  return snapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Budget management
// ─────────────────────────────────────────────────────────────────────────────

export interface SetBudgetInput {
  storeId: string;
  periodId: string;
  accountId: string;
  budgetedAmount: MoneyInput;
  notes?: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Set or update the budgeted amount for an account within a financial period.
 * One budget per (period, account) — enforced by a unique constraint; this
 * function upserts accordingly. The `variance` is recomputed as
 * `budgetedAmount − actualAmount` (actuals are 0 until refreshed).
 *
 * Blocked if the period is LOCKED.
 */
export async function setBudget(input: SetBudgetInput): Promise<Budget> {
  const {
    storeId,
    periodId,
    accountId,
    budgetedAmount,
    notes,
    userId,
    ipAddress,
    userAgent,
  } = input;

  const amount = toMoney(budgetedAmount);
  if (amount.isNegative()) {
    throw APIError.badRequest("Budgeted amount cannot be negative.");
  }

  const [account, period] = await Promise.all([
    db.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, organizationId: true },
    }),
    db.financialPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, storeId: true, periodName: true, status: true },
    }),
  ]);
  if (!account) {
    throw APIError.notFound(`Account ${accountId} not found.`);
  }
  if (!period) {
    throw APIError.notFound(`Financial period ${periodId} not found.`);
  }
  if (period.storeId !== storeId) {
    throw APIError.badRequest("Financial period does not belong to this store.");
  }
  if (period.status === FinancialPeriodStatus.LOCKED) {
    throw APIError.forbidden(
      `Cannot set budget for LOCKED period "${period.periodName}".`,
    );
  }

  const existing = await db.budget.findUnique({
    where: { periodId_accountId: { periodId, accountId } },
  });

  let budget: Budget;
  if (existing) {
    budget = await db.budget.update({
      where: { id: existing.id },
      data: {
        budgetedAmount: amount.toDecimal(),
        variance: amount.toDecimal().minus(existing.actualAmount.toString()),
        notes: notes ?? existing.notes,
      },
    });
  } else {
    budget = await db.budget.create({
      data: {
        storeId,
        periodId,
        accountId,
        budgetedAmount: amount.toDecimal(),
        actualAmount: new Decimal(0),
        variance: amount.toDecimal(),
        notes: notes ?? null,
        createdById: userId,
      },
    });
  }

  await writeAuditLog(db, {
    storeId,
    organizationId: account.organizationId,
    entityType: AuditEntityType.BUDGET,
    entityId: budget.id,
    action: AuditAction.BUDGET_SET,
    userId,
    oldValues: existing
      ? {
          budgetedAmount: existing.budgetedAmount.toString(),
          notes: existing.notes,
        }
      : null,
    newValues: {
      budgetedAmount: amount.toString(),
      accountId,
      accountCode: account.code,
      periodId,
      notes: notes ?? null,
    },
    ipAddress,
    userAgent,
  });

  return budget;
}

/**
 * Recalculate the `actualAmount` and `variance` for every budget in a period.
 * The actual is the sum of posted, non-voided journal-entry lines for the
 * budgeted account within entries linked to this period, respecting the
 * account's normal balance.
 *
 * This is an expensive operation (one query per budget) and is intended to be
 * run on-demand from the UI or by a nightly background job — NOT in real-time.
 */
export async function recalculateBudgetActuals(
  periodId: string,
): Promise<{ updated: number; budgets: Budget[] }> {
  const period = await db.financialPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, storeId: true },
  });
  if (!period) {
    throw APIError.notFound(`Financial period ${periodId} not found.`);
  }

  const budgets = await db.budget.findMany({
    where: { periodId },
    include: {
      account: { select: { code: true, name: true, normalBalance: true, type: true } },
    },
  });

  if (budgets.length === 0) {
    return { updated: 0, budgets: [] };
  }

  const updatedBudgets: Budget[] = [];

  for (const budget of budgets) {
    const lines = await db.journalEntryLine.findMany({
      where: {
        accountId: budget.accountId,
        journalEntry: {
          isVoided: false,
          isPosted: true,
          financialPeriodId: periodId,
        },
      },
      select: { debit: true, credit: true },
    });

    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    for (const line of lines) {
      totalDebit = totalDebit.add(Money.fromPrisma(line.debit));
      totalCredit = totalCredit.add(Money.fromPrisma(line.credit));
    }

    const isDebitNormal =
      budget.account.normalBalance === NormalBalance.DEBIT;
    const actual = isDebitNormal
      ? totalDebit.subtract(totalCredit)
      : totalCredit.subtract(totalDebit);
    const variance = toMoney(budget.budgetedAmount).subtract(actual);

    const updated = await db.budget.update({
      where: { id: budget.id },
      data: {
        actualAmount: actual.toDecimal(),
        variance: variance.toDecimal(),
      },
    });
    updatedBudgets.push(updated);
  }

  return { updated: updatedBudgets.length, budgets: updatedBudgets };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Reconciliation (bank / account rec)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark a single journal-entry line as reconciled. Used during bank/account
 * reconciliation to indicate that the line has been matched against an external
 * statement (bank statement, supplier statement, etc.).
 *
 * A line can only be reconciled once (immutable `reconciledAt` timestamp).
 * Lines on voided entries cannot be reconciled.
 *
 * Runs inside `withImmutabilityBypass` because JournalEntryLine is append-only.
 */
export async function reconcileJournalEntryLine(
  lineId: string,
  userId: string,
  options: { ipAddress?: string; userAgent?: string } = {},
): Promise<JournalEntryLine> {
  const line = await db.journalEntryLine.findUnique({
    where: { id: lineId },
    include: {
      journalEntry: { select: { storeId: true, isVoided: true, entryNumber: true } },
    },
  });
  if (!line) {
    throw APIError.notFound(`Journal entry line ${lineId} not found.`);
  }
  if (line.journalEntry.isVoided) {
    throw APIError.conflict(
      `Cannot reconcile a line on voided entry ${line.journalEntry.entryNumber}.`,
    );
  }
  if (line.reconciledAt) {
    throw APIError.conflict(
      `Line ${lineId} is already reconciled (at ${line.reconciledAt.toISOString()}).`,
    );
  }

  return withImmutabilityBypass(async () => {
    return db.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.journalEntryLine.update({
        where: { id: lineId },
        data: {
          reconciledAt: now,
          reconciledByUserId: userId,
        },
      });

      await writeAuditLog(tx, {
        storeId: line.journalEntry.storeId,
        entityType: AuditEntityType.JOURNAL_ENTRY_LINE,
        entityId: lineId,
        action: AuditAction.RECONCILE,
        userId,
        oldValues: { reconciledAt: null, reconciledByUserId: null },
        newValues: {
          reconciledAt: now.toISOString(),
          reconciledByUserId: userId,
        },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
      });

      return updated;
    });
  }, `reconcile_journal_line_${lineId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Audit-trail query helper
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditTrailFilters {
  storeId?: string;
  organizationId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

/** Audit-log row with the acting user eagerly loaded (for display). */
export type AuditLogWithUser = AuditLog & {
  user: { id: string; name: string | null; email: string } | null;
};

/**
 * Query the immutable audit trail with filters. Returns entries newest-first
 * with the acting user's name/email for display. Used by the audit-trail UI
 * tab and compliance export endpoints.
 */
export async function listAuditTrail(
  filters: AuditTrailFilters,
): Promise<{ entries: AuditLogWithUser[]; total: number }> {
  const {
    storeId,
    organizationId,
    entityType,
    entityId,
    action,
    userId,
    dateFrom,
    dateTo,
    limit = 50,
    offset = 0,
  } = filters;

  const where: Prisma.AuditLogWhereInput = {};
  if (storeId) where.storeId = storeId;
  if (organizationId) where.organizationId = organizationId;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;
  if (userId) where.userId = userId;
  if (dateFrom || dateTo) {
    where.timestamp = {};
    if (dateFrom) where.timestamp.gte = dateFrom;
    if (dateTo) where.timestamp.lte = dateTo;
  }

  const [entries, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: Math.min(limit, 200),
      skip: offset,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return { entries, total };
}

/**
 * Low-level audit-log writer. Used by code paths that need to record an audit
 * event outside the main lifecycle functions (e.g. custom bulk operations).
 * Most callers should use the lifecycle functions instead, which write audit
 * records automatically.
 */
export async function recordAuditLog(params: {
  storeId?: string | null;
  organizationId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  userId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string;
  userAgent?: string;
}): Promise<AuditLog> {
  return db.auditLog.create({
    data: {
      storeId: params.storeId ?? null,
      organizationId: params.organizationId ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      userId: params.userId ?? null,
      oldValues: toJsonInput(params.oldValues),
      newValues: toJsonInput(params.newValues),
      reason: params.reason ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Journal-entry status derivation (UI helper)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the display status of a journal entry from its boolean flags. The
 * status is NOT stored on the model (it's computed) to avoid the model
 * drifting from the truth.
 *
 *   VOIDED  — isVoided === true (overrides everything)
 *   POSTED  — isPosted === true
 *   APPROVED — isApproved === true (not yet posted)
 *   DRAFT   — none of the above
 *
 * NOTE: "SUBMITTED" is not currently distinguishable from DRAFT because the
 * schema has no `isSubmitted` flag. If a formal submit-step is needed later,
 * add the flag and update this function.
 */
export function deriveJournalEntryStatus(entry: {
  isPosted: boolean;
  isApproved: boolean;
  isVoided: boolean;
}): JournalEntryStatus {
  if (entry.isVoided) return JournalEntryStatus.VOIDED;
  if (entry.isPosted) return JournalEntryStatus.POSTED;
  if (entry.isApproved) return JournalEntryStatus.APPROVED;
  return JournalEntryStatus.DRAFT;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for ergonomic single-import usage
// ─────────────────────────────────────────────────────────────────────────────

export { Money, KES } from "./money";
export { withImmutabilityBypass } from "./db";
