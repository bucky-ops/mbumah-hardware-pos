// v2.212.0 — one wire, two surfaces, one truth: now LIVE.
//
//   - THE SHARED CACHE LAW: the currency switcher (top-bar, every page)
//     and the admin desk's Exchange Rates card read the SAME query key
//     (ADMIN_CURRENCY_RATES_QUERY_KEY). A rate the card writes or resets
//     invalidates that key and the switcher's chips and figures re-render
//     WITHOUT a remount. Before this release the switcher fetched once
//     per mount into local state — a same-mount card write left the
//     dropdown stale until a full page remount.
//   - THE LAZY OBSERVER LAW: sharing the cache must not cost laziness —
//     the switcher's query stays DISABLED until the first open (nothing
//     fetched on mount) and never polls (refetchInterval false). After
//     the first open it is a live observer of the one wire.
//   - THE FRESHNESS VOICE: the dropdown footer speaks WHEN the wire
//     answered ("Wire read at 14:32."), from the cache's own recorded
//     read time — honest recency, not a pretend "live". Before the first
//     answer the footer stays exactly the three sentences it has always
//     had; silence stays silence.
//   - THE TRIGGER'S HOVER TRUTH: once the wire answered, the trigger's
//     tooltip speaks the active currency's own figure and source — the
//     same voice the rows use. Before the wire answers the trigger
//     claims nothing.
//   - TRACK A PAIR: the route's pair enum has allowed non-KES pivots
//     (USD→TZS and siblings) all along, but only curl could write them.
//     The card gains "Track a pair" — its own dialog, its own direction
//     sentence (rate = base units per 1 quote unit), its own toast — and
//     the custom strip's badges gain provenance-on-hover plus their own
//     Reset affordance (the SAME DELETE route, pair-aware confirm).
//   - THE PAIR-AWARE RESET: a KES-pivot pair falls back to its built-in
//     constant; a custom pair has NO built-in — the confirm says the
//     pair simply leaves the wire. A door that lies is still a lie even
//     in a confirm dialog.
//
// Every pin reads the SOURCE OF RECORD (source bytes, not memory) — the
// house rule since the verify scripts were born.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SWITCHER_PATH = 'src/components/currency-switcher.tsx';
const SECTION_PATH = 'src/components/admin/currency-rates-section.tsx';
const ROUTE_PATH = 'src/app/api/currency/rates/route.ts';

const switcher = read(SWITCHER_PATH);
const section = read(SECTION_PATH);
const route = read(ROUTE_PATH);

// ── THE SHARED CACHE LAW ────────────────────────────────────────────────────

describe('the one-wire query key (v2.212.0)', () => {
  it('is exported from the switcher with the literal the card used to own', () => {
    expect(switcher).toMatch(/export const ADMIN_CURRENCY_RATES_QUERY_KEY = \['admin-currency-rates'\] as const;/);
  });

  it('is imported by the card — the inline literal is gone from the card', () => {
    expect(section).toMatch(/import \{ ADMIN_CURRENCY_RATES_QUERY_KEY \} from '@\/components\/currency-switcher';/);
    // The card must not keep its own copy of the literal: one key, one writer.
    expect(section).not.toMatch(/queryKey: \['admin-currency-rates'\]/);
  });

  it('is the queryKey BOTH surfaces read from', () => {
    expect(switcher).toMatch(/queryKey: ADMIN_CURRENCY_RATES_QUERY_KEY,/);
    expect(section).toMatch(/queryKey: ADMIN_CURRENCY_RATES_QUERY_KEY,/);
  });

  it('is the key the card invalidates after a write — the reactivity path', () => {
    expect(section).toMatch(/invalidateQueries\(\{ queryKey: ADMIN_CURRENCY_RATES_QUERY_KEY \}\)/);
  });
});

// ── THE LAZY OBSERVER LAW ───────────────────────────────────────────────────

