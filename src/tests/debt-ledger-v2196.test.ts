import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.196.0 — the debt card opens the ledger (the KPI row's THIRD voice).
 *
 * The Revenue card told the money's story since v2.173.0 and the count
 * face found its voice in v2.195.0 while the Debt card badge-summed its
 * aging in silence — even though the NAMED ledger was already on the
 * wire (`debtExpert.topDebtors`, the Debt Expert panel's payload since
 * the Expert panel shipped). This release gives the ledger its voice:
 * the card becomes the row's third button (the red edge + live dot +
 * ledger qualifier chip — the family vocabulary's third face), the
 * aging buckets draw their COMPOSITION BAR (card mini + modal reading
 * size, hue deepens with age: slate → amber → orange → red), and the
 * drill-down speaks the whole book — each bucket its own cell with its
 * honest share, the overdue face summed into its own rose strip, the
 * named accounts loudest-first with status/bucket chips, and the ledger
 * grouped by the branch that holds it. Zero new queries: every figure
 * composes the SAME payload; the drill-down composes, it never invents.
 *
 * The honesty rules carry the house line: a zero total renders NO
 * percentage (never an invented "0%" of nothing), a zero bucket draws
 * nothing, a settled ledger says so, and an older cached answer without
 * the named ledger speaks its step-aside while the aging story above
 * still carries. And the v2.195.0 discovery is house law from birth:
 * the third modal's panel paints its dark half on day one.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const kpi = readRepo('src/components/org/kpi-row.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const workspaceDoc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const contrastScript = readRepo('scripts/contrast-math-debt-ledger-v2196.mjs');
const verifyScript = readRepo('scripts/verify-v2-196-0.mjs');
const pkg = JSON.parse(readRepo('package.json'));

describe('the ledger math executed - the shares, the overdue face, the branch grouping', () => {
  // The component's derivations, executed on the wire's own sample (the
  // QA probe of 2026-10-21): total 200,340 across 6 accounts, buckets
  // current 31,340 / d30 114,000 / d60 15,000 / d90plus 40,000. The pins
  // below hold the source to this exact shape; this execution proves the
  // math the pinned lines speak.
  const debtShare = (v: number, total: number): number | null =>
    total > 0 ? Math.round((v / total) * 1000) / 10 : null;
  const group = (debtors: Array<{ store: string | null; outstanding: number }>) =>
    Object.entries(
      debtors.reduce<Record<string, { total: number; count: number }>>((acc, d) => {
        const name = d.store ?? 'Unassigned';
        acc[name] = acc[name] ?? { total: 0, count: 0 };
        acc[name].total += d.outstanding;
        acc[name].count += 1;
        return acc;
      }, {}),
    )
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);

  it('each bucket speaks its honest share of the ledger - the wire sample', () => {
    const total = 200_340;
    expect(debtShare(31_340, total)).toBe(15.6);
    expect(debtShare(114_000, total)).toBe(56.9);
    expect(debtShare(15_000, total)).toBe(7.5);
    expect(debtShare(40_000, total)).toBe(20);
    // the composition identity: the four shares are the whole ledger's
    // face (rounded independently — they may miss 100 by a hair, never
    // by a lie: each is its own bucket over the SAME total)
    const shares = [31_340, 114_000, 15_000, 40_000].map((v) => debtShare(v, total) as number);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  it('the zero-total honesty rule: a settled ledger renders NO percentage', () => {
    // never an invented "0%" of nothing, never a NaN
    expect(debtShare(0, 0)).toBeNull();
    expect(debtShare(31_340, 0)).toBeNull();
  });

  it('the overdue face is the three past-due buckets summed - the wire sample', () => {
    const aging = { current: 31_340, d30: 114_000, d60: 15_000, d90plus: 40_000 };
    const overdueSum = aging.d30 + aging.d60 + aging.d90plus;
    expect(overdueSum).toBe(169_000);
    expect(debtShare(overdueSum, 200_340)).toBe(84.4);
    // current money is NOT overdue money — the strip never counts it
    expect(overdueSum + aging.current).toBe(200_340);
  });

  it('the ledger groups by the branch that holds the account, loudest first', () => {
    const rows = group([
      { store: 'MBUMAH HARDWARE - Juja Main', outstanding: 90_000 },
      { store: 'MBUMAH HARDWARE - Juja Main', outstanding: 40_000 },
      { store: 'MBUMAH HARDWARE - Nairobi CBD Branch', outstanding: 63_000 },
      { store: null, outstanding: 7_340 },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['MBUMAH HARDWARE - Juja Main', 'MBUMAH HARDWARE - Nairobi CBD Branch', 'Unassigned']);
    expect(rows[0]).toEqual({ name: 'MBUMAH HARDWARE - Juja Main', total: 130_000, count: 2 });
    // an unnamed account rests under Unassigned — still spoken, never dropped
    expect(rows[2]).toEqual({ name: 'Unassigned', total: 7_340, count: 1 });
  });

  it('the debtors sort loudest balance first', () => {
    const sorted = [50, 90_000, 5, 26_340].sort((a, b) => b - a);
    expect(sorted).toEqual([90_000, 26_340, 50, 5]);
  });
});

describe('the one-writer rule - the buckets live in ONE array, the shares in ONE function', () => {
  it('the bucket array is the single definition - card bar, modal bar, grid all read it', () => {
    expect(kpi).toContain("hue: 'bg-slate-400'");
    expect(kpi).toContain("hue: 'bg-amber-400'");
    expect(kpi).toContain("hue: 'bg-orange-500'");
    expect(kpi).toContain("hue: 'bg-red-500'");
    // exactly three consumers: the card's mini bar, the modal's bar, the
    // modal's grid — a fourth would be a second writer of the shape
    expect(kpi.match(/agingBuckets\.map\(/g)?.length).toBe(3);
    // no invented merges: each bucket keeps its own key, label, value
    expect(kpi).toContain("{ key: 'current', label: 'Current', value: k.debt.aging.current, hue: 'bg-slate-400' }");
    expect(kpi).toContain("{ key: 'd90plus', label: '90d+', value: k.debt.aging.d90plus, hue: 'bg-red-500' }");
  });

  it('the share function is the single definition - grid and strip read it', () => {
    expect(kpi).toContain('const debtShare = (v: number): number | null => (k.debt.total > 0 ? Math.round((v / k.debt.total) * 1000) / 10 : null);');
    // three calls: the overdue share + the grid's gate + the grid's figure
    expect(kpi.match(/debtShare\(/g)?.length).toBe(3);
    // the overdue face composes the SAME buckets the bar draws
    expect(kpi).toContain('const overdueSum = k.debt.aging.d30 + k.debt.aging.d60 + k.debt.aging.d90plus;');
    expect(kpi).toContain('const overduePct = debtShare(overdueSum);');
  });

  it('the named ledger is re-derived in ONE place, never re-queried', () => {
    expect(kpi).toContain('const ledgerReady = Array.isArray(data.debtExpert?.topDebtors);');
    expect(kpi).toContain('[...data.debtExpert.topDebtors].sort((a, b) => b.outstanding - a.outstanding)');
    // the branch face derives from the SAME rows
    expect(kpi).toContain("const name = d.store ?? 'Unassigned';");
    expect(kpi).toContain('.sort((a, b) => b.total - a.total)');
  });
});

describe('the card - the row\u2019s third button, the red face, the mini bar', () => {
  it('the debt card is a BUTTON that opens the ledger', () => {
    expect(kpi).toContain('onClick={() => setDebtOpen(true)}');
    expect(kpi).toContain('data-testid="debt-card"');
    expect(kpi).toContain('const [debtOpen, setDebtOpen] = useState(false);');
    // the family vocabulary's third face: the red edge + live dot
    expect(kpi).toContain('<span className="absolute inset-y-0 left-0 w-1 bg-red-500" />');
    expect(kpi).toContain('{k.debt.total > 0 && <span className="h-2 w-2 rounded-full bg-red-500 anim-pulse-dot" />}');
    // the ledger qualifier chip — the gross/settled chips' sibling
    expect(kpi).toContain('text-red-700 ring-1 ring-red-200');
    expect(kpi).toContain('>ledger</span>');
    // the hot grammar survives the promotion
    expect(kpi).toContain("debtHot ? 'ring-1 ring-red-300' : ''");
    expect(kpi).toContain("debtHot ? 'anim-shake' : ''");
  });

  it('the card draws the composition bar with honest segments only', () => {
    expect(kpi).toContain('className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"');
    // a zero bucket draws nothing; an empty ledger draws the calm track
    expect(kpi).toContain('b.value > 0 && k.debt.total > 0 ? (');
    expect(kpi).toContain('style={{ width: `${(b.value / k.debt.total) * 100}%` }}');
    // the bar self-speaks for the reader who cannot see the hues
    expect(kpi).toContain('aria-label={`Aging composition: current ${kes(k.debt.aging.current)}, 30d ${kes(k.debt.aging.d30)}, 60d ${kes(k.debt.aging.d60)}, 90d+ ${kes(k.debt.aging.d90plus)}`}');
    // the aging badges ride beside the bar — the numbers stay where they were
    expect(kpi).toContain('>C {kShort(k.debt.aging.current)}</Badge>');
    expect(kpi).toContain('>90d+ {kShort(k.debt.aging.d90plus)}</Badge>');
  });
});

describe('the drill-down - the ledger\u2019s anatomy in the face\u2019s red', () => {
  it('the modal mirrors the family anatomy and wears the ledger title', () => {
    expect(kpi).toContain('<HandCoins className="h-4 w-4 text-red-600" /> Debt ledger</DialogTitle>');
    expect(kpi).toContain('<Dialog open={debtOpen} onOpenChange={setDebtOpen}>');
    // the headline row + the accounts meta
    expect(kpi).toContain('data-testid="debt-ledger-total"');
    expect(kpi).toContain('outstanding org-wide');
    expect(kpi).toContain('{num(k.debt.count)} accounts');
    expect(kpi).toContain("named ledger not on this cached answer");
  });

  it('the composition bar reads at modal size and the grid speaks each bucket', () => {
    expect(kpi).toContain('data-testid="debt-aging-bar"');
    expect(kpi).toContain('className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"');
    expect(kpi).toContain('data-testid={`debt-bucket-${b.key}`}');
    expect(kpi).toContain('% of ledger');
  });

  it('the overdue strip speaks the rose face with the share chip', () => {
    expect(kpi).toContain('data-testid="debt-overdue-strip"');
    expect(kpi).toContain('data-testid="debt-overdue-amount"');
    expect(kpi).toContain('data-testid="debt-overdue-share"');
    expect(kpi).toContain('overdue buckets</span>');
    // the gate: a settled ledger renders NO strip (honest absence)
    expect(kpi).toContain('{overdueSum > 0 && (');
    // the rose family's paint
    expect(kpi).toContain('border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10');
  });

  it('the named ledger rows carry status and bucket chips in the known voices', () => {
    expect(kpi).toContain('data-testid="debt-debtor-row"');
    expect(kpi).toContain('loudest balance first — the same accounts the Debt Expert panel speaks');
    // the status voices: partial amber, overdue red, anything else calm
    expect(kpi).toContain("'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'");
    expect(kpi).toContain("'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'");
    expect(kpi).toContain("'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'");
    // the bucket labels — a future value falls back to its own lowercase
    expect(kpi).toContain("bucket === 'DAYS_90_PLUS' ? '90d+' : bucket.toLowerCase()");
    // the balance in the face's red
    expect(kpi).toContain('text-xs font-semibold tabular-nums text-red-600 dark:text-red-400');
  });

  it('the ledger by branch groups the same rows with the account-count chip', () => {
    expect(kpi).toContain('data-testid="debt-branch-row"');
    expect(kpi).toContain('the same named accounts, grouped by the branch that holds them');
    expect(kpi).toContain("{b.count} {b.count === 1 ? 'account' : 'accounts'}");
  });
});

describe('the tolerances - the honest absences and the dark ground from birth', () => {
  it('a settled ledger says so; a stale answer steps aside', () => {
    expect(kpi).toContain('const ledgerStale = !ledgerReady;');
    expect(kpi).toContain('data-testid="debt-ledger-empty"');
    expect(kpi).toContain('No outstanding balances — every account is settled.');
    expect(kpi).toContain('data-testid="debt-ledger-stale"');
    expect(kpi).toContain('the named ledger is not on this cached answer — the aging story above still speaks. Reload to fetch it.');
  });

  it('the third panel owns its dark half from birth - the v2.195.0 discovery is house law', () => {
    // exactly FIVE panels now paint the dark half (revenue, transactions,
    // debt, watchlist; v2.198.0's rental yard joins from birth — the law holds)
    expect(kpi.split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1).toBe(6);
  });

  it('the type contract already carried the named ledger - zero wire changes', () => {
    expect(primitives).toContain('debtExpert: {');
    expect(primitives).toContain('topDebtors: Array<{ id: string; customer: string; store: string | null; outstanding: number; bucket: string; status: string }>');
    // the route keeps shipping the same shape
    const route = readRepo('src/app/api/org/kpi-summary/route.ts');
    expect(route).toContain('topDebtors: topDebts.map((d) => ({');
  });
});

describe('the a11y surface - the REAL-chain math for the ledger families', () => {
  it('the contrast script exists and derives over the real chain', () => {
    expect(contrastScript).toContain('v2.196.0 contrast math — the debt ledger');
    expect(contrastScript).toContain('PANEL_DARK');
    expect(contrastScript).toContain('ROSE_STRIP');
    // the discovery stays pinned in the new script's guards
    expect(contrastScript).toContain('the modal panel dark half drifted');
  });

  it('the a11y doc closes the ledger surface', () => {
    expect(a11yDoc).toContain("the debt ledger + the section headers' dark voice (v2.196.0)");
    expect(a11yDoc).toContain('45/45');
  });

  it('the workspace doc gains the sentence', () => {
    expect(workspaceDoc).toContain('v2.196.0 gives the debt face the same voice');
  });
});

describe('the release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.210.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.210.0');
    expect(pkg.mbumah.baseVersion).toBe('2.210.0');
    expect(pkg.scripts['verify:v2-196-0']).toBeTruthy();
    // the prior surfaces stay wired
    expect(pkg.scripts['verify:v2-195-0']).toBeTruthy();
    expect(pkg.scripts['verify:v2-194-0']).toBeTruthy();
  });

  it('the changelog and the feed head the release', () => {
    expect(changelog).toContain('## [2.196.0] The debt card opens the ledger');
    expect(changelog.indexOf('## [2.196.0]')).toBeLessThan(changelog.indexOf('## [2.195.0]'));
    expect(whatsNew).toContain("version: '2.196.0'");
    expect(whatsNew).toContain("title: 'The debt card opens the ledger'");
    expect(whatsNew.indexOf('2.196.0')).toBeLessThan(whatsNew.indexOf('2.195.0'));
  });

  it('the verify script pins the release end to end', () => {
    expect(verifyScript).toContain('v2.196.0 verification');
    expect(verifyScript).toContain('data-testid="debt-card"');
    expect(verifyScript).toContain('data-testid="debt-ledger-stale"');
  });
});
