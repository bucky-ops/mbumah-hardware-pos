#!/usr/bin/env node
// v2.203.0 contrast math — the week door (the WeekLedgerModal +
// SalesTrendForecastCard's door face in dashboard-tab.tsx) in BOTH modes,
// over the REAL paint stacks from the INSTALLED Tailwind theme.
//
// THE ROUND'S PRE-DERIVATION PROBE (scripts/probe-week-doors-v2203.mjs)
// measured the emerald family + the forecast-line re-voice BEFORE anything
// shipped — 16/16. The emerald voices ride the same family the day ledger
// door wears (v2.200.0): the -700 accents 5.09-9.81:1 on their grounds in
// light, the -300 accents 6.79-12.02:1 on slate-900 and the -500/10 dark
// chip stacks in dark.
//
// THE ROUND'S REAL CATCH, recorded as a FIX (not alignment): the trend
// chart's FORECAST DASHED LINE rode amber-500 on white — 2.15:1, BELOW the
// 3:1 non-text graphics bar (the legend text carried the figure, but the
// line itself is the graphic that carries the forecast's position). The
// line and the legend swatch re-voice to amber-600 — 3.19:1, clearing the
// bar — and the ghost amber-500 value is pinned BELOW the bar in REVERSE
// so the old voice cannot return silently. The trend polyline (emerald-600
// 3.67:1) and the edge bar (emerald-600 3.67:1) pass untouched. The
// aria-hidden progress-bar track (emerald-100 in light) is decoration per
// the v2.198.0 law: the figure it illustrates is the text beside it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const theme = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
const token = (name) => {
  const m = theme.match(new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (m) return oklchToSrgb(parseFloat(m[1]) / 100, parseFloat(m[2]), parseFloat(m[3]));
  const hex = theme.match(new RegExp(`--color-${name}: (#(?:[0-9a-f]{3}|[0-9a-f]{6}))\\b`));
  if (hex) return hexToSrgb(hex[1]);
  throw new Error(`token --color-${name} not found in theme.css`);
};
const hexToSrgb = (h) => {
  const s = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
function oklchToSrgb(L, C, Hdeg) {
  const hr = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const lin = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return [lin(lr), lin(lg), lin(lb)].map((v) => Math.min(1, Math.max(0, v)));
}
const lum = (rgb) => {
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const ratio = (a, b) => {
  const [x, y] = lum(a) > lum(b) ? [a, b] : [b, a];
  return (lum(x) + 0.05) / (lum(y) + 0.05);
};
const blend = (top, alpha, bottom) => top.map((v, i) => v * alpha + bottom[i] * (1 - alpha));

const WHITE = [1, 1, 1];
const CARD_DARK = token('slate-900');
const STACK_DARK = (c) => blend(token(c), 0.1, CARD_DARK);

let pass = 0;
let fail = 0;
const check = (name, actual, bar, invert = false) => {
  const ok = invert ? actual < bar : actual >= bar;
  if (ok) pass++; else fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} — ${actual.toFixed(2)}:1 (${invert ? 'pinned below' : 'need'} ${bar}:1)`);
};
const r = (a, b) => ratio(a, b);

// ── LIGHT: the week door's voices on the white panel ──
check('emerald-700 title icon on white', r(token('emerald-700'), WHITE), 4.5);
check('emerald-700 today-chip voice on emerald-50', r(token('emerald-700'), token('emerald-50')), 4.5);
check('slate-700 progress label on emerald-50', r(token('slate-700'), token('emerald-50')), 4.5);
check('slate-500 day labels on white', r(token('slate-500'), WHITE), 4.5);
check('slate-600 forecast-block text on slate-50', r(token('slate-600'), token('slate-50')), 4.5);
check('amber-700 outlier voice on amber-50', r(token('amber-700'), token('amber-50')), 4.5);
check('slate-700 loudest name on white', r(token('slate-700'), WHITE), 4.5);

// ── LIGHT: the chart graphics (3:1) ──
check('amber-600 forecast line on white (THE FIX)', r(token('amber-600'), WHITE), 3);
check('emerald-600 trend polyline on white', r(token('emerald-600'), WHITE), 3);
check('emerald-600 edge bar on white', r(token('emerald-600'), WHITE), 3);
check('GHOST amber-500 forecast line pinned BELOW the bar (reverse)', r(token('amber-500'), WHITE), 3, true);

// ── DARK: the week door's voices on slate-900 / the -500/10 stacks ──
check('emerald-300 chip voice on slate-900', r(token('emerald-300'), CARD_DARK), 4.5);
check('emerald-300 chip voice on emerald-500/10 stack', r(token('emerald-300'), STACK_DARK('emerald-500')), 4.5);
check('slate-300 row label on slate-900', r(token('slate-300'), CARD_DARK), 4.5);
check('slate-400 sub-voice on slate-900', r(token('slate-400'), CARD_DARK), 4.5);
check('slate-300 forecast text on slate-500/10 stack', r(token('slate-300'), STACK_DARK('slate-500')), 4.5);
check('amber-300 outlier voice on amber-500/10 stack', r(token('amber-300'), STACK_DARK('amber-500')), 4.5);
check('slate-400 window note on slate-900', r(token('slate-400'), CARD_DARK), 4.5);

console.log(`\n${pass}/${pass + fail} contrast checks pass`);
process.exit(fail > 0 ? 1 : 0);
