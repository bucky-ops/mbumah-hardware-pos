import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRunDeepLinkHref } from '../lib/workspace/links';

/**
 * v2.191.0 — the drill-down opens the run.
 *
 * The org dashboard's HR drill-down has worn the "Latest payroll" cell as
 * PLAIN TEXT since v2.23.0, while the SHARED "People & payroll by branch"
 * panel's LatestRunCell has been a real DOOR since v2.113.0 — one click
 * opens /hr/payroll with ?run=<id> and the run-detail dialog. Both
 * surfaces read the SAME /api/org/summary hrPerStore block, whose
 * latestPayroll has carried `runId` since v2.113.0; the drill-down's
 * local type simply never spoke it. This release the drill-down's cell
 * mirrors the shared panel's affordance: runId present → the door (the
 * anchor wraps the period name + the status badge + the external-link
 * glyph, the spoken label names run and branch, the title carries the
 * recorded timestamp, the hover wears the orange door vocabulary with the
 * house focus ring); runId ABSENT (an older cached answer) → the honest
 * plain text — never a dead link, never a guessed href.
 *
 * The door is EXECUTED through the link builder (the ONE writer of the
 * deep-link shape), the degradation is pinned as source text, the CSV is
 * pinned NOT to carry runId (doors don't belong in files — the file keeps
 * its v2.152.0 shape), the status-badge families carry their
 * contrast-math numbers, and the release surfaces speak 2.194.0.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const comp = readRepo('src/components/workspace/org-console.tsx');
const csvLib = readRepo('src/lib/org/branches-csv.ts');
const linksLib = readRepo('src/lib/workspace/links.ts');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const doc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const pkg = JSON.parse(readRepo('package.json'));

describe('the door executed - the link builder stays the ONE writer', () => {
  it('buildRunDeepLinkHref produces the ?run= shape the payroll page consumes', () => {
    expect(buildRunDeepLinkHref('cmvf2sfxj0005slvo34wut2cw')).toBe('/hr/payroll?run=cmvf2sfxj0005slvo34wut2cw');
    expect(buildRunDeepLinkHref('')).toBe('/hr/payroll?run=');
  });

  it('the builder is documented as the v2.113.0 shared-panel door — the drill-down reuses, never re-derives', () => {
    expect(linksLib).toContain('the People & Payroll panel\'s latest-run door');
    expect(linksLib).toContain('export function buildRunDeepLinkHref(runId: string): string');
  });
});

describe('the component contract - the cell speaks the shared vocabulary', () => {
  it('the local type grew the tolerant runId — optional, so an older cached answer type-checks and degrades', () => {
    expect(comp).toContain('runId?: string;');
    expect(comp).toContain('the wire has carried it since v2.113.0');
  });

  it('the door renders: the shared builder, the testid, the spoken label, the recorded timestamp', () => {
    expect(comp).toContain('href={buildRunDeepLinkHref(row.latestPayroll.runId)}');
    expect(comp).toContain('data-testid="org-console-hr-run-door"');
    expect(comp).toContain('aria-label={`Open the payroll run detail for ${row.latestPayroll.periodName} — ${row.storeName}`}');
    expect(comp).toContain('title={`Open the ${row.latestPayroll.periodName} run detail (recorded');
    expect(comp).toContain("<ExternalLink className=\"h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500\" aria-hidden=\"true\" />");
  });

  it('the door wears the house affordance — the orange hover, the focus ring, the underline on hover only', () => {
    expect(comp).toContain('inline-flex flex-wrap items-center gap-1.5 rounded-md text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:hover:text-orange-400');
  });

  it('the degradation is honest — no runId means the plain text, never a dead link', () => {
    expect(comp).toContain('if (row.latestPayroll.runId)');
    expect(comp).toContain('never a dead link, never a guessed href');
    // the no-run fallback keeps its exact v2.23.0 shape
    expect(comp).toContain('<span className="text-xs text-muted-foreground">no runs yet</span>');
    // the badge is a VALUE now — one vocabulary, no duplication
    expect(comp).toContain('const statusBadge = (');
  });

  it('the v2.190.0 rank machinery rides untouched — the hint, the memo, the glyph', () => {
    expect(comp).toContain('title={c.hint}');
    expect(comp).toContain('() => (summary?.hrPerStore ? sortHrDrillRows(summary.hrPerStore, hrSort) : []),');
    expect(comp).toContain("<BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />");
  });

  it('the CSV does NOT carry runId — doors do not belong in files, the v2.152.0 shape stands', () => {
    expect(csvLib).not.toContain('runId');
    expect(comp).toContain('? { periodName: r.latestPayroll.periodName, status: r.latestPayroll.status }');
  });
});

describe('the styling math - the status-badge families carry their numbers', () => {
  it('the contrast-math script exists and models the real composite stacks', () => {
    const script = readRepo('scripts/contrast-math-drilldown-badges-v2191.mjs');
    expect(script).toContain('node_modules/tailwindcss/theme.css');
    expect(script).toContain('src/app/globals.css');
    expect(script).toContain("token('emerald-950'), 0.4");
    expect(script).toContain("token('amber-950'), 0.4");
    expect(script).toContain("token('slate-900'), 0.6");
  });

  it('the a11y recipe doc records the families as reviewed-passing', () => {
    expect(a11yDoc).toContain("the drill-down's status-badge families (v2.191.0)");
    expect(a11yDoc).toContain('6/6');
    expect(a11yDoc).toContain('11.40:1');
    expect(a11yDoc).toContain('4.87:1');
  });
});

describe('docs and release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.210.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.210.0');
    expect(pkg.mbumah.baseVersion).toBe('2.210.0');
    expect(pkg.scripts['verify:v2-191-0']).toBe('node scripts/verify-v2-191-0.mjs');
    expect(pkg.scripts['verify:v2-190-0']).toBe('node scripts/verify-v2-190-0.mjs');
    expect(readRepo('scripts/verify-v2-191-0.mjs')).toContain('v2.191.0 verification');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.191.0] The drill-down opens the run');
    expect(changelog.indexOf('## [2.191.0]')).toBeLessThan(changelog.indexOf('## [2.190.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.191.0'");
    expect(whatsNew).toContain("title: 'The drill-down opens the run'");
    expect(whatsNew.indexOf('2.191.0')).toBeLessThan(whatsNew.indexOf('2.190.0'));
  });

  it('the workspace doc carries the door sentence', () => {
    expect(doc).toContain('v2.191.0 — the drill-down\'s payroll cell opens the run');
  });
});
