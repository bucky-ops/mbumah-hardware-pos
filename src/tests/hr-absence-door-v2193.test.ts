import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAbsenceReportHref, buildRunDeepLinkHref } from '../lib/workspace/links';
import { ORG_SUMMARY_ROLES } from '../lib/app-config';

/**
 * v2.193.0 — the absence cell opens the report.
 *
 * The People & Payroll surfaces have worn their "Absence" cell as plain
 * text with an amber voice since the panel first spoke it (v2.110.0) and
 * the drill-down inherited it (v2.23.0): a branch whose unscheduled
 * absence crosses 10% turns amber and font-semibold — and then goes
 * nowhere. The destination this release opens has existed all along: the
 * HR reports desk already speaks `?tab=absence` (one of its own
 * REPORT_TAB_KEYS) and already honors the v2.23.0 per-branch `storeId`
 * deep link. This release composes what exists: at the 10% attention
 * threshold the rate becomes a door — on the drill-down AND on the shared
 * panel (table and mobile cards through ONE shared AbsenceCell) — and the
 * desk report's chip families carry their contrast-math numbers (23/23
 * pass). No role gate, because a door that 403s is a lie — and this one
 * cannot: every viewer of the two surfaces (ORG_SUMMARY_ROLES) passes the
 * reports API's guard (SUPER_ADMIN via the hrGuard bypass, STORE_OWNER
 * and ACCOUNTANT are REPORT_ROLES members).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const comp = readRepo('src/components/workspace/org-console.tsx');
const panel = readRepo('src/components/finance/people-payroll-by-branch.tsx');
const linksLib = readRepo('src/lib/workspace/links.ts');
const reportsPage = readRepo('src/app/(shell)/hr/reports/page.tsx');
const reportsApi = readRepo('src/app/api/hr/reports/summary/route.ts');
const csvLib = readRepo('src/lib/org/branches-csv.ts');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const doc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const pkg = JSON.parse(readRepo('package.json'));

describe('the builder executed - the ONE writer of the composed shape', () => {
  it('composes the destination\'s OWN established contract — tab key + per-branch storeId', () => {
    expect(buildAbsenceReportHref('store-1')).toBe('/hr/reports?tab=absence&storeId=store-1');
    // the empty-id total case: the URLSearchParams set('storeId', '') keeps
    // the key with an empty value — the page's filter reads it as "all".
    expect(buildAbsenceReportHref('')).toBe('/hr/reports?tab=absence&storeId=');
  });

  it('the builder is exported from the links lib — never re-derived at the call sites', () => {
    expect(linksLib).toContain('export function buildAbsenceReportHref(storeId: string): string');
    expect(linksLib).toContain("params.set('tab', 'absence');");
    expect(linksLib).toContain("params.set('storeId', storeId || '');");
  });

  it('the destination honors BOTH halves of the composed link', () => {
    // the tab key is one of the reports page's OWN REPORT_TAB_KEYS
    expect(reportsPage).toContain("'absence'");
    expect(reportsPage).toContain("REPORT_TAB_KEYS = ['headcount', 'cost', 'absence', 'leave', 'turnover', 'tth', 'statutory', 'p10', 'schedules', 'privacy']");
    // the page consumes the ?tab= param into its tab state
    expect(reportsPage).toContain('(REPORT_TAB_KEYS as readonly string[]).includes(requested)');
    // the v2.23.0 per-branch deep link rides through the page's storeId
    // handling (the scope chips' roving group)
    expect(reportsPage).toContain('storeId');
  });

  it('no role gate, because a door that 403s is a lie — and this one cannot', () => {
    // the two surfaces' audience
    expect(ORG_SUMMARY_ROLES).toEqual(['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT']);
    // the reports API's guard: every member passes (SUPER_ADMIN via the
    // hrGuard bypass, STORE_OWNER and ACCOUNTANT are REPORT_ROLES members)
    expect(reportsApi).toContain("const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER']");
    for (const role of ORG_SUMMARY_ROLES) {
      expect(role === 'SUPER_ADMIN' || reportsApi.includes(`'${role}'`)).toBe(true);
    }
    // the reasoning lives where the door reads — the links lib speaks the
    // never-renders-where-it-would-403 shape, the shared cell the lie shape
    expect(linksLib).toContain('so the door never renders where it would 403');
    expect(panel).toContain('a door that 403s is a lie, and this one cannot');
  });
});

describe('the drill-down door - the amber voice becomes the affordance', () => {
  it('the threshold gates the door — at 10% the rate opens the report', () => {
    expect(comp).toContain('row.monthAbsenceRatePct >= 10 ? (');
    expect(comp).toContain('href={buildAbsenceReportHref(row.storeId)}');
    expect(comp).toContain('data-testid="org-console-hr-absence-door"');
  });

  it('the door speaks the rate, the branch, and the destination', () => {
    expect(comp).toContain('aria-label={`${row.monthAbsenceRatePct}% absence rate at ${row.storeName} this month — open the absence report narrowed to ${row.storeName}`}');
    expect(comp).toContain('title={`Absence rate: ABSENT days over all recorded days this month — open the absence report narrowed to ${row.storeName}`}');
  });

  it('the door wears the house affordance — the amber alert voice, the orange hover, the focus ring', () => {
    expect(comp).toContain(
      'inline-flex items-center gap-1 rounded-md font-semibold text-amber-700 underline-offset-2 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:text-amber-400 dark:hover:text-orange-400'
    );
    expect(comp).toContain('<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />');
  });

  it('below the threshold the calm plain text stays — the drill affordance never rides a quiet branch', () => {
    // the else branch keeps the exact shape this release replaces (no
    // amber, no font-semibold — the voice the calm branches always wore)
    expect(comp).toContain(') : (\n                                  `${row.monthAbsenceRatePct}%`\n                                )}');
  });

  it('the builder rides the drill-down\'s multi-line links import (the ONE writers block)', () => {
    expect(comp).toContain("import {\n  buildAbsenceReportHref,\n  buildExpiringEmployeesHref,");
  });
});

describe('the shared panel - ONE AbsenceCell, two mounts, one vocabulary', () => {
  it('the AbsenceCell exists as the ExpiryCell/LatestRunCell sibling', () => {
    expect(panel).toContain('function AbsenceCell({ row }: { row: HrPerStoreRow })');
    expect(panel).toContain('href={buildAbsenceReportHref(row.storeId)}');
    expect(panel).toContain('data-testid="people-payroll-absence-door"');
    expect(panel).toContain('aria-label={`${row.monthAbsenceRatePct}% absence rate at ${row.storeName} this month — open the absence report narrowed to ${row.storeName}`}');
    expect(panel).toContain('title="Absence rate: ABSENT days over all recorded days this month — open the absence report narrowed to this branch"');
  });

  it('the cell mounts EXACTLY twice — the table and the mobile card', () => {
    expect(panel.match(/<AbsenceCell row={row} \/>/g)?.length).toBe(2);
  });

  it('the table and mobile cells render through the shared cell — no local amber voice left behind', () => {
    expect(panel).toContain('<td className="px-3 py-2 text-right tabular-nums">\n                      <AbsenceCell row={row} />\n                    </td>');
    expect(panel).toContain('<dd className="mt-0.5 text-right tabular-nums">\n                        <AbsenceCell row={row} />\n                      </dd>');
    // the OLD conditional amber voice is gone from the panel's table cells
    expect(panel).not.toContain("row.monthAbsenceRatePct >= 10\n                          ? 'font-semibold text-amber-700 dark:text-amber-400'");
  });

  it('below the threshold the shared cell keeps the calm slate voice with the honest title', () => {
    expect(panel).toContain('<span\n      className="text-slate-700 dark:text-slate-300"\n      title="Absence rate: ABSENT days over all recorded days this month"\n    >');
  });

  it('the builder rides the panel\'s single-line links import', () => {
    expect(panel).toContain("import { buildAbsenceReportHref, buildExpiringEmployeesHref, buildOverdueAssetsHref, buildRunDeepLinkHref } from '@/lib/workspace/links';");
  });
});

describe('the siblings hold - the run/docs/assets doors and the rank machinery ride untouched', () => {
  it('the v2.191.0 run door still opens', () => {
    expect(comp).toContain('href={buildRunDeepLinkHref(row.latestPayroll.runId)}');
    expect(comp).toContain('data-testid="org-console-hr-run-door"');
    expect(buildRunDeepLinkHref('r1')).toBe('/hr/payroll?run=r1');
  });

  it('the v2.192.0 alerts doors still open, gated as ever', () => {
    expect(comp).toContain('data-testid="org-console-hr-docs-door"');
    expect(comp).toContain('data-testid="org-console-hr-assets-door"');
    expect(comp).toContain('const canOpenDocs = EMPLOYEE_LIST_READ_ROLES.includes(role);');
    expect(comp).toContain('const canOpenAssets = ASSET_LIST_READ_ROLES.includes(role);');
    expect(panel).toContain('data-testid="people-payroll-expiry-door"');
    expect(panel).toContain('data-testid="people-payroll-assets-door"');
  });

  it('the v2.190.0 rank machinery still drives the payroll column', () => {
    expect(comp).toContain('title={c.hint}');
    expect(comp).toContain("<BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />");
  });

  it('the CSV keeps its sum shape — doors do not belong in files', () => {
    expect(csvLib).not.toContain('buildAbsenceReportHref');
    expect(csvLib).toContain("'Expiry alerts (90d docs + overdue assets)'");
  });
});

describe('the styling math - the desk report families carry their numbers', () => {
  it('the contrast-math script exists and asserts the literals from the component source', () => {
    const script = readRepo('scripts/contrast-math-desk-report-chips-v2193.mjs');
    expect(script).toContain('node_modules/tailwindcss/theme.css');
    expect(script).toContain('src/components/org/desk-report-view.tsx');
    expect(script).toContain('src/app/globals.css');
  });

  it('the a11y recipe doc records the desk report families as reviewed-passing', () => {
    expect(a11yDoc).toContain("the desk report's emerald action + status families (v2.193.0)");
    expect(a11yDoc).toContain('23/23');
    expect(a11yDoc).toContain('4.55:1');
    // trimmed to survive the doc's line wraps (lesson 49)
    expect(a11yDoc).toContain('the v2.192.0 numbers do not');
    expect(a11yDoc).toContain('first numbers, not a re-run');
  });
});

describe('docs and release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.204.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.204.0');
    expect(pkg.mbumah.baseVersion).toBe('2.204.0');
    expect(pkg.scripts['verify:v2-193-0']).toBe('node scripts/verify-v2-193-0.mjs');
    expect(pkg.scripts['verify:v2-192-0']).toBe('node scripts/verify-v2-192-0.mjs');
    expect(readRepo('scripts/verify-v2-193-0.mjs')).toContain('v2.193.0 verification');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.193.0] The absence cell opens the report');
    expect(changelog.indexOf('## [2.193.0]')).toBeLessThan(changelog.indexOf('## [2.192.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.193.0'");
    expect(whatsNew).toContain("title: 'The absence cell opens the report'");
    expect(whatsNew.indexOf('2.193.0')).toBeLessThan(whatsNew.indexOf('2.192.0'));
  });

  it('the workspace doc carries the absence-door sentences', () => {
    expect(doc).toContain('v2.193.0 — the absence cell opens the report');
    expect(doc).toContain('v2.193.0 — the absence rate at or above the 10% attention threshold opens the HR reports desk');
  });

  it('the head-pin counters re-anchored to the new head', () => {
    const counter = readRepo('src/tests/console-changelog.test.ts');
    expect(counter).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(95);");
    const a11yShell = readRepo('src/tests/a11y-shell-v2148.test.ts');
    expect(a11yShell).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(95);");
  });
});
