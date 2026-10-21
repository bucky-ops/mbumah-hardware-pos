#!/usr/bin/env node
// v2.198.0 contrast math — the rental yard (card + drill-down) and the
// Expert ledger's OVERDUE badge re-voice.
//
// The new face: the card (the row's fifth button — rose edge, roster chip,
// the breach-age mini bar) and the drill-down (the breach-age bar at
// reading size, the four bucket cells with their honest shares, the rose
// per-day exposure strip, the named overdue roster with status/days chips,
// the active rentals as the yard's calm half, the roster by branch).
//
// THE DISCOVERY THIS SCRIPT RECORDS: the Expert panel's rental ledger has
// voiced its OVERDUE badge `text-red-600` on `bg-red-50` since the Expert
// panel shipped — the combination computes **4.40:1** (the script below
// measures the installed tokens), under the 4.5:1 text bar the badge's
// 10px text must meet. Unnoticed because the badge families were audited
// as a class (v2.191's drill-down badges) on the drills' own -50 grounds —
// this badge sits in the EXPERTS table, a different surface nobody
// re-measured when the rental ledger shipped. v2.198.0 re-voices the
// badge to red-700 (5.88:1 — the same voice the debt ledger's overdue
// status chip already speaks) and pins the pre-fix combination below the
// 4.5 bar in reverse so it cannot return silently.
//
// The breach-age bar's segments are DECORATION by the house rule: the
// figures are aria-labeled on the bar itself AND spoken twice beside it
// (the card's aria-label; the modal's four grid cells with their shares)
// — so the pastel segment fills (amber-400 the lightest) are exempt from
// the 3:1 non-text bar and deliberately NOT asserted here; asserting
// them would flatter the math, not inform it. What must carry is
// measured: every text family over its REAL composite chain —
//   light: dialog → panel (slate-50, opaque) → strip (rose-50/70) → chip
//   dark:  dialog → panel (slate-900, opaque) → strip (rose-500/10) → chip
// and the yard sections sit OUTSIDE the panel, on the dialog ground.
//
// The recipe (docs/a11y/contrast-math.md): oklch -> sRGB first, composite
// the real paint stack bottom-up, WCAG 4.5:1 for text (the card's 24px
// bold headline takes the 3:1 large-text bar), 3:1 for the strokes that
// exist (the card's rose edge). Token values from the INSTALLED Tailwind
// theme; the dialog ground from src/app/globals.css; every pinned literal
// asserted FROM the component source.
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
const expertsSrc = readFileSync(join(process.cwd(), 'src/components/org/experts.tsx'), 'utf8');
// The literals this release pinned (assert FROM the component source — if
// these drift, the numbers below are measuring a ghost).
if (!kpiSrc.includes('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900')) throw new Error('the modal panel dark half drifted — re-derive');
if (!kpiSrc.includes('text-rose-700 ring-1 ring-rose-200')) throw new Error('the roster chip literals drifted — re-derive');
if (!kpiSrc.includes('border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10')) throw new Error('the rose strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-rose-500/20 dark:text-rose-300 dark:ring-rose-500/30')) throw new Error('the exposure chip dark half drifted — re-derive');
if (!kpiSrc.includes('text-rose-700 dark:text-rose-400')) throw new Error('the figure dark voice drifted — re-derive');
if (!kpiSrc.includes('text-2xl font-bold text-rose-700 dark:text-rose-400')) throw new Error('the headline voice drifted — re-derive');
if (!kpiSrc.includes("'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'")) throw new Error('the overdue status chip drifted — re-derive');
if (!kpiSrc.includes("'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'")) throw new Error('the active status chip drifted — re-derive');
if (!kpiSrc.includes("'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30'")) throw new Error('the days chip drifted — re-derive');
if (!kpiSrc.includes("'text-rose-600' : 'text-slate-700'")) throw new Error('the card hot number drifted — re-derive');
if (!kpiSrc.includes('<Clock3 className="h-3.5 w-3.5 text-rose-600" /> Overdue')) throw new Error('the card icon drifted — re-derive');
if (!kpiSrc.includes('<span className="absolute inset-y-0 left-0 w-1 bg-rose-600" />')) throw new Error('the card edge drifted — re-derive');
if ((kpiSrc.split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1) !== 5) throw new Error('the fifth panel did not join the dark-half law — re-derive');
// THE DISCOVERY's fix, asserted from the Expert source: the OVERDUE badge
// wears red-700 now (red-600 measured 4.40:1 on its red-50 ground).
if (!expertsSrc.includes("r.status === 'OVERDUE' ? 'border-red-200 bg-red-50 text-red-700'")) throw new Error('the Expert OVERDUE badge re-voice drifted — re-derive');
if (expertsSrc.includes('bg-red-50 text-red-600')) throw new Error('the Expert OVERDUE badge still rides red-600 — the 4.40:1 gap returned');

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
// interior composites stack over the PANEL; the yard sections sit
// outside the panel on the DIALOG ground.
const PANEL_LIGHT = token('slate-50');
const PANEL_DARK = token('slate-900');
const ROSE_STRIP_LIGHT = blend(token('rose-50'), 0.7, PANEL_LIGHT); // bg-rose-50/70
const ROSE_STRIP_DARK = blend(token('rose-500'), 0.1, PANEL_DARK); // dark:bg-rose-500/10
// The exposure chip INSIDE the strip: light is transparent over the
// strip's own paint; dark swaps to -500/20 over the strip's -500/10.
const ROSE_CHIP_DARK = blend(token('rose-500'), 0.2, ROSE_STRIP_DARK);
// The status/days chips sit in the yard SECTIONS — their dark halves
// composite over the DIALOG ground, not a strip.
const CHIP_DARK_GROUND = (c) => blend(token(c), 0.1, DIALOG_DARK);
// The Expert badge sits on the experts page's own ground (white card).
const EXPERT_CARD = token('white');
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

