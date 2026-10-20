import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.64.0 contracts — the ledger steps into the light.
 *
 * Gap: the v2.63.0 LeaveReviewVisit ledger was recorded but only visible in
 * ONE place (the request dialog's timeline, after opening it). The desk
 * could not tell a once-glanced request from a thrice-reviewed one WITHOUT
 * opening it, and the organization had no audit view of desk activity at
 * all — the ledger answered "who looked at THIS request" but never "who is
 * looking at ANY request".
 *
 * Covered here:
 *  1. GET /api/leaves: each row carries the ledger TOTAL (visitCount) via
 *     ONE best-effort groupBy over the page's request ids — no N+1, no
 *     extra client round-trip, and a ledger misfire must never fail the
 *     list.
 *  2. Desk rows (payroll-tab.tsx): the slate visit chip (History icon +
 *     honest singular/plural count) with a tooltip naming the last
 *     reviewer, a count-less "visited" chip for legacy rows reviewed
 *     before the ledger, nothing for never-visited rows, and the stamp
 *     response keeping the chip in pace live.
 *  3. GET /api/org/review-activity: the ORG_ROLES gate (same as
 *     kpi-summary), rawDb + runWithoutTenant per the v2.58.0 contract,
 *     stats (total / week / clears / distinct reviewers) and the
 *     newest-first 12-row recent timeline joined to store + employee +
 *     leave type + status.
 *  4. Org console: the DeskActivity panel (stat tiles, emerald
 *     "cleared a re-check" chips, status chips, empty state) composed into
 *     /console with its own rail entry + fetch + 401/403 degrade.
 *  5. What's-New 2.64.0: the release leads with the ledger-in-light story.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. GET /api/leaves — the row-level visit count ──────────────────────────

describe('GET /api/leaves - the ledger total rides each row', () => {
  const ROUTE = readRepo('src/app/api/leaves/route.ts');

  it('counts visits with ONE groupBy over the page\u2019s request ids (no N+1)', () => {
    expect(ROUTE).toContain('db.leaveReviewVisit.groupBy');
    expect(ROUTE).toContain("by: ['leaveRequestId']");
    expect(ROUTE).toContain('_count: { _all: true }');
  });

  it('scopes the groupBy to the fetched requests only', () => {
    expect(ROUTE).toMatch(/leaveRequestId:\s*\{\s*in:\s*requests\.map\(\(r\) => r\.id\)/);
  });

  it('the count read is best-effort under its own guard', () => {
    expect(ROUTE).toContain('// Visit-count read is best-effort by design.');
  });

  it('an empty page skips the ledger read entirely', () => {
    expect(ROUTE).toMatch(/if \(requests\.length > 0\)/);
  });

  it('every row carries visitCount defaulting to 0 when the ledger is silent', () => {
    expect(ROUTE).toContain('visitCount: visitCounts[r.id] ?? 0');
  });
});

// ── 2. Desk rows — the at-a-glance visit chip ───────────────────────────────

describe('Desk rows - the visit chip on every reviewed row', () => {
  const PT = readRepo('src/app/(shell)/tabs/payroll-tab.tsx');

  it('the LeaveRequest row type grew visitCount', () => {
    expect(PT).toMatch(/visitCount\?: number;/);
  });

  it('the counted chip renders only for rows the ledger knows about', () => {
    expect(PT).toContain('{l.deskReviewedAt && (l.visitCount ?? 0) > 0 ? (');
    expect(PT).toContain('data-testid="desk-visit-chip"');
  });

  it('the chip wears the History icon and an honest singular/plural count', () => {
    expect(PT).toContain("<History className=\"h-2.5 w-2.5\" aria-hidden /> {l.visitCount} {l.visitCount === 1 ? 'visit' : 'visits'}");
  });

  it('the tooltip names the last reviewer and points at the dialog for the trail', () => {
    expect(PT).toMatch(/desk \{l\.visitCount === 1 \? 'visit' : 'visits'\} on record/);
    expect(PT).toContain("\u2014 last by ${l.deskReviewedByName}");
    expect(PT).toContain('The full trail (who looked, when, who cleared a re-check) lives in the request dialog.');
  });

  it('legacy rows (reviewed before the ledger) show a count-less visited chip', () => {
    expect(PT).toContain('data-testid="desk-visit-chip-legacy"');
    expect(PT).toMatch(/Reviewed\{l\.deskReviewedByName \? ` by \$\{l\.deskReviewedByName\}` : ''\} \u2014 before the visit ledger kept history/);
    expect(PT).toContain('Visits are counted from v2.63.0 onward; opening the request again files the first counted visit.');
  });

  it('never-visited rows render no chip at all', () => {
    // The ternary chain ends in : null for rows without a desk stamp.
    expect(PT).toMatch(/desk-visit-chip-legacy[\s\S]{0,1800}?\) : null\}/);
  });

  it('the chip is informational slate — the amber re-check chip stays the only alarm', () => {
    expect(PT).toContain('border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium text-slate-600');
    expect(PT).toContain('dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300');
  });

  it('the stamp response keeps the chip in pace (fresh total lands on the row)', () => {
    expect(PT).toContain('visitCount: typeof data.visitCount === \'number\' ? data.visitCount : l.visitCount');
  });
});

