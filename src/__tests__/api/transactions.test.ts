// ─────────────────────────────────────────────────────────────────────────────
// Transactions API — integration tests
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests verify the financial invariants of the POS checkout flow
// by exercising `recordSaleJournalEntry` (the double-entry helper used by
// POST /api/transactions) against the real Prisma + SQLite stack:
//
//   1. A cash sale creates a balanced journal entry (debits === credits).
//   2. A split payment (cash + M-Pesa) creates a balanced entry with both
//      payment asset accounts debited.
//   3. A credit (debt) sale debits Accounts Receivable.
//   4. A sale with a cart-level discount debits Sales Discounts (contra-revenue).
//   5. COGS entries debit COGS and credit Inventory.
//   6. The immutability guard prevents direct mutation of JournalEntry.
//
// Isolation: each test wraps the helper call in a `db.$transaction` and rolls
// back by throwing a sentinel. This keeps the dev database clean.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import {
  recordSaleJournalEntry,
  getAccountIds,
  ACCOUNT_CODES,
} from '@/lib/account-helper';

// Sentinel thrown at the end of each test transaction to force a rollback.
const ROLLBACK = Symbol('test-rollback');

async function withRollback(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void>,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK) return;
    throw e;
  }
}

// Fixtures matching the seeded dev DB.
const ORG_ID = 'org_mbumah';
const STORE_ID = 'store_juja_main';
const CASHIER_ID = 'user_super_admin';

