#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.48.0 verification
// Scope: the payroll-run POSTING digest — the approval-digest machinery
// pointed at the moment the ledger closes (journal entry + payslips
// issued): the pure posted copy + posted CSV variant, the best-effort
// fan-out inside postPayrollRun (maker + payroll group minus the poster,
// replay never re-notifies), the post route surfacing the digest, the
// notification feed carrying payroll_posted rows (both filter lists),
// NotificationType.PAYROLL_POSTED, the v2.47.0 QA fix (payroll_approved
// in the client type union + icon surface), the run-dialog posting banner
// and the What's-New entry.
// Run: node scripts/verify-v2-48-0.mjs

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
check('package.json version is 2.48.0', PKG.version === '2.48.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.48.0', PKG.mbumah?.releaseVersion === '2.48.0');
check('mbumah.baseVersion is 2.48.0', PKG.mbumah?.baseVersion === '2.48.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.48.0 entry", WN.includes("version: '2.48.0'"));
check("What's-New mentions the posting digest", WN.includes('posting digest') || WN.includes('Posting'));
check("What's-New mentions the payslip numbers", WN.includes('payslip'));
check('verify:v2-48-0 script is wired', (PKG.scripts ?? {})['verify:v2-48-0'] === 'node scripts/verify-v2-48-0.mjs');

console.log('== Pure module: src/lib/hr/payroll/run-digest.ts ==');
const RD = read('src/lib/hr/payroll/run-digest.ts') ?? '';
check('exports the payroll_posted marker', RD.includes("PAYROLL_POSTED_METADATA_MARKER = 'payroll_posted'"));
check('exports the PayrollRunPostedMeta contract', RD.includes('interface PayrollRunPostedMeta'));
check('exports the posted copy builder', RD.includes('export function payrollRunPostedCopy'));
check('posted copy uses the sky surface family (#0c4a6e, not the approval emerald)', RD.includes('#0c4a6e'));
check('posted copy carries the payslip range', RD.includes('firstPayslipNumber') && RD.includes('lastPayslipNumber'));
check('CSV builder takes the posted variant', RD.includes("variant: 'approval' | 'posted' = 'approval'"));
check('posted CSV header block flips labels', RD.includes("posted ? 'Payroll posting summary' : 'Payroll approval summary'"));
check('posted CSV adds the Payslips issued row', RD.includes("'Payslips issued'"));
check('posted filename suffix prevents inbox collisions', RD.includes("'-posted'"));
check('reuses the RFC-4180 cell escaper', RD.includes("from '@/lib/hr/digest-csv'"));
check('privacy contract in the posted email footer', RD.includes('never contains national IDs'));
check('money stays deterministic (no locale-dependent toLocaleString)', !RD.includes('toLocaleString'));

console.log('== Service fan-out: src/lib/hr/payroll/run-service.ts ==');
const RS = read('src/lib/hr/payroll/run-service.ts') ?? '';
check('sends the digest inside postPayrollRun', RS.includes('notifyPayrollRunPosted'));
check('fail-soft: posting never fails on digest errors', RS.includes("console.warn('[payroll] posting digest failed (best-effort)"));
check('returns { run, journalEntryId, replay, digest } contract', RS.includes('journalEntryId: journal.id, replay: false, digest'));
check('idempotent replay path returns NO digest (never re-notify)', (RS.split('if (run.journalEntryId)')[1] ?? '').includes('replay: true'));
check('audience excludes the actor (the poster)', RS.includes('byId.delete(params.actorId)'));
check('maker always included (their work just became payslips)', RS.includes('byId.set(maker.id, maker)'));
check('decision-capable roles mirror the approval fan-out', RS.includes("'SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'"));
check('CSV rides the email envelope', RS.includes('attachments: [csv]'));
check('email type is PAYROLL_POSTED', RS.includes("type: 'PAYROLL_POSTED'"));
check('in-app rows carry the payroll_posted kind marker', RS.includes('kind: PAYROLL_POSTED_METADATA_MARKER'));
check('metadata stamps postedBy + payslipCount', RS.includes('postedBy: posterLabel') && RS.includes('payslipCount: meta.payslipCount'));

console.log('== Post route response ==');
const PR = read('src/app/api/payroll/runs/[id]/post/route.ts') ?? '';
check('route destructures the digest result', PR.includes('digest } = await postPayrollRun') || PR.includes('digest,'));
check('response carries the digest at the top level', PR.includes('digest })'));

console.log('== Email service vocabulary ==');
const ES = read('src/lib/email-service.ts') ?? '';
check("NotificationType.PAYROLL_POSTED exists", ES.includes("PAYROLL_POSTED: 'PAYROLL_POSTED'"));
check("NotificationType.PAYROLL_APPROVED still exists (v2.47.0 intact)", ES.includes("PAYROLL_APPROVED: 'PAYROLL_APPROVED'"));

console.log('== Feed route: both filter lists ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('imports both payroll markers', NF.includes('PAYROLL_APPROVED_METADATA_MARKER') && NF.includes('PAYROLL_POSTED_METADATA_MARKER'));
check("type union carries 'payroll_posted'", NF.includes("| 'payroll_posted'"));
check('section-8 NOT list excludes posting rows', (NF.split('NOT: {')[1] ?? '').includes('PAYROLL_POSTED_METADATA_MARKER'));
check('section-9 OR list includes posting rows', (NF.split("9. v2.31.0")[1] ?? '').includes('PAYROLL_POSTED_METADATA_MARKER'));
check('posting branch deep-links the Payroll tab', NF.includes("kind === 'payroll_posted'") && (NF.split("kind === 'payroll_posted'")[1] ?? '').includes("targetTab: 'payroll'"));
check('FAILED email delivery escalates to warning (posting)', (NF.split("kind === 'payroll_posted'")[1] ?? '').includes("extras.emailStatus === 'FAILED'"));
check('approval rows flatten the delivery stamp (v2.48.0 chip)', (NF.split("kind === 'payroll_approved'")[1] ?? '').includes('emailStatus: extras.emailStatus'));
check('leave kind parser accepts payroll_posted', (read('src/lib/hr/leave-notify.ts') ?? '').includes("rec.kind === 'payroll_posted'"));

console.log('== Client surfaces ==');
const API = read('src/lib/api.ts') ?? '';
check('NotificationItem type union carries payroll_approved (v2.47.0 QA fix)', API.includes("| 'payroll_approved'"));
check('NotificationItem type union carries payroll_posted', API.includes("| 'payroll_posted'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check("icon switch handles 'payroll_approved' (emerald banknote)", NC.includes("case 'payroll_approved':") && NC.includes('Banknote'));
check("icon switch handles 'payroll_posted' (sky open-book)", NC.includes("case 'payroll_posted':") && NC.includes('BookOpenCheck'));
check('emerald left rail on approval rows', NC.includes("notification.type === 'payroll_approved' ? 'border-l-[3px] border-l-emerald-400"));
check('sky left rail on posting rows', NC.includes("notification.type === 'payroll_posted' ? 'border-l-[3px] border-l-sky-400"));
check('Approved/Posted status chips on payroll rows', NC.includes("'Approved' : 'Posted'"));
check('honest email delivery chip on payroll rows', NC.includes("'Email sent' : 'Email failed'"));
const DL = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('captures body.digest after approve AND post', DL.includes("if (action === 'approve' || action === 'post')"));
check('banner label flips by action kind', DL.includes("'Posting digest · '") && DL.includes("'Approval digest · '"));
check('emerald / amber / slate honest status styling', DL.includes("digestNotice.emailStatus === 'SENT'") && DL.includes("digestNotice.emailStatus === 'FAILED'"));
check('names the attached CSV file + size', DL.includes('csvFilename') && DL.includes('formatCsvSize'));

console.log('== Tests ==');
const TD = read('src/tests/payroll-posted-digest.test.ts') ?? '';
check('posted digest test file exists', !!TD);
check('covers the sky-vs-emerald surface guard', TD.includes('#0c4a6e'));
check('covers the payslip range line', TD.includes('Payslips issued'));
check('covers the -posted filename suffix', TD.includes('-posted.csv'));
check('covers the injection guard on the posted variant', TD.includes('=HYPERLINK'));
check('covers the fail-soft guarantee', TD.includes('expect(result.emailStatus)'));
check('covers the actor exclusion + maker inclusion', TD.includes("['maker-1', 'owner-1']"));
check('covers the quiet skip when the run row disappeared', TD.includes('already disappeared'));

console.log('');
if (failures === 0) {
  console.log('v2.48.0 verification: ALL PASS');
} else {
  console.log(`v2.48.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
