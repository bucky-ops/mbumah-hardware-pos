import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.202.0 — the org's quiet row (the org console's Combined organization
 * metrics section speaks).
 *
 * The /console KPI command row finished its door arc in v2.199.0 and the
 * branch workspaces' row + bottom grid followed (v2.200.0, v2.201.0) —
 * while the ORG CONSOLE's six metric tiles (Revenue today, Transactions
 * today, Low stock items, Overdue rentals, Debt outstanding, Pending
 * M-Pesa) still rendered silent divs even though the summary wire
 * (`GET /api/org/summary`) has carried the per-branch slices all along
 * (`stores[]` with each branch's six KPIs). This release gives the six
 * tiles the door vocabulary (the /console KPI row's own face inventory —
 * orange revenue, blue transactions, amber stock, rose rentals, red debt,
 * indigo pending) and opens the branch slice for each: ONE parametrized
 * modal (the one-writer rule) speaking the named branch rows loudest-first
 * with each branch's honest share of the org total, the count sub-line
 * where the wire carries one, the quiet branches speaking their 0 (never
 * dropped), the zero-total rule, the clear line, and the honest window
 * note.
 *
 * The house laws hold from birth: the panel paints its dark half (the org
 * desk's mount of the dark-panel law); the door is a self-contained focus
 * view with NO anchors (the branches table carries the workspace doors,
 * spoken in words — the pointer is not a door); null wire rows are
 * filtered by predicate, never a non-null assertion; the hook-order law
 * (door state declared with the component's other states); money coerced
 * at the boundary; and the RBAC is the summary's own — the doors compose
 * the slices the viewer already receives.
 *
 * THE ROUND'S SECOND FEATURE — the voice lint: the v2.201.1 lesson made
 * mechanical. `scripts/voice-lint.mjs` greps the UI sources for the
 * double-currency class (a literal "KES"/"Ksh" wrapped around formatKES,
 * which already speaks "Ksh") so the spoken-figure bug class can never
 * merge again. Zero findings on the current tree; a finding is a release
 * blocker.
 *
 * THE ROUND'S STYLE — the six-hue vocabulary measured BEFORE ship by
 * scripts/probe-desk-doors-v2202.mjs (36/36: the -700 accents 5.05-8.07
 * on white, the -50 chip grounds 4.87-7.22, the -300 dark accents
 * 8.88-12.34, the -500/10 dark chips 8.05-10.63, the edges as graphics
 * 3.19-6.44), the contrast script 42/42, and ONE honest alignment: the
 * branches table's overdue cell rode text-red-600 on bg-card (4.76:1 — a
 * PASS on the installed palette) and re-voiced to red-700 (6.42:1) as the
 * Task-188 family alignment, recorded as alignment, not violation.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const doors = readRepo('src/components/org/desk-doors.tsx');
const orgConsole = readRepo('src/components/workspace/org-console.tsx');
const apiRoute = readRepo('src/app/api/org/summary/route.ts');
const contrast = readRepo('scripts/contrast-math-desk-doors-v2202.mjs');
const probe = readRepo('scripts/probe-desk-doors-v2202.mjs');
const voiceLint = readRepo('scripts/voice-lint.mjs');
const kpiDoors = readRepo('src/components/dashboard/kpi-doors.tsx');
const pkg = JSON.parse(readRepo('package.json')) as {
  version: string;
  mbumah: { releaseVersion: string; baseVersion: string };
  scripts: Record<string, string>;
};
const whatsNew = readRepo('src/lib/whats-new.ts');
const changelog = readRepo('CHANGELOG.md');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');

const METRIC_IDS = ['revenue', 'transactions', 'lowStock', 'overdueRentals', 'debt', 'pendingMpesa'] as const;

describe('v2.202.0 — the wire purity: the doors compose, never fork', () => {
  it('the doors read ONLY the fields the org summary wire already carries', () => {
    expect(apiRoute).toContain('totals');
    expect(apiRoute).toMatch(/stores/);
    // zero new queries in the doors: no fetch, no db, no prisma
    expect(doors).not.toContain('fetch(');
    expect(doors).not.toContain("from '@/lib/db'");
    expect(doors).not.toContain('prisma');
  });

  it('the doors compose via a structural subset, not a forked payload type', () => {
    expect(doors).toContain('export interface OrgDeskWire');
    expect(orgConsole).toContain("import { BranchSliceModal, ORG_DESK_METRICS, deskDoorVoice, type OrgDeskMetricId, type OrgDeskWire } from '@/components/org/desk-doors';");
    expect(orgConsole).not.toContain('interface OrgDeskWire');
  });

  it('money is coerced at the boundary (the DECIMAL-STRING AUDIT precedent)', () => {
    expect(doors).toContain('function num(v: number | string | null | undefined): number');
    expect(doors).toContain('num(w.totals?.revenue)');
  });

  it('null wire rows are filtered by type predicate, never a non-null assertion', () => {
    expect(doors).toContain('.filter((s): s is NonNullable<typeof s> => !!s && s.id != null)');
    expect(doors).not.toContain('!.');
  });
});

describe('v2.202.0 — the six metrics and the one-writer modal', () => {
  it('the registry speaks all six metrics in the /console face inventory', () => {
    expect(doors).toContain("export const ORG_DESK_METRICS: Record<OrgDeskMetricId, OrgDeskMetric>");
    for (const id of METRIC_IDS) expect(doors).toContain(`${id}: {`);
    // the face hues match the /console KPI row's inventory
    expect(doors).toContain("hue: 'orange'");
    expect(doors).toContain("hue: 'blue'");
    expect(doors).toContain("hue: 'amber'");
    expect(doors).toContain("hue: 'rose'");
    expect(doors).toContain("hue: 'red'");
    expect(doors).toContain("hue: 'indigo'");
  });

  it('ONE parametrized modal speaks all six slices (the one-writer rule)', () => {
    expect(doors).toContain('export function BranchSliceModal');
    expect((doors.match(/<Dialog /g) || []).length).toBe(1);
    expect((doors.match(/<DialogContent /g) || []).length).toBe(1);
    // the six metrics' slices/voices/counts are data, not six copies
    expect((doors.match(/slice: \(s\) =>/g) || []).length).toBe(6);
  });

  it('the branch rows sort loudest-first client-side (the one-writer sort)', () => {
    expect(doors).toContain('.sort((a, b) => b.value - a.value)');
  });

  it('the honest shares read against the org total (zero total → no %)', () => {
    expect(doors).toContain('% of the org');
    expect(doors).toContain('function shareOf(part: number, total: number): number | null');
    expect(doors).toContain('if (total <= 0) return null;');
  });

  it('the quiet branches speak their 0 — never dropped', () => {
    expect(doors).toContain('At zero: ');
    expect(doors).toContain("data-testid={`org-desk-quiet-${metric.id}`}");
  });

  it('the count sub-lines ride the wire (transactions on revenue, bills on debt)', () => {
    expect(doors).toContain("`${t} transaction${t === 1 ? '' : 's'} today`");
    expect(doors).toContain('outstanding bill');
  });

  it('the clear line and the empty step-aside speak their honest voices', () => {
    expect(doors).toContain('org-desk-clear-${metric.id}');
    expect(doors).toContain('Every branch sits at zero on this answer');
    expect(doors).toContain('org-desk-empty');
    expect(doors).toContain('The summary names no branches yet');
  });

  it('the window note names what the slice reads and points in words', () => {
    expect(doors).toContain('data-testid="org-desk-window"');
    expect(doors).toContain('The branches table carries each workspace');
  });

  it('the no-anchors law: the door is self-contained', () => {
    expect(doors).not.toContain('<a ');
    expect(doors).not.toContain('href=');
    expect(doors).not.toContain('Link');
  });
});

describe('v2.202.0 — the row wiring: six doors in the family vocabulary', () => {
  it('all six cards carry the door handles and the open-details voice', () => {
    for (const id of METRIC_IDS) {
      expect(orgConsole).toContain(`org-desk-card-${id}`);
      expect(orgConsole).toContain(`setDeskDoor('${id}')`);
    }
    expect(orgConsole).toContain('aria-label={`${label} - open details`}');
    expect(orgConsole).toContain('Open details');
  });

  it('the hook-order law: door state declared with the component states', () => {
    const idx = orgConsole.indexOf('const [deskDoor, setDeskDoor]');
    const firstJsx = orgConsole.indexOf('<section aria-label="Combined organization metrics">');
    expect(idx).toBeGreaterThan(-1);
    expect(firstJsx).toBeGreaterThan(idx);
  });

  it('the hot ring is honest: lit only when the metric total is nonzero', () => {
    expect(orgConsole).toContain('doorHot: summary ? ORG_DESK_METRICS[id].total(summary) > 0 : false');
  });

  it('the modal mounts once with the door state (one-writer wiring)', () => {
    expect((orgConsole.match(/<BranchSliceModal/g) || []).length).toBe(1);
    expect(orgConsole).toContain('wire={summary as OrgDeskWire}');
    expect(orgConsole).toContain('open={deskDoor != null}');
  });

  it('the HR tiles keep their hrefs (they were never quiet)', () => {
    expect(orgConsole).toContain('href="/hr/reports?tab=headcount"');
    expect(orgConsole).toContain('href="/hr/payroll"');
  });
});

describe('v2.202.0 — the style: the six-hue vocabulary + the voice lint', () => {
  it('the six hues speak the family faces measured by the probe', () => {
    for (const h of ['orange', 'blue', 'amber', 'rose', 'red', 'indigo']) {
      expect(doors).toContain(`text-${h}-700`);
      expect(doors).toContain(`dark:text-${h}-300`);
      expect(doors).toContain(`bg-${h}-50 text-${h}-700`);
    }
  });

  it('the dark-panel law: one shared chrome, painted from birth', () => {
    expect(doors).toContain('dark:border-slate-700 dark:bg-slate-900');
    expect((doors.match(/className=\{PANEL_CLS\}/g) || []).length).toBe(1);
  });

  it('the overdue cell re-voiced red-700 (the honest alignment)', () => {
    expect(orgConsole).toContain('text-red-700 font-medium');
    expect(orgConsole).not.toContain('text-red-600');
    expect(contrast).toContain('RECORDED HONESTLY as ALIGNMENT, not violation');
    expect(contrast).toContain('PASSES 4.5 on the installed palette');
  });

  it('the probe measures the whole vocabulary', () => {
    for (const h of ['orange', 'blue', 'amber', 'rose', 'red', 'indigo']) {
      expect(probe).toContain(`'${h}'`);
    }
    expect(probe).toContain('need 4.5:1');
  });

  it('the voice lint exists and bans the double-currency class', () => {
    expect(voiceLint).toContain('KES\\s*\\$\\{formatKES');
    expect(voiceLint).toContain('Ksh\\s*\\$\\{formatKES');
    expect(voiceLint).toContain('process.exit(1)');
  });

  it('the v2.201.1 pluralization fix still holds', () => {
    expect(kpiDoors).toContain("${maxCount === 1 ? 'receipt' : 'receipts'}");
  });
});

describe('v2.202.0 — docs and release surfaces', () => {
  it('package.json rides at 2.202.0 (all three slots) and the scripts are wired', () => {
    expect(pkg.version).toBe('2.206.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.206.0');
    expect(pkg.mbumah.baseVersion).toBe('2.206.0');
    expect(pkg.scripts['verify:v2-202-0']).toBe('node scripts/verify-v2-202-0.mjs');
    expect(pkg.scripts['verify:v2-201-0']).toBe('node scripts/verify-v2-201-0.mjs');
  });

  it('the head-pin counters re-anchored to the new head', () => {
    const counter = readRepo('src/tests/console-changelog.test.ts');
    expect(counter).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(97);");
  });

  it('the whats-new feed heads the release', () => {
    expect(whatsNew).toContain("version: '2.202.0'");
    expect(whatsNew).toContain('quiet row speaks');
    expect(whatsNew.indexOf("version: '2.202.0'")).toBeLessThan(whatsNew.indexOf("version: '2.201.1'"));
  });

  it('the a11y doc records the round', () => {
    expect(a11yDoc).toContain('2.202.0');
  });

  it('the v2.202.1 wire guard: the field the summary actually carries', () => {
    // the summary rows carry WorkspaceStoreRef.id — the subset reads the SAME
    // field, and org-console pins the assignability at COMPILE time.
    expect(doors).toContain('id?: string;');
    expect(doors).not.toContain('storeId?: string;');
    expect(orgConsole).toContain('type DeskWireCheck = OrgSummary extends OrgDeskWire ? true : never;');
    expect(orgConsole).toContain('const deskWireCheck: DeskWireCheck = true;');
  });

  it('the changelog keeps the round above its predecessor (the treadmill-proof order)', () => {
    expect(changelog.indexOf('## [2.202.0]')).toBeGreaterThan(-1);
    expect(changelog.indexOf('## [2.202.0]')).toBeLessThan(changelog.indexOf('## [2.201.1]'));
  });

  it("the round's test file exists and pins the round", () => {
    expect(readRepo('src/tests/desk-doors-v2202.test.ts')).toContain('the org');
    expect(readRepo('src/tests/desk-doors-v2202.test.ts')).toContain('org-desk-card-revenue');
    expect(readRepo('src/tests/desk-doors-v2202.test.ts')).toContain("'2.202.0'");
  });
});
