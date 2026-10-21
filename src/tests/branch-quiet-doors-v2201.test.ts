import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.201.0 — the branch's debt book and the day's movers (the bottom
 * grid's two quiet cards speak).
 *
 * The branch KPI row found its three voices in v2.200.0; this round walks
 * the door arc down the page's bottom grid, where TWO cards still rendered
 * their stories in silence even though every figure they could drill into
 * already rode the dashboard wire:
 *
 *   - The DEBT AGING SUMMARY card becomes the debt book door (the debt
 *     family's ROSE face): the aging bar at reading size with honest
 *     shares of the book, the named debtors loudest-first with their
 *     share of the book and the WIRE's own risk voice (a high-risk debtor
 *     owes more than twice their lifetime spend — never re-derived), the
 *     high-risk line, the server's own warning banner, and the honest
 *     window note — the book names its loudest debtors, the BILL count
 *     stays the truth.
 *   - The TOP SELLING PRODUCTS card becomes the day's movers door (the
 *     VIOLET face — a new hue for products): the full named roster with
 *     qty, revenue and an honest share OF THE NAMED WINDOW, plus the
 *     category mix (the route's topSellingCategories GROUP BY — a field
 *     the tab has never read before) with the wire's own colors.
 *
 * The house laws hold from birth: both panels paint their dark half (the
 * branch page's next two mounts of the dark-panel law); a zero total
 * renders NO percentage (never an invented "0%" of nothing) and says so;
 * a zero bucket bar draws nothing while its cell still speaks its 0; the
 * named rosters are windows when they are (the count stays the truth);
 * the risk rule is the WIRE's; null wire rows are filtered by type
 * predicate, never a non-null assertion; and the doors are self-contained
 * focus views — no anchors (the honest-door law: the pointer is not a
 * door).
 *
 * THE ROUND'S SWEEP — the -600 straggler family, measured by the
 * pre-derivation probe (scripts/probe-quiet-doors-v2201.mjs) and re-voiced
 * at source BEFORE anything shipped: the Alerts count badge (white on
 * red-500 = 3.82 → red-700 = 6.42), the payment DEBT chip (rose-600 on
 * rose-100 = 3.75 → rose-700 = 5.04), the GIFT_CARD chip (slate-500 on
 * slate-100 = 4.35 → slate-600 = 6.90), the alert CRITICAL chip (red-600
 * on red-100 = 3.90 → red-700 = 5.26), the crisis banner sub-line (red-600
 * on red-50 = 4.36 → red-700 = 5.88), the trend DOWN chip (the same
 * pairing), and the family-alignment re-voices recorded as alignment (red-600
 * on white PASSES the installed palette at 4.76; the values moved to -700
 * for consistency + margin). The draft pairs are pinned below the bar in
 * REVERSE so the ghosts cannot return silently.
 *
 * Plus the v2.200.0 round's carried nit: the receipts-by-hour aria now
 * speaks "1 receipt" / "N receipts" (the pluralization fix).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const doors = readRepo('src/components/dashboard/branch-doors.tsx');
const tab = readRepo('src/app/(shell)/tabs/dashboard-tab.tsx');
const apiRoute = readRepo('src/app/api/dashboard/route.ts');
const kpiDoors = readRepo('src/components/dashboard/kpi-doors.tsx');
const contrast = readRepo('scripts/contrast-math-branch-doors-v2201.mjs');
const probe = readRepo('scripts/probe-quiet-doors-v2201.mjs');
const pkg = JSON.parse(readRepo('package.json')) as {
  version: string;
  mbumah: { releaseVersion: string; baseVersion: string };
  scripts: Record<string, string>;
};
const whatsNew = readRepo('src/lib/whats-new.ts');
const changelog = readRepo('CHANGELOG.md');
const workspaceDoc = readRepo('docs/multi-store-workspaces.md');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');

describe('v2.201.0 — the wire purity: the doors compose, never fork', () => {
  it('the doors read ONLY the fields the dashboard wire already carries', () => {
    expect(apiRoute).toContain('debtCrisis: insights.debtCrisis');
    expect(apiRoute).toContain('topProducts: topProductsResult');
    expect(apiRoute).toContain('topSellingCategories: topSellingCategoriesResult');
    // zero new queries in the doors: no fetch, no db, no prisma
    expect(doors).not.toContain('fetch(');
    expect(doors).not.toContain("from '@/lib/db'");
    expect(doors).not.toContain('prisma');
  });

  it('the doors compose via structural subsets, not forked payload types', () => {
    expect(doors).toContain('export interface BranchDebtWire');
    expect(doors).toContain('export interface BranchMoversWire');
    // v2.203.0 re-anchor: the week door rides in the same import
    expect(tab).toContain("import { DebtBookModal, MoversModal, WeekLedgerModal } from '@/components/dashboard/branch-doors';");
    // the tab declares NO forked crisis/product type: the wire is the doors'
    // structural contract, the tab's data flows in as-is
    expect(tab).not.toContain('interface BranchDebtWire');
    expect(tab).not.toContain('interface BranchMoversWire');
  });

  it('the category mix rides the tab as a structural subset extension', () => {
    expect(tab).toContain('topSellingCategories?: Array<{');
    expect(tab).toContain('revenue: number;');
  });

  it('money is coerced at the boundary (the DECIMAL-STRING AUDIT precedent)', () => {
    expect(doors).toContain('function num(v: number | string | null | undefined): number');
    expect(doors).toContain('num(crisis?.outstandingTotal)');
    expect(doors).toContain('num(p.totalRevenue)');
  });

  it('null wire rows are filtered by type predicate, never a non-null assertion', () => {
    expect(doors).toContain('.filter((c): c is NonNullable<typeof c> => !!c && c.customerId != null)');
    expect(doors).toContain('.filter((p): p is NonNullable<typeof p> => !!p && p.productId != null)');
    expect(doors).not.toContain('!.customerId');
    expect(doors).not.toContain('!.');
  });
});

describe('v2.201.0 — the debt book: the wire owns the alarm', () => {
  it('the risk voice is the WIRE rule, spoken — never re-derived', () => {
    expect(doors).toContain('row.highRisk');
    expect(doors).toContain("'high risk'");
    expect(doors).toContain('owes more than twice their');
    // no client-side re-derivation of the 2x rule
    expect(doors).not.toContain('2 *');
    expect(doors).not.toContain('* 2');
  });

  it('the honest ratio voice: wire ratio when present, the no-record line when not', () => {
    expect(doors).toContain('% of it owed');
    expect(doors).toContain('no completed purchases on record');
  });

  it('the named debtors sort loudest-first client-side (the one-writer sort)', () => {
    expect(doors).toContain('.sort((a, b) => b.owes - a.owes)');
  });

  it('the bucket cells speak dot + label + amount + honest share of the book', () => {
    expect(doors).toContain("data-testid={`branch-debt-bucket-${b.key}`}");
    expect(doors).toContain('% of the book');
    // the zero-total rule: a share of nothing is never spoken
    expect(doors).toContain('function shareOf(part: number, total: number): number | null');
    expect(doors).toContain('if (total <= 0) return null;');
    expect(doors).toContain(">none</p>");
  });

  it('the window note stays honest: the BILL count is the truth', () => {
    expect(doors).toContain('data-testid="branch-debt-window"');
    expect(doors).toContain('outstanding bill');
    expect(doors).toContain('in all; the shares read against the whole book');
  });

  it('the alarm voices exist: the high-risk line + the server banner verbatim', () => {
    expect(doors).toContain('data-testid="branch-debt-hot"');
    expect(doors).toContain('data-testid="branch-debt-banner"');
    expect(doors).toContain('{crisis.banner}');
  });

  it('the clear book and the unnamed roster speak their honest lines', () => {
    expect(doors).toContain('data-testid="branch-debt-clear"');
    expect(doors).toContain('The book is clear');
    expect(doors).toContain('data-testid="branch-debt-unnamed"');
    expect(doors).toContain("The book&rsquo;s rows ride unnamed on this answer");
  });

  it('the zero-total book renders NO bar, NO rows, NO percentage', () => {
    expect(doors).toContain('const clear = total <= 0;');
    // the clear branch renders the clear line, not a zero-count ledger
    expect(doors.indexOf('branch-debt-clear')).toBeGreaterThan(-1);
  });
});

describe("v2.201.0 — the day's movers: the window and the mix", () => {
  it('the full named roster sorts loudest-first with qty, revenue and window share', () => {
    expect(doors).toContain('.sort((a, b) => b.revenue - a.revenue)');
    expect(doors).toContain('% of the named window');
    expect(doors).toContain('data-testid="branch-movers-share"');
  });

  it('the category mix reads the wire colors with honest shares of the mix', () => {
    expect(doors).toContain('data-testid="branch-movers-cat-row"');
    expect(doors).toContain('% of the mix');
    expect(doors).toContain("backgroundColor: c.color ?? '#94a3b8'");
  });

  it('the category mix stays silent when its named total is zero (no % of nothing)', () => {
    expect(doors).toContain('cats.length > 0 && catTotal > 0');
  });

  it('the window note names what the doors read', () => {
    expect(doors).toContain('data-testid="branch-movers-window"');
    expect(doors).toContain("the shares read against the named window, the card&rsquo;s headline stays the truth");
  });

  it('the zero day speaks its line', () => {
    expect(doors).toContain('data-testid="branch-movers-clear"');
    expect(doors).toContain("No movers yet today");
  });

  it('the movers headline speaks the loudest mover in words', () => {
    expect(doors).toContain('data-testid="branch-movers-top"');
    expect(doors).toContain('Loudest:');
  });
});

describe('v2.201.0 — the row wiring: two doors in the family vocabulary', () => {
  it('the debt card is a button with the rose face, hot ring lit by the wire alarm', () => {
    expect(tab).toContain('data-testid="branch-debt-card"');
    expect(tab).toContain('aria-label="Debt aging summary - open details"');
    expect(tab).toContain('w-1 bg-rose-600');
    expect(tab).toContain("crisis?.warning ? 'ring-1 ring-rose-300 dark:ring-rose-500/40'");
    expect(tab).toContain('crisis?.warning ? <span aria-hidden="true" className="absolute right-3 top-3 h-2 w-2 rounded-full bg-rose-600 anim-pulse-dot" />');
  });

  it("the movers card is a button with the violet face, hot ring lit by the day's movers", () => {
    expect(tab).toContain('data-testid="branch-movers-card"');
    expect(tab).toContain('aria-label="Top selling products - open details"');
    expect(tab).toContain('w-1 bg-violet-600');
    expect(tab).toContain('allNamed > 0 ? \'ring-1 ring-slate-300 dark:ring-slate-600\'');
  });

  it('the hook-order law: door state before any early return', () => {
    const debtCard = tab.slice(tab.indexOf('function DebtAgingCard'));
    const moversCard = tab.slice(tab.indexOf('function TopProductsCard'));
    expect(debtCard.indexOf('useState(false)')).toBeGreaterThan(-1);
    expect(debtCard.indexOf('useState(false)')).toBeLessThan(debtCard.indexOf('\n  return ('));
    expect(moversCard.indexOf('useState(false)')).toBeGreaterThan(-1);
    expect(moversCard.indexOf('useState(false)')).toBeLessThan(moversCard.indexOf('\n  return ('));
  });

  it('the doors mount with the modals wired to the card state', () => {
    expect(tab).toContain('<DebtBookModal');
    expect(tab).toContain('crisis={crisis}');
    expect(tab).toContain('<MoversModal');
    expect(tab).toContain('categories={data?.topSellingCategories ?? null}');
  });

  it('the doors render only in the FULL dashboard (the limited row untouched)', () => {
    const fullIdx = tab.indexOf('{/* 11-12. Debt aging + alerts */}');
    const limitedIdx = tab.indexOf('function LimitedDashboard');
    expect(fullIdx).toBeGreaterThan(-1);
    expect(limitedIdx).toBeGreaterThan(-1);
    expect(limitedIdx).toBeLessThan(fullIdx);
    // the LimitedDashboard body never mounts the doors
    const limited = tab.slice(limitedIdx, tab.indexOf('function HourlyRevenueChart'));
    expect(limited).not.toContain('DebtBookModal');
    expect(limited).not.toContain('MoversModal');
  });

  it('the no-anchors law: the doors are self-contained focus views', () => {
    expect(doors).not.toContain('<a ');
    expect(doors).not.toContain('href=');
    expect(doors).not.toContain('Link');
  });
});

describe('v2.201.0 — the contrast sweep: the -600 family closed on the branch', () => {
  it('no -600 text voice rides anywhere on the branch dashboard or the doors', () => {
    expect(tab).not.toContain('text-red-600');
    expect(tab).not.toContain('text-rose-600');
    expect(doors).not.toContain('text-rose-600');
    expect(doors).not.toContain('dark:text-rose-400');
  });

  it('the five REAL violations re-voiced (measured by the probe)', () => {
    // the alerts badge: white on red-500 = 3.82 → red-700 = 6.42
    expect(tab).toContain('bg-red-700 px-1.5 text-[10px] font-bold text-white');
    // the payment DEBT chip: rose-600 on rose-100 = 3.75 → rose-700 = 5.04
    expect(tab).toContain("DEBT: 'bg-rose-100 text-rose-700'");
    // the GIFT_CARD chip: slate-500 on slate-100 = 4.35 → slate-600 = 6.90
    expect(tab).toContain("GIFT_CARD: 'bg-slate-100 text-slate-600'");
    // the alert CRITICAL chip: red-600 on red-100 = 3.90 → red-700 = 5.26
    expect(tab).toContain("circle: 'bg-red-100 text-red-700'");
    // the crisis banner sub-line: red-600 on red-50 = 4.36 → red-700 = 5.88
    expect(tab).toContain('mt-0.5 text-xs text-red-700');
    // the trend DOWN chip: the same red-50 pairing
    expect(tab).toContain("'bg-red-50 text-red-700'");
  });

  it('the family-alignment re-voices are recorded as alignment, honestly', () => {
    expect(contrast).toContain('RECORDED HONESTLY as ALIGNMENT, not violation');
    expect(contrast).toContain('PASSES 4.5 on the installed palette');
  });

  it('the ghosts are pinned below the bar in reverse', () => {
    expect(contrast).toContain("checkBug('  ghost: white on red-500 (the badge draft)'");
    expect(contrast).toContain("checkBug('  ghost: rose-600 on rose-100 (the DEBT chip draft)'");
    expect(contrast).toContain("checkBug('  ghost: slate-500 on slate-100 (the GIFT chip draft)'");
    expect(contrast).toContain("checkBug('  ghost: red-600 on red-100 (the critical draft)'");
    expect(contrast).toContain("checkBug('  ghost: red-600 on red-50 (the banner draft)'");
  });

  it('the doors carry the family-aligned debt figures', () => {
    expect(doors).toContain('text-rose-700 dark:text-rose-300');
  });

  it('the pre-derivation probe exists and measures the family', () => {
    expect(probe).toContain('ALERTS BADGE white on red-500 (the draft)');
    expect(probe).toContain('PAY CHIP DEBT rose-600 on rose-100');
    expect(probe).toContain('SEVERITY critical red-600 on red-100');
  });
});

describe('v2.201.0 — the dark-panel law and the carried nit', () => {
  it('both new panels paint their dark half from birth', () => {
    expect(doors).toContain('dark:border-slate-700 dark:bg-slate-900');
    // the doors share one chrome constant (the one-writer panel)
    // v2.203.0 re-anchor: the week door joins the same shared chrome
    expect(doors.match(/className=\{PANEL_CLS\}/g)?.length).toBe(3);
  });

  it('the v2.200.0 pluralization nit is fixed at source', () => {
    expect(kpiDoors).toContain("${maxCount === 1 ? 'receipt' : 'receipts'}");
    expect(kpiDoors).not.toContain('with ${maxCount} receipts.`}');
  });
});

describe('v2.201.0 — docs and release surfaces', () => {
  it('package.json rides at 2.201.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.206.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.206.0');
    expect(pkg.mbumah.baseVersion).toBe('2.206.0');
    expect(pkg.scripts['verify:v2-201-0']).toBe('node scripts/verify-v2-201-0.mjs');
    expect(pkg.scripts['verify:v2-200-0']).toBe('node scripts/verify-v2-200-0.mjs');
  });

  it('the head-pin counters re-anchored to the new head', () => {
    const counter = readRepo('src/tests/console-changelog.test.ts');
    expect(counter).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(97);");
    const a11yShell = readRepo('src/tests/a11y-shell-v2148.test.ts');
    expect(a11yShell).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(97);");
  });

  it('the whats-new feed heads the release', () => {
    expect(whatsNew).toContain("version: '2.201.0'");
    expect(whatsNew).toContain('The debt book and the movers speak');
    expect(whatsNew.indexOf("version: '2.201.0'")).toBeLessThan(whatsNew.indexOf("version: '2.200.0'"));
  });

  it('the a11y doc records the sweep', () => {
    expect(a11yDoc).toContain('2.201.0');
    expect(a11yDoc).toContain('red-700');
  });

  it("the workspace doc's door register carries the new doors", () => {
    expect(workspaceDoc).toContain('v2.201.0');
    expect(workspaceDoc).toContain("debt book");
    expect(workspaceDoc).toContain("movers");
  });

  it('the changelog keeps the round above its predecessor (the treadmill-proof order)', () => {
    expect(changelog.indexOf('## [2.201.0] The debt book and the movers speak')).toBeGreaterThan(-1);
    expect(changelog.indexOf('## [2.201.0] The debt book and the movers speak')).toBeLessThan(changelog.indexOf('## [2.200.0] The branch row speaks'));
  });

  it('the v2.201.1 voice fix: one currency word, never two', () => {
    const doorsSrc = readRepo('src/components/dashboard/branch-doors.tsx');
    expect(doorsSrc).not.toContain('KES ${formatKES');
    expect(doorsSrc).not.toContain('KES {formatKES');
    expect(doorsSrc).toContain('${formatKES(row.lifetimeSpend)} lifetime spend');
  });

  it("the round's test file exists and pins the round", () => {
    expect(readRepo('src/tests/branch-quiet-doors-v2201.test.ts')).toContain('the debt book and the movers');
    expect(readRepo('src/tests/branch-quiet-doors-v2201.test.ts')).toContain('testId="branch-debt-card"');
    expect(readRepo('src/tests/branch-quiet-doors-v2201.test.ts')).toContain("'2.201.0'");
  });
});
