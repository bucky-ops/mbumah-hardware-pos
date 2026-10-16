// QA helper: simulate one FAILED B2C attempt and one STUCK PROCESSING
// transaction on the October 2026 run so the retry/refresh flows can be
// exercised end-to-end. Direct DB writes are acceptable here because this is
// the hermetic QA database (the app's immutability guard lives in db.ts,
// not in SQLite).
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

const RUN_ID = 'cmvabfumo0009p8z3wq670kaq';

async function main() {
const details = await db.payrollDetail.findMany({
  where: { payrollRunId: RUN_ID },
  orderBy: { id: 'asc' },
  include: { employee: { select: { employeeCode: true, phone: true } } },
});

const [failTarget, stuckTarget] = details;

// 1. FAILED simulation: payslip PENDING again, latest tx FAILED (claimed).
await db.payrollDetail.update({
  where: { id: failTarget.id },
  data: { paymentStatus: 'PENDING', paymentRef: null, paymentDate: null },
});
const failTx = await db.mpesaTransaction.findFirst({
  where: { payrollDetailId: failTarget.id },
  orderBy: { createdAt: 'desc' },
});
await db.mpesaTransaction.update({
  where: { id: failTx.id },
  data: {
    status: 'FAILED',
    callbackReceived: true,
    resultDesc: 'Simulated failure: recipient not registered (QA)',
  },
});

// 2. STUCK simulation: payslip PENDING, PROCESSING tx with no callback 20 min old.
await db.payrollDetail.update({
  where: { id: stuckTarget.id },
  data: { paymentStatus: 'PENDING', paymentRef: null, paymentDate: null },
});
await db.mpesaTransaction.create({
  data: {
    storeId: stuckTarget.storeId,
    checkoutRequestId: `pb2c-qa-stuck-${Date.now()}`,
    phoneNumber: stuckTarget.employee.phone ?? '254700000000',
    amount: Number(stuckTarget.netPay),
    status: 'PROCESSING',
    callbackReceived: false,
    resultDesc: 'Accepted - queued (simulated stuck, QA)',
    createdAt: new Date(Date.now() - 20 * 60 * 1000),
    payrollDetailId: stuckTarget.id,
  },
});

console.log(
  JSON.stringify({
    failed: { detailId: failTarget.id, code: failTarget.employee.employeeCode },
    stuck: { detailId: stuckTarget.id, code: stuckTarget.employee.employeeCode },
  }),
);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
