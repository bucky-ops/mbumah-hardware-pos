#!/usr/bin/env node
// v2.197.0 contrast math — the reorder watchlist (card + drill-down) and
// the card face's re-hue.
//
// The new face: the card (the row's fourth button — amber edge, watchlist
// chip, the severity mini bar) and the drill-down (the severity bar at
// reading size, the four bucket cells with their honest shares, the amber
// units-short strip, the named watchlist rows with coverage chips, the
// watchlist by branch).
//
// THE DISCOVERY THIS SCRIPT RECORDS: the low-stock card's hot number AND
// its icon rode `text-orange-500` since the card shipped (v2.176.0 era) —
// orange-500 over the card's white computes 2.81:1, below even the 3:1
// bar the 24px-bold headline (large text) and the 14px icon (non-text
// UI component) must meet. Unnoticed because every prior KPI audit
// measured the MODALS' interiors; the mute tiles' own voices were never
// on the ledger until the tile became a voice. v2.197.0 re-hues the
// face to amber-600 (3.20:1 — passes both 3:1 bars; amber-500 would
// have FAILED at 2.15:1, which is why the face goes one step deeper) —
// and the pre-fix combinations are pinned below the 3 bar in reverse
// (the rows the fix must keep behind it). The MODAL's 24px headline
// count goes one step deeper still (amber-700): the debt modal's
// headline held the full 4.5 text bar and the count face keeps that
// stricter house line over the slate-50 panel.
//
// The severity bar's segments are DECORATION by the house rule: the
// figures are aria-labeled on the bar itself AND spoken twice beside it
// (the card's aria-label; the modal's four grid cells with their shares)
// — so the pastel segment fills (amber-400 the lightest) are exempt from
// the 3:1 non-text bar and deliberately NOT asserted here; asserting
// them would flatter the math, not inform it. What must carry is
// measured: every text family over its REAL composite chain —
//   light: dialog → panel (slate-50, opaque) → strip (amber-50/70) → chip
//   dark:  dialog → panel (slate-900, opaque) → strip (amber-500/10) → chip
// and the watchlist sections sit OUTSIDE the panel, on the dialog ground.
//
// The recipe (docs/a11y/contrast-math.md): oklch -> sRGB first, composite
// the real paint stack bottom-up, WCAG 4.5:1 for text (the card's 24px
// bold headline and its strokes take the 3:1 bars), 3:1 for the strokes
// that exist (the card's amber edge). Token values from the INSTALLED
// Tailwind theme; the dialog ground from src/app/globals.css; every
// pinned literal asserted FROM the component source.
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

// The grounds, read from the real sources — never from memory.
const globalsCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const dialogSrc = readFileSync(join(process.cwd(), 'src/components/ui/dialog.tsx'), 'utf8');
if (!dialogSrc.includes('bg-background')) throw new Error('ui/dialog.tsx no longer paints bg-background — re-derive the ground');
const kpiSrc = readFileSync(join(process.cwd(), 'src/components/org/kpi-row.tsx'), 'utf8');
// The literals this release pinned (assert FROM the component source — if
// these drift, the numbers below are measuring a ghost).
if (!kpiSrc.includes('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900')) throw new Error('the modal panel dark half drifted — re-derive');
if (!kpiSrc.includes('text-amber-700 ring-1 ring-amber-200')) throw new Error('the watchlist chip literals drifted — re-derive');
if (!kpiSrc.includes('border border-amber-100 bg-amber-50/70 px-2.5 py-1.5 dark:border-amber-500/30 dark:bg-amber-500/10')) throw new Error('the amber strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-500/30')) throw new Error('the short-items chip dark half drifted — re-derive');
if (!kpiSrc.includes('text-amber-700 dark:text-amber-400')) throw new Error('the headline/figure dark voice drifted — re-derive');
if (!kpiSrc.includes("'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'")) throw new Error('the out coverage chip drifted — re-derive');
if (!kpiSrc.includes("'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30'")) throw new Error('the critical coverage chip drifted — re-derive');
if (!kpiSrc.includes("'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'")) throw new Error('the below coverage chip drifted — re-derive');
if (!kpiSrc.includes("'text-amber-600' : 'text-slate-700'")) throw new Error('the card hot number re-hue drifted — re-derive');
if (!kpiSrc.includes('<PackageOpen className="h-3.5 w-3.5 text-amber-600" />')) throw new Error('the card icon re-hue drifted — re-derive');
if (!kpiSrc.includes('<span className="absolute inset-y-0 left-0 w-1 bg-amber-600" />')) throw new Error('the card edge re-hue drifted — re-derive');
if ((kpiSrc.split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1) !== 4) throw new Error('the fourth panel did not join the dark-half law — re-derive');

