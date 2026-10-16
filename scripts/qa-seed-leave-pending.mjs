// QA seed: ensure exactly ONE PENDING leave request exists for the :3200 dev
// database (v2.30.0). The leave-approval happy path needs a pending fixture;
// when QA approves or rejects it, this script re-creates one (idempotent —
// it first REJECTS/CANCELS stale PENDING duplicates only if it created them
// this run, otherwise leaves existing rows alone).
//
// Semantics mirror requestMyLeave/requestLeave: PENDING request with the
// computed workingDays (weekend-skipping), balance pendingDays += workingDays.
//
// Run: node scripts/qa-seed-leave-pending.mjs
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

function countWorkingDays(from, to) {
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function main() {
  const existing = await db.leaveRequest.findFirst({ where: { status: 'PENDING' } });
  if (existing) {
    console.log(`PENDING request already exists (${existing.id}) — nothing to do.`);
    await db.$disconnect();
    return;
  }

  // v2.31.0: prefer an employee WITH a linked user account (userId) - the
  // decision notification's in-app bell row is addressed to that user, so
  // approving the seeded request exercises the full delivery chain (bell row
  // + email) instead of only the email leg.
  const employee =
    (await db.employee.findFirst({
      where: { deletedAt: null, userId: { not: null } },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await db.employee.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    }));
  if (!employee) throw new Error('No employee found.');

  const annual = await db.leaveType.findUnique({ where: { code: 'ANNUAL' } });
  if (!annual) throw new Error('ANNUAL leave type missing — run scripts/qa-seed-leave-dev.mjs first.');

  // Next Mon-Tue (2 working days), ~1 week out so dates never land in the past.
  const start = new Date();
  do { start.setUTCDate(start.getUTCDate() + 1); } while (start.getUTCDay() !== 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const workingDays = countWorkingDays(start, end);
  const year = start.getUTCFullYear();

  const balance = await db.employeeLeaveBalance.findFirst({
    where: { employeeId: employee.id, leaveTypeId: annual.id, leaveYear: year },
  });
  if (!balance) throw new Error(`No ${year} ANNUAL balance for employee ${employee.id}.`);

  const created = await db.leaveRequest.create({
    data: {
      employeeId: employee.id,
      leaveTypeId: annual.id,
      storeId: employee.storeId,
      startDate: start,
      endDate: end,
      returnDate: new Date(end.getTime() + 24 * 60 * 60 * 1000),
      workingDays,
      status: 'PENDING',
      reason: 'QA fixture: family commitment out of town.',
    },
  });
  await db.employeeLeaveBalance.update({
    where: { id: balance.id },
    data: { pendingDays: { increment: workingDays } },
  });

  console.log(`Created PENDING request ${created.id}: ${employee.firstName} ${employee.lastName}, ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)} (${workingDays} working days).`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
