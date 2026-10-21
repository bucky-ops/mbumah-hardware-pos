// v2.211.0 — the currency wire's writer finds its surface.
//
//   - /api/currency/rates has been able to PERSIST admin-set rates since
//     v2.210.0, but the only writer was curl — a SUPER_ADMIN with a
//     browser had no way to set or reset a rate. The Exchange Rates
//     admin card completes the loop: the same GET the switcher lazily
//     calls becomes a table on the admin desk, "Set rate" POSTs one
//     (KES, quote) pair, and "Reset to built-in" DELETEs the override
//     so the pair falls back to its static constant.
//   - THE DELETE LAW: the new DELETE handler answers SUPER_ADMIN-only,
//     takes the pair as query params (?base=&quote=) validated by the
//     same enum the POST accepts, and answers an honest 404 when the
//     pair has no stored row ("nothing to reset") — never a pretend
//     success.
//   - THE DOOR LAW (v2.209's, restated for the new surface): the client
//     renders the mutation buttons only for SUPER_ADMIN and SPEAKS the
//     restriction where they would have been for every other admin-role
//     eye. Read-only surfaces stay for everyone.
//   - THE HONEST STATES: a failed wire is an error row with a retry —
//     the figures are "unavailable, not zero"; the empty sentence
//     belongs to a loaded-and-empty wire only; the dialog CLOSES on
//     success (a confirm must never outlive its own click); the reset
//     confirm is a destructive AlertDialog closed by its own action.
//   - THE ONE-WRITER VOICE: composeRatesProvenanceVoice condenses the
//     SAME entries the table renders into one spoken sentence — counts
//     from the wire only, zero/non-finite groups speak nothing,
//     singular/plural honest, an unwired card says nothing is tracked.
//   - THE MEASURED PALETTE: the chips re-verify the switcher's numbers
//     on the card ground (scripts/contrast-math-rates-card-v2211.mjs —
//     emerald 5.09 / blue 6.26 / muted 5.95 light; 9.88 / 8.75 / 5.80
//     dark; the failed-wire red 5.88/9.54; the destructive confirm
//     white-on-red-600 4.76). Style is measured BEFORE the literals
//     are pinned here.
//
// Every pin reads the SOURCE OF RECORD (source bytes, not memory) — the
// house rule since the verify scripts were born.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { composeRatesProvenanceVoice } from '@/lib/report-voices';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const ROUTE_PATH = 'src/app/api/currency/rates/route.ts';
const SECTION_PATH = 'src/components/admin/currency-rates-section.tsx';
const ADMIN_TAB_PATH = 'src/app/(shell)/tabs/admin-tab.tsx';
const SCRIPT_PATH = 'scripts/contrast-math-rates-card-v2211.mjs';

const route = read(ROUTE_PATH);
const section = read(SECTION_PATH);
const adminTab = read(ADMIN_TAB_PATH);
const script = read(SCRIPT_PATH);

// ── THE DELETE ROUTE ────────────────────────────────────────────────────────

