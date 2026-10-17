#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.56.0 verification
// Scope: the sweep self-heals ("one automatic retry before giving up").
// When a scheduled digest delivery comes up short (PARTIAL or FAILED), the
// sweep retries ONCE — straight after the stumble — to exactly the addresses
// the first attempt missed, reusing the v2.55.0 re-send machinery in its new
// automatic mode: envelopes stamped metadata.resend + automaticRetry (never
// manual), the creator gets ONE copy telling the FINAL story (recovery = quiet
// NORMAL with the recovery sentence; still-failing = HIGH saying the retry was
// already tried), the final stamp reflects the FINAL attempt, a SKIPPED retry
// leaves the first outcome standing, and the cadence never moves.
// Every v2.47–v2.55 feature is asserted intact (era-frozen version slots
// excepted by convention).
// Run: node scripts/verify-v2-56-0.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.56.0', PKG.version === '2.56.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.56.0', PKG.mbumah?.releaseVersion === '2.56.0');
check('mbumah.baseVersion is 2.56.0', PKG.mbumah?.baseVersion === '2.56.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.56.0 entry", WN.includes("version: '2.56.0'"));
check("What's-New names the self-heal story", WN.includes('The sweep self-heals'));
check('verify:v2-56-0 script is wired', (PKG.scripts ?? {})['verify:v2-56-0'] === 'node scripts/verify-v2-56-0.mjs');
check('verify:v2-55-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-55-0'] === 'node scripts/verify-v2-55-0.mjs');

console.log('== Service: the automatic re-send mode ==');
const SS = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('resendFailedDigest accepts the automatic opt', SS.includes('opts?: { automatic?: boolean }'));
check('automatic envelopes are NOT manual', SS.includes('manual: opts?.automatic ? false : true,'));
check('automatic envelopes stamp automaticRetry', SS.includes("...(opts?.automatic ? { automaticRetry: true } : {})"));
check('the automatic retry writes NO per-actor notification (the sweep writes ONE)', SS.includes('? null // v2.56.0: the sweep writes the creator'));
check('the audit distinguishes automaticRetry from manualSend', SS.includes('automaticRetry: true, manualSend: false') || SS.includes("manualSend: opts?.automatic ? false : true,"));

console.log('== Service: sweep wiring (runDueHrReportSchedules) ==');
check('the sweep self-heals before giving up', SS.includes('the sweep SELF-HEALS'));
check('the retry reuses resendFailedDigest with a SYSTEM actor', SS.includes("{ id: 'system-hr-digests', role: 'SYSTEM', storeId: schedule.storeId }"));
check('the FIRST attempt is stamped honestly before the retry', SS.includes('lastStatus: firstOutcome'));
check('the FINAL stamp reflects the FINAL attempt', SS.includes('lastStatus: finalOutcome'));
check('a SKIPPED retry leaves the first outcome standing', SS.includes("if (retryResult.outcome !== 'SKIPPED')"));
check('NOTHING_TO_RESEND from the retry is caught (first outcome stands)', SS.includes("// NOTHING_TO_RESEND (the latest batch somehow has no undelivered"));
check('a recovery is quiet: NORMAL copy with the recovery sentence', SS.includes('the automatic retry delivered to everyone who missed it.'));
check('a still-failing copy says the retry was already tried', SS.includes('An automatic retry was attempted and also failed'));
check('the partial copy says some recipients are still missing', SS.includes('some recipients are still missing'));
check('the sweep result row carries the retry meta', SS.includes('retry: { attempted: true, recovered: finalOutcome'));
check('ScheduleSweepResult declares the retry shape', SS.includes('retry?: { attempted: boolean; recovered: boolean; recipients: number }'));
check('the writeDigestNotification gained the honest note channel', SS.includes('note?: string;') && SS.includes('${params.note'));

console.log('== UI: auto-retry reads differently from a manual re-send ==');
const TB = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('history rows distinguish auto-retry from manual re-send', TB.includes("d.manual ? 're-send' : 'auto-retry'"));
check('the auto-retry tooltip says the sweep did it', TB.includes('automatic retry to the recipients the first attempt missed'));

console.log('== What did NOT change (v2.47–v2.55 era intact) ==');
check('per-recipient envelope sender (v2.54.0) untouched', SS.includes('export async function sendDigestEnvelopes'));
check('the pure aggregate vocabulary (v2.54.0) untouched', SS.includes('export function summariseRecipientSends'));
check('the pure batch derivation (v2.55.0) untouched', SS.includes('export function latestBatchFailedRecipients'));
check('the manual re-send executor (v2.55.0) untouched', SS.includes('export async function resendFailedDigest'));
check('the read-only re-send info (v2.55.0) untouched', SS.includes('export async function getScheduleResendInfo'));
check('delivered-wins survives (v2.55.0)', SS.includes('for (const address of deliveredSet) failedSet.delete(address);'));
check('digest-csv builder untouched (v2.46.0)', read('src/lib/hr/digest-csv.ts')?.includes('export function digestToCsv') === true);
check('the run digest export route (v2.53.0) untouched', read('src/app/api/payroll/runs/[id]/digest-csv/route.ts')?.includes("hrGuard('hr.payroll.read.all', READ_ROLES)") === true);
check('the report export route (v2.52.0) untouched', read('src/app/api/hr/reports/export/route.ts')?.includes("hrGuard('hr.report.branch', REPORT_ROLES)") === true);
check('buildDigestPayload (v2.52.0 shared builder) untouched', SS.includes('export async function buildDigestPayload'));
check('nextScheduleRunAt cadence helper untouched (v2.25.0)', SS.includes('export function nextScheduleRunAt'));
check('sendScheduleNow untouched (v2.24.0)', SS.includes('export async function sendScheduleNow'));
check('the resend API route (v2.55.0) untouched', read('src/app/api/hr/reports/schedules/[id]/resend/route.ts')?.includes('export const POST') === true);

console.log('== Tests ==');
const TP = read('src/tests/lib/hr-schedule-resend.test.ts') ?? '';
check('re-send test file carries the self-heal suite', TP.includes('sweep self-heal: one automatic retry before giving up'));
check('covers the recovery flow (final SENT + NORMAL note)', TP.includes('retry recovers'));
check('covers the partial recovery story', TP.includes('partial recovery story'));
check('covers the still-failing flow (HIGH note)', TP.includes('the retry also fails'));
check('covers the SKIPPED retry honesty', TP.includes('leaves the first outcome standing'));
check('covers NOTHING_TO_RESEND from the retry', TP.includes('NOTHING_TO_RESEND from the retry'));
check('covers the automatic mode stamps', TP.includes('automatic mode: envelopes are NOT manual'));
check('v2.55 intact: manual re-send tests still present', TP.includes('re-sends EXACTLY to the missed addresses'));
check('v2.54 intact: per-recipient test file still exists', !!read('src/tests/hr-digest-per-recipient.test.ts'));
check('v2.53 intact: run digest export test file still exists', !!read('src/tests/payroll-run-digest-export.test.ts'));
check('v2.52 intact: report digest export test file still exists', !!read('src/tests/report-digest-export.test.ts'));
check('v2.27 intact: schedule deliveries test file still exists', !!read('src/tests/lib/hr-schedule-deliveries.test.ts'));
check('v2.22 intact: schedule sweep test file still exists', !!read('src/tests/lib/hr-report-schedules.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.56.0 verification: ALL PASS');
} else {
  console.log(`v2.56.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
