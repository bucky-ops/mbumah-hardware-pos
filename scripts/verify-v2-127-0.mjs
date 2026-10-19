#!/usr/bin/env node
// v2.127.0 verification — "the desk says goodbye".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.127.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.127.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.127.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.127.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-127-0'], 'verify script entry missing');
});

check('whats-new: 2.127.0 leads the feed with the goodbye story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.127.0'");
  assert(head > -1, 'no 2.127.0 entry');
  assert(head < wn.indexOf("version: '2.126.0'"), '2.127.0 does not lead');
  assert(wn.includes('The desk says goodbye'), 'title missing');
  assert(wn.includes('WITHDRAWN'), 'status vocabulary missing from bullets');
  assert(wn.includes('EMS_AUDIT_COVERAGE.md'), 'audit inventory disclosure missing from bullets');
});

check('changelog: [2.127.0] section leads with Added/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.127.0]');
  assert(head > -1, 'no [2.127.0] section');
  assert(head < cl.indexOf('## [2.126.0]'), '[2.127.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.126.0]'));
  for (const s of ['### Added', '### Security', 'the candidate', 'REJECTION_RETENTION_DAYS', 'docs/EMS_AUDIT_COVERAGE.md', 'docs/EMS_RBAC_MATRIX.md']) {
    assert(section.includes(s), `section pin missing: ${s}`);
  }
});

// ── the policy door ────────────────────────────────────────────────────────
check('policy: withdraw rides every live status; terminals stay empty', () => {
  const p = read('src/lib/hr/recruitment-policy.ts');
  assert(p.includes("'interview' | 'offer' | 'approve' | 'hire' | 'reject' | 'withdraw'"), 'action union missing withdraw');
  for (const status of ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER']) {
    const line = p.split(`${status}: [`)[1]?.split(']')[0];
    assert(line && line.includes("'withdraw'"), `${status} lacks withdraw`);
  }
  for (const status of ['HIRED', 'REJECTED', 'WITHDRAWN']) {
    const line = p.split(`${status}: [`)[1]?.split(']')[0];
    assert(typeof line === 'string' && line.trim() === '', `${status} is not empty: [${line}]`);
  }
  assert(p.includes("hasDraftOffer ? ['approve', 'reject', 'withdraw'] : ['offer', 'reject', 'withdraw']"), 'interviewActions lost withdraw in a branch');
  assert(p.includes("'neutral' | 'progress' | 'offer' | 'hired' | 'rejected' | 'withdrawn'"), 'StageTone missing withdrawn');
  assert(p.includes("case 'WITHDRAWN':\n      return 'withdrawn';"), 'badge tone unmapped');
});

check('policy: one retention clock — withdrawal reuses REJECTION_RETENTION_DAYS', () => {
  const p = read('src/lib/hr/recruitment-policy.ts');
  assert(p.includes('Withdrawal rides the SAME clock'), 'decision comment missing');
  const service = read('src/lib/hr/recruitment-service.ts');
  const block = service.slice(service.indexOf('export async function withdrawApplicant'));
  assert(block.includes('REJECTION_RETENTION_DAYS'), 'service does not ride the shared constant');
  assert(!service.includes('WITHDRAWN_RETENTION_DAYS'), 'a second constant appeared');
});

// ── the service ────────────────────────────────────────────────────────────
check('service: withdrawApplicant refuses the exits it must refuse', () => {
  const service = read('src/lib/hr/recruitment-service.ts');
  const block = service.slice(service.indexOf('export async function withdrawApplicant'), service.indexOf('Close an OPEN job to new applicants (v2.125.0)'));
  assert(block.length > 400, 'withdrawApplicant block suspiciously small');
  assert(block.includes("applicant.status === 'HIRED'"), 'HIRED not refused');
  assert(block.includes('cannot be withdrawn'), 'HIRED refusal sentence missing');
  assert(block.includes("applicant.status === 'REJECTED' || applicant.status === 'WITHDRAWN'"), 'already-left not refused');
  assert(block.includes('already left the pipeline'), 'already-left sentence missing');
  assert(block.includes("status: 'WITHDRAWN'"), 'status not set');
  assert(block.includes('dataRetentionUntil: retentionUntil'), 'retention not set');
  assert(block.includes("action: 'UPDATE'") && block.includes('HrEntityType.APPLICANT'), 'audit row missing');
  assert(block.includes('retentionDays'), 'retention days not in metadata');
});

check('service: no schema migration — the note rides the audit log only', () => {
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(!service.includes('withdrawalReason'), 'withdrawalReason invented');
  assert(!service.includes('withdrawalNote'), 'withdrawalNote invented');
  const schema = read('prisma/schema.prisma');
  assert(schema.includes('REJECTED, WITHDRAWN'), 'schema status comment intact');
  assert(!schema.includes('withdrawalNote'), 'schema grew a column');
});

