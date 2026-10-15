// One-off QA seed for the :3100 hermetic dev database (v2.18.9 browser QA):
// consent records + approved attendance for the seeded employees so the full
// payroll lifecycle can be exercised end-to-end in the browser.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

const EMPLOYEES = ['emp_david_otieno', 'emp_grace_achieng', 'emp_john_mwangi', 'emp_mary_wanjiku', 'emp_peter_kamau'];

async function main() {
  // 1. Payroll-processing consents (idempotent).
  for (const employeeId of EMPLOYEES) {
    const existing = await db.consentRecord.findFirst({
      where: { employeeId, purpose: 'PAYROLL_PROCESSING', withdrawnAt: null },
    });
    if (!existing) {
      await db.consentRecord.create({
        data: {
          employeeId,
          purpose: 'PAYROLL_PROCESSING',
          scope: 'Compute salary, statutory deductions, and payslips',
          policyVersion: 'hr-policy-2026-01',
          lawfulBasis: 'CONTRACT',
          grantedAt: new Date('2025-11-01T00:00:00Z'),
        },
      });
      console.log('consent created for', employeeId);
    }
  }

  // 2. Approved attendance for January 2026 weekdays (idempotent per date).
  const approver = 'system';
  let created = 0;
  for (const employeeId of EMPLOYEES) {
    for (let day = 5; day <= 9; day += 1) {
      const date = new Date(Date.UTC(2026, 0, day));
      const existing = await db.attendanceRecord.findFirst({
        where: { employeeId, date },
      });
      if (!existing) {
        await db.attendanceRecord.create({
          data: {
            employeeId,
            storeId: 'store_juja_main',
            date,
            checkIn: new Date(Date.UTC(2026, 0, day, 8, 0)),
            checkOut: new Date(Date.UTC(2026, 0, day, 17, 0)),
            status: 'PRESENT',
            timesheetApprovedByUserId: approver,
            timesheetApprovedAt: new Date(Date.UTC(2026, 0, 12)),
          },
        });
        created += 1;
      }
    }
  }
  console.log('attendance records created:', created);
  console.log('rateTables:', await db.rateTable.count());
  console.log('consents:', await db.consentRecord.count());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
