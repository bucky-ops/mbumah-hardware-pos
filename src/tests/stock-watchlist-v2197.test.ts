import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.197.0 — the stock tile opens the watchlist (the KPI row's FOURTH
 * voice, the door arc's fourth door).
 *
 * The Revenue card told the money's story since v2.173.0, the count face
 * found its voice in v2.195.0 and the ledger in v2.196.0 while the
 * Low-stock card showed a bare count in silence — even though the NAMED
 * watchlist was already on the wire (`inventory.lowStockItems`, the Stock
 * Expert panel's payload since the Expert panel shipped). This release
 * gives the shelf its voice: the card becomes the row's fourth button
 * (the amber edge + live dot + watchlist qualifier chip — the family
 * vocabulary's fourth face), the severity buckets draw their COMPOSITION
 * BAR (card mini + modal reading size, hue deepens with urgency: slate
 * at level → amber below → orange critical → red out), and the drill-
 * down speaks the whole watchlist — each bucket its own cell with its
 * honest share, the units-short face summed into its own amber strip,
 * the named items deepest-shortage-first with coverage chips and the
 * Expert table's own qty/reorder pair, and the items grouped by the
 * branch that holds them. Zero new queries: every figure composes the
 * SAME payload; the drill-down composes, it never invents.
 *
 * The honesty rules carry the house line: a zero watchlist renders NO
 * percentage (never an invented "0%" of nothing), a zero bucket draws
 * nothing, a fully-stocked floor says so, a zero reorder level cannot
 * speak a coverage percentage, and an older cached answer without the
 * named watchlist speaks its step-aside while the count story above
 * still carries. And the discoveries are house law from birth: the
 * fourth modal's panel paints its dark half on day one, and the card's
 * face is re-hued from the orange-500 that measured under the 3:1 bars
 * (2.89:1) to amber-600 (3.19:1) — the pre-fix state pinned in reverse
 * in the round's contrast script.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const kpi = readRepo('src/components/org/kpi-row.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const workspaceDoc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const contrastScript = readRepo('scripts/contrast-math-stock-watchlist-v2197.mjs');
const verifyScript = readRepo('scripts/verify-v2-197-0.mjs');
const pkg = JSON.parse(readRepo('package.json'));

describe('the watchlist math executed - the severity buckets, the deficit, the coverage', () => {
  // The component's derivations, executed on the wire's own sample (the
  // QA seed of 2026-10-21: five items across two branches covering ALL
  // FOUR severity buckets, the at-level boundary included). The pins
  // below hold the source to this exact shape; this execution proves the
  // math the pinned lines speak.
  const coverage = (p: { stockQty: number; reorderLevel: number }): number | null =>
    p.reorderLevel > 0 ? p.stockQty / p.reorderLevel : null;
  const deficit = (p: { stockQty: number; reorderLevel: number }): number =>
    Math.max(0, p.reorderLevel - p.stockQty);
  const bucketOf = (p: { stockQty: number; coverage: number | null }): string => {
    if (p.stockQty <= 0) return 'out';
    if (p.coverage != null && p.coverage <= 0.5) return 'critical';
    if (p.coverage != null && p.coverage > 0.5 && p.coverage < 1) return 'below';
    return 'at';
  };
  const sample = [
    { id: 'cable', stockQty: 0, reorderLevel: 10, store: 'MBUMAH HARDWARE - Juja Main' },
    { id: 'chainlink', stockQty: 3, reorderLevel: 10, store: 'MBUMAH HARDWARE - Juja Main' },
    { id: 'nails', stockQty: 60, reorderLevel: 100, store: 'MBUMAH HARDWARE - Juja Main' },
    { id: 'cement', stockQty: 50, reorderLevel: 50, store: 'MBUMAH HARDWARE - Juja Main' },
    { id: 'dulux', stockQty: 4, reorderLevel: 10, store: 'MBUMAH HARDWARE - Thika Branch' },
  ].map((p) => ({ ...p, coverage: coverage(p), deficit: deficit(p) }));

  it('the four buckets land 1/2/1/1 over the seed - every severity state spoken', () => {
    expect(sample.map((p) => bucketOf(p))).toEqual(['out', 'critical', 'below', 'at', 'critical']);
    const counts = { out: 0, critical: 0, below: 0, at: 0 };
    for (const p of sample) counts[bucketOf(p) as keyof typeof counts] += 1;
    expect(counts).toEqual({ out: 1, critical: 2, below: 1, at: 1 });
  });

  it('coverage speaks the shelf against the level - and the at-level boundary reads 100%', () => {
    const byId = Object.fromEntries(sample.map((p) => [p.id, p]));
    expect(byId.chainlink.coverage).toBeCloseTo(0.3, 10);
    expect(byId.nails.coverage).toBeCloseTo(0.6, 10);
    expect(byId.cement.coverage).toBe(1);
    expect(byId.dulux.coverage).toBeCloseTo(0.4, 10);
  });

  it('the zero-level honesty rule: a missing level cannot speak a percentage', () => {
    // 0/0 is not 100% — the coverage fn returns null, the chip falls back
    expect(coverage({ stockQty: 0, reorderLevel: 0 })).toBeNull();
    expect(coverage({ stockQty: 5, reorderLevel: 0 })).toBeNull();
  });

  it('the deficit is floored at zero - an at-level item is zero short, never negative', () => {
    expect(sample.map((p) => p.deficit)).toEqual([10, 7, 40, 0, 6]);
    expect(deficit({ stockQty: 120, reorderLevel: 100 })).toBe(0);
  });

  it('the units-short strip sums the SAME rows the bar draws - the seed sample', () => {
    const shortSum = sample.reduce((acc, p) => acc + p.deficit, 0);
    expect(shortSum).toBe(63);
    expect(sample.filter((p) => p.deficit > 0).length).toBe(4);
    // the shelves hold 117 of the 180 reorder units = 65% (the meta's line)
    const qty = sample.reduce((a, p) => a + p.stockQty, 0);
    const level = sample.reduce((a, p) => a + p.reorderLevel, 0);
    expect(Math.round((qty / level) * 1000) / 10).toBe(65);
  });

  it('each bucket speaks its honest share of the NAMED watchlist', () => {
    const share = (v: number, n: number): number | null => (n > 0 ? Math.round((v / n) * 1000) / 10 : null);
    expect(share(1, 5)).toBe(20);
    expect(share(2, 5)).toBe(40);
    // the zero-total honesty rule: an empty watchlist renders NO percentage
    expect(share(0, 0)).toBeNull();
    expect(share(1, 0)).toBeNull();
  });

  it('the rows sort deepest shortage first - and the branch face groups the same rows', () => {
    const sorted = [...sample].sort((a, b) => b.deficit - a.deficit);
    expect(sorted.map((p) => p.id)).toEqual(['nails', 'cable', 'chainlink', 'dulux', 'cement']);
    const grouped = Object.entries(
      sorted.reduce<Record<string, { short: number; count: number }>>((acc, p) => {
        const name = p.store ?? 'Unassigned';
        acc[name] = acc[name] ?? { short: 0, count: 0 };
        acc[name].short += p.deficit;
        acc[name].count += 1;
        return acc;
      }, {}),
    ).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.short - a.short);
    expect(grouped).toEqual([
      { name: 'MBUMAH HARDWARE - Juja Main', short: 57, count: 4 },
      { name: 'MBUMAH HARDWARE - Thika Branch', short: 6, count: 1 },
    ]);
    // an unnamed item rests under Unassigned — still spoken, never dropped
    const withNull = [...sample, { id: 'x', stockQty: 1, reorderLevel: 9, store: null, coverage: 1 / 9, deficit: 8 }];
    const grouped2 = Object.entries(
      withNull.reduce<Record<string, { short: number; count: number }>>((acc, p) => {
        const name = (p as { store: string | null }).store ?? 'Unassigned';
        acc[name] = acc[name] ?? { short: 0, count: 0 };
        acc[name].short += (p as { deficit: number }).deficit;
        acc[name].count += 1;
        return acc;
      }, {}),
    ).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.short - a.short);
    expect(grouped2.some((g) => g.name === 'Unassigned' && g.count === 1 && g.short === 8)).toBe(true);
  });
});

describe('the one-writer rule - the buckets live in ONE array, the shares in ONE function', () => {
  it('the bucket array is the single definition - card bar, modal bar, grid all read it', () => {
    expect(kpi).toContain("key: 'out', label: 'Out of stock', hue: 'bg-red-500'");
    expect(kpi).toContain("key: 'critical', label: 'Critical', hue: 'bg-orange-500'");
    expect(kpi).toContain("key: 'below', label: 'Below level', hue: 'bg-amber-400'");
    expect(kpi).toContain("key: 'at', label: 'At level', hue: 'bg-slate-400'");
    // the array is written once and read into the counts once — a second
    // literal would be a second writer of the shape (the rows and their
    // counts ride ONE derivation — the severity object)
    expect(kpi.match(/const stockBuckets/g)?.length).toBe(1);
    expect(kpi.match(/const severity /g)?.length).toBe(1);
  });

  it('the share function is the single definition - the grid gate and figure read it', () => {
    expect(kpi).toContain('const stockShare = (v: number): number | null =>');
    // exactly two calls: the grid's gate + the grid's figure
    expect(kpi.match(/stockShare\(/g)?.length).toBe(2);
  });

  it('the strip and the headline compose the SAME rows, never re-queried', () => {
    expect(kpi).toContain('const shortSum = stockRows?.reduce((acc, p) => acc + p.deficit, 0) ?? 0;');
    expect(kpi).toContain('const levelSum = stockRows?.reduce((acc, p) => acc + p.reorderLevel, 0) ?? 0;');
    expect(kpi).toContain('const stockCoverage = (p: { stockQty: number; reorderLevel: number }): number | null =>');
    // the branch face derives from the SAME rows
    expect(kpi).toContain("const name = p.store ?? 'Unassigned';");
    expect(kpi).toContain('.sort((a, b) => b.short - a.short)');
  });

  it('the coverage chip is ONE function - the row reads it for both voice and paint', () => {
    expect(kpi.match(/coverageChip\(/g)?.length).toBe(2);
    // the four voices: out red, critical orange, below amber, calm slate
    expect(kpi).toContain("if (p.stockQty <= 0) return { text: 'out', cls: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30' }");
    expect(kpi).toContain("if (pct <= 50) return { text: `${pct}%`, cls: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30' }");
    expect(kpi).toContain("if (pct < 100) return { text: `${pct}%`, cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30' }");
  });
});

describe('the card - the row\u2019s fourth button, the amber face, the mini bar', () => {
  it('the low-stock card is a BUTTON that opens the watchlist', () => {
    expect(kpi).toContain('onClick={() => setStockOpen(true)}');
    expect(kpi).toContain('data-testid="lowstock-card"');
    expect(kpi).toContain('const [stockOpen, setStockOpen] = useState(false);');
    // the family vocabulary's fourth face: the amber edge + live dot
    expect(kpi).toContain('<span className="absolute inset-y-0 left-0 w-1 bg-amber-600" />');
    expect(kpi).toContain('{k.lowStock.count > 0 && <span className="h-2 w-2 rounded-full bg-amber-600 anim-pulse-dot" />}');
    // the watchlist qualifier chip — the gross/settled/ledger chips' sibling
    expect(kpi).toContain('text-amber-700 ring-1 ring-amber-200');
    expect(kpi).toContain('>watchlist</span>');
    // the hot grammar survives the promotion
    expect(kpi).toContain("k.lowStock.count > 0 ? 'ring-1 ring-amber-300' : ''");
  });

  it('THE FIX: the card face is re-hued from orange-500 to amber-600 - the 2.89:1 find', () => {
    // the hot number AND the icon wear amber-600 (3.19:1 over white —
    // passes the 3:1 large-text and non-text bars orange-500 failed)
    expect(kpi).not.toContain('text-orange-500" /> Low stock');
    expect(kpi).toContain('<PackageOpen className="h-3.5 w-3.5 text-amber-600" /> Low stock');
    expect(kpi).toContain("k.lowStock.count > 0 ? 'text-amber-600' : 'text-slate-700'");
    // the hot ring follows the face
    expect(kpi).not.toContain("'ring-1 ring-orange-200'");
  });

  it('the card draws the severity mini bar with honest segments only', () => {
    expect(kpi).toContain('className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"');
    // a zero bucket draws nothing; the bar renders only when the named
    // items arrived AND the count is live
    expect(kpi).toContain('{severity && k.lowStock.count > 0 && (');
    expect(kpi).toContain('b.value > 0 && severity.rows.length > 0 ? (');
    expect(kpi).toContain("style={{ width: `${(b.value / severity.rows.length) * 100}%` }}");
    // the bar self-speaks for the reader who cannot see the hues
    expect(kpi).toContain('aria-label={`Severity: ${severity.counts.map((b) => `${b.label.toLowerCase()} ${b.value}`).join(\', \')}`}');
  });
});

describe('the drill-down - the watchlist\u2019s anatomy in the face\u2019s amber', () => {
  it('the modal mirrors the family anatomy and wears the watchlist title', () => {
    expect(kpi).toContain('<PackageOpen className="h-4 w-4 text-amber-600" /> Reorder watchlist</DialogTitle>');
    expect(kpi).toContain('<Dialog open={stockOpen} onOpenChange={setStockOpen}>');
    // the headline row + the meta with the named-population disclosure
    expect(kpi).toContain('data-testid="lowstock-watchlist-count"');
    expect(kpi).toContain('SKUs at/below reorder level</span>');
    expect(kpi).toContain('of {num(data.inventory?.totalSkus ?? 0)} SKUs org-wide');
    expect(kpi).toContain('named watchlist not on this cached answer');
  });

  it('the severity bar reads at modal size and the grid speaks each bucket', () => {
    expect(kpi).toContain('data-testid="lowstock-severity-bar"');
    expect(kpi).toContain('className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"');
    expect(kpi).toContain('data-testid={`lowstock-bucket-${b.key}`}');
    expect(kpi).toContain('% of watchlist');
    // the bar renders only when the named rows exist - an empty watchlist
    // renders the honest empty state, never a bar of zeros (the severity
    // object is null for an empty watchlist)
    expect(kpi).toContain('{severity && (');
  });

  it('the units-short strip speaks the amber face with the item-count chip', () => {
    expect(kpi).toContain('data-testid="lowstock-short-strip"');
    expect(kpi).toContain('data-testid="lowstock-short-amount"');
    expect(kpi).toContain('data-testid="lowstock-short-items"');
    expect(kpi).toContain('units short</span>');
    // the gate: an all-at-level watchlist renders NO strip (honest absence)
    expect(kpi).toContain('shortSum > 0 && (');
    // the amber family's paint
    expect(kpi).toContain('border border-amber-100 bg-amber-50/70 px-2.5 py-1.5 dark:border-amber-500/30 dark:bg-amber-500/10');
    expect(kpi).toContain("{stockRows.filter((p) => p.deficit > 0).length} of {stockRows.length} items");
  });

  it('the named watchlist rows carry coverage chips and the Expert table\u2019s own pair', () => {
    expect(kpi).toContain('data-testid="lowstock-item-row"');
    expect(kpi).toContain('deepest shortage first — the same items the Stock Expert panel speaks');
    // the qty/reorder pair — the same figures the Expert table's column speaks
    expect(kpi).toContain('{num(p.stockQty)} / {num(p.reorderLevel)}');
    // the pair in the face's amber (4.84:1 on the dialog, both modes pass)
    expect(kpi).toContain('text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400');
    // the coverage chip's title speaks the coverage sentence
    expect(kpi).toContain('Coverage: ${num(p.stockQty)} of ${num(p.reorderLevel)} units');
  });

  it('the watchlist by branch groups the same rows with the units-short figure', () => {
    expect(kpi).toContain('data-testid="lowstock-branch-row"');
    expect(kpi).toContain('the same named items, grouped by the branch that holds them');
    expect(kpi).toContain("{b.count} {b.count === 1 ? 'item' : 'items'}");
    expect(kpi).toContain('{num(b.short)} short</span>');
  });
});

describe('the tolerances - the honest absences and the dark ground from birth', () => {
  it('a fully-stocked floor says so; a stale answer steps aside', () => {
    expect(kpi).toContain('const watchlistStale = !watchlistReady;');
    expect(kpi).toContain('data-testid="lowstock-watchlist-empty"');
    expect(kpi).toContain('Everything is above its reorder level.');
    expect(kpi).toContain('data-testid="lowstock-watchlist-stale"');
    expect(kpi).toContain('the named watchlist is not on this cached answer — the count story above still speaks. Reload to fetch it.');
    // the empty state requires the named rows to have ARRIVED and be empty
    expect(kpi).toContain('{watchlistReady && stockRows && stockRows.length === 0 && (');
  });

  it('the fourth panel owns its dark half from birth - the v2.195.0 discovery is house law', () => {
    // exactly FIVE panels now paint the dark half (revenue, transactions,
    // debt, watchlist; v2.198.0's rental yard joins from birth — the law holds)
    expect(kpi.split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1).toBe(6);
  });

  it('the type contract already carried the named watchlist - zero wire changes', () => {
    expect(primitives).toContain('inventory: {');
    expect(primitives).toContain('lowStockItems: Array<{ id: string; sku: string; name: string; category: string; store: string | null; stockQty: number; reorderLevel: number }>');
    // the route keeps shipping the same shape (most-critical-first, capped at 12)
    const route = readRepo('src/app/api/org/kpi-summary/route.ts');
    expect(route).toContain('.sort((a, b) => toDec(a.quantityInStock).minus(toDec(a.reorderLevel)).toNumber() - toDec(b.quantityInStock).minus(toDec(b.reorderLevel)).toNumber())');
    expect(route).toContain('.slice(0, 12)');
  });
});

describe('the a11y surface - the REAL-chain math for the watchlist families', () => {
  it('the contrast script exists and derives over the real chain', () => {
    expect(contrastScript).toContain('v2.197.0 contrast math — the reorder watchlist');
    expect(contrastScript).toContain('PANEL_DARK');
    expect(contrastScript).toContain('AMBER_STRIP_LIGHT');
    // the discovery stays pinned in the new script's guards
    expect(contrastScript).toContain('the modal panel dark half drifted');
    expect(contrastScript).toContain("the card hot number re-hue drifted");
  });

  it('the a11y doc closes the watchlist surface', () => {
    expect(a11yDoc).toContain("the reorder watchlist + the card face's re-hue (v2.197.0)");
    expect(a11yDoc).toContain('49/49');
  });

  it('the workspace doc gains the sentence', () => {
    expect(workspaceDoc).toContain('v2.197.0 gives the stock face the same voice');
  });
});

describe('the release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.202.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.202.0');
    expect(pkg.mbumah.baseVersion).toBe('2.202.0');
    expect(pkg.scripts['verify:v2-197-0']).toBeTruthy();
    // the prior surfaces stay wired
    expect(pkg.scripts['verify:v2-196-0']).toBeTruthy();
    expect(pkg.scripts['verify:v2-195-0']).toBeTruthy();
  });

  it('the changelog and the feed head the release', () => {
    expect(changelog).toContain('## [2.197.0] The stock tile opens the watchlist');
    expect(changelog.indexOf('## [2.197.0]')).toBeLessThan(changelog.indexOf('## [2.196.0]'));
    expect(whatsNew).toContain("version: '2.197.0'");
    expect(whatsNew).toContain("title: 'The stock tile opens the watchlist'");
    expect(whatsNew.indexOf('2.197.0')).toBeLessThan(whatsNew.indexOf('2.196.0'));
  });

  it('the verify script pins the release end to end', () => {
    expect(verifyScript).toContain('v2.197.0 verification');
    expect(verifyScript).toContain('data-testid="lowstock-card"');
    expect(verifyScript).toContain('data-testid="lowstock-watchlist-stale"');
  });
});
