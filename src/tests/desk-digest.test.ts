import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.67.0 contracts — the desk writes its own morning note.
 *
 * Gap: v2.63.0–v2.65.0 turned the review ledger into an org-wide audit
 * panel with drill-downs and branch filters, but the panel only ever
 * answered "what is happening" — never "what happened yesterday". A
 * manager opening the console in the morning had to eyeball timestamps
 * and count by hand, and a quiet day looked identical to an empty read.
 *
 * Covered here:
 *  1. GET /api/org/review-activity grew a `yesterday` digest block derived
 *     from the previous EAT (UTC+3, Nairobi) calendar day of the ledger —
 *     visits, corrections answered (clearedRecheck), distinct reviewers,
 *     distinct requests, busiest branch, most active reviewer, per-branch
 *     breakdown — and the window is a real calendar day [00:00, 24:00) EAT,
 *     not a trailing 24h. The digest query is deliberately NOT narrowed by
 *     the drill-down/branch filters: the note is the org's shared
 *     yesterday, same contract as `stats` and `branches`.
 *  2. The DeskActivity panel renders the note as a dawn-gradient strip
 *     ("Yesterday at the desk", Sunrise icon) between the header and the
 *     stat tiles: the four figures, busiest-branch + top-reviewer chips,
 *     per-branch mini chips on multi-branch days, and an honest quiet-day
 *     empty state — dark-mode complete in both modes.
 *  3. Types: DeskActivityData grew the `yesterday` block with the exact
 *     field set the strip renders.
 *  4. What's-New 2.67.0 leads the feed with the morning-note story.
 *  5. The prior surfaces (drill-down bar, branch chips, timeline rows,
 *     stat tiles) are untouched.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. GET /api/org/review-activity — the morning-note read ─────────────────

