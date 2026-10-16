#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.32.0 verification
// QA-discovered P1: request<T> returns the ApiResponse ENVELOPE, but SEVEN
// tabs read sendDocument fields FLAT (res.waLink etc.) - always undefined at
// runtime, so the WhatsApp-share buttons in gift-cards, transactions,
// inventory, catalog, credits, invoices (preview) and delivery-notes
// (preview) were silently dead. All now read res.data, and a static contract
// test forbids the flat reads forever. Plus: leave-request SUBMISSION
// notifications to managers (the mirror of v2.31.0's decision
// notifications), and the gift-cards route's typed-body cleanup.
// Run: npm run verify:v2-32-0

import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

function stripComments(src) {
  return src
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

console.log('== WhatsApp envelope contract (the seven dead buttons) ==');
const TABS_DIR = join(ROOT, 'src/app/(shell)/tabs');
const tabs = readdirSync(TABS_DIR).filter((f) => f.endsWith('.tsx'));
const flat = [];
for (const f of tabs) {
  const src = stripComments(readFileSync(join(TABS_DIR, f), 'utf8'));
  if (/res\??\.waLink\b|res\??\.documentTitle\b|\(\s*res\s+as\s*\{[^}]*waLink|\(\s*res\s+as\s*\{[^}]*documentTitle|\(\s*res\s+as\s*\{[^}]*message/.test(src)) flat.push(f);
}
check('no tab reads sendDocument fields flat off the envelope', flat.length === 0, flat.join(', ') || 'clean');
const consumers = tabs.filter((f) => readFileSync(join(TABS_DIR, f), 'utf8').includes('whatsappApi.sendDocument'));
check(
  'every sendDocument consumer reads res.data',
  consumers.every((f) => /res\.data|r\?\.data|res\?\.data/.test(stripComments(readFileSync(join(TABS_DIR, f), 'utf8')))),
  `${consumers.length} consumers`
);
check('static regression guard exists and is test-covered', (read('src/tests/whatsapp-envelope-contract.test.ts') ?? '').includes('stripComments'));

console.log('== Leave request submission notifications (manager direction) ==');
const LN = read('src/lib/hr/leave-notify.ts') ?? '';
check('submission copy builder exists (pure module)', LN.includes('export function leaveSubmissionCopy'));
check('submission marker constant is stable', LN.includes("LEAVE_REQUEST_METADATA_MARKER = 'leave_request'"));
check('parser returns the kind selector', LN.includes("rec.kind === 'leave_decision' || rec.kind === 'leave_request'"));
const LEV = read('src/app/api/leaves/route.ts') ?? '';
check('POST /api/leaves notifies decision-capable users', LEV.includes("role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] }") && LEV.includes("id: { not: session.userId }"));
check('POST writes one bell row per approver (createMany)', LEV.includes('db.notification.createMany') && LEV.includes('kind: LEAVE_REQUEST_METADATA_MARKER'));
check('POST sends ONE grouped LEAVE_REQUEST email', LEV.includes("type: 'LEAVE_REQUEST'") && LEV.includes('approverEmails'));
check('submission delivery is fail-soft', /Submission delivery is best-effort/.test(LEV));
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('feed pulls both leave markers', NF.includes('LEAVE_REQUEST_METADATA_MARKER') && NF.includes('OR: ['));
check('feed maps submission rows to targetTab payroll', NF.includes("targetTab: 'payroll'") && NF.includes("type: 'leave_request'"));
check('pre-v2.32.0 rows still map as decisions', NF.includes("extras.kind ?? 'leave_decision'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check('center renders the sky CalendarPlus icon for requests', NC.includes('CalendarPlus') && NC.includes('text-sky-600'));
check('center paints the sky rail + New request chip', NC.includes('border-l-sky-400 dark:border-l-sky-500') && NC.includes('New request'));
check('api.ts NotificationItem carries leave_request', (read('src/lib/api.ts') ?? '').includes("'leave_request'"));
const ES = read('src/lib/email-service.ts') ?? '';
check('email-service tags LEAVE_REQUEST', ES.includes("LEAVE_REQUEST: 'LEAVE_REQUEST'"));
check('email-log viewer whitelists + chips LEAVE_REQUEST', (read('src/components/admin/email-delivery-log-section.tsx') ?? '').includes("'LEAVE_REQUEST'"));

console.log('== Gift-cards route typed-body cleanup ==');
const GFT = read('src/app/api/gift-cards/route.ts') ?? '';
check('currency coerced through a string guard', GFT.includes('asTrimmedString((body as Record<string, unknown>).currency)'));
check('issuedTo coerced through a string guard', GFT.includes('const issuedTo = asTrimmedString((body as Record<string, unknown>).issuedTo)'));
check('expiresAt narrowed to string | Date | null', GFT.includes('const expiresAt: string | Date | null'));

console.log('== Version lockstep ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
const rel = pkg.mbumah ?? {};
check('package.json version is 2.32.0', pkg.version === '2.32.0', pkg.version);
check('mbumah.releaseVersion is 2.32.0', rel.releaseVersion === '2.32.0', rel.releaseVersion);
check('mbumah.baseVersion is 2.32.0', rel.baseVersion === '2.32.0', rel.baseVersion);
check("What's-New has a 2.32.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.32.0'"));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
