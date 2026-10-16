#!/usr/bin/env node
/**
 * QA fixture (dev DB only): link David Otieno to the portal user
 * cashier@mbumahhardware.co.ke and create one PENDING Annual Leave request
 * for him — exercises both v2.33.0 notification directions E2E:
 *   manager-cancel → bell row on cashier@ (linked user) + LEAVE_CANCEL email
 *   self-withdraw   → fan-out to the approvals group + grouped email
 * Idempotent: link is upserted; at most one PENDING David request is created.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

async function main() {
  const user = await db.user.findUnique({ where: { email: 'cashier@mbumahhardware.co.ke' } });
  const david = await db.employee.findUnique({ where: { id: 'emp_david_otieno' } });
  if (!user || !david) throw new Error('cashier user or David Otieno missing');

  if (david.userId !== user.id) {
    await db.employee.update({ where: { id: david.id }, data: { userId: user.id } });
    console.log('linked David Otieno ->', user.email);
  } else {
    console.log('link already present');
  }

  const annual = await db.leaveType.findFirst({ where: { code: 'ANNUAL' } });
  if (!annual) throw new Error('ANNUAL leave type missing (run qa-seed-leave-dev.mjs first)');

  const existing = await db.leaveRequest.findFirst({
    where: { employeeId: david.id, status: 'PENDING', leaveTypeId: annual.id },
  });
  if (existing) {
    console.log('PENDING David request already exists:', existing.id);
    return;
  }
  const start = new Date(Date.UTC(2026, 10, 2)); // 2 Nov 2026
  const end = new Date(Date.UTC(2026, 10, 3));
  const req = await db.leaveRequest.create({
    data: {
      storeId: david.storeId,
      employeeId: david.id,
      leaveTypeId: annual.id,
      startDate: start,
      endDate: end,
      workingDays: 2,
      halfDay: false,
      status: 'PENDING',
      reason: 'QA fixture for v2.33.0 cancel notification E2E.',
    },
  });
  console.log('Created PENDING David request', req.id, '(2 Nov → 3 Nov 2026, 2 days)');
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