describe('the switcher joins the cache without losing its laziness (v2.212.0)', () => {
  it('reads the wire through useQuery — not through local fetch-once state', () => {
    expect(switcher).toMatch(/useQuery\(\{/);
    expect(switcher).toMatch(/queryFn: async \(\): Promise<RatesWireBody> => \{/);
    // The old fetch-once machinery must be gone.
    expect(switcher).not.toMatch(/attemptedRef/);
    expect(switcher).not.toMatch(/setRates\(map\)/);
  });

  it('the query stays disabled until the first open — nothing fetched on mount', () => {
    expect(switcher).toMatch(/enabled: opened,/);
    expect(switcher).toMatch(/const \[opened, setOpened\] = useState\(false\);/);
    expect(switcher).toMatch(/if \(next\) setOpened\(true\);/);
  });

  it('never polls — the wire arrives on open and on invalidation, not on a timer', () => {
    expect(switcher).toMatch(/refetchInterval: false,/);
  });

  it('keeps the card-staleTime parity (30s) so one cache breathes on one clock', () => {
    expect(switcher).toMatch(/staleTime: 30_000,/);
    expect(section).toMatch(/staleTime: 30_000,/);
  });

  it('the map builder keeps the honest-absence law — an empty wire is null, not an empty claim', () => {
    expect(switcher).toMatch(/return map\.size > 0 \? map : null;/);
  });

  it('the switcher fetch helper keeps the SAME authed contract the card keeps', () => {
    expect(switcher).toMatch(/localStorage\.getItem\('mbt_token'\)/);
    expect(switcher).toMatch(/credentials: 'same-origin'/);
  });
});

// ── THE FRESHNESS VOICE ─────────────────────────────────────────────────────

describe('the dropdown footer speaks the read time (v2.212.0)', () => {
  it('composes the freshness label from the cache dataUpdatedAt — honest recency', () => {
    expect(switcher).toMatch(/ratesQuery\.dataUpdatedAt > 0 \? new Date\(ratesQuery\.dataUpdatedAt\) : null/);
    expect(switcher).toMatch(/`Wire read at \$\{readAt\.toLocaleTimeString/);
  });

  it('renders only when the wire answered — before it the footer is unchanged', () => {
    expect(switcher).toMatch(/\{freshnessLabel && \(/);
    // The three original sentences stay byte-exact.
    expect(switcher).toMatch(/Rates are indicative \(display only\)\./);
    expect(switcher).toMatch(/Accounting currency remains KES\./);
    expect(switcher).toMatch(/Each chip names its source: admin-set, API, or built-in\./);
  });

  it('the freshness line rides tabular-nums and carries the full timestamp on hover', () => {
    expect(switcher).toMatch(/title=\{freshnessTitle\}\n\s+className="tabular-nums"/);
    expect(switcher).toMatch(/const freshnessTitle = readAt \? readAt\.toLocaleString\(\) : undefined;/);
  });
});

// ── THE TRIGGER'S HOVER TRUTH ───────────────────────────────────────────────

describe('the trigger tooltip speaks the active wire figure (v2.212.0)', () => {
  it('only after the wire answered, only for a non-KES active currency', () => {
    expect(switcher).toMatch(/const activeRow = currency !== 'KES' \? rates\?\.get\(currency\) : undefined;/);
    expect(switcher).toMatch(/const triggerTitle = activeRow\s*\? `1 KES = \$\{formatCurrency\(activeRow\.kesToRate, currency\)\} · \$\{SOURCE_PHRASE\[activeRow\.source\] \?\? 'wire rate'\}`\s*: undefined;/);
  });

  it('rides the trigger button as a title — the rows voice on hover', () => {
    expect(switcher).toMatch(/aria-haspopup="menu"\n\s+title=\{triggerTitle\}/);
  });
});

// ── TRACK A PAIR ────────────────────────────────────────────────────────────

describe('the card tracks a pair outside the KES family (v2.212.0)', () => {
  it('offers exactly the pair enum the route validates — the parity law', () => {
    expect(section).toMatch(/const TRACK_PAIR_CODES = \['KES', 'USD', 'UGX', 'TZS'\] as const;/);
    const enums = route.match(/z\.enum\(\['KES', 'USD', 'UGX', 'TZS'\]\)/g) ?? [];
    expect(enums.length).toBeGreaterThanOrEqual(4); // POST base+quote, DELETE base+quote
  });

  it('a pair cannot match itself — both selects filter their twin out', () => {
    expect(section).toMatch(/TRACK_PAIR_CODES\.filter\(\(c\) => c !== trackQuote\)/);
    expect(section).toMatch(/TRACK_PAIR_CODES\.filter\(\(c\) => c !== trackBase\)/);
    expect(section).toMatch(/A pair needs two different currencies — the base and the quote cannot match\./);
  });

  it('the rate is validated positive-finite before the POST', () => {
    const trackBody = section.slice(section.indexOf('const handleTrackSubmit'), section.indexOf('<Card className='));
    expect(trackBody).toMatch(/!Number\.isFinite\(n\) \|\| n <= 0/);
    expect(trackBody).toMatch(/a rate of zero or less is not a rate/);
  });

  it('the TRACK-WRITE POSTs the same contract the set-rate dialog POSTs', () => {
    const trackMutation = section.slice(section.indexOf('const setPairMutation'), section.indexOf('// The dialog\'s live preview'));
    expect(trackMutation).toMatch(/body: JSON\.stringify\(\{ rates: \[\{ base, quote, rate, source: 'MANUAL' \}\] \}\)/);
  });

  it('the toast speaks the CUSTOM direction — base units per quote unit', () => {
    expect(section).toMatch(/toast\.success\(`Pair tracked — 1 \$\{vars\.quote\} = \$\{vars\.rate\} \$\{vars\.base\} is now admin-set\.`\)/);
  });

  it('the dialog closes on success — a confirm must never outlive its own click', () => {
    const trackMutation = section.slice(section.indexOf('const setPairMutation'), section.indexOf('// The dialog\'s live preview'));
    expect(trackMutation).toMatch(/setTrackPairOpen\(false\);/);
    expect(trackMutation).toMatch(/setTrackRateInput\(''\);/);
  });

  it('the direction sentence is spoken where the number is typed', () => {
    expect(section).toMatch(/How many \{trackBase\} one \{trackQuote\} equals — the pair direction the rates/);
    expect(section).toMatch(/Rate \(\{trackBase\} per 1 \{trackQuote\}\)/);
  });

  it('the honest scope is spoken in the dialog — the switcher reads KES pairs only', () => {
    expect(section).toMatch(/The switcher reads KES pairs only: a tracked pair is stored and/);
  });

  it('the preview stores the figure exactly as typed — no invented math', () => {
    expect(section).toMatch(/`1 \$\{trackQuote\} = \$\{trackRateInput\.trim\(\)\} \$\{trackBase\} — stored exactly as typed\.`/);
  });

  it('the Track-a-pair button opens only for the role the server would accept', () => {
    const trackButton = section.slice(section.indexOf('TRACK A PAIR (v2.212.0)'), section.indexOf('THE DOOR LAW: the restriction is spoken'));
    expect(trackButton).toMatch(/\{canManageRates && \(/);
    expect(trackButton).toMatch(/aria-label="Track a custom currency pair"/);
  });
});

// ── THE CUSTOM STRIP: provenance on hover, un-write from the UI ────────────

describe('the custom-pair strip can un-write from the UI (v2.212.0)', () => {
  it('each badge speaks its provenance, its direction, and its freshness on hover', () => {
    expect(section).toMatch(/title=\{`Pair updated \$\{formatDateTime\(pair\.updatedAt\)\} · \$\{pair\.source === 'MANUAL' \? 'admin-set' : pair\.source === 'API' \? 'API' : 'built-in'\} · 1 \$\{pair\.quote\} = \$\{pair\.rate\} \$\{pair\.base\}`\}/);
  });

  it('each badge carries its own Reset affordance — gated by the same door law', () => {
    expect(section).toMatch(/\{canManageRates && \(\s*<button\s+type="button"\s+onClick=\{\(\) => setResetPair\(\{ base: pair\.base, quote: pair\.quote, label: `\$\{pair\.base\}→\$\{pair\.quote\}` \}\)\}/);
    expect(section).toMatch(/aria-label=\{`Reset the \$\{pair\.base\}→\$\{pair\.quote\} pair \(deletes the stored rate\)`\}/);
  });

  it('the badge reset feeds the SAME AlertDialog + DELETE route the table rows use', () => {
    // The setResetPair call lands in the same state the table's Reset uses,
    // and the reset mutation DELETEs with the same pair params.
    expect(section).toMatch(/method: 'DELETE',/);
    expect(section).toMatch(/searchParams-less contract|base=\$\{encodeURIComponent\(base\)\}&quote=\$\{encodeURIComponent\(quote\)\}/);
  });
});

// ── THE PAIR-AWARE RESET CONFIRM ────────────────────────────────────────────

describe('the reset confirm speaks honestly for both pair kinds (v2.212.0)', () => {
  it('a KES-pivot pair falls back to its built-in constant — the original sentence stays', () => {
    expect(section).toMatch(/This deletes the stored override for \{resetPair\?\.base \?\? 'KES'\}→\{resetPair\?\.quote \?\? ''\}\./);
    expect(section).toMatch(/The pair falls back to its built-in constant and the switcher&apos;s chip/);
  });

  it('a CUSTOM pair has no built-in — the confirm says the pair leaves the wire', () => {
    expect(section).toMatch(/A custom pair has no built-in constant to fall back to — the pair/);
    expect(section).toMatch(/simply leaves the wire and the strip\. The switcher never read it,/);
  });

  it('the title keeps the (CODE) voice for KES pivots and the pair voice for customs', () => {
    expect(section).toMatch(/Reset the \{resetPair\?\.label \?\? ''\}\{resetPair\?\.base === 'KES' \? ` \(\$\{resetPair\.quote\}\)` : ''\} rate\?/);
  });

  it('the success toast is pair-aware too — no built-in claim for a pair that never had one', () => {
    expect(section).toMatch(/vars\.base === 'KES'/);
    expect(section).toMatch(/\? 'Rate reset — the pair reads its built-in figure again\.'/);
    expect(section).toMatch(/: 'Pair removed — the custom rate has left the wire\.'/);
  });
});

// ── THE MISSING SLICE: the switcher finally switches ───────────────────────

describe('the display-currency slice exists in the store (v2.212.0)', () => {
  const STORES_PATH = 'src/lib/stores.ts';
  const stores = read(STORES_PATH);

  it('AppState declares the slice useCurrency has selected since birth', () => {
    expect(stores).toMatch(/activeCurrency: CurrencyCode;/);
    expect(stores).toMatch(/setActiveCurrency: \(currency: CurrencyCode\) => void;/);
  });

  it('the store carries the KES default and the ONE write path onSelect calls', () => {
    expect(stores).toMatch(/activeCurrency: 'KES',/);
    expect(stores).toMatch(/setActiveCurrency: \(currency\) => set\(\{ activeCurrency: currency \}\),/);
  });

  it('the choice persists with the app preferences (mbt_app_store partialize)', () => {
    const partialize = stores.slice(stores.indexOf('partialize:'));
    expect(partialize).toMatch(/activeCurrency: state\.activeCurrency,/);
  });

  it('the slice type rides the same CurrencyCode the money lib speaks', () => {
    expect(stores).toMatch(/import type \{ CurrencyCode \} from '\.\/money';/);
  });

  it('the hook selects exactly what the store now carries — the old type errors die', () => {
    const hook = read('src/hooks/use-currency.ts');
    expect(hook).toMatch(/useAppStore\(\(s\) => s\.activeCurrency\)/);
    expect(hook).toMatch(/useAppStore\(\(s\) => s\.setActiveCurrency\)/);
  });
});

// ── THE KES DIALOG STAYS BYTE-EXACT (the v2.211 contract) ──────────────────

describe('the v2.211 KES set-rate surface is untouched (v2.212.0 regression guard)', () => {
  it('the pinned direction sentence and label survive the refactor', () => {
    expect(section).toMatch(/How many KES one \{dialogPair\?\.quote \?\? ''\} equals — the pair direction the/);
    expect(section).toMatch(/Rate \(KES per 1 \{dialogPair\?\.quote \?\? ''\}\)/);
  });

  it('the pinned KES toast template survives — the track mutation got its own voice', () => {
    expect(section).toMatch(/toast\.success\(`Rate saved — 1 \$\{vars\.quote\} = \$\{vars\.rate\} KES is now admin-set\.`\)/);
  });

  it('the per-row Set rate and Reset buttons keep their pinned aria labels', () => {
    expect(section).toMatch(/aria-label=\{`Set the \$\{entry\.name \?\? entry\.code\} \(\$\{entry\.code\}\) exchange rate`\}/);
    expect(section).toMatch(/aria-label=\{`Reset the \$\{entry\.name \?\? entry\.code\} \(\$\{entry\.code\}\) rate to its built-in figure`\}/);
  });
});
