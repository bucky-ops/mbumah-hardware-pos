// E2E seed for v2.136.0: one unapproved attendance day inside October 2026
// (the OPEN period), on an ACTIVE consented employee. Throwaway — QA only.
const { PrismaClient } = require('/home/z/ems/node_modules/@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } } });

(async () => {
  const period = await db.payrollPeriod.findFirst({
    where: { name: 'October 2026' },
    select: { id: true, name: true, startDate: true, endDate: true, status: true },
  });
  if (!period) throw new Error('October 2026 period not found');

  const employee = await db.employee.findFirst({
    where: { deletedAt: null, status: 'ACTIVE', employeeCode: 'MBH-1-001' },
    select: { id: true, employeeCode: true, firstName: true, lastName: true },
  });
  if (!employee) throw new Error('MBH-1-001 not found');

  const consent = await db.consentRecord.findFirst({
    where: { employeeId: employee.id, withdrawnAt: null },
    select: { id: true },
  });

  const day = new Date('2026-10-16T00:00:00.000Z');
  const existing = await db.attendanceRecord.findFirst({
    where: { employeeId: employee.id, date: day },
  });
  let recordId;
  if (existing) {
    await db.attendanceRecord.delete({ where: { id: existing.id } });
  }
  const record = await db.attendanceRecord.create({
    data: {
      employeeId: employee.id,
      storeId: period.id && (await db.payrollPeriod.findFirst({ where: { id: period.id }, select: { storeId: true } })).storeId,
      date: day,
      checkIn: new Date('2026-10-16T08:00:00.000Z'),
      checkOut: new Date('2026-10-16T17:00:00.000Z'),
      workingHours: 8,
      expectedHours: 8,
      timesheetApprovedByUserId: null,
      timesheetApprovedAt: null,
    },
  });
  recordId = record.id;

  console.log(JSON.stringify({
    period: { id: period.id, name: period.name, status: period.status },
    employee: { id: employee.id, code: employee.employeeCode, name: `${employee.firstName} ${employee.lastName}` },
    consentOnFile: consent !== null,
    recordId,
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
