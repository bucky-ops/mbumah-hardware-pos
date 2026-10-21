#!/usr/bin/env node
// v2.195.0 contrast math — the transactions lens (card + drill-down) AND
// the modal-ground fix, re-derived over the REAL composite chain.
//
// THE DISCOVERY THIS SCRIPT RECORDS: v2.194.0's dark-voice fix derived its
// numbers over the DIALOG ground (ui/dialog.tsx paints bg-background —
// dark oklch(0.145 0.015 260)) — but the modal's body panel
// (`rounded-xl ... bg-slate-50`, no dark half) paints between the dialog
// and every interior token, and the DOM composites against the NEAREST
// painted ancestor. Measured live (agent-browser, dark class forced):
// dark:text-slate-100 values on the unpainted panel ≈ 1.09:1 (invisible),
// the -300 strip voices ≈ 1.5:1. v2.195.0 gives both body panels their
// dark half (`dark:border-slate-700 dark:bg-slate-900` — the lens toggle's
// dark face since v2.187.0) and THIS script re-derives every interior
// family over the real chain:
//   light: dialog → panel (slate-50, opaque) → strip ({c}-50/70) → chip
//   dark:  dialog → panel (slate-900, opaque) → strip ({c}-500/10) → chip
// The v2.194.0 numbers are superseded HERE (same tokens, truer grounds) —
// the a11y doc's revenue-modal section is annotated, not re-numbered.
//
// The new transactions face: the card (white by design in dark mode, like
// every KPI card) + the drill-down (spark, stat grid, the blue
// week-over-week strip, the branch rows on the dialog ground itself).
//
// The recipe (docs/a11y/contrast-math.md): oklch -> sRGB first, composite
// the real paint stack bottom-up, WCAG ratio vs 4.5:1 (the smallest text
// here is 9-10px; bold does not buy the 3:1 large-text bar) — spark
// strokes and the title glyph are aria-hidden DECORATION (the figures
// beside them speak), recorded under the 3:1 non-text bar for
// completeness only.
//
// Token values: palette from the INSTALLED Tailwind theme
// (node_modules/tailwindcss/theme.css) — the same source the browser
// paints; the dialog ground from src/app/globals.css (:root and .dark —
// the Dialog paints bg-background, asserted from ui/dialog.tsx); every
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
if (!kpiSrc.includes('dark:text-slate-400">Today')) throw new Error('the grid label dark fix drifted — re-derive');
if (!kpiSrc.includes('text-slate-800 dark:text-slate-100')) throw new Error('the grid value dark fix drifted — re-derive');
if (!kpiSrc.includes('dark:border-violet-500/30 dark:bg-violet-500/10')) throw new Error('the net strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:border-emerald-500/30 dark:bg-emerald-500/10')) throw new Error('the VAT strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:border-blue-500/30 dark:bg-blue-500/10')) throw new Error('the transactions strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/30')) throw new Error('the transactions prior chip dark half drifted — re-derive');
if (!kpiSrc.includes('stroke="#2563eb" width={380} height={80}')) throw new Error('the transactions spark literals drifted — re-derive');
if (!kpiSrc.includes('stroke="#2563eb" />')) throw new Error('the card spark literal drifted — re-derive');
if (!kpiSrc.includes('text-blue-700 ring-1 ring-blue-200')) throw new Error('the settled chip literals drifted — re-derive');
if (!kpiSrc.includes('stroke="#d97706" width={380} height={36}')) throw new Error('the VAT spark literals drifted — re-derive');

