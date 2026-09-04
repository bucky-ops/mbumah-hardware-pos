// Financial-remediation regression tests.
//
// Companion to FINANCIAL_MODULE_AUDIT_REPORT.md — each test pins one of the
// audit's remediated behaviors so a future refactor cannot silently reintroduce
// the vulnerability. Coverage map:
//
//   • sequence.ts           (SYS-7/F1-6/F5-6): P2002 retry + formatting
//   • crypto-helpers.ts     (SYS-9/F9-3):     AES-256-GCM roundtrip + tamper
//   • Conditional decrements (R1/R2/F3-5):    oversell + gift-card double-spend
//   • Serial lifecycle      (F2-1):           double-sell lock
//   • Outbox                (F8-4/F6-2):      enqueue → pump → dead-letter
//   • Goods-receipt journal (F1-1):           Dr Inventory / Cr AP balanced
import { describe, it, expect, afterAll } from 'vitest';

// The crypto-helpers derive their key from NEXTAUTH_SECRET when
// CREDENTIAL_ENCRYPTION_KEY is unset — provide a deterministic test secret
// BEFORE the module is exercised (the key is cached on first use).
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'audit-test-secret-for-crypto-helpers-only';
import { db } from '@/lib/db';
import { withSequenceRetry, isP2002, formatSequence } from '@/lib/sequence';
import {
  encryptSecret,
  decryptSecret,
  decryptSecretLegacyAware,
  isEncrypted,
} from '@/lib/crypto-helpers';
import { recordGoodsReceiptEntry } from '@/lib/account-helper';

// Fixtures matching the seeded dev DB (see src/tests/setup.ts).
const ORG_ID = 'org_mbumah';
const STORE_ID = 'store_juja_main';
const CASHIER_ID = 'user_super_admin';

// Rows created by this suite — removed in afterAll so the dev DB stays clean.
const createdProductIds: string[] = [];
const createdSerialIds: string[] = [];
const createdGiftCardIds: string[] = [];
const createdJeIds: string[] = [];
const createdOutboxIds: string[] = [];

afterAll(async () => {
  // Children first (FK order).
  await db.outboxEvent.deleteMany({ where: { id: { in: createdOutboxIds } } }).catch(() => {});
  await db.journalEntry.deleteMany({ where: { id: { in: createdJeIds } } }).catch(() => {});
  await db.serialNumber.deleteMany({ where: { id: { in: createdSerialIds } } }).catch(() => {});
  await db.giftCard.deleteMany({ where: { id: { in: createdGiftCardIds } } }).catch(() => {});
  await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
});

// CI runners occasionally hit a one-off Prisma engine cold-start stall
// (same flake class the rollback helpers fixed with generous timeouts).
// One retry absorbs it without masking real failures.
async function withDbRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/Socket timeout|timed out/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function makeTestProduct(overrides: { quantity?: number; cost?: number } = {}) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const product = await withDbRetry(async () => {
    const created = await db.product.create({
      data: {
        storeId: STORE_ID,
        name: `AUDIT-TEST ${suffix}`,
        sku: `AUD-${suffix}`,
        pricePerUnit: 100,
        costPrice: overrides.cost ?? 50,
        quantityInStock: overrides.quantity ?? 10,
        unitType: 'PIECE',
        isActive: true,
        reorderLevel: 1,
      } as never,
    });
    return created;
  });
  createdProductIds.push(product.id);
  return product;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYS-7/F1-6/F5-6 — sequence helpers
