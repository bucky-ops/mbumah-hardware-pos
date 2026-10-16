#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.31.0 verification
// Decimal-arithmetic hygiene round: ALL 18 remaining TS2365/TS2363 baseline
// sites across 7 API routes now read Decimal-ish columns through toNum() so
// no decimal.js object (valueOf → STRING) can ever leak back into arithmetic
// (the trap class behind the v2.30.0 usedDays corruption). Plus the leave
// decision notification feature: PUT /api/leaves writes a durable bell row
// for the employee's linked user + a best-effort LEAVE_DECISION email, and
// the feed + notification center render it as its own type with status
// accents.
// Run: npm run verify:v2-31-0

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

const ATT = read('src/app/api/attendance/route.ts') ?? '';
const KRA = read('src/app/api/kra/submit/route.ts') ?? '';
const BUN = read('src/app/api/products/bundles/route.ts') ?? '';
const REP = read('src/app/api/reports/export/route.ts') ?? '';
const WHA = read('src/app/api/whatsapp/send-document/route.ts') ?? '';
const GFT = read('src/app/api/gift-cards/[id]/route.ts') ?? '';
const TXN = read('src/app/api/transactions/route.ts') ?? '';
const LEV = read('src/app/api/leaves/route.ts') ?? '';

console.log('== Decimal-safe helper (pure module) ==');
const SAFE = read('src/lib/decimal-safe.ts') ?? '';
check('decimal-safe module exists and stays pure', SAFE.includes('export function toNum') && !/^['"]use client['"]/.test(SAFE) && !/^import /m.test(SAFE));
check('helper documents the valueOf-STRING trap', SAFE.includes('valueOf'));
check('unit tests cover the DecimalStub concatenation regression', (read('src/tests/decimal-safe.test.ts') ?? '').includes('DecimalStub'));

console.log('== All 18 baseline sites read through toNum ==');
check('attendance: breakHours + expectedHours are toNum reads', ATT.includes('toNum(record.breakHours || 0)') && ATT.includes('toNum(record.expectedHours || 8)'));
check('kra/submit: discount math is toNum-wrapped', KRA.includes('toNum(item.pricePerUnit) * toNum(item.discountPercent)') && KRA.includes('toNum(item.quantity)'));
check('bundles: both reduce sums accumulate toNum products', BUN.includes('sum + toNum(bi.childProduct.pricePerUnit) * toNum(bi.quantityRequired)') && BUN.includes('sum + toNum(bi.childProduct.costPrice) * toNum(bi.quantityRequired)'));
check('bundles: discount subtraction is toNum-wrapped', BUN.includes('componentTotalPrice - toNum(bundle.pricePerUnit)'));
check('reports/export: stock value rows are toNum products', REP.includes('toNum(p.quantityInStock) * toNum(p.costPrice)') && REP.includes('toNum(p.quantityInStock) * toNum(p.pricePerUnit)'));
check('whatsapp: invoice itemTotal fallback is Decimal-safe', WHA.includes('toNum(item.lineTotal ?? toNum(item.quantity) * toNum(item.pricePerUnit))'));
check('whatsapp: quotation itemTotal fallback is Decimal-safe', (WHA.match(/toNum\(item\.lineTotal \?\? toNum\(item\.quantity\) \* toNum\(item\.pricePerUnit\)\)/g) ?? []).length >= 2);
check('whatsapp: discount/minimumPurchase comparisons are toNum reads', WHA.includes('toNum(invoice.discountAmount) > 0') && WHA.includes('toNum(transaction.discountAmount) > 0') && WHA.includes('toNum(voucher.minimumPurchase) > 0'));
check('gift-cards/[id]: balance guard + visibility use toNum', GFT.includes('newInitial < toNum(existing.currentBalance)') && GFT.includes('updateData.isVisible = toNum(existing.currentBalance) > 0'));
check('transactions: gift-card balance guard uses the canonical toNum', TXN.includes('toNum(giftCard.currentBalance) < finalTotal') && TXN.includes("from '@/lib/utils/financialMath'"));
check('leaves: defaultDaysPerYear guard is a toNum read', LEV.includes('toNum(leaveType.defaultDaysPerYear) > 0'));
check('no legacy raw-Decimal comparisons remain in the 7 routes', ![ATT, KRA, BUN, REP, WHA, GFT, LEV].some((s) => /[^.\w]([a-zA-Z][\w.]*\.currentBalance|leaveType\.defaultDaysPerYear)\s*[<>=]/.test(s.replace(/toNum\([^)]*\)/g, 'X'))));

console.log('== Leave decision notifications ==');
const LN = read('src/lib/hr/leave-notify.ts') ?? '';
check('pure copy module exists (directive-free, import-free)', LN.includes('export function leaveDecisionCopy') && !/^['"]use client['"]/.test(LN) && !/^import /m.test(LN));
check('copy covers APPROVED + REJECTED with optional reason', LN.includes("'APPROVED'") && LN.includes("'REJECTED'") && LN.includes('rejectionReason'));
check('metadata marker is stable for the feed query', LN.includes("LEAVE_DECISION_METADATA_MARKER = 'leave_decision'"));
check('fail-soft extras parser exists', LN.includes('export function parseLeaveDecisionExtras'));
check('PUT /api/leaves writes the bell row for the linked user', LEV.includes('db.notification.create') && LEV.includes('category: \'HR\'') && LEV.includes("kind: LEAVE_DECISION_METADATA_MARKER"));
check('PUT /api/leaves sends the best-effort LEAVE_DECISION email', LEV.includes("type: 'LEAVE_DECISION'") && LEV.includes('sendEmail'));
check('notification delivery is fail-soft (never blocks the decision)', /Decision delivery is best-effort/.test(LEV));
check('email-service tags LEAVE_DECISION', (read('src/lib/email-service.ts') ?? '').includes("LEAVE_DECISION: 'LEAVE_DECISION'"));
check('email-log viewer whitelists + chips LEAVE_DECISION', (read('src/components/admin/email-delivery-log-section.tsx') ?? '').includes("'LEAVE_DECISION'"));

console.log('== Feed + notification center ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('digest section excludes leave-decision rows', NF.includes('NOT: { metadata: { contains: LEAVE_DECISION_METADATA_MARKER } }'));
check('feed section 9 surfaces leave_decision rows', NF.includes("type: 'leave_decision'") && NF.includes('parseLeaveDecisionExtras'));
check('feed rows carry the decision status', NF.includes("leaveStatus: declined ? 'REJECTED' : 'APPROVED'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check('center renders decision icons (emerald check / amber cross)', NC.includes('CalendarCheck2') && NC.includes('CalendarX2'));
check('center paints status rails by decision', NC.includes("border-l-emerald-400 dark:border-l-emerald-500") && NC.includes("border-l-amber-400 dark:border-l-amber-500"));
check('center shows Approved/Declined chips', NC.includes("=== 'APPROVED' ? 'Approved' : 'Declined'"));
check('api.ts NotificationItem carries leaveStatus', (read('src/lib/api.ts') ?? '').includes("leaveStatus?: 'APPROVED' | 'REJECTED'"));

console.log('== QA seed prefers a linked user (bell QA) ==');
check('pending seed prefers employees with userId', (read('scripts/qa-seed-leave-pending.mjs') ?? '').includes('userId: { not: null }'));

console.log('== Version lockstep ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
const rel = pkg.mbumah ?? {};
check('package.json version is 2.31.0', pkg.version === '2.31.0', pkg.version);
check('mbumah.releaseVersion is 2.31.0', rel.releaseVersion === '2.31.0', rel.releaseVersion);
check('mbumah.baseVersion is 2.31.0', rel.baseVersion === '2.31.0', rel.baseVersion);
check("What's-New has a 2.31.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.31.0'"));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
