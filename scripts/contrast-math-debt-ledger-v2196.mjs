#!/usr/bin/env node
// v2.196.0 contrast math — the debt ledger (card + drill-down) and the
// section headers' dark voice.
//
// The new face: the card (the row's third button — red edge, ledger chip,
// the aging composition bar) and the drill-down (the composition bar at
// reading size, the four bucket cells with their honest shares, the rose
// overdue strip, the named ledger rows with status/bucket chips, the
// ledger by branch).
//
// THE DISCOVERY THIS SCRIPT RECORDS: the modal section headers ("The week
// by branch" and their sub-lines) have ridden `text-slate-500` with NO
// dark voice since v2.176.0 — on the dark dialog the combination measures
// 4.15:1 (below the 4.5:1 text bar these 10-11px lines must meet), in
// BOTH sibling modals, unnoticed because the v2.195.0 audit measured the
// panel interiors and the rows but not the section headers between them.
// A marginal gap, a real one. v2.196.0 fixes all four headers and their
// sub-lines (dark:text-slate-400 — 7.53:1) as part of the ledger's birth
// — the new sections were not allowed to inherit it. The pre-fix
// combination is pinned below the 4.5 bar in reverse (the rows the fix
// must keep behind it).
//
// The composition bar's segments are DECORATION by the house rule: the
// figure is aria-labeled on the bar itself AND spoken twice beside it
// (the card's aging badges; the modal's four grid cells with their
// shares) — so the pastel segment fills (amber-400 the lightest) are
// exempt from the 3:1 non-text bar and deliberately NOT asserted here;
// asserting them would flatter the math, not inform it. What must carry
// is measured: every text family over its REAL composite chain —
//   light: dialog → panel (slate-50, opaque) → strip (rose-50/70) → chip
//   dark:  dialog → panel (slate-900, opaque) → strip (rose-500/10) → chip
// and the ledger sections sit OUTSIDE the panel, on the dialog ground.
//
// The recipe (docs/a11y/contrast-math.md): oklch -> sRGB first, composite
// the real paint stack bottom-up, WCAG 4.5:1 for text (the card's 20px
// bold headline takes the 3:1 large-text bar), 3:1 for the strokes that
// exist (the card's red edge). Token values from the INSTALLED Tailwind
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
// The literals this release pinned (assert FROM the component source — if
// these drift, the numbers below are measuring a ghost).
if (!kpiSrc.includes('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900')) throw new Error('the modal panel dark half drifted — re-derive');
if (!kpiSrc.includes('text-red-700 ring-1 ring-red-200')) throw new Error('the ledger chip literals drifted — re-derive');
if (!kpiSrc.includes('border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10')) throw new Error('the rose strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-rose-500/20 dark:text-rose-300 dark:ring-rose-500/30')) throw new Error('the rose share chip dark half drifted — re-derive');
if (!kpiSrc.includes("'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'")) throw new Error('the partial status chip drifted — re-derive');
if (!kpiSrc.includes("'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'")) throw new Error('the overdue status chip drifted — re-derive');
if (!kpiSrc.includes('uppercase tracking-wide text-slate-500 dark:text-slate-400">The week by branch')) throw new Error('the section-header dark fix drifted — re-derive');
if (!kpiSrc.includes('mb-2 text-[10px] text-slate-500 dark:text-slate-400')) throw new Error('the section sub-line dark fix drifted — re-derive');
if (!kpiSrc.includes('text-red-600 dark:text-red-400')) throw new Error('the headline dark voice drifted — re-derive');
if ((kpiSrc.split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1) !== 3) throw new Error('the third panel did not join the dark-half law — re-derive');

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
// interior composites stack over the PANEL; the ledger sections sit
// outside the panel on the DIALOG ground.
const PANEL_LIGHT = token('slate-50');
const PANEL_DARK = token('slate-900');
const ROSE_STRIP_LIGHT = blend(token('rose-50'), 0.7, PANEL_LIGHT); // bg-rose-50/70
const ROSE_STRIP_DARK = blend(token('rose-500'), 0.1, PANEL_DARK); // dark:bg-rose-500/10
// The share chip INSIDE the strip: light is transparent over the strip's
// own paint; dark swaps to -500/20 over the strip's -500/10.
const ROSE_CHIP_DARK = blend(token('rose-500'), 0.2, ROSE_STRIP_DARK);
// The status/bucket chips sit in the ledger SECTIONS — their dark halves
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

console.log('── the discovery: the section headers rode light-only slate-500 since v2.176.0 ──');
checkBug('pre-fix section header slate-500 on the dark dialog', token('slate-500'), DIALOG_DARK, 4.5);
checkBug('pre-fix section sub-line slate-500 on the dark dialog', token('slate-500'), DIALOG_DARK, 4.5);
checkBug('pre-fix header voice on the dark panel', token('slate-500'), PANEL_DARK, 4.5);

