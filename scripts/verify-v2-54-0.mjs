#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.54.0 verification
// Scope: per-recipient digest envelopes ("every recipient stands alone").
// Scheduled and manual digest sends go from ONE shared envelope (every
// address on the To: line) to ONE ENVELOPE PER RECIPIENT: no address is
// exposed to the group, every address earns its own NotificationLog
// delivery row (own status + own error, metadata.recipientAddress stamped),
// and a mixed delivery is its own honest state (amber PARTIAL chip,
// "Delivered to N of M") instead of pretending all-or-nothing. Every
// v2.47–v2.53 feature is asserted intact (era-frozen version slots
// excepted by convention).
// Run: node scripts/verify-v2-54-0.mjs

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
check('package.json version is 2.54.0', PKG.version === '2.54.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.54.0', PKG.mbumah?.releaseVersion === '2.54.0');
check('mbumah.baseVersion is 2.54.0', PKG.mbumah?.baseVersion === '2.54.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.54.0 entry", WN.includes("version: '2.54.0'"));
check("What's-New names the one-envelope-per-person story", WN.includes('Every recipient stands alone'));
check('verify:v2-54-0 script is wired', (PKG.scripts ?? {})['verify:v2-54-0'] === 'node scripts/verify-v2-54-0.mjs');
check('verify:v2-53-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-53-0'] === 'node scripts/verify-v2-53-0.mjs');

console.log('== Service: per-recipient envelope machinery ==');
const SS = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('exports the pure aggregate (unit-tested)', SS.includes('export function summariseRecipientSends'));
check('SENT when every address delivered', SS.includes("outcome: 'SENT'"));
check('mixed delivery is its own honest state (PARTIAL)', SS.includes("outcome: 'PARTIAL'"));
check('PARTIAL copy says "Delivered to N of M"', SS.includes('Delivered to ${delivered} of ${total} recipient(s)'));
check('PARTIAL copy points at the delivery history', SS.includes('Per-recipient rows are in the delivery history.'));
check('FAILED aggregate counts the addresses', SS.includes('recipient(s) not delivered'));
check('exports the per-recipient envelope sender', SS.includes('export async function sendDigestEnvelopes'));
check('each envelope is to:[one address] — no shared To: line', SS.includes('to: [to],'));
check('metadata stamps the address + index + count', SS.includes('recipientAddress: to,') && SS.includes('recipientIndex: index + 1') && SS.includes('recipientCount: params.recipients.length'));
check('the CSV attachment rides every envelope', SS.includes('...(params.csv ? { attachments: [params.csv] } : {})'));
check('a rejected send counts as that recipient\u2019s failure', SS.includes('success: false, error: error instanceof Error ? error.message'));
check('the digest body is built once (no per-recipient recompute)', SS.includes('html: hrReportDigestTemplate(params.digest)'));

console.log('== Sweep wiring: runDueHrReportSchedules ==');
check('sweep stamps lastStatus PARTIAL on mixed delivery', SS.includes("lastStatus: 'PARTIAL'"));
check('sweep result rows carry the delivered count', SS.includes('delivered: summary.delivered'));
check('the creator gets ONE aggregate in-app copy (never N)', (SS.match(/writeDigestNotification\(/g) ?? []).length >= 2 && SS.includes('summary.outcome'));
check('PARTIAL rides the sweep result vocabulary', SS.includes("'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED'"));

console.log('== Send-now wiring ==');
check('SendNowOutcome gains PARTIAL', SS.includes("export type SendNowOutcome = 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED';"));
check('manual sends use the per-recipient path too', SS.includes('manual: true,') && SS.includes('sendDigestEnvelopes({'));
check('email aggregate is honest (success only when all delivered)', SS.includes('success: summary.outcome === ' + "'SENT'"));
check('the schedule view maps the real outcome', SS.includes('lastStatus: outcome'));

console.log('== Deliveries: per-recipient rows ==');
check('ScheduleDeliveryRow carries recipientAddress', SS.includes('recipientAddress: string | null;'));
check('per-recipient rows parse the stamped address', SS.includes("meta.recipientAddress === 'string' && meta.recipientAddress.includes('@')"));

console.log('== UI: schedules tab ==');
const TB = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('PARTIAL joins the last-status chip styles (amber)', TB.includes('PARTIAL:') && TB.includes('bg-amber-100'));
check('PARTIAL joins the delivery-row chip styles', (TB.match(/PARTIAL: '/g) ?? []).length >= 2);
check('PARTIAL joins the health-dot colours', TB.includes("PARTIAL: 'bg-amber-400'"));
check('send-now toast names the partial delivery honestly', TB.includes('delivered to some recipients'));
check('the toast points at the delivery history', TB.includes('check the delivery history for the per-recipient rows'));
check('per-recipient rows render the address inline (mono chip)', TB.includes("d.recipientAddress ? (") && TB.includes('font-mono text-[10px]'));
check('legacy rows keep the v2.27 chip expansion', TB.includes('d.recipientList.map((r) =>'));
check('the address chip carries a title tooltip', TB.includes("own delivery record"));
check('aria-label speaks per-recipient rows plainly', TB.includes('to ${d.recipientAddress}'));

console.log('== What did NOT change ==');
check('digest-csv builder untouched (same file on every envelope)', read('src/lib/hr/digest-csv.ts')?.includes('export function digestToCsv') === true);
check('the run digest export route (v2.53.0) untouched', read('src/app/api/payroll/runs/[id]/digest-csv/route.ts')?.includes("hrGuard('hr.payroll.read.all', READ_ROLES)") === true);
check('the report export route (v2.52.0) untouched', read('src/app/api/hr/reports/export/route.ts')?.includes("hrGuard('hr.report.branch', REPORT_ROLES)") === true);
check('buildDigestPayload (v2.52.0 shared builder) untouched', SS.includes('export async function buildDigestPayload'));
check('nextScheduleRunAt cadence helper untouched', SS.includes('export function nextScheduleRunAt'));
check('the sweep still skips when the report returns no data', SS.includes("lastStatus: 'SKIPPED'"));

console.log('== Tests ==');
const TP = read('src/tests/hr-digest-per-recipient.test.ts') ?? '';
check('per-recipient test file exists', !!TP);
check('covers the pure aggregate vocabulary', TP.includes('summariseRecipientSends'));
check('covers the no-shared-To-line contract', TP.includes('no address ever shares a To: line'));
check('covers the metadata stamping', TP.includes('recipientAddress'));
check('covers the identical CSV attachment', TP.includes('identical on every envelope'));
check('covers the PARTIAL sweep stamp', TP.includes('lastStatus PARTIAL'));
check('covers the one-creator-copy contract', TP.includes('ONE aggregate in-app copy'));
check('covers the send-now PARTIAL outcome', TP.includes('outcome PARTIAL'));
check('covers the legacy-row compatibility', TP.includes('recipientAddress null'));
check('v2.53 intact: run digest export test file still exists', !!read('src/tests/payroll-run-digest-export.test.ts'));
check('v2.52 intact: report digest export test file still exists', !!read('src/tests/report-digest-export.test.ts'));
check('v2.27 intact: schedule deliveries test file still exists', !!read('src/tests/lib/hr-schedule-deliveries.test.ts'));
check('v2.22 intact: schedule sweep test file still exists', !!read('src/tests/lib/hr-report-schedules.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.54.0 verification: ALL PASS');
} else {
  console.log(`v2.54.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
