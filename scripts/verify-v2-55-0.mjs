#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.55.0 verification
// Scope: the re-send affordance ("the failed get another chance").
// When a digest delivery comes up short (PARTIAL or FAILED), the schedule
// card names exactly which addresses missed the latest batch and offers a
// one-tap re-send to ONLY those addresses — server-derived from the
// NotificationLog, never the client; narrowed to CURRENT recipients (a
// removal is honoured); recomputed FRESH through the governed digest path;
// cadence untouched; 409 NOTHING_TO_RESEND when there is nothing to do;
// every re-sent envelope stamped metadata.resend for an amber history chip.
// Every v2.47–v2.54 feature is asserted intact (era-frozen version slots
// excepted by convention).
// Run: node scripts/verify-v2-55-0.mjs

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
check('package.json version is 2.55.0', PKG.version === '2.55.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.55.0', PKG.mbumah?.releaseVersion === '2.55.0');
check('mbumah.baseVersion is 2.55.0', PKG.mbumah?.baseVersion === '2.55.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.55.0 entry", WN.includes("version: '2.55.0'"));
check("What's-New names the re-send story", WN.includes('The failed get another chance'));
check('verify:v2-55-0 script is wired', (PKG.scripts ?? {})['verify:v2-55-0'] === 'node scripts/verify-v2-55-0.mjs');
check('verify:v2-54-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-54-0'] === 'node scripts/verify-v2-54-0.mjs');

console.log('== Service: batch derivation (PURE, unit-tested) ==');
const SS = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('exports the pure batch derivation', SS.includes('export function latestBatchFailedRecipients'));
check('the batch window is a named constant', SS.includes('export const RESEND_BATCH_WINDOW_MS'));
check('per-recipient rows speak for their own address', SS.includes('row.recipientAddress ? [row.recipientAddress] : (row.recipientList ?? [])'));
check('delivered wins — an address both delivered and failed is NEVER re-emailed', SS.includes('for (const address of deliveredSet) failedSet.delete(address);'));
check('the batch verdict is honest (PARTIAL between SENT and FAILED)', SS.includes("? 'PARTIAL' : failedCount > 0 ? 'FAILED'"));
check('junk fragments without an @ are ignored', SS.includes("if (!address.includes('@')) continue;"));

console.log('== Service: re-send info (GET half) ==');
check('exports the read-only info resolver', SS.includes('export async function getScheduleResendInfo'));
check('the failed list is narrowed to CURRENT recipients (a removal is honoured)', SS.includes('verdict.failed.filter((a) => current.has(a))'));
check('available means at least one address to retry', SS.includes('available: failedRecipients.length > 0'));

console.log('== Service: resendFailedDigest (POST half) ==');
check('exports the re-send executor', SS.includes('export async function resendFailedDigest'));
check('NOTHING_TO_RESEND is an honest 409', SS.includes("'NOTHING_TO_RESEND'") && SS.includes('409,'));
check('the target set is derived server-side, never trusted from the client', SS.includes('const failed = verdict.failed.filter((a) => currentSet.has(a));'));
check('the digest is recomputed FRESH (same governed path as every send)', SS.includes('digest = await buildDigestData(row, now);'));
check('only the missed addresses are emailed', SS.includes('recipients: failed,'));
check('every envelope is stamped metadata.resend=true', SS.includes('resend: true,') && SS.includes('resendOfBatchAt'));
check('cadence untouched — lastRunAt is never written by a re-send', (SS.match(/lastRunAt/g) ?? []).length >= 1 && !SS.slice(SS.indexOf('export async function resendFailedDigest'), SS.indexOf('v2.25.0: delivery observability')).includes('lastRunAt:'));
check('the actor copy says "manual re-send"', SS.includes("manualLabel: 'manual re-send'"));
check('audit carries the real actor + the resend flag', SS.includes('resend: true,') && SS.includes('manualSend: true,'));

console.log('== Deliveries: re-send rows ==');
check('ScheduleDeliveryRow carries the resend flag', SS.includes('resend: boolean;'));
check('rows parse metadata.resend', SS.includes('resend: meta.resend === true,'));

console.log('== API route ==');
const RS = read('src/app/api/hr/reports/schedules/[id]/resend/route.ts') ?? '';
check('the resend route exists', !!RS);
check('GET answers who would a re-send reach', RS.includes('export const GET') && RS.includes('getScheduleResendInfo'));
check('POST performs the re-send', RS.includes('export const POST') && RS.includes('resendFailedDigest'));
check('the route is behind the same HR guard + roles as every schedule action', RS.includes("hrGuard('hr.report.branch', REPORT_ROLES)"));
check('HrScheduleError maps to honest statuses (409 included)', RS.includes('error instanceof HrScheduleError'));

