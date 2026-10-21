#!/usr/bin/env node
// probe-desk-doors-v2202.mjs — pre-derivation probe for v2.202.0: the six
// door hues' voices (the /console KPI row's face inventory: orange revenue,
// blue transactions, amber stock, rose rentals, red debt, indigo pending)
// measured BEFORE anything ships, over the REAL paint stacks from the
// INSTALLED Tailwind theme.
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
const CARD_DARK = token('slate-900'); // dark:bg-slate-900 (the doors' own panels)
const CHIP_DARK = (c) => blend(token(c), 0.1, CARD_DARK);
const BG_CARD = WHITE; // bg-card resolves white in light

const HUES = ['orange', 'blue', 'amber', 'rose', 'red', 'indigo'];
console.log('── the six accents on the white panel (4.5:1, small text) ──');
for (const h of HUES) {
  console.log(`${ratio(token(`${h}-700`), WHITE) >= 4.5 ? 'PASS' : 'FAIL'}  ${h}-700 on white: ${ratio(token(`${h}-700`), WHITE).toFixed(2)}:1 (need 4.5:1)`);
}
console.log('── the six -50 chip grounds under their -700 voices (4.5:1) ──');
for (const h of HUES) {
  console.log(`${ratio(token(`${h}-700`), token(`${h}-50`)) >= 4.5 ? 'PASS' : 'FAIL'}  ${h}-700 on ${h}-50: ${ratio(token(`${h}-700`), token(`${h}-50`)).toFixed(2)}:1 (need 4.5:1)`);
}
console.log('── the six dark accents on slate-900 (4.5:1) ──');
for (const h of HUES) {
  console.log(`${ratio(token(`${h}-300`), CARD_DARK) >= 4.5 ? 'PASS' : 'FAIL'}  ${h}-300 on slate-900: ${ratio(token(`${h}-300`), CARD_DARK).toFixed(2)}:1 (need 4.5:1)`);
}
console.log('── the six dark chips on their -500/10 stacks (4.5:1) ──');
for (const h of HUES) {
  console.log(`${ratio(token(`${h}-300`), CHIP_DARK(`${h}-500`)) >= 4.5 ? 'PASS' : 'FAIL'}  ${h}-300 on ${h}-500/10: ${ratio(token(`${h}-300`), CHIP_DARK(`${h}-500`)).toFixed(2)}:1 (need 4.5:1)`);
}
console.log('── the six edges as graphics over the white card (3:1) ──');
for (const h of HUES) {
  console.log(`${ratio(token(`${h}-600`), BG_CARD) >= 3 ? 'PASS' : 'FAIL'}  ${h}-600 edge on bg-card: ${ratio(token(`${h}-600`), BG_CARD).toFixed(2)}:1 (need 3:1)`);
}
console.log('── the sweep\'s alignment candidates (org-console stragglers) ──');
console.log(`  note: red-600 on bg-card (light) = ${ratio(token('red-600'), BG_CARD).toFixed(2)}:1 — PASSES 4.5 on the installed palette; the overdue cell re-voices to red-700 (${ratio(token('red-700'), BG_CARD).toFixed(2)}:1) as FAMILY ALIGNMENT (the Task-188 record), not a violation.`);
console.log('── the dots (hot rings lit only by a nonzero figure) ──');
for (const h of HUES) {
  console.log(`  note: ${h}-600 dot on white = ${ratio(token(`${h}-600`), WHITE).toFixed(2)}:1 — the dot is aria-hidden decoration; the figure it hints at is the card's own value text.`);
}