const readBgToken = (block) => {
  const m = block.match(/--background: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error('--background oklch not found in the expected block');
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootBlock = globalsCss.slice(globalsCss.indexOf(':root {'), globalsCss.indexOf('.dark {'));
const darkBlock = globalsCss.slice(globalsCss.indexOf('.dark {'), globalsCss.indexOf('.dark {') + 2500);
const DIALOG_LIGHT = readBgToken(rootBlock);
const DIALOG_DARK = readBgToken(darkBlock);

// The REAL chain, bottom-up: the panels are OPAQUE in both modes
// (light slate-50 by history, dark slate-900 since v2.195.0), so every
// interior composite stacks over the PANEL, not the dialog.
const PANEL_LIGHT = token('slate-50');
const PANEL_DARK = token('slate-900');
// The strips inside the panels.
const TX_STRIP_LIGHT = blend(token('blue-50'), 0.7, PANEL_LIGHT); // bg-blue-50/70
const TX_STRIP_DARK = blend(token('blue-500'), 0.1, PANEL_DARK); // dark:bg-blue-500/10
const NET_STRIP_LIGHT = blend(token('violet-50'), 0.7, PANEL_LIGHT); // bg-violet-50/70
const NET_STRIP_DARK = blend(token('violet-500'), 0.1, PANEL_DARK); // dark:bg-violet-500/10
const VAT_STRIP_LIGHT = blend(token('emerald-50'), 0.7, PANEL_LIGHT); // bg-emerald-50/70
const VAT_STRIP_DARK = blend(token('emerald-500'), 0.1, PANEL_DARK); // dark:bg-emerald-500/10
// The chips INSIDE the strips: white/80 is an ALPHA over the strip's own
// paint (light) — dark mode swaps to the opaque-ish -500/20 over the
// strip's -500/10.
const TX_PRIOR_CHIP_LIGHT = blend([1, 1, 1], 0.8, TX_STRIP_LIGHT); // bg-white/80 over blue-50/70
const TX_PRIOR_CHIP_DARK = blend(token('blue-500'), 0.2, TX_STRIP_DARK); // dark:bg-blue-500/20
const PRIOR_CHIP_LIGHT = blend([1, 1, 1], 0.8, NET_STRIP_LIGHT);
const PRIOR_CHIP_DARK = blend(token('violet-500'), 0.2, NET_STRIP_DARK);
const NET_CHIP_LIGHT = blend([1, 1, 1], 0.8, VAT_STRIP_LIGHT);
const NET_CHIP_DARK = blend(token('emerald-500'), 0.2, VAT_STRIP_DARK);
// The verdict chips' opaque light -50 grounds are stack-independent; their
// dark halves composite over the STRIP's dark paint (they sit inside it).
const VERDICT_DARK_GROUND = (c) => blend(token(c), 0.1, TX_STRIP_DARK);
const NET_VERDICT_DARK_GROUND = (c) => blend(token(c), 0.1, NET_STRIP_DARK);
// The card's opaque faces (the KPI cards stay WHITE in dark mode by
// design — the light voice on them is correct).
const CARD = token('white');

let pass = 0, fail = 0, total = 0;
const check = (label, fg, bg, need) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need ${need}:1)`);
};
// The discovery rows: the PRE-fix states must measure BELOW the bar — the
// numbers that prove the bug was real, kept as regressions-in-reverse.
const checkBug = (label, fg, bg, max) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r < max;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (the pre-fix state, must stay under ${max}:1)`);
};

console.log('── the discovery: v2.194.0 dark tokens on the UNPAINTED light panel ──');
checkBug('pre-fix grid value slate-100 on slate-50', token('slate-100'), PANEL_LIGHT, 2);
checkBug('pre-fix strip voice violet-300 on violet-500/10-over-slate-50', token('violet-300'), blend(token('violet-500'), 0.1, PANEL_LIGHT), 2);
checkBug('pre-fix strip voice blue-300 on blue-500/10-over-slate-50', token('blue-300'), blend(token('blue-500'), 0.1, PANEL_LIGHT), 2);

