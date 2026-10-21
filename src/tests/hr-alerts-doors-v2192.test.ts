import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildExpiringEmployeesHref,
  buildOverdueAssetsHref,
  buildRunDeepLinkHref,
} from '../lib/workspace/links';
import { ASSET_LIST_READ_ROLES, EMPLOYEE_LIST_READ_ROLES } from '../lib/app-config';

/**
 * v2.192.0 — the drill-down opens the alerts.
 *
 * The org dashboard's HR drill-down has worn its "Expiry alerts" cell as an
 * undifferentiated SUM since v2.23.0 (documents expiring in 90 days +
 * overdue asset assignments, amber when positive), while the SHARED
 * "People & payroll by branch" panel's ExpiryCell has split the count into
 * its two honest halves and opened each as a ROLE-GATED door since
 * v2.113.0 (documents → the employees list pre-filtered to expiring
 * documents) and v2.114.0 (assets → the assets list pre-filtered). Both
 * surfaces read the SAME /api/org/summary hrPerStore block, whose
 * expiryAlerts has carried BOTH halves since the wire first spoke it; the
 * drill-down simply summed them away. This release the drill-down's cell
 * mirrors the shared panel's split vocabulary: each half becomes the door
 * the role can actually cross (a door that 403s is a lie — the gates are
 * the shared panel's OWN EMPLOYEE_LIST_READ_ROLES / ASSET_LIST_READ_ROLES,
 * so the accountant sees the exact plain-text cell this release replaces),
 * the builders are the ONE writers of the deep-link shapes (reused, never
 * re-derived), zero halves never render as links, and the CSV keeps its
 * v2.152.0 sum shape — doors do not belong in files.
 *
 * The styling half: the desk digest's avatar-hue family transfers its
 * v2.190.0 numbers to the digest panel's literal slate-900 ground
 * (proven, not assumed) and the timeline's status chips get their first
 * numbers — 36/36 pass, reviewed-passing, the numbers are the deliverable.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const comp = readRepo('src/components/workspace/org-console.tsx');
const panel = readRepo('src/components/finance/people-payroll-by-branch.tsx');
const csvLib = readRepo('src/lib/org/branches-csv.ts');
const linksLib = readRepo('src/lib/workspace/links.ts');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const doc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const pkg = JSON.parse(readRepo('package.json'));

describe('the gates executed - the shared panel contract is the ONE source', () => {
  it('the role gates answer exactly whom the lists would serve', () => {
    expect(EMPLOYEE_LIST_READ_ROLES).toEqual(['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER', 'BRANCH_MANAGER']);
    expect(ASSET_LIST_READ_ROLES).toEqual(['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER']);
    // the org console's audience: the accountant sees NO door (both lists
    // would 403); owner and super-admin cross both.
    expect(EMPLOYEE_LIST_READ_ROLES.includes('ACCOUNTANT')).toBe(false);
    expect(ASSET_LIST_READ_ROLES.includes('ACCOUNTANT')).toBe(false);
    expect(EMPLOYEE_LIST_READ_ROLES.includes('STORE_OWNER')).toBe(true);
    expect(ASSET_LIST_READ_ROLES.includes('STORE_OWNER')).toBe(true);
  });

  it('the builders produce the exact pre-filtered shapes the target pages consume', () => {
    expect(buildExpiringEmployeesHref('store-1')).toBe('/hr/employees?expiring=90&storeId=store-1');
    expect(buildOverdueAssetsHref('store-1')).toBe('/hr/assets?overdue=1&storeId=store-1');
    // the empty-id total case: the URLSearchParams set('storeId', '') keeps
    // the key with an empty value — the page's filter reads it as "all".
    expect(buildExpiringEmployeesHref('')).toBe('/hr/employees?expiring=90&storeId=');
  });

  it('the builders stay documented as the shared panel doors — reused, never re-derived', () => {
    expect(linksLib).toContain('export function buildExpiringEmployeesHref(storeId: string, days = 90): string');
    expect(linksLib).toContain('export function buildOverdueAssetsHref(storeId: string): string');
  });
});

describe('the component contract - the cell speaks the split vocabulary', () => {
  it('the cell reads BOTH halves and gates them on the shared panel\'s own roles', () => {
    expect(comp).toContain('const docs = row.expiryAlerts.documentsExpiring90Days;');
    expect(comp).toContain('const assets = row.expiryAlerts.assetsOverdue;');
    expect(comp).toContain('const canOpenDocs = EMPLOYEE_LIST_READ_ROLES.includes(role);');
    expect(comp).toContain('const canOpenAssets = ASSET_LIST_READ_ROLES.includes(role);');
  });

  it('the doors render: the shared builders, the drill-down testid vocabulary, the spoken labels', () => {
    expect(comp).toContain('href={buildExpiringEmployeesHref(row.storeId)}');
    expect(comp).toContain('href={buildOverdueAssetsHref(row.storeId)}');
    expect(comp).toContain('data-testid="org-console-hr-docs-door"');
    expect(comp).toContain('data-testid="org-console-hr-assets-door"');
    expect(comp).toContain('aria-label={`${docs} document${docs === 1 ? \'\' : \'s\'} expiring within 90 days at ${row.storeName} — open the pre-filtered employees list`}');
    expect(comp).toContain('aria-label={`${assets} overdue asset assignment${assets === 1 ? \'\' : \'s\'} at ${row.storeName} — open the pre-filtered assets list`}');
    expect(comp).toContain('title={docTitle}');
    expect(comp).toContain('title={assetsTitle}');
    // the assets door keeps the shared panel's "+N" vocabulary when it rides
    // beside the docs door, and speaks alone when it is the only door
    expect(comp).toContain('+{assets}');
  });

  it('the door wears the house affordance — the amber alert voice, the orange hover, the focus ring', () => {
    expect(comp).toContain(
      'inline-flex items-center gap-1 rounded-md font-semibold text-amber-700 underline-offset-2 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:text-amber-400 dark:hover:text-orange-400'
    );
    expect(comp).toContain('<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />');
  });

  it('the degradation ladder is honest — zero halves never render as links, the plain cell keeps its own voice', () => {
    expect(comp).toContain('if (docs > 0 && canOpenDocs)');
    expect(comp).toContain('if (assets > 0 && canOpenAssets)');
    // the accountant's plain cell: the sum, the amber alert voice kept, the
    // breakdown now spoken in the title (the ONLY thing this release adds
    // for a role no door may serve)
    expect(comp).toContain('alerts > 0 ? \'font-semibold text-amber-700 dark:text-amber-400\' : \'text-muted-foreground\'');
    expect(comp).toContain('title={title}');
    expect(comp).toContain('`Expiring documents (90 days): ${docs} - overdue asset assignments: ${assets}`');
    // the assets half beside a gated-out role stays text, pointed at the page
    expect(comp).toContain('title={`Overdue asset assignments: ${assets} — see the Assets page`}');
    // a door that 403s is a lie — the reasoning lives where the gates read
    expect(comp).toContain('a door that 403s is a');
  });

  it('the v2.191.0 run door and the v2.190.0 rank machinery ride untouched', () => {
    expect(comp).toContain('href={buildRunDeepLinkHref(row.latestPayroll.runId)}');
    expect(comp).toContain('data-testid="org-console-hr-run-door"');
    expect(buildRunDeepLinkHref('r1')).toBe('/hr/payroll?run=r1');
    expect(comp).toContain('title={c.hint}');
    expect(comp).toContain("<BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />");
  });

  it('the CSV keeps its v2.152.0 sum shape — doors do not belong in files', () => {
    expect(csvLib).not.toContain('buildExpiringEmployeesHref');
    expect(csvLib).not.toContain('buildOverdueAssetsHref');
    expect(csvLib).toContain("'Expiry alerts (90d docs + overdue assets)'");
    expect(csvLib).toContain('r.expiryAlerts,');
  });

  it('the shared panel\'s own doors stay untouched — the mirrored affordance keeps its first home', () => {
    expect(panel).toContain('data-testid="people-payroll-expiry-door"');
    expect(panel).toContain('data-testid="people-payroll-assets-door"');
    expect(panel).toContain('const canOpenDocs = EMPLOYEE_LIST_READ_ROLES.includes(role || \'\');');
    expect(panel).toContain('const canOpenAssets = ASSET_LIST_READ_ROLES.includes(role || \'\');');
  });
});

describe('the styling math - the digest families carry their numbers', () => {
  it('the contrast-math script exists and asserts the digest ground from the component', () => {
    const script = readRepo('scripts/contrast-math-digest-avatars-v2192.mjs');
    expect(script).toContain('node_modules/tailwindcss/theme.css');
    expect(script).toContain('src/components/org/panels.tsx');
    expect(script).toContain('dark:bg-slate-900');
    // the four statuses are named, the six hues ride the array
    expect(script).toContain("'PENDING'");
    expect(script).toContain("'CANCELLED'");
    expect(script).toContain("const AVATAR_HUES = ['emerald', 'sky', 'violet', 'amber', 'rose', 'teal'];");
  });

  it('the a11y recipe doc records the digest families as reviewed-passing', () => {
    expect(a11yDoc).toContain("the desk digest's avatar + status-chip families (v2.192.0)");
    expect(a11yDoc).toContain('36/36');
    expect(a11yDoc).toContain('4.55:1');
    expect(a11yDoc).toContain('the transfer is now proven, not assumed');
  });
});

describe('docs and release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.208.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.208.0');
    expect(pkg.mbumah.baseVersion).toBe('2.208.0');
    expect(pkg.scripts['verify:v2-192-0']).toBe('node scripts/verify-v2-192-0.mjs');
    expect(pkg.scripts['verify:v2-191-0']).toBe('node scripts/verify-v2-191-0.mjs');
    expect(readRepo('scripts/verify-v2-192-0.mjs')).toContain('v2.192.0 verification');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.192.0] The drill-down opens the alerts');
    expect(changelog.indexOf('## [2.192.0]')).toBeLessThan(changelog.indexOf('## [2.191.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.192.0'");
    expect(whatsNew).toContain("title: 'The drill-down opens the alerts'");
    expect(whatsNew.indexOf('2.192.0')).toBeLessThan(whatsNew.indexOf('2.191.0'));
  });

  it('the workspace doc carries the doors sentence', () => {
    expect(doc).toContain('v2.192.0 — the drill-down\'s alerts cell opens its two halves');
  });

  it('the head-pin counters re-anchored to the new head', () => {
    const counter = readRepo('src/tests/console-changelog.test.ts');
    expect(counter).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(99);");
    const a11yShell = readRepo('src/tests/a11y-shell-v2148.test.ts');
    expect(a11yShell).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(99);");
  });
});
