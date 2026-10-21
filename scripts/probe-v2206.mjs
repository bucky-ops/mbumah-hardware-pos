#!/usr/bin/env node
// v2.206.0 probe — "the best-sellers stand up, honestly".
// Measures the rank chips against the 4.5:1 TEXT bar (the rank NUMBER is
// text riding a fill), re-checks the bar fill's ghost ban, and verifies the
// wire/adapter contract strings at source. GHOSTS pinned BELOW the bar in
// reverse via checkBug (the v2.199.0 pattern).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

const relLum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (fg, bg) => {
  const a = relLum(fg);
  const b = relLum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// Tailwind v4 palette hexes at the classes the tab ships.
const CHIP = {
  'bg-yellow-700': '#a16207',
  'bg-slate-600': '#475569',
  'bg-orange-700': '#c2410c',
};
const GHOSTS = {
  'bg-yellow-500': '#eab308',
  'bg-gray-400': '#9ca3af',
  'bg-amber-600': '#d97706',
};
const WHITE = '#ffffff';

const tab = read('src/app/(shell)/tabs/reports-tab.tsx');

console.log('--- the rank chips (text on fill, 4.5:1) ---');
for (const [name, hex] of Object.entries(CHIP)) {
  const r = ratio(hex, WHITE);
  check(`${name} + white text = ${r.toFixed(2)}:1 (>= 4.5)`, () => {
    assert(r >= 4.5, `${r.toFixed(2)} is below the text bar`);
    assert(tab.includes(`'${name} text-white'`), `the tab no longer ships ${name}`);
  });
}

console.log('--- GHOSTS pinned BELOW the bar in reverse (the v2.199 pattern: the pre-fix state must stay under) ---');
for (const [name, hex] of Object.entries(GHOSTS)) {
  const r = ratio(hex, WHITE);
  check(`ghost ${name} (${r.toFixed(2)}:1) stays under the text bar`, () => {
    // The pre-fix state must STAY a failure: if the palette shifts and the
    // old chip would start passing, this pin flags it for re-judgement.
    assert(r < 4.5, `${r.toFixed(2)} clears the bar now — re-judge the ghost pin`);
    assert(!tab.includes(`'${name} text-white'`), `${name} is shipped again`);
  });
}

console.log('--- the rank bar ghost (graphics law carried from v2.204) ---');
check('the /60 gradient dimming is gone from the rank bars', () => {
  assert(!/from-primary\/60/.test(tab), 'the from-primary/60 ghost is shipped');
  assert(tab.includes('bg-primary transition-all duration-500'), 'the solid-primary bar is missing');
});

console.log('--- the wire contract (naming as contract) ---');
const route = read('src/app/api/reports/fast-moving/route.ts');
const api = read('src/lib/api.ts');
check('the route ships fastMovers (never products:)', () => {
  assert(/fastMovers:/.test(route), 'fastMovers missing from the route response');
  assert(!/products:\s*fastMovingProducts/.test(route), 'the products key is shipped — the normalizer will flatten the wire');
});
check('the client type + tab read fastMovers', () => {
  assert(api.includes('fastMovers: {'), 'the interface lost fastMovers');
  assert(tab.includes('Array.isArray(wire?.fastMovers)'), 'the tab stopped reading fastMovers');
});

console.log('--- the trends adapter contract ---');
const trends = read('src/app/api/trends/analysis/route.ts');
check('the trend rows carry real stock (currentStock) on the same findMany', () => {
  assert(trends.includes('quantityInStock: true,'), 'the select lost quantityInStock');
  assert(trends.includes('currentStock: info?.currentStock ?? null'), 'the row lost currentStock');
});

console.log('--- the adapter maps the wire actual names (source pins) ---');
check('topGrowing/topDeclining mapped; the imagined names are gone', () => {
  assert(tab.includes('d?.topGrowing'), 'topGrowing unmapped');
  assert(tab.includes('d?.topDeclining'), 'topDeclining unmapped');
  assert(!/Array\.isArray\(d\?\.(growing|declining)\)/.test(tab), 'the imagined wire names survive');
});
check('the honest share guards a zero total', () => {
  assert(tab.includes('share: total > 0 ? r.current / total : 0'), 'the zero-total guard is missing');
});
check('changeKnown rides the adapter and the render speaks "new"', () => {
  assert(tab.includes("changeKnown: typeof row?.growthPct === 'number'"), 'changeKnown missing');
  assert(tab.includes('{!row.changeKnown ? ('), 'the new-chip render is missing');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail === 0 ? 0 : 1);