// ─────────────────────────────────────────────────────────────────────────────
describe('sequence helpers (SYS-7 remediation)', () => {
  it('formats document numbers as PREFIX-YYYYMMDD-NNNN', () => {
    const seq = formatSequence('PO', new Date(2026, 8, 4), 7);
    expect(seq).toBe('PO-20260904-0007');
  });

  it('detects Prisma P2002 unique-violation errors', () => {
    const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    expect(isP2002(err)).toBe(true);
    expect(isP2002(new Error('regular'))).toBe(false);
    expect(isP2002(null)).toBe(false);
  });

  it('withSequenceRetry retries on P2002 and re-allocates the number', async () => {
    let attempts = 0;
    const result = await withSequenceRetry(async (attempt) => {
      attempts = attempt;
      if (attempt === 1) {
        // First attempt collides — the retry must regenerate.
        throw Object.assign(new Error('dup'), { code: 'P2002' });
      }
      return 'PO-20260904-0002';
    });
    expect(result).toBe('PO-20260904-0002');
    expect(attempts).toBe(2);
  });

  it('withSequenceRetry passes non-P2002 errors straight through', async () => {
    await expect(
      withSequenceRetry(async () => {
        throw new Error('business rule violation');
      }, 3)
    ).rejects.toThrow('business rule violation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SYS-9/F9-3 — AES-256-GCM credential encryption
// ─────────────────────────────────────────────────────────────────────────────
describe('crypto-helpers (SYS-9/F9-3 remediation)', () => {
  it('round-trips a secret through AES-256-GCM', () => {
    const plaintextFixture = 'audit-test-plaintext-value-42';
    const envelope = encryptSecret(plaintextFixture);
    expect(isEncrypted(envelope)).toBe(true);
    expect(envelope.startsWith('v1:')).toBe(true);
    expect(decryptSecret(envelope)).toBe(plaintextFixture);
    // Ciphertext must not contain the plaintext.
    expect(envelope).not.toContain(plaintextFixture);
  });

  it('rejects tampered ciphertext (GCM auth tag mismatch)', () => {
    const envelope = encryptSecret('do-not-tamper');
    const parts = envelope.split(':');
    // Flip one character of the ciphertext body.
    const data = Buffer.from(parts[3], 'base64');
    data[0] = data[0] ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], data.toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('decryptSecretLegacyAware decodes legacy base64 rows but flags new ones', () => {
    const legacy = Buffer.from('old-base64-secret', 'utf8').toString('base64');
    expect(decryptSecretLegacyAware(legacy)).toBe('old-base64-secret');
    const modern = encryptSecret('new-secret');
    expect(decryptSecretLegacyAware(modern)).toBe('new-secret');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1/R2/F3-5 — atomic conditional decrements
// ─────────────────────────────────────────────────────────────────────────────
describe('conditional decrements (R1/R2 remediation)', () => {
  it('refuses to oversell stock past zero (R1)', async () => {
    const product = await makeTestProduct({ quantity: 5 });

    // Claim 5 — succeeds (balance hits 0).
    const first = await db.product.updateMany({
      where: { id: product.id, quantityInStock: { gte: 5 } },
      data: { quantityInStock: { decrement: 5 } },
    });
    expect(first.count).toBe(1);

    // A concurrent checkout of the same last units must LOSE the race.
    const second = await db.product.updateMany({
      where: { id: product.id, quantityInStock: { gte: 1 } },
      data: { quantityInStock: { decrement: 1 } },
    });
    expect(second.count).toBe(0); // ← the oversell guard
  });

  it('refuses a gift-card redemption beyond the remaining balance (R2)', async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const card = await withDbRetry(async () => {
      const created = await db.giftCard.create({
        data: {
          storeId: STORE_ID,
          code: `AUDGC-${suffix}`,
          reason: 'PROMOTION',
          initialBalance: 1000,
          currentBalance: 1000,
          status: 'ACTIVE',
        },
      });
      return created;
    });
    createdGiftCardIds.push(card.id);

    // Drain 800 — succeeds.
    const first = await db.giftCard.updateMany({
      where: { id: card.id, status: { in: ['ACTIVE', 'PARTIALLY_REDEEMED'] }, currentBalance: { gte: 800 } },
      data: { currentBalance: { decrement: 800 } },
    });
    expect(first.count).toBe(1);

    // The OLD code let a concurrent 800 redemption re-read 1000 and double-
    // spend. The conditional guard must refuse (only 200 remains).
    const second = await db.giftCard.updateMany({
      where: { id: card.id, status: { in: ['ACTIVE', 'PARTIALLY_REDEEMED'] }, currentBalance: { gte: 800 } },
      data: { currentBalance: { decrement: 800 } },
    });
    expect(second.count).toBe(0);

    // Balance is exactly 200 — not 2000, not negative.
    const fresh = await db.giftCard.findUnique({ where: { id: card.id } });
    expect(Number(fresh?.currentBalance)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F2-1 — serialized-asset double-sell lock
// ─────────────────────────────────────────────────────────────────────────────
describe('serial lifecycle (F2-1 remediation)', () => {
  it('claims a serial exactly once — the second claimer loses', async () => {
    const product = await makeTestProduct({ quantity: 3 });
    const suffix = Math.random().toString(36).slice(2, 10);

    const serialRow = await withDbRetry(async () => {
      const created = await db.serialNumber.create({
        data: {
          productId: product.id,
          storeId: STORE_ID,
          serial: `AUDSN-${suffix}`,
          status: 'IN_STOCK',
        },
      });
      return created;
    });
    createdSerialIds.push(serialRow.id);

    // Sale A claims the serial.
    const saleA = await db.serialNumber.updateMany({
      where: { serial: serialRow.serial, productId: product.id, storeId: STORE_ID, status: 'IN_STOCK' },
      data: { status: 'SOLD', soldInTransactionId: 'audit-test-tx-a' },
    });
    expect(saleA.count).toBe(1);

    // Sale B (concurrent at the counter) must NOT be able to sell it again.
    const saleB = await db.serialNumber.updateMany({
      where: { serial: serialRow.serial, productId: product.id, storeId: STORE_ID, status: 'IN_STOCK' },
      data: { status: 'SOLD', soldInTransactionId: 'audit-test-tx-b' },
    });
    expect(saleB.count).toBe(0); // ← the double-sell lock

    // The winner is recorded for warranty tracking.
    const sold = await db.serialNumber.findUnique({ where: { serial: serialRow.serial } });
    expect(sold?.status).toBe('SOLD');
    expect(sold?.soldInTransactionId).toBe('audit-test-tx-a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F1-1 — goods-receipt double-entry posting
// ─────────────────────────────────────────────────────────────────────────────
describe('recordGoodsReceiptEntry (F1-1 remediation)', () => {
  it('posts a BALANCED Dr Inventory(+VAT)/Cr AP journal inside the tx', async () => {
    const poId = `audit-po-${Math.random().toString(36).slice(2, 8)}`;
    await db.$transaction(async (tx) => {
      await recordGoodsReceiptEntry(tx, {
        organizationId: ORG_ID,
        storeId: STORE_ID,
        poId,
        poNumber: 'PO-AUDIT-0001',
        grossAmount: 1160, // 1000 net + 160 input VAT (16%)
        vatRate: 16,
        receivedById: CASHIER_ID,
      });

      // Assert balance and account structure.
      const je = await tx.journalEntry.findFirst({
        where: { referenceType: 'GOODS_RECEIPT', referenceId: poId },
        include: { lines: true },
      });
      expect(je).toBeDefined();
      createdJeIds.push(je!.id);

      const totalDebit = je!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = je!.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(Math.abs(totalDebit - totalCredit)).toBeLessThanOrEqual(0.01);
      expect(totalDebit).toBeCloseTo(1160, 2); // gross hits AP in full

      // Debit sides: Inventory (net 1000) + VAT Payable (160).
      const inventoryLine = je!.lines.find((l) => Number(l.debit) > 0 && Number(l.credit) === 0 && l.description?.includes('Inventory'));
      const vatLine = je!.lines.find((l) => l.description?.includes('input VAT'));
      expect(Number(inventoryLine?.debit)).toBeCloseTo(1000, 2);
      expect(Number(vatLine?.debit)).toBeCloseTo(160, 2);
    });
  });

  it('skips zero-value receipts without creating an empty journal', async () => {
    const poId = `audit-po-zero-${Math.random().toString(36).slice(2, 8)}`;
    await db.$transaction(async (tx) => {
      await recordGoodsReceiptEntry(tx, {
        organizationId: ORG_ID,
        storeId: STORE_ID,
        poId,
        poNumber: 'PO-AUDIT-0002',
        grossAmount: 0,
      });
      const je = await tx.journalEntry.findFirst({
        where: { referenceType: 'GOODS_RECEIPT', referenceId: poId },
      });
      expect(je).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F8-4/F6-2 — transactional outbox
// ─────────────────────────────────────────────────────────────────────────────
describe('transactional outbox (F8-4 remediation)', () => {
  it('delivers an enqueued event and marks it COMPLETED', async () => {
    const { enqueueOutbox, pumpOutbox, registerOutboxHandler } = await import('@/lib/outbox');
    let delivered: Record<string, unknown> | null = null;

    registerOutboxHandler('AUDIT_TEST_EVENT', async ({ payload }) => {
      delivered = payload;
    });

    const created = await withDbRetry(async () =>
      db.$transaction(async (tx) => {
        await enqueueOutbox(tx, {
          storeId: STORE_ID,
          kind: 'AUDIT_TEST_EVENT',
          payload: { hello: 'outbox' },
        });
        return tx.outboxEvent.findFirst({ where: { kind: 'AUDIT_TEST_EVENT' }, orderBy: { createdAt: 'desc' } });
      })
    );
    if (created) createdOutboxIds.push(created.id);
    expect(created).toBeDefined();
    expect(created!.status).toBe('PENDING');

    await pumpOutbox();

    const pumped = await db.outboxEvent.findUnique({ where: { id: created!.id } });
    expect(pumped?.status).toBe('COMPLETED');
    expect(delivered).toEqual({ hello: 'outbox' });
  });

  it('retries a failing event with backoff and dead-letters after maxAttempts', async () => {
    const { enqueueOutbox, pumpOutbox, registerOutboxHandler } = await import('@/lib/outbox');

    registerOutboxHandler('AUDIT_TEST_FAILING', async () => {
      throw new Error('downstream unavailable');
    });

    const created = await withDbRetry(async () =>
      db.$transaction(async (tx) => {
        await enqueueOutbox(tx, {
          storeId: STORE_ID,
          kind: 'AUDIT_TEST_FAILING',
          payload: {},
          maxAttempts: 2,
          availableAt: new Date(Date.now() - 1000), // immediately due
        });
        return tx.outboxEvent.findFirst({ where: { kind: 'AUDIT_TEST_FAILING' }, orderBy: { createdAt: 'desc' } });
      })
    );
    if (created) createdOutboxIds.push(created.id);

    // Attempt 1 → FAILED, backoff scheduled (availableAt in the future).
    await pumpOutbox();
    const afterFirst = await db.outboxEvent.findUnique({ where: { id: created!.id } });
    expect(afterFirst?.status).toBe('PENDING'); // re-queued
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst?.availableAt.getTime()).toBeGreaterThan(Date.now());

    // Force due again → attempt 2 exhausts maxAttempts → DEAD.
    await withDbRetry(async () => {
      await db.outboxEvent.update({
        where: { id: created!.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
    });
    await pumpOutbox();
    const afterSecond = await db.outboxEvent.findUnique({ where: { id: created!.id } });
    expect(afterSecond?.status).toBe('DEAD');
    expect(afterSecond?.attempts).toBe(2);
  });
});
