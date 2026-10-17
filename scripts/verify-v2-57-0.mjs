#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.57.0 verification
// Scope: the bell closes the loop ("the fix rides the bad news").
// A FAILED digest copy in the notification center that still names its
// schedule carries its own amber "Retry delivery" action — calling the SAME
// server-governed re-send endpoint the schedule card uses (POST
// /api/hr/reports/schedules/[id]/resend): the missed set is derived
// SERVER-SIDE (delivered-wins), the digest is recomputed fresh, the cadence
// never moves, and the honest outcome renders inline on the row (SENT
// emerald / PARTIAL-FAILED-SKIPPED amber / 409 nothing-to-re-send amber
// note / 403-404 rose scope refusal). The "Email failed" filter tab explains
// itself with an amber hint. A manual retry writes a fresh manual copy into
// the feed, so the bell keeps the before-and-after.
// Every v2.47–v2.56 feature is asserted intact (era-frozen version slots
// excepted by convention).
// Run: node scripts/verify-v2-57-0.mjs

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
check('package.json version is 2.57.0', PKG.version === '2.57.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.57.0', PKG.mbumah?.releaseVersion === '2.57.0');
check('mbumah.baseVersion is 2.57.0', PKG.mbumah?.baseVersion === '2.57.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.57.0 entry", WN.includes("version: '2.57.0'"));
check("What's-New names the bell story", WN.includes('The bell closes the loop'));
check('verify:v2-57-0 script is wired', (PKG.scripts ?? {})['verify:v2-57-0'] === 'node scripts/verify-v2-57-0.mjs');
check('verify:v2-56-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-56-0'] === 'node scripts/verify-v2-56-0.mjs');

console.log('== Pure view predicate (digest-notification-view) ==');
const DV = read('src/lib/hr/digest-notification-view.ts') ?? '';
check('isRetryableDigestFailure exists', DV.includes('export function isRetryableDigestFailure'));
check('it requires the hr_digest type', DV.includes("row.type !== 'hr_digest'"));
check('it requires the FAILED stamp', DV.includes("row.emailStatus !== 'FAILED'"));
check('it requires a non-empty scheduleId (schedule-scoped endpoint)', DV.includes("typeof row.scheduleId === 'string' && row.scheduleId.trim().length > 0"));
check('the v2.28.0 Email failed predicate is untouched', DV.includes('export function isFailedEmailDigest'));
check('the v2.27.0 metadata mapper is untouched', DV.includes('export function parseDigestNotificationExtras'));

console.log('== UI: the bell carries the fix ==');
const NC = read('src/components/notification-center.tsx') ?? '';
check('rows gate the affordance on the pure predicate', NC.includes('isRetryableDigestFailure(notification)'));
check('the retry calls the SAME server-governed endpoint the card uses', NC.includes('/api/hr/reports/schedules/${notification.scheduleId}/resend'));
check('the endpoint verb is POST (server derives the target set)', NC.includes("'POST'"));
check('the button never bubbles into the row deep link (stopPropagation first)', NC.split('handleRetryDelivery')[1]?.includes('e.stopPropagation()') ?? false);
check('one retry in flight at a time (per-row busy lock)', NC.includes('retryingId !== null) return'));
check('the busy state spins the icon', NC.includes("retryingId === notification.id ? 'animate-spin' : ''"));
check('the busy label is honest', NC.includes("'Retrying…'"));
check('SENT gets the emerald note', NC.includes('who missed it — email delivered.'));
check('PARTIAL gets the amber note pointing at the per-recipient rows', NC.includes('the per-recipient rows are on the schedule'));
check('FAILED gets the amber note pointing at the failure rows', NC.includes('the per-recipient failure rows are on the schedule'));
check('SKIPPED is honest about nothing being emailed', NC.includes('Nothing was emailed.'));
check('409 NOTHING_TO_RESEND is an amber note, not an error', NC.includes("status === 409 || message.toLowerCase().includes('nothing to re-send')"));
check('403/404 refuse honestly (scope)', NC.includes('status === 403 || status === 404'));
check('the outcome note is announced (role=status)', NC.includes('role="status"'));
check('a retry pulls the fresh manual copy into the feed', NC.includes("queryClient.invalidateQueries({ queryKey: ['notifications', storeId] })"));
check('the Email failed tab explains itself (amber hint)', NC.includes('Rows that name their schedule carry a Retry delivery action'));
check('the hint only shows on the active failed tab (not dismissed view)', NC.includes("filter === 'email_failed' && !showDismissed && visibleNotifications.length > 0"));