console.log('── light mode: the ledger interior over the slate-50 panel ──');
check('headline label slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('headline total red-600 on panel', token('red-600'), PANEL_LIGHT, 4.5);
check('meta line slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('grid label slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('grid value slate-800 on panel', token('slate-800'), PANEL_LIGHT, 4.5);
check('grid share slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
console.log('── light: the rose overdue strip over the panel ──');
check('strip label rose-800 on rose-50/70', token('rose-800'), ROSE_STRIP_LIGHT, 4.5);
check('strip amount rose-900 on rose-50/70', token('rose-900'), ROSE_STRIP_LIGHT, 4.5);
check('strip share chip rose-700 on the strip paint', token('rose-700'), ROSE_STRIP_LIGHT, 4.5);
console.log('── light: the ledger sections on the dialog ground ──');
check('section header slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('section sub-line slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('debtor name slate-700 on dialog', token('slate-700'), DIALOG_LIGHT, 4.5);
check('debtor store slate-500 on dialog', token('slate-500'), DIALOG_LIGHT, 4.5);
check('branch name slate-600 on dialog', token('slate-600'), DIALOG_LIGHT, 4.5);
check('branch count slate-700 on dialog', token('slate-700'), DIALOG_LIGHT, 4.5);
console.log('── light chips (opaque -50 grounds, stack-independent) ──');
check('status partial amber-700 on amber-50', token('amber-700'), token('amber-50'), 4.5);
check('status overdue red-700 on red-50', token('red-700'), token('red-50'), 4.5);
check('status other slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);
check('bucket chip slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);
check('card ledger chip red-700 on red-50', token('red-700'), token('red-50'), 4.5);

console.log('── dark mode: the ledger interior over the slate-900 panel ──');
check('headline label slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('headline total red-400 on panel', token('red-400'), PANEL_DARK, 4.5);
check('meta line slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('grid label slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('grid value slate-100 on panel', token('slate-100'), PANEL_DARK, 4.5);
check('grid share slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
console.log('── dark: the rose overdue strip over the panel ──');
check('strip label rose-300 on rose-500/10', token('rose-300'), ROSE_STRIP_DARK, 4.5);
check('strip amount rose-200 on rose-500/10', token('rose-200'), ROSE_STRIP_DARK, 4.5);
check('strip share chip rose-300 on rose-500/20 stack', token('rose-300'), ROSE_CHIP_DARK, 4.5);
console.log('── dark: the ledger sections on the 0.145 dialog ──');
check('section header slate-400 on dialog (THE FIX)', token('slate-400'), DIALOG_DARK, 4.5);
check('section sub-line slate-400 on dialog (THE FIX)', token('slate-400'), DIALOG_DARK, 4.5);
check('debtor name slate-200 on dialog', token('slate-200'), DIALOG_DARK, 4.5);
check('debtor store slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('branch name slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('branch count slate-300 on dialog', token('slate-300'), DIALOG_DARK, 4.5);
console.log('── dark chips (-500/10 over the dialog ground) ──');
check('status partial amber-300 on amber-500/10', token('amber-300'), CHIP_DARK_GROUND('amber-500'), 4.5);
check('status overdue red-300 on red-500/10', token('red-300'), CHIP_DARK_GROUND('red-500'), 4.5);
check('status other slate-400 on slate-500/10', token('slate-400'), CHIP_DARK_GROUND('slate-500'), 4.5);
check('bucket chip slate-400 on slate-500/10', token('slate-400'), CHIP_DARK_GROUND('slate-500'), 4.5);

console.log('── the card (white in BOTH modes by design — the light voice is correct) ──');
check('card headline red-500 on white (20px bold, large-text bar)', token('red-500'), CARD, 3);
check('card ledger chip red-700 on red-50', token('red-700'), token('red-50'), 4.5);
check('card edge red-500 on white (non-text stroke)', token('red-500'), CARD, 3);

console.log('── the composition bar: decoration by the house rule (NOT asserted) ──');
console.log('        the segments are aria-labeled on the bar AND spoken twice beside');
console.log('        it (the card badges; the modal grid with shares) — the pastel fills');
console.log('        (amber-400 the lightest) are exempt from the 3:1 non-text bar; the');
console.log('        bar adds no figure the text does not already carry.');

console.log(`\n${pass}/${total} families pass (3 discovery rows prove the pre-fix header gap at 4.15:1 under the 4.5 bar; the bar's pastel fills documented as decoration, not asserted).`);
process.exit(fail > 0 ? 1 : 0);
