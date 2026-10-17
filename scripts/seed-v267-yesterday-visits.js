// seed-v267-yesterday-visits.js — E2E seed for the v2.67.0 morning note.
// Inserts LeaveReviewVisit rows dated YESTERDAY (EAT) so the desk digest
// strip has a populated day to summarize. Uses real users + real leave
// requests; visits are append-only ledger rows (the same rows the timeline,
// drill-down and branch chips read), so this is realistic desk history.
const { PrismaClient } = require('/home/z/ems/node_modules/@prisma/client');

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

const EAT = '+03:00';

(async () => {
  // Two branches' requests so the multi-branch mini chips + busiest logic exercise.
  const jujaReq = await prisma.leaveRequest.findFirst({
    where: { store: { name: { contains: 'Juja' } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, storeId: true },
  });
  // Prefer a second request on a DIFFERENT branch if one exists (multi-branch
  // day); otherwise fall back to another Juja request (single-branch day —
  // the busiest/top-reviewer chips still exercise).
  const secondReq = await prisma.leaveRequest.findFirst({
    where: { storeId: { not: jujaReq?.storeId ?? '' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, storeId: true },
  }) ?? await prisma.leaveRequest.findFirst({
    where: { id: { not: jujaReq?.id ?? '' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, storeId: true },
  });
  const otherReq = secondReq;
  const allUsers = await prisma.user.findMany({
    where: { role: { in: ['STORE_OWNER', 'BRANCH_MANAGER', 'SUPER_ADMIN', 'HR_MANAGER'] } },
    take: 5,
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
  const users = allUsers.filter((u) => u.name);
  if (!jujaReq || !otherReq || users.length < 2) {
    console.error('MISSING_SEED_INPUTS', { jujaReq: !!jujaReq, otherReq: !!otherReq, users: users.length });
    process.exit(1);
  }
  const [uA, uB] = users;
  // Yesterday (EAT) working hours; today is 2026-10-17 EAT.
  const y = (h, m) => new Date(`2026-10-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${EAT}`);
  const rows = [
    { leaveRequestId: jujaReq.id, visitedById: uA.id, visitedByName: uA.name, clearedRecheck: true, createdAt: y(9, 15) },
    { leaveRequestId: jujaReq.id, visitedById: uA.id, visitedByName: uA.name, clearedRecheck: false, createdAt: y(11, 40) },
    { leaveRequestId: jujaReq.id, visitedById: uB.id, visitedByName: uB.name, clearedRecheck: false, createdAt: y(14, 5) },
    { leaveRequestId: otherReq.id, visitedById: uA.id, visitedByName: uA.name, clearedRecheck: false, createdAt: y(16, 30) },
  ];
  const existing = await prisma.leaveReviewVisit.count({
    where: { createdAt: { gte: new Date('2026-10-16T00:00:00+03:00'), lt: new Date('2026-10-17T00:00:00+03:00') } },
  });
  if (existing > 0) {
    console.log('ALREADY_SEEDED', existing);
  } else {
    await prisma.leaveReviewVisit.createMany({ data: rows });
    console.log('SEEDED', rows.length, '| reviewers:', uA.name, '+', uB.name, '| stores:', jujaReq.storeId, otherReq.storeId);
  }
  const cnt = await prisma.leaveReviewVisit.count({
    where: { createdAt: { gte: new Date('2026-10-16T00:00:00+03:00'), lt: new Date('2026-10-17T00:00:00+03:00') } },
  });
  const total = await prisma.leaveReviewVisit.count();
  console.log('yesterday-window rows:', cnt, '| ledger total:', total);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