describe('GET /api/org/review-activity - the morning-note read', () => {
  const RA = readRepo('src/app/api/org/review-activity/route.ts');

  it('computes yesterday as a real EAT calendar day, not a trailing 24h', () => {
    // Nairobi trades at UTC+3; the window is [yesterdayStart, todayStart)
    // with today's EAT-midnight = UTC midnight of the EAT wall date - 3h.
    expect(RA).toContain('const EAT_OFFSET_MS = 3 * 3_600_000;');
    expect(RA).toMatch(/const eatNow = new Date\(now\.getTime\(\) \+ EAT_OFFSET_MS\);/);
    expect(RA).toMatch(
      /Date\.UTC\(eatNow\.getUTCFullYear\(\), eatNow\.getUTCMonth\(\), eatNow\.getUTCDate\(\)\) - EAT_OFFSET_MS,?/,
    );
    expect(RA).toMatch(/const yesterdayStart = new Date\(todayStart\.getTime\(\) - DAY_MS\);/);
    expect(RA).toMatch(/createdAt: \{ gte: yesterdayStart, lt: todayStart \}/);
  });

  it('derives the day label server-side on the EAT wall clock', () => {
    expect(RA).toMatch(/const eatYesterday = new Date\(yesterdayStart\.getTime\(\) \+ EAT_OFFSET_MS\);/);
    expect(RA).toMatch(/toLocaleDateString\('en-GB', \{\s*weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',\s*\}\)/);
  });

  it('ships the full yesterday block: date, label, figures, chips, breakdown', () => {
    expect(RA).toMatch(/yesterday: \{/);
    expect(RA).toContain('date: yesterdayStart.toISOString(),');
    expect(RA).toContain('label: yesterdayLabel,');
    expect(RA).toContain('visits: digestVisits,');
    expect(RA).toContain('clears: digestClears,');
    expect(RA).toContain('reviewers: reviewerDigest.size,');
    expect(RA).toContain('requests: requestIds.size,');
    expect(RA).toMatch(/busiestBranch: digestBranches\[0]\s*\?\s*\{ storeName: digestBranches\[0]\.storeName, visits: digestBranches\[0]\.visits \}\s*: null,/);
    expect(RA).toMatch(/topReviewer: digestTopReviewer\s*\?\s*\{ name: digestTopReviewer\[0], visits: digestTopReviewer\[1] \}\s*: null,/);
    expect(RA).toContain('branches: digestBranches,');
  });

  it('derives the digest from the window rows in one pass (visits, clears, reviewers, requests, branches)', () => {
    expect(RA).toContain('for (const row of yesterdayRows) {');
    expect(RA).toMatch(/if \(row\.clearedRecheck\) digestClears \+= 1;/);
    expect(RA).toContain('requestIds.add(row.leaveRequestId);');
    expect(RA).toMatch(/reviewerDigest\.set\(row\.visitedByName, \(reviewerDigest\.get\(row\.visitedByName\) \?\? 0\) \+ 1\);/);
    expect(RA).toMatch(/const digestBranches = \[\.\.\.branchDigest\.values\(\)\]\.sort\(/);
    expect(RA).toMatch(/\.sort\(\(a, b\) => b\[1\] - a\[1\] \|\| a\[0\]\.localeCompare\(b\[0\]\)\)\[0\] \?\? null;/);
  });

  it('keeps the note org-wide — the digest query is never narrowed by visitWhere', () => {
    // The morning-note findMany selects its own window, not the filter
    // predicate the timeline uses; the comment says so on the record.
    expect(RA).toMatch(/Deliberately NOT narrowed by visitWhere/);
    const digestQuery = RA.slice(RA.indexOf("rawDb.leaveReviewVisit.findMany({\n        where: { createdAt: { gte: yesterdayStart, lt: todayStart } }"), RA.indexOf('const branchCounts'));
    expect(digestQuery).toContain("where: { createdAt: { gte: yesterdayStart, lt: todayStart } }");
    expect(digestQuery).not.toContain('visitWhere');
  });

  it('keeps the prior read contract intact (org gate, rawDb, runWithoutTenant, drill-down params)', () => {
    expect(RA).toContain("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];");
    expect(RA).toContain('return runWithoutTenant(async () => {');
    expect(RA).toMatch(/rawDb\.leaveReviewVisit\.findMany/);
    expect(RA).toMatch(/const reviewer = url\.searchParams\.get\('reviewer'\)/);
    expect(RA).toMatch(/const branch = url\.searchParams\.get\('branch'\)/);
    // the timeline query still uses the filter predicate
    expect(RA).toMatch(/where: visitWhere,/);
  });
});

// ── 2. Types — DeskActivityData grew the yesterday block ────────────────────

describe('DeskActivityData - the yesterday block', () => {
  const PRIM = readRepo('src/components/org/primitives.tsx');

  it('declares the exact field set the strip renders', () => {
    expect(PRIM).toMatch(/export interface DeskActivityData \{[\s\S]*?yesterday: \{[\s\S]*?date: string;[\s\S]*?label: string;[\s\S]*?visits: number;[\s\S]*?clears: number;[\s\S]*?reviewers: number;[\s\S]*?requests: number;[\s\S]*?busiestBranch: \{ storeName: string; visits: number \} \| null;[\s\S]*?topReviewer: \{ name: string; visits: number \} \| null;[\s\S]*?branches: Array<\{ storeId: string; storeName: string; visits: number \}>;[\s\S]*?\};/);
  });

  it('documents the org-wide contract on the type', () => {
    expect(PRIM).toMatch(/v2\.67\.0: the desk's morning note[\s\S]*?never\s|\nnarrow|Org-wide by contract/s);
    expect(PRIM).toContain('the note never re-keys under the panel\'s filters');
  });
});

// ── 3. The DeskActivity panel — the dawn strip ───────────────────────────────

describe('DeskActivity panel - the dawn strip', () => {
  const PANELS = readRepo('src/components/org/panels.tsx');
  const digest = () => PANELS.slice(PANELS.indexOf('data-testid="desk-digest"'), PANELS.indexOf('Stat tiles — org-wide figures'));

  it('renders the morning note between the header and the stat tiles', () => {
    const head = PANELS.indexOf('Every desk visit on record, newest first');
    const tiles = PANELS.indexOf('Stat tiles — org-wide figures');
    const strip = PANELS.indexOf('data-testid="desk-digest"');
    expect(strip).toBeGreaterThan(head);
    expect(strip).toBeLessThan(tiles);
  });

  it('carries the dawn styling: gradient card, Sunrise heading, both colour modes', () => {
    const d = digest();
    expect(d).toContain('bg-gradient-to-r from-amber-50/90 via-white to-emerald-50/70');
    expect(d).toContain('dark:from-amber-500/10 dark:via-slate-900 dark:to-emerald-500/10');
    expect(d).toMatch(/<Sunrise className="h-3\.5 w-3\.5 text-amber-500"/);
    expect(d).toContain('Yesterday at the desk');
    expect(d).toContain('role="status"');
    expect(d).toContain('aria-label="Yesterday at the desk"');
  });

  it('exposes every figure under an honest testid', () => {
    const d = digest();
    for (const id of [
      'desk-digest',
      'desk-digest-heading',
      'desk-digest-label',
      'desk-digest-visits',
      'desk-digest-clears',
      'desk-digest-reviewers',
      'desk-digest-requests',
      'desk-digest-busiest',
      'desk-digest-top-reviewer',
      'desk-digest-branches',
    ]) {
      expect(d).toContain(`data-testid="${id}"`);
    }
    expect(d).toMatch(/desk-digest-label[\s\S]*?\{yesterday\.label\}/);
  });

  it('labels the figures with singular/plural honesty', () => {
    const d = digest();
    expect(d).toContain("{num(yesterday.visits)}");
    expect(d).toContain('visit{yesterday.visits === 1 ? \'\' : \'s\'}');
    expect(d).toContain('correction{yesterday.clears === 1 ? \'\' : \'s\'} answered');
    expect(d).toContain('reviewer{yesterday.reviewers === 1 ? \'\' : \'s\'} on the desk');
    expect(d).toContain('request{yesterday.requests === 1 ? \'\' : \'s\'} touched');
  });

  it('wears the busiest branch in emerald and the top reviewer in their own hue', () => {
    const d = digest();
    expect(d).toMatch(/data-testid="desk-digest-busiest"[\s\S]*?busiest · \{shortStoreName\(yesterday\.busiestBranch\.storeName\)\}/);
    expect(d).toMatch(/data-testid="desk-digest-top-reviewer"[\s\S]*?top reviewer · \{yesterday\.topReviewer\.name\}/);
    expect(d).toMatch(/className=\{`inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0\.5 text-\[10px\] font-medium \$\{avatarHue\(yesterday\.topReviewer\.name\)\}`\}/);
  });

  it('caps per-branch mini chips at three on multi-branch days', () => {
    const d = digest();
    expect(d).toMatch(/yesterday\.branches\.length > 1 \? \(/);
    expect(d).toMatch(/yesterday\.branches\.slice\(0, 3\)\.map\(\(b\) => \(/);
  });

  it('says the quiet part out loud — an honest empty state, never fake zeros', () => {
    const d = digest();
    expect(d).toContain('data-testid="desk-digest-empty"');
    expect(d).toContain('The desk was quiet yesterday — no visits on record.');
    expect(d).toMatch(/<Coffee className="h-3\.5 w-3\.5 text-amber-500"/);
    // the empty branch renders only when the window is empty
    expect(d).toMatch(/yesterday\.visits > 0 \? \(/);
  });

  it('is dark-mode complete (card, figures, chips, empty state)', () => {
    const d = digest();
    expect(d).toMatch(/text-slate-800 dark:text-slate-100/);
    expect(d).toMatch(/text-emerald-600 dark:text-emerald-400/);
    expect(d).toMatch(/text-slate-400 dark:text-slate-500/);
    expect(d).toMatch(/dark:border-amber-500\/20 dark:bg-amber-500\/5/);
    expect(d).toMatch(/dark:border-slate-700 dark:bg-slate-800\/60 dark:text-slate-400/);
    expect(d).toMatch(/dark:border-emerald-500\/30 dark:bg-emerald-500\/10 dark:text-emerald-300/);
  });
});

// ── 4. What's-New 2.67.0 — the story leads the feed ─────────────────────────

describe('What\'s-New 2.67.0 - the morning-note story', () => {
  const WN = readRepo('src/lib/whats-new.ts');

  it('leads WHATS_NEW with the 2.67.0 entry', () => {
    expect(WN.indexOf("version: '2.67.0'")).toBeGreaterThan(WN.indexOf('WHATS_NEW: WhatsNewEntry[] = ['));
    expect(WN.indexOf("version: '2.67.0'")).toBeLessThan(WN.indexOf("version: '2.66.0'"));
  });

  it('tells the morning-note story in shop-floor language', () => {
    const entry = WN.slice(WN.indexOf("version: '2.67.0'"), WN.indexOf("version: '2.66.0'"));
    expect(entry).toContain('The desk writes its own morning note');
    expect(entry).toContain('Nairobi calendar (EAT)');
    expect(entry).toContain('busiest branch and the most active reviewer wear chips');
    expect(entry).toContain('org-wide on purpose');
    expect(entry).toContain('The desk was quiet yesterday');
    const bullets = (entry.match(/'/g) ?? []).length;
    expect(bullets).toBeGreaterThanOrEqual(10); // 5 bullets, quoted strings
  });
});

// ── 5. Release metadata + prior surfaces untouched ──────────────────────────

describe('Release metadata - v2.67.0', () => {
  it('bumps package.json version + mbumah metadata and registers the verify script', () => {
    const PKG = JSON.parse(readRepo('package.json')) as {
      version: string;
      mbumah: { releaseVersion: string; baseVersion: string };
      scripts: Record<string, string>;
    };
    expect(PKG.version).toBe('2.67.0');
    expect(PKG.mbumah.releaseVersion).toBe('2.67.0');
    expect(PKG.mbumah.baseVersion).toBe('2.67.0');
    expect(PKG.scripts['verify:v2-67-0']).toBe('node scripts/verify-v2-67-0.mjs');
  });

  it('keeps the prior desk surfaces intact (drill-down, chips, rows, tiles)', () => {
    const PANELS = readRepo('src/components/org/panels.tsx');
    for (const id of [
      'desk-drilldown-bar',
      'desk-drilldown-stats',
      'desk-drilldown-clear',
      'desk-branch-chips',
      'desk-branch-chip-all',
      'desk-visit-row',
      'desk-empty-state',
    ]) {
      expect(PANELS).toContain(`data-testid="${id}"`);
    }
  });
});