console.log('── the discovery: the Expert OVERDUE badge rode red-600 on red-50 ──');
checkBug('pre-fix Expert OVERDUE badge red-600 on red-50 (10px text, 4.5 bar)', token('red-600'), token('red-50'), 4.5);

console.log('── light mode: the yard interior over the slate-50 panel ──');
check('headline label slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('headline count rose-700 on panel', token('rose-700'), PANEL_LIGHT, 4.5);
check('meta line slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('grid label slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('grid value slate-800 on panel', token('slate-800'), PANEL_LIGHT, 4.5);
check('grid share slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
console.log('── light: the rose per-day exposure strip over the panel ──');
check('strip label rose-800 on rose-50/70', token('rose-800'), ROSE_STRIP_LIGHT, 4.5);
check('strip amount rose-900 on rose-50/70', token('rose-900'), ROSE_STRIP_LIGHT, 4.5);
check('strip rentals chip rose-700 on the strip paint', token('rose-700'), ROSE_STRIP_LIGHT, 4.5);
console.log('── light: the yard sections on the dialog ground ──');
check('section header slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('section sub-line slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('roster customer slate-700 on dialog', token('slate-700'), DIALOG_LIGHT, 4.5);
check('roster item/store line slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('branch name slate-600 on dialog', token('slate-600'), DIALOG_LIGHT, 4.5);
check('rate figure rose-700 on dialog', token('rose-700'), DIALOG_LIGHT, 4.5);
check('active rate slate-700 on dialog', token('slate-700'), DIALOG_LIGHT, 4.5);
console.log('── light chips (opaque -50 grounds, stack-independent) ──');
check('status overdue red-700 on red-50', token('red-700'), token('red-50'), 4.5);
check('status active emerald-700 on emerald-50', token('emerald-700'), token('emerald-50'), 4.5);
check('days chip rose-700 on rose-50', token('rose-700'), token('rose-50'), 4.5);
check('days chip calm slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);
check('card roster chip rose-700 on rose-50', token('rose-700'), token('rose-50'), 4.5);
check('Expert badge FIXED red-700 on red-50', token('red-700'), token('red-50'), 4.5);
check('Expert badge active emerald-700 on white', token('emerald-700'), EXPERT_CARD, 4.5);

console.log('── dark mode: the yard interior over the slate-900 panel ──');
check('headline label slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('headline count rose-400 on panel', token('rose-400'), PANEL_DARK, 4.5);
check('meta line slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('grid label slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('grid value slate-100 on panel', token('slate-100'), PANEL_DARK, 4.5);
check('grid share slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
console.log('── dark: the rose per-day exposure strip over the panel ──');
check('strip label rose-300 on rose-500/10', token('rose-300'), ROSE_STRIP_DARK, 4.5);
check('strip amount rose-200 on rose-500/10', token('rose-200'), ROSE_STRIP_DARK, 4.5);
check('strip rentals chip rose-300 on rose-500/20 stack', token('rose-300'), ROSE_CHIP_DARK, 4.5);
console.log('── dark: the yard sections on the dialog ground ──');
check('section header slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('section sub-line slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('roster customer slate-200 on dialog', token('slate-200'), DIALOG_DARK, 4.5);
check('roster item/store line slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('branch name slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('rate figure rose-400 on dialog', token('rose-400'), DIALOG_DARK, 4.5);
check('active rate slate-300 on dialog', token('slate-300'), DIALOG_DARK, 4.5);
console.log('── dark chips (-500/10 over the dialog ground) ──');
check('status overdue red-300 on red-500/10', token('red-300'), CHIP_DARK_GROUND('red-500'), 4.5);
check('status active emerald-300 on emerald-500/10', token('emerald-300'), CHIP_DARK_GROUND('emerald-500'), 4.5);
check('days chip rose-300 on rose-500/10', token('rose-300'), CHIP_DARK_GROUND('rose-500'), 4.5);
check('days chip calm slate-400 on slate-500/10', token('slate-400'), CHIP_DARK_GROUND('slate-500'), 4.5);

console.log('── the card (white in BOTH modes by design — the light voice is correct) ──');
check('card hot number rose-600 on white (24px bold, large-text bar)', token('rose-600'), CARD, 3);
check('card icon rose-600 on white (non-text bar)', token('rose-600'), CARD, 3);
check('card edge rose-600 on white (non-text stroke)', token('rose-600'), CARD, 3);
check('card calm number slate-700 on white (24px bold)', token('slate-700'), CARD, 3);
check('card footer line slate-500 on white (10px)', token('slate-500'), CARD, 4.5);

console.log('── the breach-age bar: decoration by the house rule (NOT asserted) ──');
console.log('        the segments are aria-labeled on the bar AND spoken twice beside');
console.log('        it (the card aria-label; the modal grid with shares) — the pastel fills');
console.log('        (amber-400 the lightest) are exempt from the 3:1 non-text bar; the');
console.log('        bar adds no figure the text does not already carry.');

console.log(`\n${pass}/${total} families pass (1 discovery row proves the Expert OVERDUE badge gap at under 4.5 — the fix re-voices to red-700; the bar's pastel fills documented as decoration, not asserted).`);
process.exit(fail > 0 ? 1 : 0);