// ── 3. GET /api/org/review-activity — the org-wide ledger read ──────────────

describe('GET /api/org/review-activity - the org audit read', () => {
  const RA = readRepo('src/app/api/org/review-activity/route.ts');

  it('is gated to the exact ORG_ROLES set kpi-summary uses', () => {
    expect(RA).toContain("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];");
    expect(RA).toMatch(/requireAuth\([\s\S]{0,80}\{\s*roles: ORG_ROLES \},?\s*\)/);
  });

  it('reads through rawDb inside runWithoutTenant (the v2.58.0 leak-class contract)', () => {
    expect(RA).toContain('return runWithoutTenant(async () => {');
    expect(RA).toContain('rawDb.leaveReviewVisit.');
  });

  it('the recent timeline is newest-first and capped at 12', () => {
    expect(RA).toContain('const RECENT_LIMIT = 12;');
    expect(RA).toMatch(/orderBy:\s*\{\s*createdAt: 'desc'\s*\}/);
    expect(RA).toMatch(/take: RECENT_LIMIT/);
  });

  it('each recent row joins store, employee, leave type and status', () => {
    expect(RA).toContain('store: { select: { name: true } }');
    expect(RA).toContain('leaveType: { select: { name: true } }');
    expect(RA).toMatch(/employee:\s*\{\s*select:\s*\{\s*firstName: true,\s*lastName: true\s*\}\s*\}/);
    expect(RA).toMatch(/status: true/);
  });

  it('the stat block computes total, week visits, week clears and distinct reviewers', () => {
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.count\(\)/);
    expect(RA).toMatch(/count\(\{\s*where:\s*\{\s*createdAt:\s*\{\s*gte: weekAgo \}\s*\}\s*\}\)/);
    expect(RA).toMatch(/count\(\{\s*where:\s*\{\s*createdAt:\s*\{\s*gte: weekAgo \},\s*clearedRecheck: true\s*\}\s*\}\)/);
    expect(RA).toContain("distinct: ['visitedByName']");
    // v2.189.0 — the local rides `weekReviewerNames` (the WEEK roster now
    // owns the plural reading under `stats.weekReviewerRows`; the count
    // keeps its meaning under its own name).
    expect(RA).toContain('weekReviewers: weekReviewerNames.length');
  });

  it('the payload shape is { generatedAt, stats, recent } with ISO visit times', () => {
    expect(RA).toContain('generatedAt: now.toISOString()');
    expect(RA).toMatch(/visitedAt: v\.createdAt\.toISOString\(\)/);
    expect(RA).toContain('clearedRecheck: v.clearedRecheck');
    expect(RA).toContain('employeeName: `${v.leaveRequest.employee.firstName} ${v.leaveRequest.employee.lastName}`');
  });
});

// ── 4. Org console — the DeskActivity panel + composition ───────────────────

