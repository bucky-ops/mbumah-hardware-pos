// v2.50.0 E2E DB verification: payroll_disbursed rows + NotificationLog + payslip states
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient();

const runs = await db.payrollRun.findMany({
  orderBy: { createdAt: 'desc' },
  take: 2,
  select: { id: true, runType: true, status: true, paidAt: true },
});
for (const r of runs) {
  const details = await db.payrollDetail.findMany({
    where: { payrollRunId: r.id },
    select: { paymentStatus: true, paymentRef: true, payslipNumber: true },
    orderBy: { payslipNumber: 'asc' },
  });
  const counts = {};
  for (const d of details) counts[d.paymentStatus] = (counts[d.paymentStatus] ?? 0) + 1;
  console.log(`${r.runType} ${r.status} paidAt=${r.paidAt?.toISOString() ?? 'null'} states=${JSON.stringify(counts)}`);
  const refs = details.filter((d) => d.paymentRef).slice(0, 2);
  for (const d of refs) console.log(`   ${d.payslipNumber} ref=${d.paymentRef}`);
}

const notices = await db.notification.findMany({
  where: { category: 'HR', metadata: { contains: 'payroll_disbursed' } },
  orderBy: { createdAt: 'desc' },
  take: 8,
});
console.log('== payroll_disbursed notification rows ==');
for (const n of notices) {
  const meta = JSON.parse(n.metadata ?? '{}');
  const user = n.userId ? await db.user.findUnique({ where: { id: n.userId }, select: { email: true } }) : null;
  console.log(`${n.createdAt.toISOString()} | to=${user?.email ?? n.userId} | "${n.title}" | run=${meta.runId?.slice(-6)} | emailStatus=${meta.emailStatus}`);
  console.log(`   msg: ${n.message.slice(0, 150)}`);
}

const logs = await db.notificationLog.findMany({
  where: { type: 'PAYROLL_DISBURSED' },
  orderBy: { createdAt: 'desc' },
  take: 4,
});
console.log('== NotificationLog PAYROLL_DISBURSED ==');
for (const l of logs) {
  const meta = l.metadata ? JSON.parse(l.metadata) : {};
  console.log(`${l.createdAt.toISOString()} | to=${l.recipient.slice(0, 60)} | ${l.status} | mode=${meta.mode} | csv=${meta.csvFilename ?? 'none'}`);
}

await db.$disconnect();
