// v2.128.0 E2E cleanup — remove the walk's employee + consent records.
// AuditLog rows are RETAINED (hash chain, house decision).
const { PrismaClient } = require('/home/z/ems/node_modules/@prisma/client');
const db = new PrismaClient();

const EMP = 'cmvenruj7000hpugu918gw9v8';

(async () => {
  const crs = await db.consentRecord.deleteMany({ where: { employeeId: EMP } });
  const leaves = await db.leaveRequest.deleteMany({ where: { employeeId: EMP } }).catch(() => null);
  const emp = await db.employee.delete({ where: { id: EMP } });
  console.log(`CLEANUP: consent=${crs.count} leave=${leaves ? leaves.count : 'n/a'} employee=1 (${emp.firstName} ${emp.lastName})`);
  const residualEmp = await db.employee.count({ where: { id: EMP } });
  const residualCr = await db.consentRecord.count({ where: { employeeId: EMP } });
  const audits = await db.auditLog.count({
    where: {
      OR: [
        { entityId: EMP },
        { action: { in: ['PRIVACY_CONSENT_GRANTED', 'PRIVACY_CONSENT_WITHDRAWN'] }, timestamp: { gte: new Date('2026-10-19T02:50:00Z') } },
        { reason: { in: ['Portal account linked.', 'Portal account unlinked.'] }, timestamp: { gte: new Date('2026-10-19T02:50:00Z') } },
      ],
    },
  });
  console.log(`RESIDUAL: employee=${residualEmp} consentRecords=${residualCr} | audit rows retained (hash chain): ${audits}`);
  const role = await db.user.findUnique({ where: { id: 'user_store_owner' }, select: { role: true } });
  console.log('OWNER ROLE (must be STORE_OWNER):', role.role);
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
