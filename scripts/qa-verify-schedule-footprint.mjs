// QA verify (v2.37.0): leave-utilisation schedule send-now footprint:
//   1. hrReportSchedule row stamped (lastStatus FAILED w/ RESEND error, lastRunAt untouched-ish)
//   2. NotificationLog row (type HR_REPORT_DIGEST, subject has 'Leave year 2026')
//   3. notification bell row for the creator (HIGH priority failure alert)
//   4. hash-chained audit row (EXECUTE, manualSend=true)
// Run: DATABASE_URL='file:/home/z/ems/prisma/prisma/dev.db' node scripts/qa-verify-schedule-footprint.mjs
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function main() {
  const sched = await db.hrReportSchedule.findFirst({
    where: { reportKey: 'leave-utilisation', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  check('schedule row exists (leave-utilisation)', !!sched);
  if (!sched) process.exit(1);
  check('lastStatus stamped FAILED (dev, no RESEND key)', sched.lastStatus === 'FAILED', sched.lastStatus ?? '');
  check('lastError mentions RESEND_API_KEY', (sched.lastError ?? '').includes('RESEND_API_KEY'), (sched.lastError ?? '').slice(0, 80));
  check('recipients JSON valid', Array.isArray(JSON.parse(sched.recipients)), `${JSON.parse(sched.recipients).length} recipients`);
  // nextRunAt is COMPUTED by the view (not a stored column) — assert the
  // cadence inputs instead: weekly = weekday 1 (Monday), 02:00 UTC.
  check('cadence stored: WEEKLY Monday 02:00 UTC', sched.weekday === 1 && sched.hourUtc === 2, `weekday=${sched.weekday} hour=${sched.hourUtc}`);

  const email = await db.notificationLog.findFirst({
    where: { type: 'HR_REPORT_DIGEST', subject: { contains: 'Leave balances digest' } },
    orderBy: { createdAt: 'desc' },
  });
  check('NotificationLog row (HR_REPORT_DIGEST)', !!email);
  check('email subject carries the leave-year label', !!email?.subject?.includes('Leave year 2026'), email?.subject ?? '');

  const bell = await db.notification.findFirst({
    where: { metadata: { contains: sched.id } },
    orderBy: { createdAt: 'desc' },
  });
  check('creator bell row written', !!bell);
  check('failure alert is HIGH priority', bell?.priority === 'HIGH', bell?.priority ?? '');
  check('bell copy carries digest headline', !!bell?.message?.includes('Liability days'), (bell?.message ?? '').slice(0, 120));

  const audit = await db.auditLog.findFirst({
    where: { action: 'EXECUTE', entityType: 'HrReportSchedule', entityId: sched.id },
    orderBy: { timestamp: 'desc' },
  });
  check('audit EXECUTE row for the send', !!audit);

  // hrAudit ALSO mirrors into SystemLog with the full metadata blob
  // (manualSend, outcome, integrity hash) — that's where the manual-send
  // marker lives.
  const syslog = await db.systemLog.findFirst({
    where: { metadata: { contains: sched.id }, action: 'AUDIT_EXECUTE' },
    orderBy: { createdAt: 'desc' },
  }).catch(() => null);
  check('systemLog mirror with manualSend marker', !!syslog, syslog ? 'found' : 'missing');
  const meta = JSON.parse(syslog?.metadata ?? '{}');
  check('systemLog metadata has manualSend + outcome', meta.manualSend === true && meta.outcome === 'FAILED', JSON.stringify({ manualSend: meta.manualSend, outcome: meta.outcome }));

  console.log(failures === 0 ? '\nFOOTPRINT ALL PASS' : `\n${failures} FOOTPRINT FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
