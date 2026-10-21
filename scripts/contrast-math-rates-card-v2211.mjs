#!/usr/bin/env node
// v2.211.0 contrast math — the Exchange Rates admin card
// (src/components/admin/currency-rates-section.tsx). The card paints
// `bg-card/80` over the page background, so the real ground is the CARD
// token composited at 80% over the BACKGROUND token (globals.css :root
// / .dark) — read from the source of record, not assumed. Families:
//   • source chips (the SAME measured palette the switcher uses —
//     re-verified here on the card ground):
//       MANUAL light `bg-emerald-50 text-emerald-700` (opaque chip)
//       MANUAL dark  `bg-emerald-500/15 text-emerald-300` (translucent
//                    over the card ground)
//       API light    `bg-blue-50 text-blue-700` / dark blue-500/15
//       STATIC       `text-muted-foreground` on the card
//   • the failed-wire state: `text-red-700` on `bg-red-50` (light),
//     `text-red-300` on `bg-red-900/10` over card (dark) — 4.5:1
//   • the destructive confirm action: `text-white` on `bg-red-600`
//   • muted helper text + table figures on the card ground
// Every chip/helper is 10-12px font-medium — small text, the 4.5:1 bar
// applies (docs/a11y/contrast-math.md recipe).
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

const globalsCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const sectionSrc = readFileSync(join(process.cwd(), 'src/components/admin/currency-rates-section.tsx'), 'utf8');
// The card's ground contract: bg-card/80 over the page background.
if (!sectionSrc.includes('backdrop-blur-sm bg-card/80 border-border/50')) {
  throw new Error('currency-rates-section.tsx no longer paints bg-card/80 — re-derive the ground');
}

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
const blend = (top, alpha, bottom) =>
  top.map((v, i) => v * alpha + bottom[i] * (1 - alpha));

// The real grounds from globals.css: --card composited 80% over --background.
const readOklch = (block, name) => {
  const m = block.match(new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`--${name} oklch not found in the expected block`);
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootStart = globalsCss.indexOf(':root {');
const darkStart = globalsCss.indexOf('.dark {');
const rootBlock = globalsCss.slice(rootStart, darkStart);
const darkBlock = globalsCss.slice(darkStart, darkStart + 2500);
const CARD_LIGHT = blend(readOklch(rootBlock, 'card'), 0.8, readOklch(rootBlock, 'background'));
const CARD_DARK = blend(readOklch(darkBlock, 'card'), 0.8, readOklch(darkBlock, 'background'));
const MUTED_LIGHT = readOklch(rootBlock, 'muted-foreground');
const MUTED_DARK = readOklch(darkBlock, 'muted-foreground');

const cases = [
  // Source chips — light chips are opaque (text on its own bg); dark chips
  // composite over the card ground.
  ['MANUAL light  emerald-700 on emerald-50', token('emerald-700'), token('emerald-50')],
  ['MANUAL dark   emerald-300 on emerald-500/15/card', token('emerald-300'), blend(token('emerald-500'), 0.15, CARD_DARK)],
  ['API light     blue-700 on blue-50', token('blue-700'), token('blue-50')],
  ['API dark      blue-300 on blue-500/15/card', token('blue-300'), blend(token('blue-500'), 0.15, CARD_DARK)],
  ['STATIC light  muted-foreground on card', MUTED_LIGHT, CARD_LIGHT],
  ['STATIC dark   muted-foreground on card', MUTED_DARK, CARD_DARK],
  // The failed-wire state (an error row that must still be readable).
  ['ERROR light   red-700 on red-50', token('red-700'), token('red-50')],
  ['ERROR dark    red-300 on red-900/10/card', token('red-300'), blend(token('red-900'), 0.10, CARD_DARK)],
  // The destructive confirm action (white on red-600).
  ['CONFIRM       white on red-600', token('white'), token('red-600')],
  // Table figures ride the default foreground — sanity on the card ground.
  ['FIGURES light foreground on card', readOklch(rootBlock, 'foreground'), CARD_LIGHT],
  ['FIGURES dark  foreground on card', readOklch(darkBlock, 'foreground'), CARD_DARK],
];

let fail = 0;
console.log('v2.211.0 exchange-rates card contrast (4.5:1 small-text bar):');
for (const [label, fg, bg] of cases) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}  ${label}`);
}
process.exit(fail ? 1 : 0);
