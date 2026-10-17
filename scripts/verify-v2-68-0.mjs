#!/usr/bin/env node
// verify-v2-68-0.mjs — release gate for "the morning note rings the bell".
//
// Contracts locked:
//   1. Pure module (src/lib/hr/desk-digest-note.ts): marker, org-role
//      audience, EAT date key, honest copy, quiet-day null, metadata,
//      dedupe needle.
//   2. GET /api/org/review-activity ensures the bell note after deriving
//      the digest — swallow-safe, deduped per summarized EAT day, fanned
//      out to active ORG_ROLES users, rows storeId NULL, rawDb.
//   3. /api/notifications section 9 owns the marker; desk_digest maps to a
//      quiet info row deep-linking /org/dashboard.
//   4. The bell wears the dawn voice: orange sunrise icon, orange rail,
//      "Morning note" chip; both type unions declare desk_digest.
//   5. What's-New 2.68.0 leads; version slots bumped; prior anchors intact.

import { readFileSync } from 'node:fs';

const read = (p) => {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
// v2.69.0 precedent: prior-release version pins are looser every round —
// this script must keep passing on this and later versions.
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.68.0', atLeast(PKG.version, '2.68.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.68.0', atLeast(PKG.mbumah?.releaseVersion, '2.68.0'));
check('mbumah.baseVersion is >= 2.68.0', atLeast(PKG.mbumah?.baseVersion, '2.68.0'));
check('verify:v2-68-0 script registered', PKG.scripts?.['verify:v2-68-0'] === 'node scripts/verify-v2-68-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.68.0 entry first', WN.includes("version: '2.68.0'") && WN.indexOf("version: '2.68.0'") < WN.indexOf("version: '2.67.0'"));
check('whats-new leads with the bell story', WN.includes('The morning note rings the bell'));
check('whats-new feed has grown to 68+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 68);

console.log('== The pure module ==');
const NOTE = read('src/lib/hr/desk-digest-note.ts') ?? '';
check('marker constant is desk_digest', NOTE.includes("export const DESK_DIGEST_METADATA_MARKER = 'desk_digest';"));
check('audience = the review-activity gate roles', NOTE.includes("export const DESK_DIGEST_ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;"));
check('deep link is the org dashboard panel', NOTE.includes("export const DESK_DIGEST_ACTION_URL = '/org/dashboard';"));
check('EAT offset is the desk calendar (+3h)', NOTE.includes('const EAT_OFFSET_MS = 3 * 3_600_000;'));
check('date key renders the EAT wall date of the window', /export function deskDigestDateKey\(windowStart: Date\): string \{\s*return new Date\(windowStart\.getTime\(\) \+ EAT_OFFSET_MS\)\.toISOString\(\)\.slice\(0, 10\);\s*\}/.test(NOTE));
check('copy is null on a quiet day (honest silence)', NOTE.includes('if (figures.visits === 0) return null;'));
check('copy mirrors the strip figures with singular/plural honesty', NOTE.includes('deskDigestPlural(figures.visits') && NOTE.includes("'visit', 'visits'") && NOTE.includes("'correction answered', 'corrections answered'"));
check('metadata carries kind + dedupe date + figures', /kind: DESK_DIGEST_METADATA_MARKER,/.test(NOTE) && /deskDigestDate: dateKey,/.test(NOTE) && /visits: figures\.visits,/.test(NOTE));
check('busiest-branch name shortened like the strip chip', NOTE.includes('export function deskDigestShortStoreName') && NOTE.includes("name.replace(/^MBUMAH HARDWARE\\s*-\\s*/i, '') || name") && NOTE.includes('deskDigestShortStoreName(figures.busiestBranch.storeName)'));
check('dedupe needle built in one place', /export function deskDigestDedupeNeedle\(dateKey: string\): string \{\s*return `"deskDigestDate":"\$\{dateKey\}"`;\s*\}/.test(NOTE));

console.log('== The trigger: /api/org/review-activity ==');
const RA = read('src/app/api/org/review-activity/route.ts') ?? '';
check('route imports the note writer pieces', RA.includes("} from '@/lib/hr/desk-digest-note';"));
check('writer called after the digest, before the payload', RA.indexOf('await ensureDeskDigestNote({') > RA.indexOf('const digestTopReviewer') && RA.indexOf('await ensureDeskDigestNote({') < RA.indexOf('return Response.json({'));
check('writer feeds the payload figures', RA.includes('label: yesterdayLabel,') && RA.includes('visits: digestVisits,') && RA.includes('reviewers: reviewerDigest.size,'));
check('swallow-safe: best-effort try/catch', /try \{\s*await ensureDeskDigestNote/.test(RA) && RA.includes('/* the bell note is best-effort by contract */'));
check('dedupe: findFirst on the needle, early return', RA.includes('metadata: { contains: deskDigestDedupeNeedle(dateKey) }') && RA.includes('if (existing) return;'));
check('recipients: active ORG_ROLES users via rawDb', /rawDb\.user\.findMany\(\{\s*where: \{ isActive: true, role: \{ in: \[\.\.\.DESK_DIGEST_ORG_ROLES\] \} \}/.test(RA));
check('rows: storeId NULL, SYSTEM/HR/NORMAL, deep link + label', RA.includes('storeId: null,') && RA.includes("type: 'SYSTEM',") && RA.includes("category: 'HR',") && RA.includes("priority: 'NORMAL',") && RA.includes('actionUrl: DESK_DIGEST_ACTION_URL,') && RA.includes("actionLabel: 'Open desk activity',"));
check('the v2.67.0 strip contract untouched (org-wide comment)', /Deliberately NOT narrowed by visitWhere/.test(RA));
check('org gate unchanged', RA.includes("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];"));

console.log('== The feed: /api/notifications ==');
const NR = read('src/app/api/notifications/route.ts') ?? '';
check('marker imported from the pure module', NR.includes("import { DESK_DIGEST_METADATA_MARKER } from '@/lib/hr/desk-digest-note';"));
check('section-9 OR list sweeps the marker', NR.includes('{ metadata: { contains: DESK_DIGEST_METADATA_MARKER } },'));
check('desk_digest kind maps to its own row', NR.includes("} else if (kind === 'desk_digest') {"));
check('row is quiet info with the dashboard deep link', /severity: 'info',\s*timestamp: n\.createdAt\.toISOString\(\),\s*isRead: false,\s*targetTab: '',\s*category: 'HR',\s*actionUrl: n\.actionUrl \?\? '\/org\/dashboard',/.test(NR));
check('section-8 NOT filter excludes the marker (no double render)', (() => {
  const notStart = NR.indexOf('NOT: {');
  const notEnd = NR.indexOf('orderBy', notStart);
  return notStart > -1 && notEnd > notStart && NR.slice(notStart, notEnd).includes('DESK_DIGEST_METADATA_MARKER');
})());
check('NotificationData union declares desk_digest', NR.includes("'payroll_paid' | 'desk_digest';"));

console.log('== The bell: notification-center + types ==');
const NC = read('src/components/notification-center.tsx') ?? '';
check('Sunrise imported', /Sunrise,\s*\n\} from 'lucide-react';/.test(NC));
check('desk_digest icon is the orange sunrise', /case 'desk_digest':\s*\n\s*return <Sunrise className="h-4 w-4 text-orange-600 dark:text-orange-400" \/>;/.test(NC));
check('orange dawn rail', NC.includes("notification.type === 'desk_digest' ? 'border-l-[3px] border-l-orange-400 dark:border-l-orange-500' : ''"));
check('"Morning note" chip in the feed chip language', /Morning note\s*<\/span>/.test(NC) && NC.includes('border-orange-200 bg-orange-50') && NC.includes('dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300'));
check('NotificationItem union declares desk_digest', (read('src/lib/api.ts') ?? '').includes("'payroll_paid' | 'desk_digest';"));
check('parser whitelist grew the kind + date', (read('src/lib/hr/leave-notify.ts') ?? '').includes("rec.kind === 'desk_digest'") && (read('src/lib/hr/leave-notify.ts') ?? '').includes('out.deskDigestDate = rec.deskDigestDate;'));

console.log('== Prior-version anchors (no regression) ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
check('v2.67.0 dawn strip still in the panel', PANELS.includes('data-testid="desk-digest"') && PANELS.includes('Yesterday at the desk'));
check('v2.67.0 quiet-day empty state intact', PANELS.includes('The desk was quiet yesterday — no visits on record.'));
check('v2.65.0 drill-down bar still in the panel', PANELS.includes('data-testid="desk-drilldown-bar"'));
check('v2.65.0 branch chips still in the panel', PANELS.includes('data-testid="desk-branch-chips"') && PANELS.includes('data-testid="desk-branch-chip-all"'));
check('v2.64.0 ledger model still present', (read('prisma/schema.prisma') ?? '').includes('model LeaveReviewVisit'));
check('v2.66.0 changelog modal contract untouched', (read('src/components/org/chrome.tsx') ?? '').includes('data-testid="changelog-modal"'));
check('prior verify scripts still registered', ['verify:v2-67-0', 'verify:v2-66-0', 'verify:v2-65-0', 'verify:v2-64-0', 'verify:v2-63-0'].every((k) => PKG.scripts?.[k] === `node scripts/${k.replace('verify:', 'verify-')}.mjs`));
check('both digest test suites present', (read('src/tests/desk-digest.test.ts') ?? '').includes('the desk writes its own morning note') && (read('src/tests/desk-digest-note.test.ts') ?? '').includes('the morning note rings the bell'));

console.log(`\nv2.68.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) { failures.forEach((f) => console.log(`  FAIL: ${f}`)); process.exit(1); }