console.log('── light mode: the modal interior over the slate-50 panel ──');
check('grid label slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('grid value slate-800 on panel', token('slate-800'), PANEL_LIGHT, 4.5);
check('lens note slate-500 on panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('tx strip label blue-800 on blue-50/70', token('blue-800'), TX_STRIP_LIGHT, 4.5);
check('tx strip week blue-900 on blue-50/70', token('blue-900'), TX_STRIP_LIGHT, 4.5);
check('tx prior chip blue-700 on white/80 stack', token('blue-700'), TX_PRIOR_CHIP_LIGHT, 4.5);
check('net strip label violet-800 on violet-50/70', token('violet-800'), NET_STRIP_LIGHT, 4.5);
check('net strip week violet-900 on violet-50/70', token('violet-900'), NET_STRIP_LIGHT, 4.5);
check('net prior chip violet-700 on white/80 stack', token('violet-700'), PRIOR_CHIP_LIGHT, 4.5);
check('VAT strip label emerald-800 on emerald-50/70', token('emerald-800'), VAT_STRIP_LIGHT, 4.5);
check('VAT strip week emerald-900 on emerald-50/70', token('emerald-900'), VAT_STRIP_LIGHT, 4.5);
check('net chip emerald-700 on white/80 stack', token('emerald-700'), NET_CHIP_LIGHT, 4.5);
console.log('── light verdict chips (opaque -50 grounds, stack-independent) ──');
check('verdict up emerald-700 on emerald-50', token('emerald-700'), token('emerald-50'), 4.5);
check('verdict down red-700 on red-50', token('red-700'), token('red-50'), 4.5);
check('verdict flat slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);
console.log('── light branch rows (outside the panel, on the dialog ground) ──');
check('branch name slate-600 on dialog', token('slate-600'), DIALOG_LIGHT, 4.5);
check('branch count slate-700 on dialog', token('slate-700'), DIALOG_LIGHT, 4.5);

console.log('── dark mode: the FIXED voice over the slate-900 panel ──');
check('grid label slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('grid value slate-100 on panel', token('slate-100'), PANEL_DARK, 4.5);
check('lens note slate-400 on panel', token('slate-400'), PANEL_DARK, 4.5);
check('tx strip label blue-300 on blue-500/10', token('blue-300'), TX_STRIP_DARK, 4.5);
check('tx strip week blue-200 on blue-500/10', token('blue-200'), TX_STRIP_DARK, 4.5);
check('tx prior chip blue-300 on blue-500/20 stack', token('blue-300'), TX_PRIOR_CHIP_DARK, 4.5);
check('net strip label violet-300 on violet-500/10', token('violet-300'), NET_STRIP_DARK, 4.5);
check('net strip week violet-200 on violet-500/10', token('violet-200'), NET_STRIP_DARK, 4.5);
check('net prior chip violet-300 on violet-500/20 stack', token('violet-300'), PRIOR_CHIP_DARK, 4.5);
check('VAT strip label emerald-300 on emerald-500/10', token('emerald-300'), VAT_STRIP_DARK, 4.5);
check('VAT strip week emerald-200 on emerald-500/10', token('emerald-200'), VAT_STRIP_DARK, 4.5);
check('net chip emerald-300 on emerald-500/20 stack', token('emerald-300'), NET_CHIP_DARK, 4.5);
console.log('── dark verdict chips (-500/10 over the strip\'s own -500/10) ──');
check('verdict up emerald-300 on emerald-500/10 stack', token('emerald-300'), VERDICT_DARK_GROUND('emerald-500'), 4.5);
check('verdict down red-300 on red-500/10 stack', token('red-300'), VERDICT_DARK_GROUND('red-500'), 4.5);
check('verdict flat slate-400 on slate-500/10 stack', token('slate-400'), VERDICT_DARK_GROUND('slate-500'), 4.5);
check('net verdict up emerald-300 (net strip stack)', token('emerald-300'), NET_VERDICT_DARK_GROUND('emerald-500'), 4.5);
console.log('── dark branch rows (outside the panel, on the 0.145 dialog) ──');
check('branch name slate-400 on dialog', token('slate-400'), DIALOG_DARK, 4.5);
check('branch count slate-300 on dialog', token('slate-300'), DIALOG_DARK, 4.5);

console.log('── the card (white in BOTH modes by design — the light voice is correct) ──');
check('card legacy line slate-500 on white', token('slate-500'), CARD, 4.5);
check('settled chip blue-700 on blue-50', token('blue-700'), token('blue-50'), 4.5);

console.log('── sparks + title glyph (aria-hidden decoration — 3:1 non-text, recorded) ──');
check('card spark stroke #2563eb on white', hexToSrgb('#2563eb'), CARD, 3);
check('modal spark stroke #2563eb on light panel', hexToSrgb('#2563eb'), PANEL_LIGHT, 3);
check('modal spark stroke #2563eb on dark panel', hexToSrgb('#2563eb'), PANEL_DARK, 3);
check('VAT spark stroke amber-600 on light panel', token('amber-600'), PANEL_LIGHT, 3);
check('VAT spark stroke amber-600 on dark panel', token('amber-600'), PANEL_DARK, 3);
check('title glyph blue-600 on light dialog', token('blue-600'), DIALOG_LIGHT, 3);

console.log(`\n${pass}/${total} families pass (3 discovery rows prove the pre-fix bug; strokes recorded under the 3:1 non-text bar).`);
process.exit(fail > 0 ? 1 : 0);
