import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.198.0 — the overdue tile opens the yard (the KPI row's FIFTH voice,
 * the door arc's LAST tile).
 *
 * The Revenue card told the money's story since v2.173.0, the count face
 * found its week in v2.195.0, the ledger opened in v2.196.0 and the shelf
 * in v2.197.0 while the Overdue card showed a bare count in silence —
 * even though the NAMED rental roster was already on the wire
 * (`rentals.items`, the Expert panel's ledger payload since the Expert
 * panel shipped: item, store, customer, ratePerDay, deposit, status and
 * BOTH dates). This release gives the yard the row's fifth voice: the
 * card becomes the fifth button (the rose edge + live dot + roster
 * qualifier chip — the family vocabulary's fifth face), the breach ages
 * draw their COMPOSITION BAR (card mini + modal reading size, hue
 * deepens with age: amber ≤7d → orange 8-30d → rose 31-60d → red 60d+),
 * and the drill-down speaks the whole yard — each bucket its own cell
 * with its honest share, the per-day exposure summed into its own rose
 * strip, the overdue rentals loudest-breach-first with status/days chips
 * and the Expert ledger's rate voice, the active rentals as the yard's
 * calm half (soonest return first, the honest "past return" when the
 * date passed while the status stayed ACTIVE), and the roster grouped by
 * the branch that holds it. Zero new queries: every figure composes the
 * SAME payload; the drill-down composes, it never invents.
 *
 * The honesty rules carry the house line: a clean yard renders NO
 * percentage (never an invented "0%" of nothing), a zero bucket draws
 * nothing, a clean yard says so, a zero-day breach speaks "past return"
 * (never a fabricated "0d past"), an ACTIVE row never speaks a negative
 * "due in -1d" (the status governs the count, the date governs the
 * voice), and an older cached answer without the roster speaks its
 * step-aside while the count story above still carries. And the
 * discoveries are house law from birth: the fifth modal's panel paints
 * its dark half on day one, and the Expert ledger's OVERDUE badge
 * re-voices from the red-600-on-red-50 that measured 4.36:1 — under the
 * 4.5 bar its 10px text must meet — to red-700 (5.88:1), the pre-fix
 * state pinned in reverse in the round's contrast script.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const kpi = readRepo('src/components/org/kpi-row.tsx');
const experts = readRepo('src/components/org/experts.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const workspaceDoc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const contrastScript = readRepo('scripts/contrast-math-rental-yard-v2198.mjs');
const verifyScript = readRepo('scripts/verify-v2-198-0.mjs');
const pkg = JSON.parse(readRepo('package.json'));

describe('the yard math executed - the breach buckets, the exposure, the branch grouping', () => {
  // The component's derivations, executed on the wire's own sample (the
  // QA seed of 2026-10-21 with TODAY pinned: four overdue rentals across
  // three branches covering three of the four breach buckets, plus the
  // honest active-past-return row). The pins below hold the source to
  // this exact shape; this execution proves the math the pinned lines
  // speak.
  const TODAY = new Date('2026-10-21T00:00:00');
  const DAY_MS = 86_400_000;
  const startOfLocalDay = (d: Date): number => {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c.getTime();
  };
  const todayStart = startOfLocalDay(TODAY);
  const daysPast = (iso: string): number => Math.max(0, Math.floor((todayStart - startOfLocalDay(new Date(iso))) / DAY_MS));
  const daysUntil = (iso: string): number => Math.ceil((startOfLocalDay(new Date(iso)) - todayStart) / DAY_MS);
  const bucketOf = (days: number): string => (days <= 7 ? 'd7' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : 'd60plus');
  const sample = [
    { id: 'vibrator', customer: 'Samuel Mwangi', store: 'MBUMAH HARDWARE - Nairobi CBD Branch', ratePerDay: 1200, status: 'OVERDUE', expectedReturnDate: '2026-08-21T00:00:00.000Z' },
    { id: 'scaffolding-thika', customer: 'Fatima Hassan', store: 'MBUMAH HARDWARE - Thika Branch', ratePerDay: 800, status: 'OVERDUE', expectedReturnDate: '2026-09-26T00:00:00.000Z' },
    { id: 'scaffolding-juja', customer: 'Akinyi Builders Ltd', store: 'MBUMAH HARDWARE - Juja Main', ratePerDay: 1500, status: 'OVERDUE', expectedReturnDate: '2026-10-12T00:00:00.000Z' },
    { id: 'mixer', customer: 'Mary Njeri', store: 'MBUMAH HARDWARE - Nairobi CBD Branch', ratePerDay: 2500, status: 'OVERDUE', expectedReturnDate: '2026-10-18T00:00:00.000Z' },
    { id: 'mixer-active', customer: 'Peter Odhiambo', store: 'MBUMAH HARDWARE - Juja Main', ratePerDay: 3000, status: 'ACTIVE', expectedReturnDate: '2026-10-20T00:00:00.000Z' },
  ].map((r) => ({ ...r, days: daysPast(r.expectedReturnDate), due: daysUntil(r.expectedReturnDate) }));

  it('the calendar-day math speaks whole days - the seed ages land exactly', () => {
    const byId = Object.fromEntries(sample.map((r) => [r.id, r]));
    expect(byId.vibrator.days).toBe(61);
    expect(byId['scaffolding-thika'].days).toBe(25);
    expect(byId['scaffolding-juja'].days).toBe(9);
    expect(byId.mixer.days).toBe(3);
    // the active row's date passed yesterday - the signed math speaks -1,
    // the chip falls back to the honest "past return"
    expect(byId['mixer-active'].due).toBe(-1);
    expect(byId['mixer-active'].days).toBe(1);
  });

  it('the breach buckets land 1/2/0/1 over the seed - every age spoken', () => {
    const overdue = sample.filter((r) => r.status === 'OVERDUE');
    expect(overdue.map((r) => bucketOf(r.days))).toEqual(['d60plus', 'd30', 'd30', 'd7']);
    const counts = { d7: 0, d30: 0, d60: 0, d60plus: 0 };
    for (const r of overdue) counts[bucketOf(r.days) as keyof typeof counts] += 1;
    expect(counts).toEqual({ d7: 1, d30: 2, d60: 0, d60plus: 1 });
  });

  it('the floored-at-zero rule: a future date is not negative overdue', () => {
    expect(daysPast('2027-01-01T00:00:00.000Z')).toBe(0);
    expect(daysPast('2026-10-21T00:00:00.000Z')).toBe(0);
  });

  it('the rows sort loudest breach first, then the costlier rate', () => {
    const sorted = [...sample.filter((r) => r.status === 'OVERDUE')].sort((a, b) => b.days - a.days || b.ratePerDay - a.ratePerDay);
    expect(sorted.map((r) => r.id)).toEqual(['vibrator', 'scaffolding-thika', 'scaffolding-juja', 'mixer']);
    const tie = [
      { id: 'a', days: 9, ratePerDay: 1000 },
      { id: 'b', days: 9, ratePerDay: 2500 },
    ].sort((x, y) => y.days - x.days || y.ratePerDay - x.ratePerDay);
    expect(tie.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('the per-day exposure sums the SAME rows the bar draws - the seed sample', () => {
    const overdue = sample.filter((r) => r.status === 'OVERDUE');
    const exposure = overdue.reduce((acc, r) => acc + r.ratePerDay, 0);
    expect(exposure).toBe(6000);
    // the active row never feeds the exposure face
    expect(sample.filter((r) => r.status === 'ACTIVE').reduce((acc, r) => acc + r.ratePerDay, 0)).toBe(3000);
  });

  it('each bucket speaks its honest share of the NAMED roster', () => {
    const share = (v: number, n: number): number | null => (n > 0 ? Math.round((v / n) * 1000) / 10 : null);
    expect(share(1, 4)).toBe(25);
    expect(share(2, 4)).toBe(50);
    // the zero-total honesty rule: an empty roster renders NO percentage
    expect(share(0, 0)).toBeNull();
    expect(share(1, 0)).toBeNull();
  });

  it('the yard groups by the branch that holds the rental, loudest exposure first', () => {
    const overdue = sample.filter((r) => r.status === 'OVERDUE');
    const grouped = Object.entries(
      overdue.reduce<Record<string, { perDay: number; count: number }>>((acc, r) => {
        const name = r.store ?? 'Unassigned';
        acc[name] = acc[name] ?? { perDay: 0, count: 0 };
        acc[name].perDay += r.ratePerDay;
        acc[name].count += 1;
        return acc;
      }, {}),
    ).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.perDay - a.perDay);
    expect(grouped).toEqual([
      { name: 'MBUMAH HARDWARE - Nairobi CBD Branch', perDay: 3700, count: 2 },
      { name: 'MBUMAH HARDWARE - Juja Main', perDay: 1500, count: 1 },
      { name: 'MBUMAH HARDWARE - Thika Branch', perDay: 800, count: 1 },
    ]);
    // an unnamed rental rests under Unassigned — still spoken, never dropped
    const withNull = [...overdue, { id: 'x', store: null, ratePerDay: 500, days: 2, status: 'OVERDUE' }];
    const grouped2 = Object.entries(
      withNull.reduce<Record<string, { perDay: number; count: number }>>((acc, r) => {
        const name = (r as { store: string | null }).store ?? 'Unassigned';
        acc[name] = acc[name] ?? { perDay: 0, count: 0 };
        acc[name].perDay += (r as { ratePerDay: number }).ratePerDay;
        acc[name].count += 1;
        return acc;
      }, {}),
    ).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.perDay - a.perDay);
    expect(grouped2.some((g) => g.name === 'Unassigned' && g.count === 1 && g.perDay === 500)).toBe(true);
  });

  it('the due voice is honest - an ACTIVE row never speaks a negative "due in -1d"', () => {
    const dueVoice = (r: { status: string; days: number; due: number }): string => {
      if (r.status === 'OVERDUE') return r.days > 0 ? `${r.days}d past` : 'past return';
      return r.due > 0 ? `due in ${r.due}d` : r.due === 0 ? 'due today' : 'past return';
    };
    const byId = Object.fromEntries(sample.map((r) => [r.id, r]));
    expect(dueVoice(byId['mixer-active'])).toBe('past return');
    expect(dueVoice({ status: 'ACTIVE', days: 0, due: 3 })).toBe('due in 3d');
    expect(dueVoice({ status: 'ACTIVE', days: 0, due: 0 })).toBe('due today');
    expect(dueVoice({ status: 'OVERDUE', days: 0, due: 0 })).toBe('past return');
    expect(dueVoice({ status: 'OVERDUE', days: 61, due: -61 })).toBe('61d past');
  });
});

describe('the one-writer rule - the buckets live in ONE array, the shares in ONE function', () => {
  it('the bucket array is the single definition - card bar, modal bar, grid all read it', () => {
    expect(kpi).toContain("key: 'd7', label: '≤7d', hue: 'bg-amber-400'");
    expect(kpi).toContain("key: 'd30', label: '8-30d', hue: 'bg-orange-500'");
    expect(kpi).toContain("key: 'd60', label: '31-60d', hue: 'bg-rose-500'");
    expect(kpi).toContain("key: 'd60plus', label: '60d+', hue: 'bg-red-500'");
    // the array is written once and read into the counts once — a second
    // literal would be a second writer of the shape (the rows and their
    // counts ride ONE derivation — the yardSev object)
    expect(kpi.match(/const yardBuckets/g)?.length).toBe(1);
    expect(kpi.match(/const yardSev /g)?.length).toBe(1);
  });

  it('the share function is the single definition - the grid gate and figure read it', () => {
    expect(kpi).toContain('const yardShare = (v: number): number | null =>');
    // exactly two calls: the grid's gate + the grid's figure
    expect(kpi.match(/yardShare\(/g)?.length).toBe(2);
  });

  it('the strip and the sort compose the SAME rows, never re-queried', () => {
    expect(kpi).toContain('const exposurePerDay = overdueRows?.reduce((acc, r) => acc + r.ratePerDay, 0) ?? 0;');
    expect(kpi).toContain("const name = r.store ?? 'Unassigned';");
    expect(kpi).toContain('.sort((a, b) => b.perDay - a.perDay)');
    // the day math lives in ONE pair of functions
    expect(kpi.match(/const daysPast /g)?.length).toBe(1);
    expect(kpi.match(/const daysUntil /g)?.length).toBe(1);
  });

  it('the chips are single functions - status and days each one writer', () => {
    expect(kpi.match(/rentalStatusChip\(/g)?.length).toBe(2);
    expect(kpi.match(/yardDaysChip\(/g)?.length).toBe(4);
    // the status voices: overdue red, active emerald, else calm slate
    expect(kpi).toContain("'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'");
    expect(kpi).toContain("'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'");
  });
});

describe('the card - the row\u2019s fifth button, the rose face, the mini bar', () => {
  it('the overdue card is a BUTTON that opens the yard', () => {
    expect(kpi).toContain('onClick={() => setYardOpen(true)}');
    expect(kpi).toContain('data-testid="overdue-card"');
    expect(kpi).toContain('const [yardOpen, setYardOpen] = useState(false);');
    // the family vocabulary's fifth face: the rose edge + live dot
    expect(kpi).toContain('<span className="absolute inset-y-0 left-0 w-1 bg-rose-600" />');
    expect(kpi).toContain('{k.overdueRentals.count > 0 && <span className="h-2 w-2 rounded-full bg-rose-600 anim-pulse-dot" />}');
    // the roster qualifier chip — the gross/settled/ledger/watchlist chips' sibling
    expect(kpi).toContain('text-rose-700 ring-1 ring-rose-200');
    expect(kpi).toContain('>roster</span>');
    // the hot grammar survives the promotion
    expect(kpi).toContain("k.overdueRentals.count > 0 ? 'ring-1 ring-rose-300' : ''");
  });

  it('the card face wears rose-600 - the fifth hue that never merges with debt\u2019s red', () => {
    expect(kpi).toContain('<Clock3 className="h-3.5 w-3.5 text-rose-600" /> Overdue');
    expect(kpi).toContain("k.overdueRentals.count > 0 ? 'text-rose-600' : 'text-slate-700'");
    // the old red face is gone from the card
    expect(kpi).not.toContain('<Clock3 className="h-3.5 w-3.5 text-red-500" /> Overdue');
    expect(kpi).not.toContain("'ring-1 ring-red-200'");
  });

  it('the card draws the breach-age mini bar with honest segments only', () => {
    expect(kpi).toContain('className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"');
    // a zero bucket draws nothing; the bar renders only when the named
    // rows arrived AND the count is live
    expect(kpi).toContain('{yardSev && k.overdueRentals.count > 0 && (');
    expect(kpi).toContain('b.value > 0 && yardSev.rows.length > 0 ? (');
    expect(kpi).toContain("style={{ width: `${(b.value / yardSev.rows.length) * 100}%` }}");
    // the bar self-speaks for the reader who cannot see the hues
    expect(kpi).toContain('aria-label={`Breach ages: ${yardSev.counts.map((b) => `${b.label} ${b.value}`).join(\', \')}`}');
  });
});

describe('the drill-down - the yard\u2019s anatomy in the face\u2019s rose', () => {
  it('the modal mirrors the family anatomy and wears the yard title', () => {
    expect(kpi).toContain('<Clock3 className="h-4 w-4 text-rose-600" /> The rental yard</DialogTitle>');
    expect(kpi).toContain('<Dialog open={yardOpen} onOpenChange={setYardOpen}>');
    // the headline row + the meta with the named-population disclosure
    expect(kpi).toContain('data-testid="rental-yard-count"');
    expect(kpi).toContain('rentals past return</span>');
    expect(kpi).toContain('{num(data.rentals?.active ?? 0)} active also on the yard');
    expect(kpi).toContain('roster not on this cached answer');
  });

  it('the breach-age bar reads at modal size and the grid speaks each bucket', () => {
    expect(kpi).toContain('data-testid="rental-days-bar"');
    expect(kpi).toContain('className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"');
    expect(kpi).toContain('data-testid={`rental-bucket-${b.key}`}');
    expect(kpi).toContain('% of overdue');
    // the bar renders only when the named rows exist - a clean yard
    // renders the honest clear note, never a bar of zeros
    expect(kpi).toContain('{yardSev && (');
  });

  it('the exposure strip speaks the rose face with the rental-count chip', () => {
    expect(kpi).toContain('data-testid="rental-exposure-strip"');
    expect(kpi).toContain('data-testid="rental-exposure-amount"');
    expect(kpi).toContain('data-testid="rental-exposure-rentals"');
    expect(kpi).toContain('per-day exposure</span>');
    // the gate: a clean yard renders NO strip (honest absence)
    expect(kpi).toContain('exposurePerDay > 0 && (');
    // the rose family's paint
    expect(kpi).toContain('border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10');
    expect(kpi).toContain("across {overdueRows.length} {overdueRows.length === 1 ? 'rental' : 'rentals'}");
  });

  it('the named roster rows carry status chips, days chips and the Expert rate', () => {
    expect(kpi).toContain('data-testid="rental-overdue-row"');
    expect(kpi).toContain('deepest breach first — the same rentals the Expert ledger speaks');
    // the rate/day — the same figure the Expert table's column speaks
    expect(kpi).toContain('{kes(r.ratePerDay)}/d');
    // the rate in the face's rose
    expect(kpi).toContain('text-xs font-semibold tabular-nums text-rose-700 dark:text-rose-400');
    // the days chip's title speaks the breach sentence
    expect(kpi).toContain('past the expected return of ${r.expectedReturnDate.slice(0, 10)}');
  });

  it('the active half speaks soonest-return-first with the honest due voice', () => {
    expect(kpi).toContain('data-testid="rental-active-row"');
    expect(kpi).toContain('soonest return first — still out, not yet past return');
    expect(kpi).toContain('Past its expected return — the status still reads active');
  });

  it('the yard by branch groups the same rows with the exposure figure', () => {
    expect(kpi).toContain('data-testid="rental-branch-row"');
    expect(kpi).toContain('the same overdue rentals, grouped by the branch that holds them');
    expect(kpi).toContain("{b.count} {b.count === 1 ? 'rental' : 'rentals'}");
    expect(kpi).toContain('{kes(b.perDay)}/d</span>');
  });
});

describe('the tolerances - the honest absences and the dark ground from birth', () => {
  it('a clean yard says so; a stale answer steps aside', () => {
    expect(kpi).toContain('const yardStale = !yardReady;');
    expect(kpi).toContain('data-testid="rental-yard-clear"');
    expect(kpi).toContain('Nothing is past return — the yard is clean.');
    expect(kpi).toContain('data-testid="rental-yard-stale"');
    expect(kpi).toContain('the rental roster is not on this cached answer — the count story above still speaks. Reload to fetch it.');
    // the clear state requires the roster to have ARRIVED and be empty
    expect(kpi).toContain('{yardReady && overdueRows && overdueRows.length === 0 && (');
  });

  it('the fifth panel owns its dark half from birth - the v2.195.0 discovery is house law', () => {
    // exactly FIVE panels now paint the dark half (revenue, transactions,
    // debt, watchlist, yard)
    expect(kpi.split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1).toBe(6);
  });

  it('the type contract already carried the roster - zero wire changes', () => {
    expect(primitives).toContain('rentals: {');
    expect(primitives).toContain('ratePerDay: number; deposit: number; status: string;');
    // the route keeps shipping the same shape (soonest return first, capped at 8)
    const route = readRepo('src/app/api/org/kpi-summary/route.ts');
    expect(route).toContain("orderBy: { expectedReturnDate: 'asc' }");
    expect(route).toContain('take: 8');
  });
});

describe('the a11y surface - the REAL-chain math for the yard families', () => {
  it('the contrast script exists and derives over the real chain', () => {
    expect(contrastScript).toContain('v2.198.0 contrast math — the rental yard');
    expect(contrastScript).toContain('PANEL_DARK');
    expect(contrastScript).toContain('ROSE_STRIP_LIGHT');
    // the discovery stays pinned in the new script's guards
    expect(contrastScript).toContain('the modal panel dark half drifted');
    expect(contrastScript).toContain('the Expert OVERDUE badge re-voice drifted');
  });

  it('THE FIX: the Expert OVERDUE badge re-voices red-600 to red-700 - the 4.36:1 find', () => {
    expect(experts).toContain("r.status === 'OVERDUE' ? 'border-red-200 bg-red-50 text-red-700'");
    expect(experts).not.toContain('bg-red-50 text-red-600');
    // the ACTIVE badge keeps the Expert's emerald voice
    expect(experts).toContain("r.status === 'ACTIVE' ? 'border-emerald-200 text-emerald-700'");
  });

  it('the a11y doc closes the yard surface', () => {
    expect(a11yDoc).toContain("the rental yard + the Expert OVERDUE badge's re-voice (v2.198.0)");
    expect(a11yDoc).toContain('49/49');
  });

  it('the workspace doc gains the sentence', () => {
    expect(workspaceDoc).toContain('v2.198.0 gives the rentals face the same voice');
  });
});

describe('the release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.208.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.208.0');
    expect(pkg.mbumah.baseVersion).toBe('2.208.0');
    expect(pkg.scripts['verify:v2-198-0']).toBeTruthy();
    // the prior surfaces stay wired
    expect(pkg.scripts['verify:v2-197-0']).toBeTruthy();
    expect(pkg.scripts['verify:v2-196-0']).toBeTruthy();
  });

  it('the changelog and the feed head the release', () => {
    expect(changelog).toContain('## [2.198.0] The overdue tile opens the yard');
    expect(changelog.indexOf('## [2.198.0]')).toBeLessThan(changelog.indexOf('## [2.197.0]'));
    expect(whatsNew).toContain("version: '2.198.0'");
    expect(whatsNew).toContain("title: 'The overdue tile opens the yard'");
    expect(whatsNew.indexOf('2.198.0')).toBeLessThan(whatsNew.indexOf('2.197.0'));
  });

  it('the verify script pins the release end to end', () => {
    expect(verifyScript).toContain('v2.198.0 verification');
    expect(verifyScript).toContain('data-testid="overdue-card"');
    expect(verifyScript).toContain('data-testid="rental-yard-stale"');
  });
});
