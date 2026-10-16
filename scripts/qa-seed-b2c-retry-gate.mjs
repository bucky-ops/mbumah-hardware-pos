#!/usr/bin/env node
/**
 * QA fixture (dev DB only): create an October 2026 LOCKED payroll run with
 * per-employee payslips, then seed the three B2C retry-gate states so the
 * run dialog renders every chip surface E2E:
 *   - John Mwangi  → 2 OLD failed attempts (2h+)  → emerald "retry ready"
 *   - Peter Kamau  → 1 FRESH failed attempt       → amber "retry in 2m"
 *   - Mary Wanjiku → 5 failed attempts            → rose "manual review"
 * Grace Achieng stays COMPLETED/PAID as the control row.
 * Idempotent: keyed on the idempotencyKey 'qa-b2c-gate-oct-2026'; failed txs
 * de-duplicated by the [qa-retry-gate] marker in resultDesc.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

const RUN_KEY = 'qa-b2c-gate-oct-2026';

const TARGETS = [
  { lastName: 'Mwangi', failedCount: 2, agesMin: [130, 128], net: '60692.65' },
  { lastName: 'Kamau', failedCount: 1, agesMin: [0.2], net: '33572.65' },
  { lastName: 'Wanjiku', failedCount: 5, agesMin: [300, 260, 220, 180, 140], net: '41606.65' },
  { lastName: 'Achieng', failedCount: 0, agesMin: [], net: '37280.65' },
];

async function main() {
  const store = await db.store.findFirst();
  if (!store) throw new Error('No store in dev DB');
  const admin = await db.user.findUnique({ where: { email: 'admin@mbumahhardware.co.ke' } });
  if (!admin) throw new Error('admin user missing');

  let run = await db.payrollRun.findUnique({ where: { idempotencyKey: RUN_KEY } });
  if (!run) {
    let period = await db.payrollPeriod.findFirst({ where: { storeId: store.id, name: 'October 2026' } });
    if (!period) {
      period = await db.payrollPeriod.create({
        data: {
          storeId: store.id,
          name: 'October 2026',
          startDate: new Date(Date.UTC(2026, 9, 1)),
          endDate: new Date(Date.UTC(2026, 9, 31)),
          payDate: new Date(Date.UTC(2026, 9, 28)),
          status: 'PROCESSING',
          periodType: 'MONTHLY',
        },
      });
      console.log('PayrollPeriod October 2026 created');
    }
    run = await db.payrollRun.create({
      data: {
        payrollPeriodId: period.id,
        storeId: store.id,
        runType: 'REGULAR',
        status: 'LOCKED',
        initiatedBy: admin.id,
        preparedByUserId: admin.id,
        preparedAt: new Date(),
        approvedByUserId: admin.id,
        approvedAt: new Date(),
        postedByUserId: admin.id,
        postedAt: new Date(),
        lockedByUserId: admin.id,
        lockedAt: new Date(),
        idempotencyKey: RUN_KEY,
        employeeCount: TARGETS.length,
      },
    });
    console.log('PayrollRun (LOCKED) created:', run.id);
  } else {
    console.log('Run already exists:', run.id);
  }

  const now = Date.now();
  for (const t of TARGETS) {
    const emp = await db.employee.findFirst({ where: { lastName: t.lastName } });
    if (!emp) throw new Error(`Employee ${t.lastName} missing`);
    let detail = await db.payrollDetail.findFirst({ where: { payrollRunId: run.id, employeeId: emp.id } });
    if (!detail) {
      detail = await db.payrollDetail.create({
        data: {
          payrollRunId: run.id,
          employeeId: emp.id,
          storeId: store.id,
          basicSalary: Number(t.net) * 0.8,
          grossPay: Number(t.net),
          totalDeductions: 0,
          netPay: t.net,
          paymentStatus: t.failedCount === 0 ? 'PAID' : 'PENDING',
          paymentDate: t.failedCount === 0 ? new Date() : null,
          daysWorked: 22,
        },
      });
      console.log(`detail for ${t.lastName}: created (${t.failedCount === 0 ? 'PAID' : 'PENDING'})`);
    } else {
      await db.payrollDetail.update({
        where: { id: detail.id },
        data: { paymentStatus: t.failedCount === 0 ? 'PAID' : 'PENDING', paymentRef: null, paymentDate: t.failedCount === 0 ? new Date() : null },
      });
      console.log(`detail for ${t.lastName}: reset to ${t.failedCount === 0 ? 'PAID' : 'PENDING'}`);
    }

    await db.mpesaTransaction.deleteMany({
      where: { payrollDetailId: detail.id, resultDesc: { contains: '[qa-retry-gate]' } },
    });
    for (let i = 0; i < t.failedCount; i++) {
      await db.mpesaTransaction.create({
        data: {
          storeId: store.id,
          phoneNumber: '25471100020' + (i + 1),
          amount: t.net,
          status: 'FAILED',
          resultCode: '1',
          resultDesc: `[qa-retry-gate] The beneficiary account is inactive (attempt ${i + 1})`,
          payrollDetailId: detail.id,
          createdAt: new Date(now - t.agesMin[i] * 60 * 1000),
        },
      });
    }
    if (t.failedCount > 0) console.log(`  + ${t.failedCount} FAILED B2C tx(s)`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
