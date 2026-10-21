#!/usr/bin/env node
// v2.212.0 contrast math — the currency wire's live surfaces.
// New text the release puts on real grounds (globals.css :root / .dark —
// the source of record, same recipe as docs/a11y/contrast-math.md):
//   • the switcher footer's FRESHNESS LINE: muted-foreground on the
//     dropdown ground (bg-popover) — 10px small text, 4.5:1 bar.
//   • the TRACK-PAIR dialog's preview + helper voices: muted-foreground
//     on the dialog ground (DialogContent paints bg-background) — 10px.
//   • the SELECT options inside the track dialog: popover-foreground on
//     popover — the dialog's own pickers must read.
//   • the custom-pair badge + its reset affordance ride foreground /
//     muted-foreground on the card ground (bg-card/80 over background —
//     re-derived here; the v2.211 numbers for these two families are
//     re-verified so a token drift cannot slip through a reused class).
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
const switcherSrc = readFileSync(join(process.cwd(), 'src/components/currency-switcher.tsx'), 'utf8');
const sectionSrc = readFileSync(join(process.cwd(), 'src/components/admin/currency-rates-section.tsx'), 'utf8');
// The ground contracts this script measures against.
if (!sectionSrc.includes('backdrop-blur-sm bg-card/80 border-border/50')) {
  throw new Error('currency-rates-section.tsx no longer paints bg-card/80 — re-derive the ground');
}
if (!switcherSrc.includes('Wire read at ')) {
  throw new Error('currency-switcher.tsx lost the freshness voice — nothing to measure');
}
if (!sectionSrc.includes('Track a currency pair')) {
  throw new Error('currency-rates-section.tsx lost the track-pair dialog — nothing to measure');
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

const readOklch = (block, name) => {
  const m = block.match(new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`--${name} oklch not found in the expected block`);
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootStart = globalsCss.indexOf(':root {');
const darkStart = globalsCss.indexOf('.dark {');
const rootBlock = globalsCss.slice(rootStart, darkStart);
const darkBlock = globalsCss.slice(darkStart, darkStart + 2500);
const BG_LIGHT = readOklch(rootBlock, 'background');
const BG_DARK = readOklch(darkBlock, 'background');
const CARD_LIGHT = blend(readOklch(rootBlock, 'card'), 0.8, BG_LIGHT);
const CARD_DARK = blend(readOklch(darkBlock, 'card'), 0.8, BG_DARK);
const POP_LIGHT = readOklch(rootBlock, 'popover');
const POP_DARK = readOklch(darkBlock, 'popover');
const MUTED_LIGHT = readOklch(rootBlock, 'muted-foreground');
const MUTED_DARK = readOklch(darkBlock, 'muted-foreground');
const POPFG_LIGHT = readOklch(rootBlock, 'popover-foreground');
const POPFG_DARK = readOklch(darkBlock, 'popover-foreground');
const FG_LIGHT = readOklch(rootBlock, 'foreground');
const FG_DARK = readOklch(darkBlock, 'foreground');

const cases = [
  // The freshness voice — the dropdown footer's new last line.
  ['FRESHNESS light  muted-fg on popover', MUTED_LIGHT, POP_LIGHT],
  ['FRESHNESS dark   muted-fg on popover', MUTED_DARK, POP_DARK],
  // The track-pair dialog — preview + helper text on the dialog ground.
  ['TRACK light      muted-fg on dialog bg', MUTED_LIGHT, BG_LIGHT],
  ['TRACK dark       muted-fg on dialog bg', MUTED_DARK, BG_DARK],
  // The dialog's selects — the options must read on their popover ground.
  ['SELECT light     popover-fg on popover', POPFG_LIGHT, POP_LIGHT],
  ['SELECT dark      popover-fg on popover', POPFG_DARK, POP_DARK],
  // The custom-pair strip — badge text + reset affordance on the card.
  ['STRIP light      foreground on card/80', FG_LIGHT, CARD_LIGHT],
  ['STRIP dark       foreground on card/80', FG_DARK, CARD_DARK],
  ['STRIP-RESET light muted-fg on card/80', MUTED_LIGHT, CARD_LIGHT],
  ['STRIP-RESET dark muted-fg on card/80', MUTED_DARK, CARD_DARK],
];

let fail = 0;
console.log('v2.212.0 currency-wire contrast (4.5:1 small-text bar):');
for (const [label, fg, bg] of cases) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}  ${label}`);
}
process.exit(fail ? 1 : 0);
