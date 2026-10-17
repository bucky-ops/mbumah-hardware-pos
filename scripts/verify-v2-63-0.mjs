#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.63.0 verification
// Scope: the desk keeps its own ledger.
// (1) The LeaveReviewVisit table records EVERY desk visit (dialog open) —
//     WHO looked (visitedById + denormalised visitedByName), WHEN
//     (createdAt), and whether THAT visit cleared a pending re-check
//     marker (clearedRecheck = hadPendingCorrection). Cascade-deleted with
//     the request; indexed [leaveRequestId, createdAt] for the timeline.
// (2) POST /api/leaves/[id]/review writes the visit row best-effort under
//     its own guard (the stamp stays durable), and the response now rides
//     the visit history (newest-first, take 8) + total count.
// (3) The desk dialog renders the "Visit history" timeline: count chip,
//     emerald dot + "Cleared a re-check" chip for clearing visits,
//     reviewer initial avatars, capped at 5 with an honest
//     "+ N earlier visits on file".
// Every v2.47–v2.62 feature is asserted intact.
// Run: node scripts/verify-v2-63-0.mjs

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
check('package.json version is 2.63.0+', PKG.version >= '2.63.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.63.0+', PKG.mbumah?.releaseVersion >= '2.63.0');
check('mbumah.baseVersion is 2.63.0+', PKG.mbumah?.baseVersion >= '2.63.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.63.0 entry first', WN.includes("version: '2.63.0'") && WN.indexOf("version: '2.63.0'") < WN.indexOf("version: '2.62.0'"));
check('whats-new leads with the ledger story', WN.includes('The desk keeps its own ledger'));

console.log('== Schema contract ==');
const SCHEMA = read('prisma/schema.prisma') ?? '';
check('the LeaveReviewVisit model exists', SCHEMA.includes('model LeaveReviewVisit'));
check('mapped to leave_review_visits', SCHEMA.includes('@@map("leave_review_visits")'));
check('records WHO looked (visitedById + visitedByName)', SCHEMA.match(/model LeaveReviewVisit \{[\s\S]*?visitedById\s+String/) !== null && SCHEMA.match(/model LeaveReviewVisit \{[\s\S]*?visitedByName\s+String/) !== null);
check('records WHETHER the visit cleared a re-check (clearedRecheck)', SCHEMA.match(/model LeaveReviewVisit \{[\s\S]*?clearedRecheck\s+Boolean/) !== null);
check('cascade-deletes with the request', SCHEMA.includes('leaveRequest LeaveRequest @relation(fields: [leaveRequestId], references: [id], onDelete: Cascade)'));
check('indexed for the timeline read', SCHEMA.includes('@@index([leaveRequestId, createdAt])'));
check('LeaveRequest carries the back-relation', SCHEMA.includes('reviewVisits LeaveReviewVisit[]'));

console.log('== Route contract ==');
const RV = read('src/app/api/leaves/[id]/review/route.ts') ?? '';
check('the visit row is written', RV.includes('db.leaveReviewVisit.create'));
check('with the same reviewer name chain the stamp uses', RV.includes('visitedByName: reviewerName'));
check('stamped with THIS visit\u2019s re-check outcome', RV.includes('clearedRecheck: hadPendingCorrection'));
check('the ledger write is best-effort under its own guard', RV.includes('// Visit-ledger write is best-effort by design.'));
check('the history read is newest-first, capped at 8', RV.match(/db\.leaveReviewVisit\.findMany\(\{[\s\S]*?orderBy: \{ createdAt: 'desc' \}[\s\S]*?take: 8/) !== null);
check('the total count rides the same response', RV.includes('db.leaveReviewVisit.count({ where: { leaveRequestId: id } })'));
check('the response carries visitHistory + visitCount', RV.includes('visitHistory,') && RV.includes('visitCount,'));
check('the v2.59/v2.60 stamp update is untouched', RV.includes('deskReviewedAt: reviewedAt') && RV.includes('deskReviewedById: session.userId') && RV.includes('deskReviewedByName: reviewerName'));

console.log('== Styling: the visit timeline ==');
const PT = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('the response generic grew the ledger fields', PT.includes('visitHistory?: Array<{ visitedByName: string; visitedAt: string; clearedRecheck: boolean }>') && PT.includes('visitCount?: number'));
check('the onSuccess files the fresh history per request', PT.includes('setVisitLog((prev) => ({') && PT.includes('Array.isArray(data.visitHistory)'));
check('the Visit history heading + History icon render', PT.includes('data-testid="leave-visit-history"') && PT.includes('<History className="h-3 w-3" aria-hidden />'));
check('the count chip keeps the total honest', PT.includes("{log.total} {log.total === 1 ? 'visit' : 'visits'}"));
check('clearing visits wear the emerald dot', PT.includes("'bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-800'"));
check('clearing visits wear the Cleared-a-re-check chip', PT.includes('<BadgeCheck className="h-2.5 w-2.5" aria-hidden /> Cleared a re-check'));
check('every entry wears the reviewer initial avatar', PT.includes('v.visitedByName.trim().charAt(0).toUpperCase()'));
check('the trail is capped at 5 with the earlier-visits line', PT.includes('log.entries.slice(0, 5)') && PT.includes('earlier {hidden === 1 ? \'visit\' : \'visits\'} on file'));
check('an empty ledger renders nothing', PT.includes('if (!log || log.entries.length === 0) return null;'));

console.log('== Tests ==');
const TS = read('src/tests/leave-review-visits.test.ts') ?? '';
check('the v2.63.0 suite exists', TS.includes('LeaveReviewVisit schema - the desk ledger table'));
check('the suite pins the route ledger contract', TS.includes('the visit is recorded and the history rides the response'));
check('the suite pins the dialog timeline contract', TS.includes('the visit timeline renders from the ledger'));

console.log('== History: v2.47–v2.62 anchors intact ==');
check('v2.58.0 tableToCsv still present', (read('src/lib/hr/digest-csv.ts') ?? '').includes('export function tableToCsv'));
check('v2.58.0 audit test still present', !!read('src/tests/bypass-reads-audit.test.ts'));
check('v2.57.0 rawDb feed fix still present', (read('src/lib/db.ts') ?? '').includes('rawDb'));
check('v2.59.0 re-check chip still present', PT.includes('re-check'));
check('v2.60.0 reviewer stamp still personal', RV.includes('deskReviewedByName: reviewerName'));
check('v2.61.0 employee bell still gated + named', RV.includes('kind: LEAVE_REVIEW_SEEN_METADATA_MARKER') && RV.includes("actionUrl: '/employees/me/leave'"));
check('v2.62.0 answered fan-out still gated by the dedup', RV.indexOf('kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER') > RV.indexOf('if (hadPendingCorrection) {'));
check('v2.62.0 emerald answered receipt still renders', PT.includes('border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40'));
check('v2.62.0 verify script still exists', !!read('scripts/verify-v2-62-0.mjs'));

console.log('');
if (failures === 0) {
  console.log('v2.63.0 verification: ALL PASS');
} else {
  console.log(`v2.63.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
