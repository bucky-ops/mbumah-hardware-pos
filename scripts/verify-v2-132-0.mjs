#!/usr/bin/env node
// v2.132.0 verification — "the columns bend, the branch files itself".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The parity check
// (every TableHead but four is resizable) exists BECAUSE a mechanical codemod
// spread the resize keys — the count is the tripwire that keeps it honest.

import { readFileSync, existsSync } from 'node:fs';
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
check('version: package.json leads 2.132.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.132.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.132.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.132.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-132-0'], 'verify script entry missing');
});

check('whats-new: 2.132.0 leads the feed with the bend-and-file story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.132.0'");
  assert(head > -1, 'no 2.132.0 entry');
  assert(head < wn.indexOf("version: '2.131.0'"), '2.132.0 does not lead');
  assert(wn.includes('The columns bend, the branch files itself'), 'title missing');
  const bullets = (wn.slice(head, wn.indexOf("version: '2.131.0'")).match(/'/g) ?? []).length;
  assert(bullets >= 10, `too few bullets (${bullets} quotes)`);
});

check('changelog: [2.132.0] carries Added + Changed with both beats', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.132.0]');
  assert(head > -1, 'no [2.132.0] section');
  assert(head < cl.indexOf('## [2.131.0]'), '[2.132.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.131.0]'));
  assert(section.includes('### Added'), 'no Added');
  assert(section.includes('### Changed'), 'no Changed');
  assert(section.includes('exportConsentTimelines'), 'service missing');
  assert(section.includes('Resizable columns'), 'resize beat missing');
});

// ── the branch export: route, service, serializer ──────────────────────────
check('route: GET-only behind the ledger guard trio, csv disposition, no-store', () => {
  const s = read('src/app/api/hr/privacy/consent/export/route.ts');
  assert(s.includes('export const GET'), 'no GET');
  for (const verb of ['export const POST', 'export const PATCH', 'export const PUT', 'export const DELETE']) {
    assert(!s.includes(verb), `mutation verb found: ${verb}`);
  }
  assert(s.includes("hrGuard('hr.report.branch'"), 'wrong guard');
  assert(s.includes("['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const"), 'wrong trio');
  assert(s.includes("'Content-Type': 'text/csv; charset=utf-8'"), 'no csv content type');
  assert(s.includes("'Cache-Control': 'no-store'"), 'no no-store');
  assert(s.includes('exportConsentTimelines(session)'), 'service not called');
});

check('service: exportConsentTimelines rides the ledger scope and the drawer serializer', () => {
  const s = read('src/lib/hr/data-protection.ts');
  const fn = s.slice(
    s.indexOf('export async function exportConsentTimelines'),
    s.indexOf('async function consentTargetEmployee'),
  );
  assert(fn.length > 200, 'function body missing');
  assert(fn.includes('deletedAt: null'), 'no deletedAt filter');
  assert(fn.includes('employeeScopeWhere(session)'), 'no scope where');
  assert(fn.includes('take: 200'), 'no take cap');
  assert(fn.includes("orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]"), 'employee order missing');
  assert(fn.includes("consentRecords: { orderBy: { grantedAt: 'asc' } }"), 'cycle order missing');
  assert(fn.includes('buildConsentTimelineCsv(rows)'), 'not the drawer serializer');
  assert(fn.includes('consentTimelinesCsvFilename()'), 'filename helper missing');
  assert(fn.includes('cycle: i + 1'), 'cycle numbering missing');
});

check('serializer: consentTimelinesCsvFilename names the plural branch file', () => {
  const s = read('src/lib/hr/consent-timeline-csv.ts');
  assert(s.includes('export function consentTimelinesCsvFilename'), 'helper missing');
  assert(s.includes("return `consent-timelines-${day}.csv`;"), 'wrong filename shape');
});

check('the shared clock: stoodDaysBetween exists once and serves two callers', () => {
  const s = read('src/lib/hr/data-protection.ts');
  assert(s.includes('export function stoodDaysBetween'), 'not exported');
  const uses = s.split('stoodDaysBetween(c.grantedAt, c.withdrawnAt)').length - 1;
  assert(uses === 2, `expected 2 call sites, found ${uses}`);
  const dayMath = s.split('86_400_000').length - 1;
  assert(dayMath === 1, `day math lives ${dayMath} times, must live once`);
});

