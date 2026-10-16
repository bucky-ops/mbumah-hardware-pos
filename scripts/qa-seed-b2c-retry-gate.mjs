#!/usr/bin/env node
/**
 * QA fixture: seed the three B2C retry-gate states into the October LOCKED run
 * (dev DB only) so the run dialog renders all chip surfaces E2E:
 *   - J M …m3061q  → PENDING payment, 2 OLD failed attempts  → emerald "retry ready"
 *   - P K …8curfs  → PENDING payment, 1 FRESH failed attempt → amber "retry in 2m"
 *   - M W …mghn4zi → PENDING payment, 5 failed attempts      → rose "manual review"
 * Idempotent: payslip paymentStatus reset + failed txs de-duplicated by a
 * marker in resultDesc. Run: node scripts/qa-seed-b2c-retry-gate.mjs
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

const TARGETS = [
  { detailId: 'cmvabfung000fp8z3jzm3061q', phone: '254711000201', amount: '60692.65', failedCount: 2, agesMin: [130, 128] },
  { detailId: 'cmvabfunj000jp8z3ua8curfs', phone: '254711000204', amount: '33572.65', failedCount: 1, agesMin: [0.2] },
  { detailId: 'cmvabfuni000hp8z3wmghn4zi', phone: '254711000203', amount: '41606.65', failedCount: 5, agesMin: [300, 260, 220, 180, 140] },
];

async function main() {
  const store = await db.store.findFirst({ select: { id: true } });
  if (!store) throw new Error('No store in dev DB');

  for (const t of TARGETS) {
    await db.payrollDetail.update({
      where: { id: t.detailId },
      data: { paymentStatus: 'PENDING', paymentRef: null, paymentDate: null },
    });
    // De-dup previous fixture runs (marker in resultDesc).
    await db.mpesaTransaction.deleteMany({
      where: { payrollDetailId: t.detailId, resultDesc: { contains: '[qa-retry-gate]' } },
    });
    const now = Date.now();
    for (let i = 0; i < t.failedCount; i++) {
      await db.mpesaTransaction.create({
        data: {
          storeId: store.id,
          phoneNumber: t.phone,
          amount: t.amount,
          status: 'FAILED',
          resultCode: '1',
          resultDesc: `[qa-retry-gate] The beneficiary account is inactive (attempt ${i + 1})`,
          payrollDetailId: t.detailId,
          createdAt: new Date(now - t.agesMin[i] * 60 * 1000),
        },
      });
    }
    console.log(`seeded ${t.detailId.slice(-6)}: PENDING payment + ${t.failedCount} FAILED attempt(s)`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
