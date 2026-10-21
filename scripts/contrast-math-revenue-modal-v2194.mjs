#!/usr/bin/env node
// v2.194.0 contrast math — the revenue modal's dialog-ground texts (BOTH
// modes) + the new VAT spark's stroke (src/components/org/kpi-row.tsx).
// THE DISCOVERY THIS SCRIPT RECORDS: the modal's stat grid + lens strips
// were built light-only (v2.176-era) while the Dialog surface paints
// `bg-background` — in dark mode oklch(0.145 0.015 260) — so the modal's
// `text-slate-800` VALUES measured ~1.3:1 (near-invisible) and the
// `text-slate-500` labels ~3.6:1, and the strips' light alpha paints
// (violet-50/70, emerald-50/70) sank under their own text. v2.194.0 fixes
// the modal's dark voice: the house's proven dark chip pattern ({c}-500/10
// ground under a -300 voice, the /30 ring — the panels' STATUS_CHIP
// family) for both strips and their verdict chips, slate-400/slate-100
// for the grid, and the new VAT spark in amber-600 — a THIRD stroke hue
// so the modal's three faces never merge (emerald gross, violet net,
// amber VAT).
// The recipe (docs/a11y/contrast-math.md): oklch -> sRGB first, composite
// the real paint stack bottom-up, WCAG ratio vs 4.5:1 (the grid labels
// are 10-14px; bold does not buy the 3:1 large-text bar) — the spark
// stroke is aria-hidden DECORATION (the figures beside it speak), so its
// number is recorded under the 3:1 non-text bar for completeness only.
//
// Token values: palette from the INSTALLED Tailwind theme
// (node_modules/tailwindcss/theme.css) — the same source the browser
// paints; the dialog ground from src/app/globals.css (:root and .dark —
// the Dialog paints bg-background, asserted from ui/dialog.tsx).
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

// The dialog's real ground: the app background token, read from
// globals.css (:root for light, .dark for dark) — never from memory.
// ui/dialog.tsx paints `bg-background` on the content surface (asserted).
const globalsCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const dialogSrc = readFileSync(join(process.cwd(), 'src/components/ui/dialog.tsx'), 'utf8');
if (!dialogSrc.includes('bg-background')) throw new Error('ui/dialog.tsx no longer paints bg-background — re-derive the ground');
const kpiSrc = readFileSync(join(process.cwd(), 'src/components/org/kpi-row.tsx'), 'utf8');
// The literals this release pinned (assert FROM the component source — if
// these drift, the numbers below are measuring a ghost).
if (!kpiSrc.includes('dark:text-slate-400">Today')) throw new Error('the grid label dark fix drifted — re-derive');
if (!kpiSrc.includes('text-slate-800 dark:text-slate-100')) throw new Error('the grid value dark fix drifted — re-derive');
if (!kpiSrc.includes('dark:border-violet-500/30 dark:bg-violet-500/10')) throw new Error('the net strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:border-emerald-500/30 dark:bg-emerald-500/10')) throw new Error('the VAT strip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-violet-500/20 dark:text-violet-300 dark:ring-violet-500/30')) throw new Error('the prior chip dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/30')) throw new Error('the net chip dark half drifted — re-derive');
if (!kpiSrc.includes('stroke="#d97706" width={380} height={36}')) throw new Error('the VAT spark literals drifted — re-derive');
if (!kpiSrc.includes('dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30')) throw new Error('the verdict up-state dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30')) throw new Error('the verdict down-state dark half drifted — re-derive');
if (!kpiSrc.includes('dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30')) throw new Error('the verdict flat-state dark half drifted — re-derive');

