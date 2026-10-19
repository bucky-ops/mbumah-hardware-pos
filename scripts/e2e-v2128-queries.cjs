// v2.128.0 E2E prep + verification queries (sqlite worktree).
const { PrismaClient } = require('/home/z/ems/node_modules/@prisma/client');
const db = new PrismaClient();

(async () => {
  const mode = process.argv[2] || 'prep';

  if (mode === 'prep') {
    const users = await db.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, role: true, storeId: true },
      take: 10,
    });
    console.log('USERS:', JSON.stringify(users, null, 1));
    const employees = await db.employee.findMany({
      where: { deletedAt: null },
      select: { id: true, employeeCode: true, firstName: true, lastName: true, userId: true, storeId: true },
      take: 10,
    });
    console.log('EMPLOYEES:', JSON.stringify(employees, null, 1));
  }

  if (mode === 'audit') {
    const rows = await db.auditLog.findMany({
      where: { entityType: 'Employee', action: 'UPDATE' },
      orderBy: { timestamp: 'desc' },
      take: 6,
      select: { id: true, timestamp: true, action: true, entityType: true, entityId: true, reason: true, newValues: true, userId: true },
    });
    console.log('RECENT EMPLOYEE UPDATE AUDITS:');
    for (const r of rows) {
      const m = typeof r.newValues === 'string' ? r.newValues : JSON.stringify(r.newValues);
      console.log(` ${r.timestamp.toISOString()} | ${r.userId} | ${r.reason} | target=${r.entityId} | ${m ? m.slice(0, 200) : '(no meta)'}`);
    }
  }

  if (mode === 'consent-audit') {
    const rows = await db.auditLog.findMany({
      where: { OR: [{ reason: { contains: 'consent' } }, { reason: { contains: 'Consent' } }] },
      orderBy: { timestamp: 'desc' },
      take: 8,
      select: { timestamp: true, userId: true, action: true, entityType: true, entityId: true, reason: true, newValues: true },
    });
    console.log('RECENT CONSENT AUDITS:');
    for (const r of rows) {
      const m = typeof r.newValues === 'string' ? r.newValues : JSON.stringify(r.newValues);
      console.log(` ${r.timestamp.toISOString()} | ${r.userId} | ${r.action}/${r.entityType} | ${r.reason} | ${m ? m.slice(0, 140) : ''}`);
    }
    const crs = await db.consentRecord.findMany({
      orderBy: { grantedAt: 'desc' },
      take: 8,
      select: { id: true, employeeId: true, purpose: true, grantedAt: true, withdrawnAt: true },
    });
    console.log('CONSENT RECORDS (newest 8):');
    for (const c of crs) {
      console.log(` ${c.grantedAt.toISOString()} emp=${c.employeeId} ${c.purpose} withdrawn=${c.withdrawnAt ? c.withdrawnAt.toISOString() : 'null'}`);
    }
  }

  await db.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