console.log('== What did NOT change (v2.47–v2.56 era intact) ==');
const SS = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('the automatic re-send mode (v2.56.0) untouched', SS.includes('opts?: { automatic?: boolean }'));
check('the sweep self-heal wiring (v2.56.0) untouched', SS.includes('the sweep SELF-HEALS'));
check('the manual re-send executor (v2.55.0) untouched', SS.includes('export async function resendFailedDigest'));
check('the pure batch derivation (v2.55.0) untouched', SS.includes('export function latestBatchFailedRecipients'));
check('per-recipient envelope sender (v2.54.0) untouched', SS.includes('export async function sendDigestEnvelopes'));
check('the resend API route (v2.55.0) untouched', read('src/app/api/hr/reports/schedules/[id]/resend/route.ts')?.includes('export const POST') === true);
check('the resend route keeps its hrGuard scope', read('src/app/api/hr/reports/schedules/[id]/resend/route.ts')?.includes("hrGuard('hr.report.branch', REPORT_ROLES)") === true);
check('the schedule card affordance (v2.55.0) untouched', read('src/components/hr/report-schedules-tab.tsx')?.includes('Re-send to') === true);
check('digest-csv builder untouched (v2.46.0)', read('src/lib/hr/digest-csv.ts')?.includes('export function digestToCsv') === true);

console.log('== FIX: the feed tenant-free reads (org-wide rows vanished on prod) ==');
const DBS = read('src/lib/db.ts') ?? '';
check('db.ts exports the un-hardened rawDb client', DBS.includes('export const rawDb = baseClient;'));
check('the rawDb contract names the ALS leak', DBS.includes('ALS-timing-dependent'));
check('the rawDb contract forbids store-scoped business data', DBS.includes('MUST NOT be used for'));
const NR = read('src/app/api/notifications/route.ts') ?? '';
check('the feed route imports rawDb', NR.includes("import { db, rawDb, runWithTenant, runWithoutTenant } from '@/lib/db';"));
check('SECURITY section reads via rawDb', (NR.match(/rawDb\.notification\.findMany/g) ?? []).length === 3);
check('no hardened db.notification read remains in the feed', !/\bdb\.notification\./.test(NR));
check('the digest section comment tells the vanish story', NR.includes('excluded every one of them from the feed'));
check('the rawDb regression test exists', !!read('src/tests/notifications-feed-tenant-free.test.ts'));

console.log('== Tests ==');
const TP = read('src/tests/lib/digest-notification-view.test.ts') ?? '';
check('the retry predicate suite exists', TP.includes("describe('isRetryableDigestFailure'"));
check('covers FAILED+scheduleId positives', TP.includes('matches FAILED hr_digest rows that name their schedule'));
check('covers SENT / unstamped / schedule-less refusals', TP.includes('refuses SENT digests, unstamped digests, and schedule-less failures'));
check('covers the payroll-row scope guard', TP.includes('refuses non-hr_digest rows even when they carry the same fields'));
check('covers fail-soft junk inputs', TP.includes('is fail-soft on malformed rows (null / scalar / array)'));
check('v2.28.0 Email failed suite still present', TP.includes("describe('isFailedEmailDigest'"));
check('v2.56.0 self-heal test file still exists', !!read('src/tests/lib/hr-schedule-resend.test.ts'));
check('v2.54.0 per-recipient test file still exists', !!read('src/tests/hr-digest-per-recipient.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.57.0 verification: ALL PASS');
} else {
  console.log(`v2.57.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