const readBgToken = (block) => {
  const m = block.match(/--background: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error('--background oklch not found in the expected block');
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootBlock = globalsCss.slice(globalsCss.indexOf(':root {'), globalsCss.indexOf('.dark {'));
const darkBlock = globalsCss.slice(globalsCss.indexOf('.dark {'), globalsCss.indexOf('.dark {') + 2500);
const DIALOG_LIGHT = readBgToken(rootBlock);
const DIALOG_DARK = readBgToken(darkBlock);

// The REAL chain, bottom-up: the panels are OPAQUE in both modes, so the
// interior composites stack over the PANEL; the watchlist sections sit
// outside the panel on the DIALOG ground.
const PANEL_LIGHT = token('slate-50');
const PANEL_DARK = token('slate-900');
const AMBER_STRIP_LIGHT = blend(token('amber-50'), 0.7, PANEL_LIGHT); // bg-amber-50/70
const AMBER_STRIP_DARK = blend(token('amber-500'), 0.1, PANEL_DARK); // dark:bg-amber-500/10
// The short-items chip INSIDE the strip: light is transparent over the
// strip's own paint; dark swaps to -500/20 over the strip's -500/10.
const AMBER_CHIP_DARK = blend(token('amber-500'), 0.2, AMBER_STRIP_DARK);
// The coverage chips sit in the watchlist SECTIONS — their dark halves
// composite over the DIALOG ground, not a strip.
const CHIP_DARK_GROUND = (c) => blend(token(c), 0.1, DIALOG_DARK);
const CARD = token('white');

let pass = 0, fail = 0, total = 0;
const check = (label, fg, bg, need) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need ${need}:1)`);
};
const checkBug = (label, fg, bg, max) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r < max;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (the pre-fix state, must stay under ${max}:1)`);
};

console.log('── the discovery: the card face rode orange-500 under the 3:1 bars ──');
checkBug('pre-fix hot number orange-500 on white (24px bold, 3:1 bar)', token('orange-500'), CARD, 3);
checkBug('pre-fix icon orange-500 on white (non-text, 3:1 bar)', token('orange-500'), CARD, 3);
checkBug('the amber-500 alternative would ALSO fail (why the face goes to amber-600)', token('amber-500'), CARD, 3);

