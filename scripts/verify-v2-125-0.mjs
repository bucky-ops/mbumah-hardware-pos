#!/usr/bin/env node
// v2.125.0 verification — "the desk starts hiring".
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
check('version: package.json leads 2.125.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.125.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.125.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.125.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-125-0'], 'verify script entry missing');
});

check('whats-new: 2.125.0 leads the feed with the hiring story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.125.0'");
  assert(head > -1, 'no 2.125.0 entry');
  assert(head < wn.indexOf("version: '2.124.0'"), '2.125.0 does not lead');
  assert(wn.includes('The desk starts hiring'), 'title missing');
  assert(wn.includes('Reject'), 'reject vocabulary missing from bullets');
  assert(wn.includes('never invented'), 'honest-terms disclosure missing from bullets');
});

check('changelog: [2.125.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.125.0]');
  assert(head > -1, 'no [2.125.0] section');
  assert(head < cl.indexOf('## [2.124.0]'), '[2.125.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.124.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the policy (single source of truth) ────────────────────────────────────
check('policy: pure module owning the role gates and the action map', () => {
  const policy = read('src/lib/hr/recruitment-policy.ts');
  assert(!policy.includes('@/lib/db'), 'policy must never import the db client');
  assert(policy.includes("export const RECRUITMENT_READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'] as const;"), 'read roles missing');
  assert(policy.includes("export const RECRUITMENT_WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;"), 'write roles missing');
  assert(policy.includes('export function actionsForStatus('), 'action map missing');
  assert(policy.includes('HIRED: []'), 'terminal states must allow nothing');
  assert(policy.includes('export function stageBadgeTone('), 'tone map missing');
  assert(policy.includes('export function canCloseJob('), 'close rule missing');
  assert(policy.includes('REJECTION_RETENTION_DAYS = 90'), 'retention disclosure missing');
});

check('routes: all five recruitment routes ride the policy roles', () => {
  const files = [
    'src/app/api/recruitment/jobs/route.ts',
    'src/app/api/recruitment/applicants/route.ts',
    'src/app/api/recruitment/applicants/[id]/stage/route.ts',
    'src/app/api/recruitment/applicants/[id]/offer/route.ts',
    'src/app/api/recruitment/applicants/[id]/convert/route.ts',
  ];
  for (const f of files) {
    const route = read(f);
    assert(route.includes("from '@/lib/hr/recruitment-policy'"), `${f} missing policy import`);
    assert(!route.includes("const WRITE_ROLES = ['HR_MANAGER'"), `${f} keeps a hand-copied write gate`);
    assert(!route.includes("const READ_ROLES = ['HR_MANAGER'"), `${f} keeps a hand-copied read gate`);
  }
});

// ── the reject door ────────────────────────────────────────────────────────
check('reject route: write-gated, reason required, existing service fn', () => {
  const route = read('src/app/api/recruitment/applicants/[id]/reject/route.ts');
  assert(route.includes("hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)"), 'write guard missing');
  assert(route.includes('A rejection reason is required — it rides the audit log.'), 'reason requirement missing');
  assert(route.includes('rejectApplicant(id, session.userId, session.role, reason)'), 'must call the service fn');
  assert(route.includes('retentionUntil: result.retentionUntil.toISOString()'), 'retention date missing');
});

check('reject service: re-rejection and hired refusals hardened', () => {
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(service.includes("throw new Error('Applicant has already left the pipeline.')"), 're-reject guard missing');
  assert(service.includes("throw new Error('A hired applicant cannot be rejected.')"), 'hired guard missing');
  assert(service.includes('dataRetentionUntil: retentionUntil'), 'retention window missing');
});

// ── the close door ─────────────────────────────────────────────────────────
check('close route: write-gated and backed by closeJob', () => {
  const route = read('src/app/api/recruitment/jobs/[id]/close/route.ts');
  assert(route.includes("hrGuard('hr.recruitment.manage', RECRUITMENT_WRITE_ROLES)"), 'write guard missing');
  assert(route.includes('closeJob({ jobId: id, actorId: session.userId, actorRole: session.role })'), 'service call missing');
});

check('close service: only OPEN jobs, closedAt stamped, audited', () => {
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(service.includes('export async function closeJob('), 'closeJob missing');
  assert(service.includes("throw new Error(`Job is ${job.status}; only OPEN jobs can be closed.`)"), 'status guard missing');
  assert(service.includes("data: { status: 'CLOSED', closedAt: new Date() }"), 'closedAt stamp missing');
  assert(service.includes("reason: 'Job closed to new applicants.'"), 'audit reason missing');
});

// ── the envelope + the desk ────────────────────────────────────────────────
check('jobs GET: canWrite rides the envelope, computed server-side', () => {
  const route = read('src/app/api/recruitment/jobs/route.ts');
  assert(route.includes('(RECRUITMENT_WRITE_ROLES as readonly string[]).includes(session.role)'), 'canWrite computation missing');
  assert(route.includes('canWrite'), 'envelope field missing');
});

check('page: the fabricated offer terms are exorcised', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(!page.includes('3_000_000'), 'hard-coded KES 30,000 still lives');
  assert(!page.includes('86400000'), '+7-days fabrication still lives');
  assert(page.includes('the desk never'), 'honest-terms copy missing');
  assert(page.includes('invents them.'), 'honest-terms copy missing (2)');
});

