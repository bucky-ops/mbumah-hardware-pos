#!/usr/bin/env node
// probe-week-doors-v2203.mjs — pre-derivation probe for v2.203.0: the week
// door's emerald family + the forecast line's re-voice, measured BEFORE
// anything ships, over the REAL paint stacks from the INSTALLED Tailwind
// theme.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const theme = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
const token = (name) => {
  const m = theme.match(new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (m) return oklchToSrgb(parseFloat(m[1]) / 100, parseFloat(m[2]), parseFloat(m[3]));
  const hex = theme.match(new RegExp(`--color-${name}: (#(?:[0-9a-f]{3}|[0-9a-f]{6}))\\b`));
  if (hex) return hexToSrgb(hex[1]);
  throw new Error(`token --color-${name} not found`);
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
const probe = (name, r, bar, invert = false) => {
  const ok = invert ? r < bar : r >= bar;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${r.toFixed(2)}:1 (${invert ? 'below' : 'need'} ${bar}:1)`);
};

console.log('── v2.203.0 the week door — LIGHT (white panel) ──');
probe('emerald-700 title icon on white', ratio(token('emerald-700'), WHITE), 4.5);
probe('emerald-700 today-chip voice on emerald-50', ratio(token('emerald-700'), token('emerald-50')), 4.5);
probe('slate-700 progress label on emerald-50', ratio(token('slate-700'), token('emerald-50')), 4.5);
probe('slate-500 day labels on white', ratio(token('slate-500'), WHITE), 4.5);
probe('slate-600 forecast-block text on slate-50', ratio(token('slate-600'), token('slate-50')), 4.5);
probe('amber-700 outlier voice on amber-50', ratio(token('amber-700'), token('amber-50')), 4.5);

console.log('── the chart graphics (3:1 non-text bar) ──');
probe('amber-600 forecast line on white (THE FIX)', ratio(token('amber-600'), WHITE), 3);
probe('emerald-600 trend line on white', ratio(token('emerald-600'), WHITE), 3);
probe('emerald-600 edge bar on white', ratio(token('emerald-600'), WHITE), 3);
probe('GHOST amber-500 forecast line pinned BELOW the bar (in reverse)', ratio(token('amber-500'), WHITE), 3, true);

console.log('── v2.203.0 the week door — DARK (slate-900 panel) ──');
probe('emerald-300 chip voice on slate-900', ratio(token('emerald-300'), CARD_DARK), 4.5);
probe('emerald-300 chip voice on emerald-500/10 stack', ratio(token('emerald-300'), STACK_DARK('emerald-500')), 4.5);
probe('slate-300 row label on slate-900', ratio(token('slate-300'), CARD_DARK), 4.5);
probe('slate-400 sub-voice on slate-900', ratio(token('slate-400'), CARD_DARK), 4.5);
probe('slate-300 forecast text on slate-500/10 stack', ratio(token('slate-300'), STACK_DARK('slate-500')), 4.5);
probe('amber-300 outlier voice on amber-500/10 stack', ratio(token('amber-300'), STACK_DARK('amber-500')), 4.5);

console.log(`\n${pass}/${pass + fail} probe checks pass`);
process.exit(fail > 0 ? 1 : 0);
