// Financial accounting tests for `recordSaleJournalEntry`.
//
// These tests verify the double-entry bookkeeping invariants that the POS
// checkout relies on (ISO 9001 / GAAP compliance):
//
//   1. A cash sale credits Sales Revenue + VAT Payable and debits Cash on
//      Hand (and COGS/Inventory if cogsAmount > 0). Debits must equal credits.
//   2. A cart-level discount is routed to the Sales Discounts contra-revenue
//      account (debit), NOT netted against Sales Revenue.
//   3. A gift-card redemption debits Gift Card Liability (the unearned-
//      revenue account is reduced when the card is used).
//   4. The golden-rule safeguard throws if debits ≠ credits (e.g. a payment
//      breakdown that doesn't sum to revenue + tax + discount).
//
// Isolation strategy: each test wraps the helper call in a `db.$transaction`
// and intentionally rolls back by throwing a sentinel error at the end. This
// keeps the dev database clean without needing a per-test ephemeral DB.
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import {
  recordSaleJournalEntry,
  getAccountIds,
  ACCOUNT_CODES,
} from '@/lib/account-helper';

// Sentinel thrown at the end of each test transaction to force a rollback.
// Using a Symbol guarantees it won't collide with any real Prisma error.
const ROLLBACK = Symbol('test-rollback');

/**
 * Runs `fn` inside a Prisma interactive transaction and rolls back whatever
 * `fn` did by throwing `ROLLBACK` at the end. The ROLLBACK throw is caught
 * here so the test sees a clean exit. Any OTHER throw inside `fn` propagates
 * to the test (which is what we want for the unbalanced-entry test).
 */
async function withRollback<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await db.$transaction(async (tx) => {
      const _r = await fn(tx);
      throw ROLLBACK; // force rollback
    });
    return result;
  } catch (e) {
    if (e === ROLLBACK) {
      // Transaction rolled back cleanly — but `result` was assigned before
      // the throw, so return it. (TypeScript can't see this, so we cast.)
      return (undefined as unknown) as T;
    }
    throw e;
  }
}

// Fixtures matching the seeded dev DB (org_mbumah / store_juja_main /
// user_super_admin). See prisma/seed.ts.
const ORG_ID = 'org_mbumah';
const STORE_ID = 'store_juja_main';
const CASHIER_ID = 'user_super_admin';