check('page: arms demand real terms and refuse empty submissions', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes("useState({ salary: '', startDate: '' })"), 'offer inputs must start empty');
  assert(page.includes('data-testid="hr-recruitment-offer-salary"'), 'salary input missing');
  assert(page.includes('data-testid="hr-recruitment-offer-date"'), 'date input missing');
  assert(page.includes('proposedSalaryCents: cents'), 'cent conversion missing');
  assert(page.includes('data-testid="hr-recruitment-reject-reason"'), 'reject reason input missing');
  assert(page.includes('!rejectReason.trim()'), 'empty reason must block confirm');
});

check('page: the offer handoff is closed — draft turns into approve & send', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes('interviewActions((a.offers?.length ?? 0) > 0)'), 'draft-offer hinge missing');
  assert(page.includes('Approve &amp; send'), 'approve button missing');
  assert(page.includes("?offerId=${draftId}`, {}, 'PATCH')"), 'PATCH call missing');
  const applicantsRoute = read('src/app/api/recruitment/applicants/route.ts');
  assert(applicantsRoute.includes("offers: { where: { status: 'DRAFT' }, take: 1, select: { id: true, status: true } }"), 'draft offer include missing');
});

check('page: honest read posture, counts strip, and honest empties', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes('data-testid="hr-recruitment-readonly"'), 'read strip missing');
  assert(page.includes('setCanWrite(j.canWrite === true)'), 'canWrite parse missing');
  assert(page.includes('data-testid="hr-recruitment-counts"'), 'counts strip missing');
  assert(page.includes('No jobs yet — hiring starts with a job.'), 'jobs empty guidance missing');
  assert(page.includes('No candidates yet. Register an applicant against an open job to start the pipeline.'), 'pipeline empty guidance missing');
  assert(page.includes('function disarmAll()'), 'cross-disarm missing');
  assert(page.includes("from '@/lib/hr/recruitment-policy'"), 'desk must render from the policy map');
});

// ── tests + prior anchors ──────────────────────────────────────────────────
check('tests: the v2.125.0 suite exists and pins the contract', () => {
  const t = read('src/tests/recruitment-v2125.test.ts');
  for (const s of [
    'the pipeline single source of truth',
    'the door that never existed',
    'the fabricated offer terms are EXORCISED',
    'history, not buttons that 403',
    'consent spine',
  ]) {
    assert(t.includes(s), `pin missing: ${s}`);
  }
});

check('tests: the unread counter re-anchored for the 2.125.0-fed feed', () => {
  const t = read('src/tests/console-changelog.test.ts');
  assert(t.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(14)"), '2.110.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.109.0')).toBe(15)"), '2.109.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.108.0')).toBe(16)"), '2.108.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(47)"), '2.77.0 anchor missing');
});

check('prior anchors: the consent spine and the pipeline stages stay', () => {
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(service.includes('Applicant consent is required before registering personal data (MISSING_CONSENT).'), 'consent requirement missing');
  assert(service.includes("lawfulBasis: 'CONSENT'"), 'consent record missing');
  assert(service.includes('export async function convertApplicantToEmployee('), 'convert fn missing');
  assert(service.includes('REJECTION_RETENTION_DAYS = 90'), '90-day window missing');
});

check('dead-surface fix: the permission map admits the owner to read.branch', () => {
  const perms = read('src/lib/hr/permissions.ts');
  assert(perms.includes("'hr.recruitment.read.branch': ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'],"),
    'the drift that 403\u2019d every living user still lives');
});

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
