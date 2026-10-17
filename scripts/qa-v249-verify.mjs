// v2.49.0 E2E DB verification: payslip_issued rows + NotificationLog + payslips
const DATABASE_URL = 'file:/home/z/ems/prisma/prisma/dev.db';
process.env.DATABASE_URL = DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient();
const RUN_ID = 'cmvbs6mr60009pusah48wnbe5';

const run = await db.payrollRun.findUnique({ where: { id: RUN_ID }, select: { status: true, postedAt: true, postedByUserId: true, preparedByUserId: true } });
console.log('run:', JSON.stringify(run));

const slips = await db.payrollDetail.findMany({
  where: { payrollRunId: RUN_ID },
  select: { payslipNumber: true, netPay: true, paymentStatus: true, employee: { select: { firstName: true, lastName: true, userId: true } } },
  orderBy: { payslipNumber: 'asc' },
});
console.log('== Payslips ==');
for (const s of slips) console.log(`${s.payslipNumber} | ${s.employee.firstName} ${s.employee.lastName} | net ${s.netPay} | user=${s.employee.userId ?? 'NONE'}`);

const notices = await db.notification.findMany({
  where: { category: 'HR', metadata: { contains: 'payslip_issued' } },
  orderBy: { createdAt: 'desc' },
  take: 5,
});
console.log('== payslip_issued notification rows ==');
for (const n of notices) {
  const meta = JSON.parse(n.metadata ?? '{}');
  const user = n.userId ? await db.user.findUnique({ where: { id: n.userId }, select: { email: true } }) : null;
  console.log(`${n.createdAt.toISOString()} | to=${user?.email ?? n.userId} | "${n.title}" | action=${n.actionUrl} | run=${meta.runId?.slice(-6)} | period=${meta.periodName}`);
  console.log(`   msg: ${n.message.slice(0, 130)}`);
}

const logs = await db.notificationLog.findMany({
  where: { type: 'PAYSLIP_ISSUED' },
  orderBy: { createdAt: 'desc' },
  take: 5,
});
console.log('== NotificationLog PAYSLIP_ISSUED ==');
for (const l of logs) console.log(`${l.createdAt.toISOString()} | to=${l.recipient} | ${l.status} | ${l.subject.slice(0, 70)}`);

await db.$disconnect();