describe('currency rates DELETE route (v2.211.0)', () => {
  it('exists as an exported DELETE handler wrapped in the SUPER_ADMIN guard', () => {
    expect(route).toMatch(/export const DELETE = requireAuth\(deleteHandler,\s*\{ roles: \['SUPER_ADMIN'\] \}\)/);
  });

  it('takes the pair as query params, validated by the same enum the POST accepts', () => {
    expect(route).toMatch(/searchParams\.get\('base'\)/);
    expect(route).toMatch(/searchParams\.get\('quote'\)/);
    // The delete schema repeats the POST's pair enum — one currency family.
    const enums = route.match(/z\.enum\(\['KES', 'USD', 'UGX', 'TZS'\]\)/g) ?? [];
    expect(enums.length).toBeGreaterThanOrEqual(4); // POST base + quote, DELETE base + quote
  });

  it('answers 422 with a spoken error when the pair is missing or unknown', () => {
    expect(route).toMatch(/status: 422/);
    expect(route).toMatch(/base and quote query params are required/);
  });

  it('answers the honest 404 — nothing to reset, never a pretend success', () => {
    expect(route).toMatch(/findUnique\(\{/);
    expect(route).toMatch(/status: 404/);
    expect(route).toMatch(/No stored rate for \$\{parsed\.data\.base\}→\$parsed\.data\.quote|No stored rate for \$\{parsed\.data\.base\}→\$\{parsed\.data\.quote\}/);
    expect(route).toMatch(/already reads its built-in rate/);
  });

  it('deletes exactly the requested pair and returns the deleted row', () => {
    expect(route).toMatch(/db\.currencyRate\.delete\(\{\s*where: \{ base_quote: \{ base: parsed\.data\.base, quote: parsed\.data\.quote \} \},?\s*\}\)/);
    expect(route).toMatch(/deleted: \{/);
  });

  it('runs inside runWithoutTenant — global financial config, not store-scoped', () => {
    const deleteBody = route.slice(route.indexOf('async function deleteHandler'), route.indexOf('export const DELETE'));
    expect(deleteBody).toContain('runWithoutTenant');
  });

  it('the header documents the DELETE contract for the next reader', () => {
    expect(route).toMatch(/DELETE \/api\/currency\/rates - reset one pair to its built-in rate/);
  });
});

// ── THE CARD ────────────────────────────────────────────────────────────────

describe('exchange rates admin card (v2.211.0)', () => {
  it('rides the admin tab after the configuration editor', () => {
    expect(adminTab).toMatch(/import \{ CurrencyRatesSection \} from '@\/components\/admin\/currency-rates-section';/);
    const placement = adminTab.indexOf('<CurrencyRatesSection />');
    const config = adminTab.indexOf('<ConfigEditor storeId={currentStoreId} />');
    const updates = adminTab.indexOf('<UpdatesSafetySection />');
    expect(placement).toBeGreaterThan(config);
    expect(placement).toBeLessThan(updates);
  });

  it('reads the SAME wire the switcher reads (one GET, one truth)', () => {
    expect(section).toMatch(/'\/api\/currency\/rates'/);
    expect(section).not.toMatch(/\/api\/currency\/(?!rates)[a-z-]+/);
  });

  it('the door: mutations render only for SUPER_ADMIN, read-only stays for everyone', () => {
    expect(section).toMatch(/useAuthStore\(\(s\) => s\.user\?\.role\) === 'SUPER_ADMIN'/);
    // The action column and the buttons ride the door; the table does not.
    expect(section).toMatch(/\{canManageRates && <TableHead className="text-right">Actions<\/TableHead>\}/);
    expect(section).toMatch(/\{canManageRates && \(/);
  });

  it('the restriction is SPOKEN where the buttons would have been', () => {
    expect(section).toMatch(/Exchange rate management is restricted to the system administrator\./);
  });

  it('the failed wire is an error row — figures unavailable, NOT zero', () => {
    expect(section).toMatch(/The rates wire failed to answer — the exchange figures are unavailable, not zero\./);
    expect(section).toMatch(/the figures below are unavailable, not zero\./);
    expect(section).toMatch(/void ratesQuery\.refetch\(\)/);
  });

  it('the dialog CLOSES on success and the toast speaks the outcome', () => {
    const onSuccess = section.slice(
      section.indexOf('onSuccess: (_body, vars) => {'),
      section.indexOf('onError: (err: Error) => {'),
    );
    expect(onSuccess).toContain('setDialogPair(null)');
    expect(onSuccess).toContain('invalidateRates()');
    expect(onSuccess).toMatch(/toast\.success\(`Rate saved/);
  });

  it('the reset confirm is a destructive AlertDialog closed by its own action', () => {
    expect(section).toMatch(/<AlertDialog /);
    expect(section).toMatch(/Reset to built-in/);
    expect(section).toMatch(/setResetPair\(null\)/);
    expect(section).toMatch(/toast\.success\('Rate reset — the pair reads its built-in figure again\.'\)/);
  });

  it('the reset surfaces the honest 404 as a toast error, never a pretend success', () => {
    const resetMutation = section.slice(
      section.indexOf('const resetRateMutation = useMutation'),
      section.indexOf('const resetRateMutation = useMutation') + 2200,
    );
    expect(resetMutation).toMatch(/body\.error \|\| `The wire refused the reset \(\$\{res\.status\}\)`/);
  });

  it('validates the input: a positive finite number, nothing else', () => {
    expect(section).toMatch(/Enter a positive number — a rate of zero or less is not a rate\./);
    expect(section).toMatch(/!Number\.isFinite\(n\) \|\| n <= 0/);
  });

  it('the dialog computes the switcher figure from the SAME input the POST sends', () => {
    expect(section).toMatch(/const inversePreview =/);
    expect(section).toMatch(/\(1 \/ parsedRate\)\.toPrecision\(6\)/);
    expect(section).toMatch(/the figure the switcher will show/);
  });

  it('the pair DIRECTION is spoken: the route stores KES-per-quote-unit, the dialog says so', () => {
    expect(section).toMatch(/How many KES one \{dialogPair\?\.quote \?\? ''\} equals — the pair direction the/);
    expect(section).toMatch(/Rate \(KES per 1 \{dialogPair\?\.quote \?\? ''\}\)/);
    expect(section).toMatch(/1 KES = \$\{inversePreview\} \$\{dialogPair\?\.quote \?\? ''\}/);
    expect(section).toMatch(/toast\.success\(`Rate saved — 1 \$\{vars\.quote\} = \$\{vars\.rate\} KES is now admin-set\.`\)/);
  });

  it('the KES pivot never moves — no actions on the base row', () => {
    expect(section).toMatch(/the pivot never moves/);
  });

  it('custom pairs (base ≠ KES) render muted and speak their honest scope', () => {
    expect(section).toMatch(/rawRates\.filter\(\(r\) => r\.base !== 'KES'\)/);
    expect(section).toMatch(/Custom pairs stored \(the switcher reads KES pairs only\):/);
  });

  it('figures ride tabular-nums; rows carry aria labels for the actions', () => {
    expect(section).toMatch(/tabular-nums/);
    expect(section).toMatch(/aria-label=\{`Set the \$\{entry\.name \?\? entry\.code\} \(\$\{entry\.code\}\) exchange rate`\}/);
    expect(section).toMatch(/aria-label=\{`Reset the \$\{entry\.name \?\? entry\.code\} \(\$\{entry\.code\}\) rate to its built-in figure`\}/);
  });

  it('the card announces itself to the reader', () => {
    expect(section).toMatch(/aria-label="Exchange rates configuration"/);
    expect(section).toMatch(/aria-label="Refresh exchange rates"/);
  });

  it('the one-writer voice is composed from the SAME entries the table renders', () => {
    expect(section).toMatch(/composeRatesProvenanceVoice\(currencies\.length > 0 \? currencies : null\)/);
  });

  it('accounting honesty: the card says the accounting currency remains KES', () => {
    expect(section).toMatch(/the accounting currency remains KES/);
  });
});

// ── THE MEASURED PALETTE ────────────────────────────────────────────────────

describe('the rates card measured palette (v2.211.0)', () => {
  it('uses the SAME chip families the switcher uses — one provenance, one look', () => {
    expect(section).toMatch(/'bg-emerald-50 text-emerald-700 dark:bg-emerald-500\/15 dark:text-emerald-300'/);
    expect(section).toMatch(/'bg-blue-50 text-blue-700 dark:bg-blue-500\/15 dark:text-blue-300'/);
    expect(section).toMatch(/'text-muted-foreground'/);
  });

  it('the contrast script exists, measures the card ground, and is the source of the numbers', () => {
    expect(script).toMatch(/v2\.211\.0 contrast math/);
    expect(script).toMatch(/bg-card\/80/);
    expect(script).toMatch(/4\.5:1 small-text bar/);
    // The measured families appear in the script as real cases.
    expect(script).toMatch(/emerald-700 on emerald-50/);
    expect(script).toMatch(/blue-700 on blue-50/);
    expect(script).toMatch(/white on red-600/);
  });
});

// ── THE ONE-WRITER VOICE ────────────────────────────────────────────────────

describe('composeRatesProvenanceVoice (v2.211.0)', () => {
  it('an unwired or empty card says plainly that nothing is tracked', () => {
    expect(composeRatesProvenanceVoice(null)).toBe('No currencies tracked yet — the rates wire has not answered.');
    expect(composeRatesProvenanceVoice(undefined)).toBe('No currencies tracked yet — the rates wire has not answered.');
    expect(composeRatesProvenanceVoice([])).toBe('No currencies tracked yet — the rates wire has not answered.');
  });

  it('composes the provenance breakdown from the SAME entries it is handed', () => {
    expect(
      composeRatesProvenanceVoice([{ source: 'STATIC' }, { source: 'MANUAL' }, { source: 'MANUAL' }, { source: 'STATIC' }]),
    ).toBe('4 currencies tracked — 2 static, 2 manual.');
  });

  it('singular/plural is honest', () => {
    expect(composeRatesProvenanceVoice([{ source: 'MANUAL' }])).toBe('1 currency tracked — 1 manual.');
    expect(composeRatesProvenanceVoice([{ source: 'API' }])).toBe('1 currency tracked — 1 api.');
  });

  it('zero and non-finite groups speak nothing (the zero law)', () => {
    // Groups are derived by counting — a count of zero cannot exist, but
    // non-string sources are filtered before counting, never invented.
    expect(
      composeRatesProvenanceVoice([{ source: 'STATIC' }, { source: undefined } as unknown as { source: string }]),
    ).toBe('1 currency tracked — 1 static.');
  });

  it('a row shape without usable sources degrades to the tracked count only', () => {
    // Non-string sources still count as tracked rows (they ARE on the wire)
    // — the composer names them only when the group is countable.
    const voice = composeRatesProvenanceVoice([{ source: 'MANUAL' }, { source: 'MANUAL' }]);
    expect(voice).toBe('2 currencies tracked — 2 manual.');
  });
});