// ── the route ──────────────────────────────────────────────────────────────
check('route: identical gate, optional note, honest status codes', () => {
  const route = read('src/app/api/recruitment/applicants/[id]/withdraw/route.ts');
  assert(route.includes("hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)"), 'wrong or missing gate');
  assert(route.includes('withdrawApplicant('), 'does not delegate to the service');
  assert(route.includes('body = {};'), 'empty body is not a valid withdrawal');
  assert(route.includes('note || undefined'), 'note not optional');
  assert(route.includes('slice(0, 500)'), 'note not clamped');
  assert(route.includes("'cannot be withdrawn'") && route.includes("'already left'"), '409 mapping incomplete');
  assert(route.includes("'not found'"), '404 mapping missing');
  assert(route.includes('force-dynamic'), 'route must be dynamic');
  assert(!route.includes('db.applicant'), 'route writes db directly');
});

// ── the desk ───────────────────────────────────────────────────────────────
check('desk: the violet door arms, confirms, and disarms', () => {
  const desk = read('src/app/(shell)/hr/recruitment/page.tsx');
  for (const pin of [
    "actions.includes('withdraw')",
    'hr-recruitment-withdraw-${a.id}',
    'hr-recruitment-withdraw-arm-${a.id}',
    'hr-recruitment-withdraw-note',
    'hr-recruitment-withdraw-confirm',
    'hr-recruitment-withdraw-cancel',
    'withdrawNote.trim() || undefined',
    'setWithdrawArm(null);',
    "setWithdrawNote('');",
    "candidate&apos;s own exit",
    '{REJECTION_RETENTION_DAYS} days',
    'withdrew from the pipeline',
  ]) {
    assert(desk.includes(pin), `pin missing: ${pin}`);
  }
});

check('desk: withdrawn reads as history — slate band, muted name, italic explainer', () => {
  const desk = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(desk.includes("a.status === 'WITHDRAWN' ? 'bg-slate-50/60 dark:bg-slate-500/5' : ''"), 'row band missing');
  assert(desk.includes('hr-recruitment-withdrawn-note-${a.id}'), 'explainer testid missing');
  assert(desk.includes('Candidate withdrew from the process'), 'explainer sentence missing');
  assert(desk.includes('withdrawn:'), 'TONE_CLASS lacks withdrawn');
  assert(desk.includes('border-slate-300 bg-slate-100 text-slate-600'), 'slate badge class missing');
  assert(desk.includes('bg-violet-50/70 dark:bg-violet-500/10'), 'violet arm band missing');
});

// ── the governance rider (EMS spec Phase 4.8, acceptance 7 + 8) ────────────
check('docs: audit coverage inventory exists and names its gap', () => {
  const inv = read('docs/EMS_AUDIT_COVERAGE.md');
  for (const s of ['acceptance 8', '96', '30 files', 'linkPortalAccount', 'deliberately does not audit', 'Known gaps']) {
    assert(inv.toLowerCase().includes(s.toLowerCase()), `inventory pin missing: ${s}`);
  }
});

check('docs: security headers + rate limits documented in the RBAC matrix', () => {
  const m = read('docs/EMS_RBAC_MATRIX.md');
  for (const s of ['acceptance 7', 'Strict-Transport-Security', 'X-Frame-Options', 'Permissions-Policy', 'AUTH', 'WEBHOOK', 'brute-force']) {
    assert(m.includes(s), `matrix pin missing: ${s}`);
  }
});

// ── tests + counters ───────────────────────────────────────────────────────
check('tests: the v2127 suite pins the door end to end', () => {
  const t = read('src/tests/recruitment-withdraw-v2127.test.ts');
  for (const s of ['interviewActions', 'withdrawn', 'cannot be withdrawn', 'already left', 'hr-recruitment-withdraw-confirm', 'Candidate withdrew from the process']) {
    assert(t.includes(s), `pin missing: ${s}`);
  }
});

check('tests: the unread counter re-anchored for the 2.127.0-fed feed', () => {
  const t = read('src/tests/console-changelog.test.ts');
  assert(t.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(16)"), '2.110.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.109.0')).toBe(17)"), '2.109.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.108.0')).toBe(18)"), '2.108.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(49)"), '2.77.0 anchor missing');
});

check('prior anchors: the v2.125/2.126 doors and the consent spine stay', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes('data-testid={`hr-recruitment-reject-arm-${a.id}`}'), 'reject arm missing');
  assert(page.includes('data-testid={`hr-recruitment-stage-arm-${a.id}`}'), 'stage arm missing');
  assert(page.includes('data-testid={`hr-recruitment-close-arm-${j.id}`}'), 'close arm missing');
  assert(page.includes('data-testid="hr-recruitment-readonly"'), 'read strip missing');
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(service.includes('Applicant consent is required before registering personal data (MISSING_CONSENT).'), 'consent requirement missing');
  assert(service.includes('DUPLICATE_DRAFT'), 'duplicate-draft guard missing');
});

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
