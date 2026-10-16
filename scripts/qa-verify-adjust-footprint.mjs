// QA verify (v2.36.0): check the adjustment left the full governance footprint:
//   1. notification bell row (kind=leave_balance_adjusted) to the employee user
//   2. email log row (type=LEAVE_BALANCE_ADJUSTED)
//   3. hash-chained audit row (action=LEAVE_BALANCE_ADJUSTED)
// The bell leg only exists when the employee has a linked portal user — the
// script resolves the linkage and asserts accordingly (v2.36.0 QA finding:
// MBH-1-001 has no portal user, so its footprint is email + audit only).
// Usage:
//   DATABASE_URL='file:/home/z/ems/prisma/prisma/dev.db' \
//     node scripts/qa-verify-adjust-footprint.mjs [employeeCode=MBH-1-005] [typeCode=ANNUAL] [year=2026]
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const code = process.argv[2] ?? 'MBH-1-005';
const typeCode = process.argv[3] ?? 'ANNUAL';
const year = Number(process.argv[4] ?? 2026);
let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label}`);
  if (!ok) failures += 1;
};

async function main() {
  const emp = await db.employee.findFirst({
    where: { employeeCode: code, deletedAt: null },
    select: { id: true, email: true, user: { select: { id: true, email: true } } },
  });
  if (!emp) {
    console.log(`[FAIL] employee ${code} not found (run scripts/qa-seed-employee-codes.mjs first)`);
    process.exit(1);
  }
  console.log(`== footprint for ${code} (linked user: ${emp.user ? emp.user.id : 'none'}) ==`);

  if (emp.user) {
    const bells = await db.notification.findMany({
      where: { userId: emp.user.id, metadata: { contains: 'leave_balance_adjusted' } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, title: true, actionUrl: true, createdAt: true },
    });
    check(`bell row delivered to ${emp.user.id}`, bells.length > 0);
    for (const n of bells) console.log('  bell:', JSON.stringify(n));
  } else {
    console.log('[INFO] no linked portal user — bell leg skipped by design (email still sent)');
  }

  const emails = await db.notificationLog.findMany({
    where: { type: 'LEAVE_BALANCE_ADJUSTED', recipient: emp.email },
    orderBy: { sentAt: 'desc' },
    take: 3,
    select: { id: true, recipient: true, subject: true, sentAt: true },
  }).catch((e) => {
    console.log('emailLog query failed:', e.message);
    return [];
  });
  check(`email log delivered to ${emp.email}`, emails.length > 0);
  for (const e of emails) console.log('  email:', JSON.stringify(e));

  const audits = await db.auditLog.findMany({
    where: { action: 'LEAVE_BALANCE_ADJUSTED' },
    orderBy: { timestamp: 'desc' },
    take: 25,
    select: { id: true, entityType: true, entityId: true, action: true, reason: true, userId: true, timestamp: true },
  });
  const mine = audits.filter((a) => a.entityId === emp.id);
  check('hash-chained audit row for this employee', mine.length > 0);
  for (const a of mine.slice(0, 3)) console.log('  audit:', JSON.stringify(a));

  const bal = await db.employeeLeaveBalance.findFirst({
    where: { employee: { employeeCode: code }, leaveType: { code: typeCode }, leaveYear: year },
    select: { allocatedDays: true, notes: true },
  });
  console.log(`== balance ${code}/${typeCode}/${year} ==`);
  console.log(JSON.stringify(bal, null, 1));

  console.log(failures === 0 ? '\nFOOTPRINT ALL PASS' : `\n${failures} FOOTPRINT FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