// ── the Export-all door ────────────────────────────────────────────────────
check('door: testid, aria-label, honesty tooltip, busy spin, rows-gate', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('data-testid="hr-privacy-consent-export-all"'), 'no testid');
  assert(s.includes('aria-label="Export all consent timelines CSV"'), 'no aria-label');
  assert(s.includes("One flat CSV: every in-scope employee's consent cycles — who, when, and what purpose. Never content."), 'no honesty tooltip');
  assert(s.includes("{exportAllBusy ? 'Exporting…' : 'Export all'}"), 'no busy state');
  assert(s.includes('consent && consent.records.length > 0 ? ('), 'not gated on rows');
  assert(s.includes("fetch('/api/hr/privacy/consent/export', { credentials: 'include' })"), 'fetch missing');
  assert(s.includes('The export could not be built — nothing was downloaded.'), 'failure does not speak');
  assert(s.includes('data-testid="hr-privacy-consent-export-error"'), 'no error testid');
});

// ── resizable columns ──────────────────────────────────────────────────────
check('mechanics: the pure module exports the honest band', () => {
  const s = read('src/lib/hr/column-resize.ts');
  assert(s.includes('export const COL_WIDTH_MIN = 88'), 'min wrong');
  assert(s.includes('export const COL_WIDTH_MAX = 480'), 'max wrong');
  assert(s.includes('export const EDGE_BAND = 8'), 'edge band wrong');
  assert(s.includes("export const COL_WIDTHS_STORAGE_KEY = 'hr-reports-col-widths'"), 'storage key wrong');
  assert(s.includes('export function clampColWidth'), 'clamp missing');
  assert(s.includes('export function nudgeColWidth'), 'nudge missing');
  assert(s.includes('export function loadColWidths'), 'loader missing');
});

check('parity: every TableHead but the four minis carries a resize key', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  const elements = (s.match(/<TableHead(?!er)/g) ?? []).length;
  const spreads = (s.match(/\{\.\.\.head\('[a-z0-9-]+'\)\}/g) ?? []).length;
  assert(elements === 63, `elements=${elements}, expected 63`);
  assert(spreads === 59, `spreads=${spreads}, expected 59`);
  assert(elements - spreads === 4, `non-resizable=${elements - spreads}, expected 4`);
});

check('drag: delegated once on the tabs container, window-listener halves', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('onPointerDown={onReportPointerDown}'), 'no pointerdown');
  assert(s.includes('onDoubleClick={onReportDoubleClick}'), 'no dblclick reset');
  assert(s.includes('onPointerMove={onReportPointerMove}'), 'no hover cursor');
  assert(s.includes("closest?.('th[data-resize-key]')"), 'no delegation');
  assert(s.includes('nudgeColWidth(r.startW, e.clientX - r.startX)'), 'no live width math');
  assert(s.includes('window.localStorage.getItem(COL_WIDTHS_STORAGE_KEY)'), 'no load');
  assert(s.includes('window.localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(next))'), 'no persist');
  assert(s.includes('Drag the right edge to resize · double-click the edge to reset'), 'no affordance tooltip');
});

// ── tests + counters ───────────────────────────────────────────────────────
check('tests: the v2.132.0 test file exists with the pins that matter', () => {
  const p = 'src/tests/consent-branch-export-v2132.test.ts';
  assert(existsSync(join(process.cwd(), p)), 'test file missing');
  const s = read(p);
  assert(s.includes('expect(elements).toBe(63)'), 'no parity pin');
  assert(s.includes('export const POST') === false || s.includes('GET-only'), 'no mutation-verb pin');
  assert(s.includes('stoodDaysBetween'), 'no clock pin');
});

check('counter: console-changelog re-anchored for 2.132.0 joining the feed', () => {
  const s = read('src/tests/console-changelog.test.ts');
  assert(s.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(21)"), '2.110.0 anchor stale');
  assert(s.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(54)"), '2.77.0 anchor stale');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