describe('Transactions API — financial invariants', () => {
  beforeAll(async () => {
    // Warm the account-id cache so in-tx lookups are cache hits.
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
  });

  describe('Cash sale — journal entry balance', () => {
    it('creates a balanced journal entry (debits === credits)', async () => {
      await withRollback(async (tx) => {
        const receiptNumber = 'TEST-CASH-001';
        const transactionId = 'tx-test-cash-001';

        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: ORG_ID,
          cashierId: CASHIER_ID,
          receiptNumber,
          transactionId,
          grossRevenue: 1000,
          taxAmount: 160,
          discountAmount: 0,
          cogsAmount: 0,
          paymentBreakdown: { cash: 1160 },
        });

        const entry = await tx.journalEntry.findFirst({
          where: { referenceId: transactionId },
          include: { lines: true },
        });

        expect(entry).not.toBeNull();
        const totalDebit = entry!.lines.reduce((s, l) => s + l.debit as number, 0);
        const totalCredit = entry!.lines.reduce((s, l) => s + l.credit as number, 0);

        expect(totalDebit).toBeCloseTo(1160, 2);
        expect(totalCredit).toBeCloseTo(1160, 2);
        expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
        expect(entry!.referenceType).toBe('SALE');
        expect(entry!.isVoided).toBe(false);
      });
    });

    it('credits Sales Revenue and VAT Payable, debits Cash on Hand', async () => {
      await withRollback(async (tx) => {
        const transactionId = 'tx-test-cash-002';
        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: ORG_ID,
          cashierId: CASHIER_ID,
          receiptNumber: 'TEST-CASH-002',
          transactionId,
          grossRevenue: 1000,
          taxAmount: 160,
          discountAmount: 0,
          cogsAmount: 0,
          paymentBreakdown: { cash: 1160 },
        });

        const entry = await tx.journalEntry.findFirst({
          where: { referenceId: transactionId },
          include: { lines: { include: { account: { select: { code: true } } } } },
        });

        expect(entry).not.toBeNull();

        const cashLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.CASH_ON_HAND,
        );
        expect(cashLine).toBeDefined();
        expect(cashLine!.debit as number).toBe(1160);
        expect(cashLine!.credit as number).toBe(0);

        const salesLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.SALES_REVENUE,
        );
        expect(salesLine).toBeDefined();
        expect(salesLine!.credit as number).toBe(1000);
        expect(salesLine!.debit as number).toBe(0);

        const vatLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.VAT_PAYABLE,
        );
        expect(vatLine).toBeDefined();
        expect(vatLine!.credit as number).toBe(160);
      });
    });
  });

  describe('Split payment (cash + M-Pesa)', () => {
    it('debits both Cash on Hand and M-Pesa Account', async () => {
      await withRollback(async (tx) => {
        const transactionId = 'tx-test-split-001';
        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: ORG_ID,
          cashierId: CASHIER_ID,
          receiptNumber: 'TEST-SPLIT-001',
          transactionId,
          grossRevenue: 1000,
          taxAmount: 160,
          discountAmount: 0,
          cogsAmount: 0,
          paymentBreakdown: { cash: 500, mpesa: 660 },
        });

        const entry = await tx.journalEntry.findFirst({
          where: { referenceId: transactionId },
          include: { lines: { include: { account: { select: { code: true } } } } },
        });

        expect(entry).not.toBeNull();

        const cashLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.CASH_ON_HAND,
        );
        const mpesaLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.MPESA_ACCOUNT,
        );

        expect(cashLine).toBeDefined();
        expect(cashLine!.debit as number).toBe(500);
        expect(mpesaLine).toBeDefined();
        expect(mpesaLine!.debit as number).toBe(660);

        // Still balanced.
        const totalDebit = entry!.lines.reduce((s, l) => s + l.debit as number, 0);
        const totalCredit = entry!.lines.reduce((s, l) => s + l.credit as number, 0);
        expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
      });
    });
  });

  describe('Credit (debt) sale', () => {
    it('debits Accounts Receivable instead of Cash', async () => {
      await withRollback(async (tx) => {
        const transactionId = 'tx-test-debt-001';
        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: ORG_ID,
          cashierId: CASHIER_ID,
          receiptNumber: 'TEST-DEBT-001',
          transactionId,
          grossRevenue: 2000,
          taxAmount: 320,
          discountAmount: 0,
          cogsAmount: 0,
          paymentBreakdown: { credit: 2320 },
        });

        const entry = await tx.journalEntry.findFirst({
          where: { referenceId: transactionId },
          include: { lines: { include: { account: { select: { code: true } } } } },
        });

        expect(entry).not.toBeNull();

        const arLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
        );
        expect(arLine).toBeDefined();
        expect(arLine!.debit as number).toBe(2320);

        // No Cash on Hand debit for a debt sale.
        const cashLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.CASH_ON_HAND,
        );
        expect(cashLine).toBeUndefined();
      });
    });
  });

  describe('Sale with cart-level discount', () => {
    it('debits Sales Discounts (contra-revenue) for the discount amount', async () => {
      await withRollback(async (tx) => {
        const transactionId = 'tx-test-disc-001';
        // grossRevenue is GROSS (before cart discount). Cart discount is separate.
        // Customer pays: (1000 - 100) + 144 = 1044
        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: ORG_ID,
          cashierId: CASHIER_ID,
          receiptNumber: 'TEST-DISC-001',
          transactionId,
          grossRevenue: 1000,
          taxAmount: 144,
          discountAmount: 100,
          cogsAmount: 0,
          paymentBreakdown: { cash: 1044 },
        });

        const entry = await tx.journalEntry.findFirst({
          where: { referenceId: transactionId },
          include: { lines: { include: { account: { select: { code: true } } } } },
        });

        expect(entry).not.toBeNull();

        const discountLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.SALES_DISCOUNTS,
        );
        expect(discountLine).toBeDefined();
        expect(discountLine!.debit as number).toBe(100);

        // Sales Revenue is credited at the GROSS amount.
        const salesLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.SALES_REVENUE,
        );
        expect(salesLine).toBeDefined();
        expect(salesLine!.credit as number).toBe(1000);

        // Still balanced: debits (1044 + 100) === credits (1000 + 144).
        const totalDebit = entry!.lines.reduce((s, l) => s + l.debit as number, 0);
        const totalCredit = entry!.lines.reduce((s, l) => s + l.credit as number, 0);
        expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
      });
    });
  });

  describe('COGS entries', () => {
    it('debits COGS and credits Inventory for the cost amount', async () => {
      await withRollback(async (tx) => {
        const transactionId = 'tx-test-cogs-001';
        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: ORG_ID,
          cashierId: CASHIER_ID,
          receiptNumber: 'TEST-COGS-001',
          transactionId,
          grossRevenue: 1000,
          taxAmount: 160,
          discountAmount: 0,
          cogsAmount: 400,
          paymentBreakdown: { cash: 1160 },
        });

        const entry = await tx.journalEntry.findFirst({
          where: { referenceId: transactionId },
          include: { lines: { include: { account: { select: { code: true } } } } },
        });

        expect(entry).not.toBeNull();

        const cogsLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.COST_OF_GOODS_SOLD,
        );
        expect(cogsLine).toBeDefined();
        expect(cogsLine!.debit as number).toBe(400);

        const invLine = entry!.lines.find(
          (l) => l.account.code === ACCOUNT_CODES.INVENTORY,
        );
        expect(invLine).toBeDefined();
        expect(invLine!.credit as number).toBe(400);

        // Balanced: debits (1160 + 400) === credits (1000 + 160 + 400).
        const totalDebit = entry!.lines.reduce((s, l) => s + l.debit as number, 0);
        const totalCredit = entry!.lines.reduce((s, l) => s + l.credit as number, 0);
        expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);
      });
    });
  });

  describe('Immutability guard', () => {
    it('prevents direct update of JournalEntry outside withImmutabilityBypass', async () => {
      await withRollback(async (tx) => {
        const transactionId = 'tx-test-immut-001';
        await recordSaleJournalEntry(tx, {
          storeId: STORE_ID,
          organizationId: ORG_ID,
          cashierId: CASHIER_ID,
          receiptNumber: 'TEST-IMMUT-001',
          transactionId,
          grossRevenue: 500,
          taxAmount: 80,
          discountAmount: 0,
          cogsAmount: 0,
          paymentBreakdown: { cash: 580 },
        });

        const entry = await tx.journalEntry.findFirst({
          where: { referenceId: transactionId },
        });

        expect(entry).not.toBeNull();

        // Attempting to update the entry directly should throw
        // IMMUTABILITY_VIOLATION (the db.$extends guard intercepts this).
        await expect(
          tx.journalEntry.update({
            where: { id: entry!.id },
            data: { description: 'TAMPERED' },
          }),
        ).rejects.toThrow();
      });
    });
  });
});