const readBgToken = (block) => {
  const m = block.match(/--background: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error('--background oklch not found in the expected block');
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootBlock = globalsCss.slice(globalsCss.indexOf(':root {'), globalsCss.indexOf('.dark {'));
const darkBlock = globalsCss.slice(globalsCss.indexOf('.dark {'), globalsCss.indexOf('.dark {') + 2500);
const DIALOG_LIGHT = readBgToken(rootBlock);
const DIALOG_DARK = readBgToken(darkBlock);

// The strips' paint stacks, bottom-up over the dialog ground.
const NET_STRIP_LIGHT = blend(token('violet-50'), 0.7, DIALOG_LIGHT); // bg-violet-50/70
const NET_STRIP_DARK = blend(token('violet-500'), 0.1, DIALOG_DARK); // dark:bg-violet-500/10
const VAT_STRIP_LIGHT = blend(token('emerald-50'), 0.7, DIALOG_LIGHT); // bg-emerald-50/70
const VAT_STRIP_DARK = blend(token('emerald-500'), 0.1, DIALOG_DARK); // dark:bg-emerald-500/10
// The chips INSIDE the strips: white/80 is an ALPHA over the strip's own
// paint (light) — dark mode swaps to the opaque-ish -500/20 over the
// strip's -500/10.
const PRIOR_CHIP_LIGHT = blend([1, 1, 1], 0.8, NET_STRIP_LIGHT); // bg-white/80 over violet-50/70
const NET_CHIP_LIGHT = blend([1, 1, 1], 0.8, VAT_STRIP_LIGHT); // bg-white/80 over emerald-50/70
const PRIOR_CHIP_DARK = blend(token('violet-500'), 0.2, NET_STRIP_DARK); // dark:bg-violet-500/20
const NET_CHIP_DARK = blend(token('emerald-500'), 0.2, VAT_STRIP_DARK); // dark:bg-emerald-500/20
// The verdict chips' opaque light -50 grounds are stack-independent; their
// dark halves composite over the STRIP's dark paint (they sit inside it).
const VERDICT_DARK_GROUND = (c) => blend(token(c), 0.1, NET_STRIP_DARK);

let pass = 0, fail = 0, total = 0;
const check = (label, fg, bg, need) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need ${need}:1)`);
};

console.log('── light mode: the modal over the near-white dialog ground ──');
check('grid label slate-500', token('slate-500'), DIALOG_LIGHT, 4.5);
check('grid value slate-800', token('slate-800'), DIALOG_LIGHT, 4.5);
check('lens note slate-500', token('slate-500'), DIALOG_LIGHT, 4.5);
check('net strip label violet-800 on violet-50/70', token('violet-800'), NET_STRIP_LIGHT, 4.5);
check('net strip week violet-900 on violet-50/70', token('violet-900'), NET_STRIP_LIGHT, 4.5);
check('prior chip violet-700 on white/80 stack', token('violet-700'), PRIOR_CHIP_LIGHT, 4.5);
check('VAT strip label emerald-800 on emerald-50/70', token('emerald-800'), VAT_STRIP_LIGHT, 4.5);
check('VAT strip week emerald-900 on emerald-50/70', token('emerald-900'), VAT_STRIP_LIGHT, 4.5);
check('net chip emerald-700 on white/80 stack', token('emerald-700'), NET_CHIP_LIGHT, 4.5);
console.log('── light verdict chips (opaque -50 grounds, stack-independent) ──');
check('verdict up emerald-700 on emerald-50', token('emerald-700'), token('emerald-50'), 4.5);
check('verdict down red-700 on red-50', token('red-700'), token('red-50'), 4.5);
check('verdict flat slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);

console.log('── dark mode: the FIXED voice over the 0.145 dialog ground ──');
check('grid label slate-400', token('slate-400'), DIALOG_DARK, 4.5);
check('grid value slate-100', token('slate-100'), DIALOG_DARK, 4.5);
check('lens note slate-400', token('slate-400'), DIALOG_DARK, 4.5);
check('net strip label violet-300 on violet-500/10', token('violet-300'), NET_STRIP_DARK, 4.5);
check('net strip week violet-200 on violet-500/10', token('violet-200'), NET_STRIP_DARK, 4.5);
check('prior chip violet-300 on violet-500/20 stack', token('violet-300'), PRIOR_CHIP_DARK, 4.5);
check('VAT strip label emerald-300 on emerald-500/10', token('emerald-300'), VAT_STRIP_DARK, 4.5);
check('VAT strip week emerald-200 on emerald-500/10', token('emerald-200'), VAT_STRIP_DARK, 4.5);
check('net chip emerald-300 on emerald-500/20 stack', token('emerald-300'), NET_CHIP_DARK, 4.5);
console.log('── dark verdict chips (-500/10 over the strip\'s own -500/10) ──');
check('verdict up emerald-300 on emerald-500/10 stack', token('emerald-300'), VERDICT_DARK_GROUND('emerald-500'), 4.5);
check('verdict down red-300 on red-500/10 stack', token('red-300'), VERDICT_DARK_GROUND('red-500'), 4.5);
check('verdict flat slate-400 on slate-500/10 stack', token('slate-400'), VERDICT_DARK_GROUND('slate-500'), 4.5);

console.log('── the VAT spark stroke (aria-hidden decoration — 3:1 non-text, recorded) ──');
check('spark stroke amber-600 on light dialog', token('amber-600'), DIALOG_LIGHT, 3);
check('spark stroke amber-600 on dark dialog', token('amber-600'), DIALOG_DARK, 3);

console.log(`\n${pass}/${total} families pass (the spark stroke recorded under the 3:1 non-text bar).`);
process.exit(fail > 0 ? 1 : 0);