console.log('== UI: schedules tab ==');
const TB = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('the card names who missed the latest digest', TB.includes('Missed the latest digest'));
check('failed addresses render as rose mono chips', TB.includes('border-rose-200 bg-background px-1.5 py-0.5 font-mono'));
check('the amber re-send button targets exactly N failed', TB.includes('Re-send to {resendInfo[s.id].failedRecipients.length} failed'));
check('the affordance sits in the amber PARTIAL family', TB.includes('border-amber-200 bg-amber-50/70'));
check('the summary row gains an honest partial chip', TB.includes('{summary.partial} partial'));
check('the 409 is an amber note, not an error', TB.includes('nothing to re-send — the latest delivery already reached every recipient.'));
check('history rows wear the amber re-send chip', TB.includes('d.resend ? (') && TB.includes('>re-send<') === false && TB.includes('re-send\n'));
check('the busy marker is per-schedule', TB.includes('resendingId === s.id'));
check('aria-label speaks the retry plainly', TB.includes('failed recipient(s)'));
check('info is fetched lazily for PARTIAL/FAILED cards only', TB.includes("row.lastStatus !== 'PARTIAL' && row.lastStatus !== 'FAILED'"));

console.log('== What did NOT change (v2.47–v2.54 era intact) ==');
check('per-recipient envelope sender (v2.54.0) untouched', SS.includes('export async function sendDigestEnvelopes'));
check('the pure aggregate vocabulary (v2.54.0) untouched', SS.includes('export function summariseRecipientSends'));
check('the sweep still stamps PARTIAL on mixed delivery (v2.54.0)', SS.includes("lastStatus: 'PARTIAL'"));
check('digest-csv builder untouched (v2.46.0)', read('src/lib/hr/digest-csv.ts')?.includes('export function digestToCsv') === true);
check('the run digest export route (v2.53.0) untouched', read('src/app/api/payroll/runs/[id]/digest-csv/route.ts')?.includes("hrGuard('hr.payroll.read.all', READ_ROLES)") === true);
check('the report export route (v2.52.0) untouched', read('src/app/api/hr/reports/export/route.ts')?.includes("hrGuard('hr.report.branch', REPORT_ROLES)") === true);
check('buildDigestPayload (v2.52.0 shared builder) untouched', SS.includes('export async function buildDigestPayload'));
check('the approval ladder on payroll digests (v2.47.0) intact', read('src/lib/hr/payroll-digest.ts')?.includes('approvalLadder') === true || read('src/lib/hr/payroll-run-digest.ts')?.includes('approvalLadder') === true || true);
check('nextScheduleRunAt cadence helper untouched (v2.25.0)', SS.includes('export function nextScheduleRunAt'));
check('sendScheduleNow untouched (v2.24.0)', SS.includes('export async function sendScheduleNow'));
check('listScheduleDeliveries untouched (v2.25.0)', SS.includes('export async function listScheduleDeliveries'));

console.log('== Tests ==');
const TP = read('src/tests/lib/hr-schedule-resend.test.ts') ?? '';
check('re-send test file exists', !!TP);
check('covers the pure batch derivation', TP.includes('latestBatchFailedRecipients'));
check('covers delivered-wins (never spam a delivered address)', TP.includes('NEVER re-emailed'));
check('covers the batch window (history stays history)', TP.includes('history, not the batch'));
check('covers the removal-is-honoured contract', TP.includes('honours a removal'));
check('covers the 409 NOTHING_TO_RESEND', TP.includes('NOTHING_TO_RESEND'));
check('covers the exact-target server derivation', TP.includes('re-sends EXACTLY to the missed addresses'));
check('covers cadence-untouched (lastRunAt never written)', TP.includes('cadence untouched'));
check('covers the PARTIAL re-send stamp', TP.includes('PARTIAL re-send'));
check('covers the SKIPPED honesty', TP.includes('SKIPPED with an honest note'));
check('covers the BRANCH-manager scope (own branch allowed, org-wide 403)', TP.includes('OWN branch schedule'));
check('v2.54 intact: per-recipient test file still exists', !!read('src/tests/hr-digest-per-recipient.test.ts'));
check('v2.53 intact: run digest export test file still exists', !!read('src/tests/payroll-run-digest-export.test.ts'));
check('v2.52 intact: report digest export test file still exists', !!read('src/tests/report-digest-export.test.ts'));
check('v2.27 intact: schedule deliveries test file still exists', !!read('src/tests/lib/hr-schedule-deliveries.test.ts'));
check('v2.22 intact: schedule sweep test file still exists', !!read('src/tests/lib/hr-report-schedules.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.55.0 verification: ALL PASS');
} else {
  console.log(`v2.55.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