describe('recordSaleJournalEntry — double-entry accounting', () => {
  // Ensure all required accounts exist (auto-creates if missing) before the
  // tests run. This warms the in-memory cache so in-tx lookups are cache hits.
  // The return value is intentionally discarded — the call is for its
  // side effect (populating the account-id cache inside account-helper).
  let cashierOrgId: string;

  beforeAll(async () => {
    await getAccountIds(ORG_ID, [
      ACCOUNT_CODES.CASH_ON_HAND,
      ACCOUNT_CODES.MPESA_ACCOUNT,
      ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
      ACCOUNT_CODES.GIFT_CARD_LIABILITY,
      ACCOUNT_CODES.SALES_REVENUE,
      ACCOUNT_CODES.VAT_PAYABLE,
      ACCOUNT_CODES.SALES_DISCOUNTS,
      ACCOUNT_CODES.COST_OF_GOODS_SOLD,
      ACCOUNT_CODES.INVENTORY,
    ]);
    // Confirm the org exists; fall back to org_mbumah which the helper uses.
    cashierOrgId = ORG_ID;
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 1: Cash sale — revenue + VAT credited, cash debited, balanced.
  // ─────────────────────────────────────────────────────────────────────
  it('credits Sales Revenue + VAT Payable and debits Cash on Hand for a cash sale (debits = credits)', async () => {
    const receiptNumber = `TEST-CASH-${Date.now()}`;
    const grossRevenue = 1000;
    const taxAmount = 160; // 16% VAT
    const finalTotal = grossRevenue + taxAmount; // 1160, no discount

    let savedJeId: string | null = null;

    await withRollback(async (tx) => {
      await recordSaleJournalEntry(tx, {
        storeId: STORE_ID,
        organizationId: cashierOrgId,
        cashierId: CASHIER_ID,
        receiptNumber,
        transactionId: `test-tx-${receiptNumber}`,
        grossRevenue,
        taxAmount,
        discountAmount: 0,
        paymentBreakdown: { cash: finalTotal },
        cogsAmount: 0,
        postImmediately: true,
      });

      // Fetch the journal entry + lines we just created (inside the same tx).
      const je = await tx.journalEntry.findFirst({
        where: { referenceId: `test-tx-${receiptNumber}` },
        include: { lines: { include: { account: { select: { code: true } } } } },
      });

      expect(je).not.toBeNull();
      savedJeId = je!.id;

      // Golden rule: debits must equal credits.
      expect(je!.totalDebit).toBeCloseTo(je!.totalCredit, 2);
      expect(je!.totalDebit).toBeCloseTo(finalTotal, 2);

      // Sales Revenue (4000) credited with gross revenue.
      const revenueLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.SALES_REVENUE);
      expect(revenueLine).toBeDefined();
      expect(revenueLine!.credit).toBeCloseTo(grossRevenue, 2);
      expect(revenueLine!.debit).toBe(0);

      // VAT Payable (2100) credited with tax.
      const vatLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.VAT_PAYABLE);
      expect(vatLine).toBeDefined();
      expect(vatLine!.credit).toBeCloseTo(taxAmount, 2);

      // Cash on Hand (1000) debited with the full amount received.
      const cashLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.CASH_ON_HAND);
      expect(cashLine).toBeDefined();
      expect(cashLine!.debit).toBeCloseTo(finalTotal, 2);
      expect(cashLine!.credit).toBe(0);

      // Entry should be posted (M-Pesa is the only unposted path).
      expect(je!.isPosted).toBe(true);
    });

    // Verify rollback: the JE should NOT exist outside the transaction.
    const jeAfter = await db.journalEntry.findUnique({ where: { id: savedJeId! } });
    expect(jeAfter).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: Cart-level discount → Sales Discounts contra-revenue (debit).
  // The discount must NOT reduce the Sales Revenue credit; instead it's a
  // separate debit to 4300 so management can track discounts granted.
  // ─────────────────────────────────────────────────────────────────────
  it('routes a cart-level discount to the Sales Discounts contra-revenue account (debit), leaving Sales Revenue whole', async () => {
    const receiptNumber = `TEST-DISC-${Date.now()}`;
    const grossRevenue = 1000;
    const taxAmount = 160;
    const discountAmount = 100; // Ksh 100 cart discount
    const finalTotal = grossRevenue + taxAmount - discountAmount; // 1060

    await withRollback(async (tx) => {
      await recordSaleJournalEntry(tx, {
        storeId: STORE_ID,
        organizationId: cashierOrgId,
        cashierId: CASHIER_ID,
        receiptNumber,
        transactionId: `test-tx-${receiptNumber}`,
        grossRevenue,
        taxAmount,
        discountAmount,
        paymentBreakdown: { cash: finalTotal },
        cogsAmount: 0,
        postImmediately: true,
      });

      const je = await tx.journalEntry.findFirst({
        where: { referenceId: `test-tx-${receiptNumber}` },
        include: { lines: { include: { account: { select: { code: true } } } } },
      });

      expect(je).not.toBeNull();

      // Balance: cash(1060) + discount(100) = revenue(1000) + vat(160) = 1160
      expect(je!.totalDebit).toBeCloseTo(1160, 2);
      expect(je!.totalCredit).toBeCloseTo(1160, 2);

      // Sales Revenue stays at the FULL gross (discount does NOT net it).
      const revenueLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.SALES_REVENUE);
      expect(revenueLine!.credit).toBeCloseTo(grossRevenue, 2);

      // Sales Discounts (4300) is debited — contra-revenue.
      const discountLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.SALES_DISCOUNTS);
      expect(discountLine).toBeDefined();
      expect(discountLine!.debit).toBeCloseTo(discountAmount, 2);
      expect(discountLine!.credit).toBe(0);

      // Cash debited with the reduced final total.
      const cashLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.CASH_ON_HAND);
      expect(cashLine!.debit).toBeCloseTo(finalTotal, 2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: Gift-card redemption → Gift Card Liability debited.
  // When a gift card is redeemed, the unearned-revenue liability (2300) is
  // reduced (debited), not a payment asset like cash.
  // ─────────────────────────────────────────────────────────────────────
  it('debits Gift Card Liability (unearned revenue) when a sale is paid with a gift card', async () => {
    const receiptNumber = `TEST-GC-${Date.now()}`;
    const grossRevenue = 500;
    const taxAmount = 80;
    const finalTotal = grossRevenue + taxAmount; // 580

    await withRollback(async (tx) => {
      await recordSaleJournalEntry(tx, {
        storeId: STORE_ID,
        organizationId: cashierOrgId,
        cashierId: CASHIER_ID,
        receiptNumber,
        transactionId: `test-tx-${receiptNumber}`,
        grossRevenue,
        taxAmount,
        discountAmount: 0,
        paymentBreakdown: { giftCard: finalTotal },
        cogsAmount: 0,
        postImmediately: true,
      });

      const je = await tx.journalEntry.findFirst({
        where: { referenceId: `test-tx-${receiptNumber}` },
        include: { lines: { include: { account: { select: { code: true } } } } },
      });

      expect(je).not.toBeNull();
      expect(je!.totalDebit).toBeCloseTo(finalTotal, 2);
      expect(je!.totalCredit).toBeCloseTo(finalTotal, 2);

      // Gift Card Liability (2300) DEBITED — liability decreases.
      const gcLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.GIFT_CARD_LIABILITY);
      expect(gcLine).toBeDefined();
      expect(gcLine!.debit).toBeCloseTo(finalTotal, 2);
      expect(gcLine!.credit).toBe(0);

      // Cash should NOT be touched in a pure gift-card sale.
      const cashLine = je!.lines.find((l) => l.account.code === ACCOUNT_CODES.CASH_ON_HAND);
      expect(cashLine).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 4: Golden-rule safeguard — unbalanced entry must throw.
  // If the payment breakdown doesn't sum to revenue + tax (+ discount), the
  // helper must refuse to write a journal entry (prevents silent corruption).
  // ─────────────────────────────────────────────────────────────────────
  it('throws when debits do not equal credits (golden-rule safeguard)', async () => {
    const receiptNumber = `TEST-BAD-${Date.now()}`;
    const grossRevenue = 1000;
    const taxAmount = 160;
    // Deliberately wrong: cash is only 500 but the sale is 1160.
    // Debits would be 500, credits 1160 → imbalance of 660.
    const wrongCash = 500;

    let thrownError: unknown = null;

    await withRollback(async (tx) => {
      try {
        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: cashierOrgId,
          cashierId: CASHIER_ID,
          receiptNumber,
          transactionId: `test-tx-${receiptNumber}`,
          grossRevenue,
          taxAmount,
          discountAmount: 0,
          paymentBreakdown: { cash: wrongCash },
          cogsAmount: 0,
          postImmediately: true,
        });
      } catch (e) {
        thrownError = e;
        throw e; // re-throw so the tx rolls back (not via ROLLBACK sentinel)
      }
    }).catch(() => {
      // Expected: the re-thrown error propagates here.
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toMatch(/unbalanced/i);
    expect((thrownError as Error).message).toContain(receiptNumber);

    // Verify NO journal entry was persisted for the rejected sale.
    const je = await db.journalEntry.findFirst({
      where: { referenceId: `test-tx-${receiptNumber}` },
    });
    expect(je).toBeNull();
  });
});
