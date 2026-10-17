// E2E prep check: portal-linked employees, period/run state for v2.49.0 QA
const DATABASE_URL = 'file:/home/z/ems/prisma/prisma/dev.db';
process.env.DATABASE_URL = DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient();

const linked = await db.employee.findMany({
  where: { userId: { not: null } },
  select: { id: true, firstName: true, lastName: true, employeeCode: true, userId: true, email: true, storeId: true, status: true },
});
console.log('== Portal-linked employees ==');
for (const e of linked) console.log(`${e.firstName} ${e.lastName} | ${e.employeeCode} | user=${e.userId} | email=${e.email} | store=${e.storeId} | ${e.status}`);

const periods = await db.payrollPeriod.findMany({
  orderBy: { startDate: 'desc' },
  take: 3,
  select: { id: true, name: true, status: true, storeId: true },
});
console.log('== Recent periods ==');
for (const p of periods) console.log(`${p.name} | ${p.status} | store=${p.storeId}`);

const runs = await db.payrollRun.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { id: true, runType: true, status: true, payrollPeriodId: true, storeId: true, employeeCount: true, journalEntryId: true },
});
console.log('== Recent runs ==');
for (const r of runs) console.log(`${r.id} | ${r.runType} | ${r.status} | period=${r.payrollPeriodId} | n=${r.employeeCount} | journal=${r.journalEntryId ? 'yes' : 'no'}`);

const users = await db.user.findMany({
  where: { isActive: true },
  select: { id: true, email: true, name: true, role: true, storeId: true },
  take: 12,
});
console.log('== Active users ==');
for (const u of users) console.log(`${u.email} | ${u.name} | ${u.role} | store=${u.storeId ?? 'null'}`);

await db.$disconnect();
