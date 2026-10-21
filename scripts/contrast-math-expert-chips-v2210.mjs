#!/usr/bin/env node
// v2.210.0 contrast math — the EXPERT-TABLE chip audit (final third of the
// badge/chip sweep: ledger OVERDUE v2.198, login error v2.199, now
// src/components/org/experts.tsx). The panel paints an OPAQUE white card
// (`bg-white`, line 204); the Unavailable panel paints slate-50. Pairs:
//   TEXT (4.5:1 — 10-12px, small text; bold buys nothing):
//     audit ERROR / debt bucket / debt status badges: red-600 on white
//     audit WARN badge: amber-700 on white
//     rentals OVERDUE badge: red-700 on red-50
//     status ACTIVE / pct healthy: emerald-700 on white
//     system check fail text + env badge fail + debt/rental tiles: red-500 on white
//     watchlist qty: orange-600 on white; tile low-stock: orange-500 on white
//     control: slate-500 on white
//   GRAPHICS (3:1):
//     Unavailable panel's AlertTriangle icon: amber-500 on slate-50
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
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
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

const WHITE = token('white');
const SLATE_50 = token('slate-50');

const adoptedCases = [
  ['red-700 on white (tiles + check FAIL text + env badge)', token('red-700'), WHITE],
  ['red-700 on red-50 (rentals OVERDUE filled badge)', token('red-700'), blend(token('red-50'), 1, WHITE)],
  ['orange-700 on white (low-stock tile + watchlist qty)', token('orange-700'), WHITE],
  ['amber-600 icon on slate-50 (Unavailable AlertTriangle)', token('amber-600'), SLATE_50],
  // untouched passers, re-verified so a palette bump can never slip through:
  ['red-600 on white (audit ERROR / debt badges)', token('red-600'), WHITE],
  ['amber-700 on white (audit WARN badge)', token('amber-700'), WHITE],
  ['emerald-700 on white (ACTIVE / healthy pct)', token('emerald-700'), WHITE],
  ['slate-500 on white (control)', token('slate-500'), WHITE],
];
// The banned pairs, recorded with their numbers (why the literals died).
const bannedCases = [
  ['red-500 on white (was: check FAIL text + tiles)', token('red-500'), WHITE],
  ['orange-500 on white (was: low-stock tile text)', token('orange-500'), WHITE],
  ['orange-600 on white (was: watchlist qty text)', token('orange-600'), WHITE],
  ['amber-500 icon on slate-50 (was: Unavailable icon)', token('amber-500'), SLATE_50],
];

let fail = 0;
console.log('v2.210.0 expert-table chips — ADOPTED (bar 4.5:1 text / 3:1 graphics):');
for (const [label, fg, bg] of adoptedCases) {
  const bar = label.includes('icon') ? 3 : 4.5;
  const r = ratio(fg, bg);
  const ok = r >= bar;
  if (!ok) fail++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2)}  ${label}`);
}
console.log('v2.210.0 expert-table chips — BANNED (recorded, expected below bar):');
for (const [label, fg, bg] of bannedCases) {
  const r = ratio(fg, bg);
  console.log(`  banned  ${r.toFixed(2)}  ${label}`);
}
process.exit(fail ? 1 : 0);