describe('Org console - the DeskActivity audit panel', () => {
  const PANELS = readRepo('src/components/org/panels.tsx');
  const PAGE = readRepo('src/app/(shell)/console/page.tsx');
  const PRIM = readRepo('src/components/org/primitives.tsx');

  it('primitives declare the DeskActivityData payload type', () => {
    expect(PRIM).toContain('export interface DeskActivityData');
    // v2.189.0 — stats grew the optional `weekReviewerRows` roster (the
    // `weekReviewers` NUMBER predates it and keeps its meaning); the
    // four original fields keep their exact contiguity.
    expect(PRIM).toMatch(/stats:\s*\{\s*total: number;\s*weekVisits: number;\s*weekClears: number;\s*weekReviewers: number/);
    expect(PRIM).toContain('weekReviewerRows?: Array<{ name: string; visits: number; clears: number }>;');
  });

  it('the panel renders the ledger heading with the live pill', () => {
    expect(PANELS).toContain('export function DeskActivity(');
    expect(PANELS).toContain('Desk activity — leave review ledger');
    expect(PANELS).toContain('anim-live');
  });

  it('the four stat tiles answer the week\u2019s management questions', () => {
    expect(PANELS).toContain("['Visits · 7 days', stats.weekVisits]");
    expect(PANELS).toContain("['Cleared re-checks', stats.weekClears]");
    expect(PANELS).toContain("['Reviewers active', stats.weekReviewers]");
    expect(PANELS).toContain("['On record', stats.total]");
  });

  it('clearing visits wear the emerald cleared-a-re-check chip with the reviewer avatar', () => {
    expect(PANELS).toContain('<BadgeCheck className="h-2.5 w-2.5" aria-hidden /> cleared a re-check');
    expect(PANELS).toContain('v.visitedByName.trim().charAt(0).toUpperCase()');
  });

  it('each row names the reviewer, the employee and the request type', () => {
    expect(PANELS).toMatch(/\{' '\}opened \{v\.employeeName\}&apos;s \{v\.leaveTypeName\} request/);
  });

  it('the status chip is kind-coded per decision state', () => {
    expect(PANELS).toContain('DESK_STATUS_CHIP');
    expect(PANELS).toMatch(/PENDING: '[^']*text-amber-700/);
    expect(PANELS).toMatch(/APPROVED: '[^']*text-emerald-700/);
    expect(PANELS).toMatch(/REJECTED: '[^']*text-rose-700/);
    expect(PANELS).toMatch(/CANCELLED: '[^']*text-slate-500/);
  });

  it('an empty ledger degrades to an explicit empty state', () => {
    expect(PANELS).toContain('No desk visits recorded yet — the ledger fills as approvers open leave requests.');
  });

  it('the console page fetches the new endpoint in the same 30s poll', () => {
    expect(PAGE).toContain('/api/org/review-activity');
    expect(PAGE).toMatch(/const \[summaryRes, kpiRes, deskRes\] = await Promise\.all/);
  });

  it('the panel composes under its own rail entry + section id', () => {
    expect(PAGE).toContain("{ id: 'desk-activity', label: 'Desk activity', icon: History }");
    expect(PAGE).toContain('<div id="desk-activity">');
    expect(PAGE).toMatch(/<SectionErrorBoundary sectionName="Desk activity">/);
  });

  it('401/403 degrade with role-explicit copy (ACCOUNTANT excluded per kpi-summary precedent)', () => {
    expect(PAGE).toContain("'Sign in to load desk activity.'");
    expect(PAGE).toContain("'Desk activity is limited to org roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER).'");
  });
});

// ── 5. What's-New ────────────────────────────────────────────────────────────

describe("What's-New 2.64.0 - the ledger steps into the light", () => {
  const WN = readRepo('src/lib/whats-new.ts');

  it('leads with the 2.64.0 entry and the ledger-in-light story', () => {
    expect(WN.indexOf("version: '2.64.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.64.0'")).toBeLessThan(WN.indexOf("version: '2.63.0'"));
    expect(WN).toContain('The ledger steps into the light');
  });

  it('covers the desk chip, the legacy honesty and the org audit panel', () => {
    expect(WN).toContain('slate visit chip');
    expect(WN).toContain('count-less "visited" chip');
    expect(WN).toContain('"Desk activity" audit panel');
  });
});
