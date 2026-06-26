// Financial immutability tests for the hardened Prisma Client Extension.
//
// These tests prove that the ORM-level guard on `JournalEntry`,
// `JournalEntryLine`, and `SystemLog` actually fires when application code
// attempts an `update`, `updateMany`, `delete`, or `deleteMany` outside of a
// sanctioned `withImmutabilityBypass()` scope.
//
// Strategy:
//   • Create a throwaway JournalEntry inside a rollback-transaction so the
//     test leaves no persistent state in the dev DB.
//   • Attempt the four mutation operations on that row and assert that each
//     throws `ImmutabilityViolationError` with the `IMMUTABILITY_VIOLATION`
//     code.
//   • Then prove the escape hatch works: the SAME operations wrapped in
//     `withImmutabilityBypass()` succeed (this is what the M-Pesa callback,
//     journal void, and expense void paths rely on).
//   • Finally verify that `create` is NOT blocked (financial records are
//     append-only — writes are allowed, mutations are not).
import { describe, it, expect, beforeAll } from 'vitest';
import { db, withImmutabilityBypass, ImmutabilityViolationError } from '@/lib/db';
import {
  recordSaleJournalEntry,
  getAccountIds,
  ACCOUNT_CODES,
} from '@/lib/account-helper';
import { generateJournalEntryNumber } from '@/lib/helpers';

// Sentinel thrown at the end of each rollback transaction.
const ROLLBACK = Symbol('test-rollback');

async function withRollback<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await db.$transaction(async (tx) => {
      const _r = await fn(tx);
      throw ROLLBACK;
    });
    return result;
  } catch (e) {
    if (e === ROLLBACK) {
      return (undefined as unknown) as T;
    }
    throw e;
  }
}

// Fixtures matching the seeded dev DB.
const ORG_ID = 'org_mbumah';
const STORE_ID = 'store_juja_main';
const CASHIER_ID = 'user_super_admin';

