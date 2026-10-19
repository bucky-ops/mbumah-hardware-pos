#!/usr/bin/env node
// v2.126.0 verification — "the pipeline shows its steps".
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
check('version: package.json leads 2.126.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.126.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.126.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.126.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-126-0'], 'verify script entry missing');
});

check('whats-new: 2.126.0 leads the feed with the steps story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.126.0'");
  assert(head > -1, 'no 2.126.0 entry');
  assert(head < wn.indexOf("version: '2.125.0'"), '2.126.0 does not lead');
  assert(wn.includes('The pipeline shows its steps'), 'title missing');
  assert(wn.includes('Record stage'), 'stage vocabulary missing from bullets');
  assert(wn.includes('One live offer per candidate'), 'duplicate-draft disclosure missing from bullets');
});

check('changelog: [2.126.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.126.0]');
  assert(head > -1, 'no [2.126.0] section');
  assert(head < cl.indexOf('## [2.125.0]'), '[2.126.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.125.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the one list (policy single-sourcing) ──────────────────────────────────
check('policy: PIPELINE_STAGES and STAGE_OUTCOMES live once', () => {
  const policy = read('src/lib/hr/recruitment-policy.ts');
  assert(policy.includes("export const PIPELINE_STAGES = ['SCREENING', 'INTERVIEW_ONE', 'INTERVIEW_TWO', 'TASK', 'REFERENCE', 'OFFER'] as const;"), 'stage list missing');
  assert(policy.includes("export const STAGE_OUTCOMES = ['PENDING', 'PASS', 'FAIL'] as const;"), 'outcome list missing');
  assert(policy.includes('export function formatOfferKes('), 'KES formatter missing');
  assert(policy.includes('export function offerChipLabel('), 'chip label missing');
  assert(!policy.includes('@/lib/db'), 'policy must never import the db client');
});

check('service: validation imports the SAME list; local copies are gone', () => {
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(service.includes("import { PIPELINE_STAGES, REJECTION_RETENTION_DAYS } from './recruitment-policy';"), 'policy import missing');
  assert(service.includes('const STAGES = PIPELINE_STAGES;'), 'STAGES must alias the policy list');
  assert(!service.includes("const STAGES = ['SCREENING'"), 'local stage copy still lives');
  assert(!service.includes('const REJECTION_RETENTION_DAYS = 90;'), 'local retention copy still lives');
  assert(service.includes('retentionUntil.setDate(retentionUntil.getDate() + REJECTION_RETENTION_DAYS)'), 'retention window must still ride');
});

// ── the duplicate-draft guard ──────────────────────────────────────────────
check('guard: createOffer refuses a second DRAFT with the DUPLICATE_DRAFT code', () => {
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(service.includes("where: { applicantId: input.applicantId, status: 'DRAFT' }"), 'pending-draft probe missing');
  assert(service.includes('(DUPLICATE_DRAFT)'), 'code missing from the refusal');
});

check('offer route: the guard maps to 409', () => {
  const route = read('src/app/api/recruitment/applicants/[id]/offer/route.ts');
  assert(route.includes("message.includes('DUPLICATE_DRAFT') ? 409 : 500"), '409 mapping missing');
});

// ── the stage arm ──────────────────────────────────────────────────────────
check('page: the hard-coded jump is exorcised', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(!page.includes("stage: 'INTERVIEW_ONE', outcome: 'PASS'"), 'the auto-jump still lives');
  assert(!page.includes('To interview'), 'the old label still lives');
});

check('page: Record stage… arms the sky row with real inputs', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes('data-testid={`hr-recruitment-stage-arm-${a.id}`}'), 'arm testid missing');
  assert(page.includes('data-testid="hr-recruitment-stage-select"'), 'stage select missing');
  assert(page.includes('data-testid="hr-recruitment-outcome-select"'), 'outcome select missing');
  assert(page.includes('data-testid="hr-recruitment-stage-notes"'), 'notes input missing');
  assert(page.includes('data-testid="hr-recruitment-stage-confirm"'), 'confirm missing');
  assert(page.includes('Confirm stage'), 'confirm label missing');
  assert(page.includes('it never skips ahead for you.'), 'honesty copy missing');
  assert(page.includes('PIPELINE_STAGES.map((s) =>'), 'select must render from the policy list');
  assert(page.includes('STAGE_OUTCOMES.map((o) =>'), 'outcome select must render from the policy list');
  assert(page.includes('notes: stageForm.notes.trim() || undefined'), 'blank notes must ride as undefined');
  assert(page.includes('function disarmAll()'), 'cross-disarm missing');
});

// ── the offer chip + the closed date ───────────────────────────────────────
check('page: the offer chip renders the sent terms with KES', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes('data-testid={`hr-recruitment-offer-chip-${a.id}`}'), 'chip testid missing');
  assert(page.includes('offerChipLabel(a.offers?.[0])'), 'chip label call missing');
  assert(page.includes('formatOfferKes(a.offers?.[0]?.proposedSalaryCents)'), 'KES format call missing');
  assert(page.includes("interviewActions(a.offers?.[0]?.status === 'DRAFT')"), 'hinge must key on DRAFT');
});

check('page: CLOSED jobs print when they closed', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes("j.status === 'CLOSED' && j.closedAt"), 'closedAt gate missing');
  assert(page.includes('closed ${j.closedAt.slice(0, 10)}'), 'closed date rendering missing');
});

check('applicants GET: the latest offer of any status rides the envelope', () => {
  const route = read('src/app/api/recruitment/applicants/route.ts');
  assert(route.includes("orderBy: { createdAt: 'desc' },\n          take: 1,"), 'latest-order missing');
  assert(route.includes('select: { id: true, status: true, proposedSalaryCents: true, sentAt: true, createdAt: true }'), 'offer select missing');
});

// ── tests + prior anchors ──────────────────────────────────────────────────
check('tests: the v2.126.0 suite exists and pins the contract', () => {
  const t = read('src/tests/recruitment-v2126.test.ts');
  for (const s of [
    'the pipeline shows its steps',
    'the one list',
    'the duplicate-draft guard',
    'the stage arm',
    'the hard-coded jump is EXORCISED',
    'the offer chip',
  ]) {
    assert(t.includes(s), `pin missing: ${s}`);
  }
});

check('tests: the unread counter re-anchored for the 2.126.0-fed feed', () => {
  const t = read('src/tests/console-changelog.test.ts');
  assert(t.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(15)"), '2.110.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.109.0')).toBe(16)"), '2.109.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.108.0')).toBe(17)"), '2.108.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(48)"), '2.77.0 anchor missing');
});

check('prior anchors: the v2.125.0 doors and the consent spine stay', () => {
  const page = read('src/app/(shell)/hr/recruitment/page.tsx');
  assert(page.includes('data-testid={`hr-recruitment-reject-arm-${a.id}`}'), 'reject arm missing');
  assert(page.includes('data-testid={`hr-recruitment-close-arm-${j.id}`}'), 'close arm missing');
  assert(page.includes('data-testid="hr-recruitment-readonly"'), 'read strip missing');
  assert(!page.includes('3_000_000'), 'fabricated salary must stay exorcised');
  assert(!page.includes('86400000'), 'fabricated date must stay exorcised');
  const service = read('src/lib/hr/recruitment-service.ts');
  assert(service.includes('Applicant consent is required before registering personal data (MISSING_CONSENT).'), 'consent requirement missing');
});

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
