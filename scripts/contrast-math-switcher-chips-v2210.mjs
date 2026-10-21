#!/usr/bin/env node
// v2.210.0 contrast math — the CurrencySwitcher's honest-source chips
// (src/components/currency-switcher.tsx). The dropdown content paints an
// OPAQUE `bg-popover` ground (src/components/ui/dropdown-menu.tsx), so the
// real ground is the POPOVER token from globals.css (:root / .dark) — NOT
// the page background token. Three chip families ride the panel:
//   MANUAL (admin-set): light `bg-emerald-50 text-emerald-700`,
//                       dark `bg-emerald-500/15 text-emerald-300`
//   API:                light `bg-blue-50 text-blue-700`,
//                       dark `bg-blue-500/15 text-blue-300`
//   STATIC (built-in):  plain muted text `text-muted-foreground` light+dark
// Every chip text is 10px font-medium — small text, the 4.5:1 bar applies
// (docs/a11y/contrast-math.md recipe: oklch -> sRGB, composite the real
// stack bottom-up, WCAG ratio).
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
const menuSrc = readFileSync(join(process.cwd(), 'src/components/ui/dropdown-menu.tsx'), 'utf8');
if (!menuSrc.includes('bg-popover text-popover-foreground')) {
  throw new Error('dropdown-menu.tsx no longer paints bg-popover — re-derive the ground');
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

// The real grounds: --popover from globals.css (oklch triplets).
const readPopover = (block) => {
  const m = block.match(/--popover: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error('--popover oklch not found in the expected block');
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootBlock = globalsCss.slice(globalsCss.indexOf(':root {'), globalsCss.indexOf('.dark {'));
const darkBlock = globalsCss.slice(globalsCss.indexOf('.dark {'), globalsCss.indexOf('.dark {') + 2500);
const POPOVER_LIGHT = readPopover(rootBlock);
const POPOVER_DARK = readPopover(darkBlock);

// muted-foreground tokens (the STATIC chip's text) from globals.css.
const readFg = (block) => {
  const m = block.match(/--muted-foreground: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error('--muted-foreground not found');
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const MUTED_LIGHT = readFg(rootBlock);
const MUTED_DARK = readFg(darkBlock);

const cases = [
  ['MANUAL light  emerald-700 on emerald-50/popover', token('emerald-700'), blend(token('emerald-50'), 1, POPOVER_LIGHT)],
  ['MANUAL dark   emerald-300 on emerald-500/15/popover', token('emerald-300'), blend(token('emerald-500'), 0.15, POPOVER_DARK)],
  ['API light     blue-700 on blue-50/popover', token('blue-700'), blend(token('blue-50'), 1, POPOVER_LIGHT)],
  ['API dark      blue-300 on blue-500/15/popover', token('blue-300'), blend(token('blue-500'), 0.15, POPOVER_DARK)],
  ['STATIC light  muted-foreground on popover', MUTED_LIGHT, POPOVER_LIGHT],
  ['STATIC dark   muted-foreground on popover', MUTED_DARK, POPOVER_DARK],
];

let fail = 0;
console.log('v2.210.0 switcher source-chip contrast (4.5:1 small-text bar):');
for (const [label, fg, bg] of cases) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}  ${label}`);
}
process.exit(fail ? 1 : 0);
