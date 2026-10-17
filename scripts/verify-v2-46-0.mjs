#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.46.0 verification
// Scope: digest emails arrive with a ready-to-file CSV attachment (pure
// digest-csv builder, EmailAttachment support in the email service with
// names+sizes-only audit metadata, both digest send sites attach, delivery
// rows surface the violet CSV chip, send-now reports the attachment) and
// admin password resets are no longer silent (PASSWORD_CHANGED admin-reset
// variant fired best-effort by PATCH /api/users/[id]).
// Run: node scripts/verify-v2-46-0.mjs

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
check('package.json version is 2.46.0', PKG.version === '2.46.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.46.0', PKG.mbumah?.releaseVersion === '2.46.0');
check('mbumah.baseVersion is 2.46.0', PKG.mbumah?.baseVersion === '2.46.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.46.0 entry", WN.includes("version: '2.46.0'"));
check("What's-New mentions the CSV attachment", WN.includes('ready-to-file CSV'));
check("What's-New mentions the admin reset notice", WN.includes('An administrator changed your password'));

console.log('== Pure builder: src/lib/hr/digest-csv.ts ==');
const CSV = read('src/lib/hr/digest-csv.ts') ?? '';
check('module exists', !!CSV);
check('exports digestToCsv', CSV.includes('export function digestToCsv'));
check('exports csvCell', CSV.includes('export function csvCell'));
check('exports formatCsvSize', CSV.includes('export function formatCsvSize'));
check('exports periodFilenameFragment', CSV.includes('export function periodFilenameFragment'));
check('RFC-4180 CRLF framing', CSV.includes("join('\\r\\n')"));
check('quote-doubling escape', CSV.includes('replace(/"/g, \'""\')'));
check('formula-injection guard (= + - @ tab CR)', CSV.includes("/^[=+\\-@\\t\\r]/"));
check('filename slug from reportLabel', CSV.includes('mbumah-${slug(digest.reportLabel)}'));
check('byteSize measured from the UTF-8 buffer', CSV.includes('Buffer.byteLength(csv'));
check('pure module (no db / network imports)', !CSV.includes("@/lib/db") && !CSV.includes('fetch('));
check('null when a digest has nothing to file', CSV.includes('return null'));

console.log('== Email service: attachments support ==');
const ES = read('src/lib/email-service.ts') ?? '';
check('EmailAttachment type exported', ES.includes('export interface EmailAttachment'));
check('SendEmailParams.attachments optional', ES.includes('attachments?: EmailAttachment[]'));
check('passthrough to the Resend SDK', ES.includes('...(attachments && attachments.length > 0 ? { attachments } : {})'));
check('per-file cap (10 MB)', ES.includes('MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024'));
check('total cap (20 MB)', ES.includes('MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024'));
check('count cap (10 files)', ES.includes('MAX_ATTACHMENTS = 10'));
check('validation runs BEFORE the Resend call', ES.indexOf('const attachmentError = validateAttachments(attachments)') < ES.indexOf('const resend = createResendClient()'));
check('log metadata carries names + sizes', ES.includes('attachmentLogMeta'));
check('log metadata NEVER carries content', !/attachments:\s*attachments/.test(ES));

console.log('== Schedule service: both send sites attach the CSV ==');
const SVC = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('imports the builder', SVC.includes("from '@/lib/hr/digest-csv'"));
check('scheduled sweep builds the CSV', (SVC.split('runDueHrReportSchedules')[1] ?? '').includes('digestToCsv(digest, now)'));
check('scheduled sweep passes attachments', (SVC.split('runDueHrReportSchedules')[1] ?? '').includes('...(csv ? { attachments: [csv] } : {})'));
check('scheduled metadata stamps csvFilename + csvBytes', (SVC.split('runDueHrReportSchedules')[1] ?? '').includes('csvFilename: csv.filename'));
check('send-now builds the CSV', (SVC.split('export async function sendScheduleNow')[1] ?? '').includes('digestToCsv(digest, now)'));
check('send-now passes attachments', (SVC.split('export async function sendScheduleNow')[1] ?? '').includes('...(attachment ? { attachments: [attachment] } : {})'));
check('send-now result carries csv info', (SVC.split('export interface SendScheduleNowResult')[1] ?? '').split('export async function sendScheduleNow')[0].includes('csv: { filename: string; byteSize: number } | null'));
check('in-app copy mentions the attachment', SVC.includes('attached.`'));
check('deliveries DTO exposes csvFilename', (SVC.split('export interface ScheduleDeliveryRow')[1] ?? '').split('export interface SchedulePreview')[0].includes('csvFilename: string | null'));
check('deliveries DTO exposes csvBytes', (SVC.split('export interface ScheduleDeliveryRow')[1] ?? '').split('export interface SchedulePreview')[0].includes('csvBytes: number | null'));
check('delivery rows parse csvFilename from metadata', SVC.includes("typeof meta.csvFilename === 'string'"));
check('delivery rows parse csvBytes from metadata', SVC.includes("typeof meta.csvBytes === 'number'"));

console.log('== Admin-reset security notice ==');
const TPL = read('src/lib/email-templates.ts') ?? '';
check('template takes changedByAdmin', TPL.includes('changedByAdmin?: boolean'));
check('template takes changedByAdminEmail', TPL.includes('changedByAdminEmail?: string'));
check('admin variant headline', TPL.includes('An administrator changed your password'));
check('admin variant explains the rotation lock', TPL.includes('"Set a new password" screen'));
check('admin variant next step', TPL.includes('sign in with the temporary password you were given'));
check('self variant untouched', TPL.includes("The password for <strong>${data.userEmail}</strong> was just changed from your account settings."));
const USERS = read('src/app/api/users/[id]/route.ts') ?? '';
check('users route imports sendEmail', USERS.includes("from '@/lib/email-service'"));
check('users route imports the template', USERS.includes("from '@/lib/email-templates'"));
check('notice fires only on password changes', USERS.includes('if (password !== undefined) {') && USERS.includes('passwordChangedTemplate({'));
check('subject names the actor class', USERS.includes('An administrator changed your MBUMAH HARDWARE password'));
check('notice is best-effort (never fails the PATCH)', USERS.includes('.catch(() => undefined);'));
check('metadata carries changedByAdmin', USERS.includes('changedByAdmin: true'));
check('type is PASSWORD_CHANGED', (USERS.split('if (password !== undefined) {').pop() ?? '').includes('NotificationType.PASSWORD_CHANGED'));

console.log('== Schedules tab UI ==');
const TAB = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('DeliveryRow carries csv fields', TAB.includes('csvFilename: string | null') && TAB.includes('csvBytes: number | null'));
check('violet CSV chip renders', TAB.includes('bg-violet-100') && TAB.includes('CSV{d.csvBytes'));
check('chip tooltip names the file', TAB.includes('the ready-to-file CSV attached to this digest email'));
check('send-now contract includes csv', TAB.includes('csv: { filename: string; byteSize: number } | null'));
check('send-now note reports the attachment', TAB.includes('ready-to-file CSV'));
check('imports formatCsvSize', TAB.includes("import { formatCsvSize } from '@/lib/hr/digest-csv'"));
check('imports the Paperclip icon', TAB.includes('Paperclip,'));

console.log('== package.json script ==');
check('verify:v2-46-0 registered', (PKG.scripts ?? {})['verify:v2-46-0'] === 'node scripts/verify-v2-46-0.mjs');

console.log('');
if (failures > 0) {
  console.log(`FAILED: ${failures} check(s) did not pass.`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
