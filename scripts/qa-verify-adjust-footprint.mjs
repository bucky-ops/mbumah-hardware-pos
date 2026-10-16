// QA verify (v2.36.0): check the adjustment left the full governance footprint:
//   1. notification bell row (kind=leave_balance_adjusted) to the employee user
//   2. email log row (type=LEAVE_BALANCE_ADJUSTED)
//   3. hash-chained audit row (action=LEAVE_BALANCE_ADJUSTED)
// Run: DATABASE_URL='file:/home/z/ems/prisma/prisma/dev.db' node scripts/qa-verify-adjust-footprint.mjs
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const notifs = await db.notification.findMany({
    where: { metadata: { contains: 'leave_balance_adjusted' } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, title: true, message: true, actionUrl: true, userId: true, createdAt: true },
  });
  console.log('== notifications ==');
  for (const n of notifs) console.log(JSON.stringify(n));

  const emails = await db.notificationLog.findMany({
    where: { type: 'LEAVE_BALANCE_ADJUSTED' },
    orderBy: { sentAt: 'desc' },
    take: 3,
    select: { id: true, recipient: true, subject: true, type: true, sentAt: true },
  }).catch((e) => {
    console.log('emailLog query failed:', e.message);
    return [];
  });
  console.log('== notificationLog ==');
  for (const e of emails) console.log(JSON.stringify(e));

  const audits = await db.auditLog.findMany({
    where: { action: 'LEAVE_BALANCE_ADJUSTED' },
    orderBy: { timestamp: 'desc' },
    take: 3,
    select: { id: true, entityType: true, entityId: true, action: true, reason: true, newValues: true, userId: true, timestamp: true },
  });
  console.log('== auditLog ==');
  for (const a of audits) console.log(JSON.stringify(a));

  const bal = await db.employeeLeaveBalance.findFirst({
    where: { employee: { employeeCode: 'MBH-1-001' }, leaveType: { code: 'ANNUAL' }, leaveYear: 2026 },
    select: { allocatedDays: true, notes: true },
  });
  console.log('== balance MBH-1-001/ANNUAL/2026 ==');
  console.log(JSON.stringify(bal, null, 1));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