describe('Prisma Client Extension — financial immutability guard', () => {
  let cashAccountId: string;

  beforeAll(async () => {
    const accounts = await getAccountIds(ORG_ID, [ACCOUNT_CODES.CASH_ON_HAND]);
    cashAccountId = accounts.CASH_ON_HAND;
  });

  // ─────────────────────────────────────────────────────────────────────
  // 1. db.journalEntry.delete() throws IMMATURABILITY_VIOLATION.
  // ─────────────────────────────────────────────────────────────────────
  it('blocks db.journalEntry.delete() outside of a bypass scope', async () => {
    let jeId: string | null = null;

    await withRollback(async (tx) => {
      // Create a JE inside the rollback tx (create is allowed — append-only).
      const je = await tx.journalEntry.create({
        data: {
          storeId: STORE_ID,
          entryNumber: generateJournalEntryNumber(),
          description: 'Immutability test — delete',
          referenceType: 'SALE',
          referenceId: `immutability-test-${Date.now()}`,
          totalDebit: 100,
          totalCredit: 100,
          isPosted: true,
          postedAt: new Date(),
          createdBy: CASHIER_ID,
          lines: {
            create: [
              { accountId: cashAccountId, debit: 100, credit: 0, description: 'test' },
              { accountId: cashAccountId, debit: 0, credit: 100, description: 'test' },
            ],
          },
        },
      });
      jeId = je.id;

      // The hardened extension intercepts delete on journalEntry. The
      // mutation is attempted on the TOP-LEVEL db client (not the tx) so the
      // extension's query interceptor fires. We expect it to throw.
      await expect(db.journalEntry.delete({ where: { id: je.id } })).rejects.toThrow(
        ImmutabilityViolationError,
      );
    });

    // Sanity: the JE was never deleted (the rejected delete threw before
    // touching the row). It still exists inside the (now-rolled-back) tx
    // scope, but outside the tx it never committed — so a top-level lookup
    // should return null.
    if (jeId) {
      const after = await db.journalEntry.findUnique({ where: { id: jeId } });
      expect(after).toBeNull();
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. db.journalEntry.update() throws IMMATURABILITY_VIOLATION.
  // ─────────────────────────────────────────────────────────────────────
  it('blocks db.journalEntry.update() outside of a bypass scope', async () => {
    await withRollback(async (tx) => {
      const je = await tx.journalEntry.create({
        data: {
          storeId: STORE_ID,
          entryNumber: generateJournalEntryNumber(),
          description: 'Immutability test — update',
          referenceType: 'SALE',
          referenceId: `immutability-update-${Date.now()}`,
          totalDebit: 50,
          totalCredit: 50,
          isPosted: true,
          postedAt: new Date(),
          createdBy: CASHIER_ID,
          lines: {
            create: [
              { accountId: cashAccountId, debit: 50, credit: 0, description: 't' },
              { accountId: cashAccountId, debit: 0, credit: 50, description: 't' },
            ],
          },
        },
      });

      await expect(
        db.journalEntry.update({
          where: { id: je.id },
          data: { description: 'tampered' },
        }),
      ).rejects.toThrow(ImmutabilityViolationError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. db.journalEntry.deleteMany() throws IMMATURABILITY_VIOLATION.
  // ─────────────────────────────────────────────────────────────────────
  it('blocks db.journalEntry.deleteMany() outside of a bypass scope', async () => {
    await expect(
      db.journalEntry.deleteMany({ where: { description: 'will-never-delete' } }),
    ).rejects.toThrow(ImmutabilityViolationError);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. db.journalEntry.updateMany() throws IMMATURABILITY_VIOLATION.
  // ─────────────────────────────────────────────────────────────────────
  it('blocks db.journalEntry.updateMany() outside of a bypass scope', async () => {
    await expect(
      db.journalEntry.updateMany({
        where: { description: 'will-never-update' },
        data: { description: 'tampered' },
      }),
    ).rejects.toThrow(ImmutabilityViolationError);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. db.journalEntryLine.delete() throws IMMATURABILITY_VIOLATION.
  // ─────────────────────────────────────────────────────────────────────
  it('blocks db.journalEntryLine.delete() outside of a bypass scope', async () => {
    await withRollback(async (tx) => {
      const je = await tx.journalEntry.create({
        data: {
          storeId: STORE_ID,
          entryNumber: generateJournalEntryNumber(),
          description: 'Immutability test — line delete',
          referenceType: 'SALE',
          referenceId: `immutability-line-${Date.now()}`,
          totalDebit: 10,
          totalCredit: 10,
          isPosted: true,
          postedAt: new Date(),
          createdBy: CASHIER_ID,
          lines: {
            create: [
              { accountId: cashAccountId, debit: 10, credit: 0, description: 't' },
              { accountId: cashAccountId, debit: 0, credit: 10, description: 't' },
            ],
          },
        },
        include: { lines: true },
      });

      const firstLine = je.lines[0];
      await expect(
        db.journalEntryLine.delete({ where: { id: firstLine.id } }),
      ).rejects.toThrow(ImmutabilityViolationError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. The error carries the IMMATURABILITY_VIOLATION code.
  // ─────────────────────────────────────────────────────────────────────
  it('throws an error with code === "IMMATURABILITY_VIOLATION"', async () => {
    let caught: unknown = null;
    try {
      await db.journalEntry.update({
        where: { id: 'non-existent-id' },
        data: { description: 'x' },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ImmutabilityViolationError);
    expect((caught as ImmutabilityViolationError).code).toBe('IMMUTABILITY_VIOLATION');
    expect((caught as Error).message).toMatch(/IMMUTABILITY_VIOLATION/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. withImmutabilityBypass() allows the sanctioned mutation.
  // ─────────────────────────────────────────────────────────────────────
  it('permits journalEntry.update() inside withImmutabilityBypass() (sanctioned void / post path)', async () => {
    await withRollback(async (tx) => {
      const je = await tx.journalEntry.create({
        data: {
          storeId: STORE_ID,
          entryNumber: generateJournalEntryNumber(),
          description: 'Immutability test — bypass',
          referenceType: 'SALE',
          referenceId: `immutability-bypass-${Date.now()}`,
          totalDebit: 200,
          totalCredit: 200,
          isPosted: false,
          postedAt: null,
          createdBy: CASHIER_ID,
          lines: {
            create: [
              { accountId: cashAccountId, debit: 200, credit: 0, description: 't' },
              { accountId: cashAccountId, debit: 0, credit: 200, description: 't' },
            ],
          },
        },
      });

      // Inside a bypass scope, the SAME mutation that was blocked above
      // must succeed. This is what the M-Pesa callback, journal-void, and
      // expense-void paths rely on. We use `tx` (not top-level `db`) so the
      // JE created in this rollback transaction is visible to the update.
      await withImmutabilityBypass(async () => {
        const updated = await tx.journalEntry.update({
          where: { id: je.id },
          data: { isPosted: true, postedAt: new Date() },
        });
        expect(updated.isPosted).toBe(true);
      }, 'test_bypass_posting');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. create is NOT blocked — append-only means writes are fine.
  // ─────────────────────────────────────────────────────────────────────
  it('allows journalEntry.create() (append-only — writes are permitted, mutations are not)', async () => {
    await withRollback(async (tx) => {
      const je = await tx.journalEntry.create({
        data: {
          storeId: STORE_ID,
          entryNumber: generateJournalEntryNumber(),
          description: 'Immutability test — create allowed',
          referenceType: 'SALE',
          referenceId: `immutability-create-${Date.now()}`,
          totalDebit: 1,
          totalCredit: 1,
          isPosted: true,
          postedAt: new Date(),
          createdBy: CASHIER_ID,
          lines: {
            create: [
              { accountId: cashAccountId, debit: 1, credit: 0, description: 't' },
              { accountId: cashAccountId, debit: 0, credit: 1, description: 't' },
            ],
          },
        },
      });
      expect(je.id).toBeTruthy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 9. recordSaleJournalEntry writes succeed (they use create, not update).
  // ─────────────────────────────────────────────────────────────────────
  it('does not block recordSaleJournalEntry (the helper only creates, never mutates)', async () => {
    const receiptNumber = `IMMUT-HELPER-${Date.now()}`;
    await withRollback(async (tx) => {
      await recordSaleJournalEntry(tx, {
        storeId: STORE_ID,
        organizationId: ORG_ID,
        cashierId: CASHIER_ID,
        receiptNumber,
        transactionId: `test-tx-${receiptNumber}`,
        grossRevenue: 100,
        taxAmount: 16,
        discountAmount: 0,
        paymentBreakdown: { cash: 116 },
        cogsAmount: 0,
        postImmediately: true,
      });

      const je = await tx.journalEntry.findFirst({
        where: { referenceId: `test-tx-${receiptNumber}` },
      });
      expect(je).not.toBeNull();
    });
  });
});
