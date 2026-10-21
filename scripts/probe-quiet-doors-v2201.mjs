#!/usr/bin/env node
// probe-quiet-doors-v2201.mjs — pre-derivation probe for the round's sweep:
// measure every suspect small-text pair on the branch dashboard BEFORE
// fixing, so the round's finds are evidence, not vibes.
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

const WHITE = [1, 1, 1];
const SLATE900 = token('slate-900');
const pairs = [
  // [label, fg, bg, need]
  ['ALERTS BADGE white on red-500 (the draft)', WHITE, token('red-500'), 4.5],
  ['ALERTS BADGE white on red-700 (the fix)', WHITE, token('red-700'), 4.5],
  ['DEBT OWES rose-600 on white (the draft)', token('rose-600'), WHITE, 4.5],
  ['DEBT OWES rose-700 on white (the fix)', token('rose-700'), WHITE, 4.5],
  ['DEBT COUNT rose-600 on white (2xl large, 3:1 bar)', token('rose-600'), WHITE, 3],
  ['DEBT COUNT rose-700 on white (the fix, still large)', token('rose-700'), WHITE, 3],
  ['DEBT dark rose-400 on slate-900', token('rose-400'), SLATE900, 4.5],
  ['DEBT dark rose-300 on slate-900', token('rose-300'), SLATE900, 4.5],
  ['CARD TOTAL rose-600 on white (text-lg bold = small)', token('rose-600'), WHITE, 4.5],
  ['CARD TOTAL rose-700 on white (the fix)', token('rose-700'), WHITE, 4.5],
  ['PAY CHIP DEBT rose-600 on rose-100', token('rose-600'), token('rose-100'), 4.5],
  ['PAY CHIP DEBT rose-700 on rose-100 (the fix)', token('rose-700'), token('rose-100'), 4.5],
  ['PAY CHIP GIFT slate-500 on slate-100', token('slate-500'), token('slate-100'), 4.5],
  ['PAY CHIP GIFT slate-600 on slate-100 (the fix)', token('slate-600'), token('slate-100'), 4.5],
  ['SEVERITY critical red-600 on red-100', token('red-600'), token('red-100'), 4.5],
  ['SEVERITY critical red-700 on red-100 (the fix)', token('red-700'), token('red-100'), 4.5],
  ['SEVERITY warning amber-700 on amber-100', token('amber-700'), token('amber-100'), 4.5],
  ['MOVERS meta slate-500 on white', token('slate-500'), WHITE, 4.5],
  ['MOVERS accent violet-600 on white (sm chip text?)', token('violet-600'), WHITE, 4.5],
  ['MOVERS accent violet-700 on white (the safe voice)', token('violet-700'), WHITE, 4.5],
  ['EDGE rose-600 on white (graphics 3:1)', token('rose-600'), WHITE, 3],
  ['EDGE violet-600 on white (graphics 3:1)', token('violet-600'), WHITE, 3],
  ['RING rose-300 on white (graphics 3:1)', token('rose-300'), WHITE, 3],
  ['AGING SEG red-500 on white (3:1 graphics)', token('red-500'), WHITE, 3],
  ['AGING SEG orange-500 on white (3:1 graphics)', token('orange-500'), WHITE, 3],
  ['AGING SEG emerald-500 on white (3:1 graphics)', token('emerald-500'), WHITE, 3],
  ['AGING SEG slate-500 on white (3:1 graphics)', token('slate-500'), WHITE, 3],
];
for (const [label, fg, bg, need] of pairs) {
  const r = ratio(fg, bg);
  console.log(`${r >= need ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need ${need}:1)`);
}