console.log('── light mode: the watchlist interior over the slate-50 panel ──');
check('headline label slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('headline count amber-700 on panel', token('amber-700'), PANEL_LIGHT, 4.5);
check('meta line slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('grid label slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('grid value slate-800 on panel', token('slate-800'), PANEL_LIGHT, 4.5);
check('grid share slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
console.log('── light: the amber units-short strip over the panel ──');
check('strip label amber-800 on amber-50/70', token('amber-800'), AMBER_STRIP_LIGHT, 4.5);
check('strip amount amber-900 on amber-50/70', token('amber-900'), AMBER_STRIP_LIGHT, 4.5);
check('strip items chip amber-700 on the strip paint', token('amber-700'), AMBER_STRIP_LIGHT, 4.5);
console.log('── light: the watchlist sections on the dialog ground ──');
check('section header slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('section sub-line slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('item name slate-700 on dialog', token('slate-700'), DIALOG_LIGHT, 4.5);
check('item sku/store line slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('branch name slate-600 on dialog', token('slate-600'), DIALOG_LIGHT, 4.5);
check('branch figure amber-700 on dialog', token('amber-700'), DIALOG_LIGHT, 4.5);
check('item qty/reorder pair amber-700 on dialog', token('amber-700'), DIALOG_LIGHT, 4.5);
console.log('── light chips (opaque -50 grounds, stack-independent) ──');
check('coverage out red-700 on red-50', token('red-700'), token('red-50'), 4.5);
check('coverage critical orange-700 on orange-50', token('orange-700'), token('orange-50'), 4.5);
check('coverage below amber-700 on amber-50', token('amber-700'), token('amber-50'), 4.5);
check('coverage at-level slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);
check('card watchlist chip amber-700 on amber-50', token('amber-700'), token('amber-50'), 4.5);

console.log('── dark mode: the watchlist interior over the slate-900 panel ──');
check('headline label slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('headline count amber-400 on panel', token('amber-400'), PANEL_DARK, 4.5);
check('meta line slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('grid label slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('grid value slate-100 on panel', token('slate-100'), PANEL_DARK, 4.5);
check('grid share slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
console.log('── dark: the amber units-short strip over the panel ──');
check('strip label amber-300 on amber-500/10', token('amber-300'), AMBER_STRIP_DARK, 4.5);
check('strip amount amber-200 on amber-500/10', token('amber-200'), AMBER_STRIP_DARK, 4.5);
check('strip items chip amber-300 on amber-500/20 stack', token('amber-300'), AMBER_CHIP_DARK, 4.5);
console.log('── dark: the watchlist sections on the dialog ground ──');
check('section header slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('section sub-line slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('item name slate-200 on dialog', token('slate-200'), DIALOG_DARK, 4.5);
check('item sku/store line slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('branch name slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('branch figure amber-400 on dialog', token('amber-400'), DIALOG_DARK, 4.5);
check('item qty/reorder pair amber-400 on dialog', token('amber-400'), DIALOG_DARK, 4.5);
console.log('── dark chips (-500/10 over the dialog ground) ──');
check('coverage out red-300 on red-500/10', token('red-300'), CHIP_DARK_GROUND('red-500'), 4.5);
check('coverage critical orange-300 on orange-500/10', token('orange-300'), CHIP_DARK_GROUND('orange-500'), 4.5);
check('coverage below amber-300 on amber-500/10', token('amber-300'), CHIP_DARK_GROUND('amber-500'), 4.5);
check('coverage at-level slate-400 on slate-500/10', token('slate-400'), CHIP_DARK_GROUND('slate-500'), 4.5);

console.log('── the card (white in BOTH modes by design — the light voice is correct) ──');
check('card hot number amber-600 on white (24px bold, large-text bar) — THE FIX', token('amber-600'), CARD, 3);
check('card icon amber-600 on white (non-text bar) — THE FIX', token('amber-600'), CARD, 3);
check('card edge amber-600 on white (non-text stroke) — THE FIX', token('amber-600'), CARD, 3);
check('card calm number slate-700 on white (24px bold)', token('slate-700'), CARD, 3);
check('card footer line slate-500 on white (10px)', token('slate-500'), CARD, 4.5);

console.log('── the severity bar: decoration by the house rule (NOT asserted) ──');
console.log('        the segments are aria-labeled on the bar AND spoken twice beside');
console.log('        it (the card aria-label; the modal grid with shares) — the pastel fills');
console.log('        (amber-400 the lightest) are exempt from the 3:1 non-text bar; the');
console.log('        bar adds no figure the text does not already carry.');

console.log(`\n${pass}/${total} families pass (3 discovery rows prove the pre-fix card-face gap at 2.81:1 under the 3:1 bars — the fix re-hues to amber-600 3.20:1 and the modal count holds the 4.5 bar at amber-700; the bar's pastel fills documented as decoration, not asserted).`);
process.exit(fail > 0 ? 1 : 0);
