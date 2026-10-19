#!/usr/bin/env node
// v2.127.0 E2E cleanup — remove the walk's rows, keep the audit trail
// (hash chain, house decision). Sweep by the exact ids the walk created.
const { PrismaClient } = require('/home/z/ems/node_modules/@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } } });

const APPLICANT_ID = 'cmvelzzcv000bpu35hjp8fe94';
const JOB_ID = 'cmvelzrr30005pu35oe46mofq';

(async () => {
  const consent = await db.consentRecord.deleteMany({ where: { applicantId: APPLICANT_ID } });
  const stages = await db.applicationStage.deleteMany({ where: { applicantId: APPLICANT_ID } });
  const offers = await db.offer.deleteMany({ where: { applicantId: APPLICANT_ID } });
  const applicant = await db.applicant.deleteMany({ where: { id: APPLICANT_ID } });
  const job = await db.recruitmentJob.deleteMany({ where: { id: JOB_ID } });
  const notifications = await db.notification.deleteMany({
    where: { actionUrl: { contains: APPLICANT_ID } },
  });
  console.log(`cleanup: consent=${consent.count} stages=${stages.count} offers=${offers.count} applicant=${applicant.count} job=${job.count} notifications=${notifications.count}`);

  const residual = {
    applicants: await db.applicant.count({ where: { id: APPLICANT_ID } }),
    jobs: await db.recruitmentJob.count({ where: { id: JOB_ID } }),
    offers: await db.offer.count({ where: { applicantId: APPLICANT_ID } }),
    stages: await db.applicationStage.count({ where: { applicantId: APPLICANT_ID } }),
  };
  console.log(`RESIDUAL: ${Object.values(residual).join('/')}`);
  await db.$disconnect();
  process.exit(Object.values(residual).some((n) => n > 0) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
