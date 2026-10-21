#!/usr/bin/env node
// v2.193.0 contrast math — the desk REPORT page's emerald action + status
// chip families (src/components/org/desk-report-view.tsx: the active
// window/branch scope chips, the Print button (same literals), the
// "File all visits" button, the ledger's via chip, and the page's own
// REPORT_STATUS_CHIP statuses). The desk DIGEST panel's parallel families
// were measured at v2.192.0 over the panel's LITERAL slate-900 ground;
// THIS surface differs in two honest ways the numbers must respect:
//   1. the page paints NO local ground — the view root carries no bg
//      class, so the real ground is the app BACKGROUND token (the root
//      layout paints `bg-background`) — a DIFFERENT dark value from the
//      digest's slate-900, so the v2.192.0 numbers do NOT transfer;
//   2. the File-all button's LIGHT half is an ALPHA paint
//      (`bg-emerald-50/70`) — the only light alpha in the family — so it
//      composites over the light background instead of standing opaque;
//   3. the ledger rows carry their own hover tints (`hover:bg-emerald-
//      50/40`, `dark:hover:bg-emerald-500/5`) that sit UNDER the
//      translucent dark chips (and under the via chip's own
//      slate-900/60 in BOTH row states).
// Light OPAQUE halves (-50/white) stay stack-independent: one number per
// family covers every row state in that mode. Dark halves composite
// bottom-up: row tint (if any) over the background token, then the chip's
// alpha layer over that. The recipe (docs/a11y/contrast-math.md): oklch ->
// sRGB first, composite the real paint stack bottom-up, WCAG ratio vs
// 4.5:1 — every one of these texts is 9-12px (font-medium/semibold/bold),
// small text; bold does not buy the 3:1 large-text bar.
//
// Token values: palette from the INSTALLED Tailwind theme
// (node_modules/tailwindcss/theme.css) — the same source the browser
// paints; the background token from src/app/globals.css (:root and .dark).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const theme = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
const token = (name) => {
  const m = theme.match(new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (m) return oklchToSrgb(parseFloat(m[1]) / 100, parseFloat(m[2]), parseFloat(m[3]));
  // white (and any non-oklch token) ships as hex in theme.css
  const hex = theme.match(new RegExp(`--color-${name}: (#(?:[0-9a-f]{3}|[0-9a-f]{6}))\\b`));
  if (hex) return hexToSrgb(hex[1]);
  throw new Error(`token --color-${name} not found in theme.css`);
};
const hexToSrgb = (h) => {
  const s = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};

// The page's real ground: the app background token, read from
// globals.css (:root for light, .dark for dark) — never from memory.
// The layout paints it (`bg-background`); the view root paints nothing.
const globalsCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const layoutSrc = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');
if (!layoutSrc.includes('bg-background')) throw new Error('layout.tsx no longer paints bg-background — re-derive the ground');
const viewSrc = readFileSync(join(process.cwd(), 'src/components/org/desk-report-view.tsx'), 'utf8');
if (/(return|<div[^>]*className="mx-auto w-full max-w-5xl[^"]*bg-)/.test(viewSrc) === true && !viewSrc.includes('className="mx-auto w-full max-w-5xl px-4 py-6"')) {
  throw new Error('desk-report-view.tsx root drifted — re-derive the ground');
}
if (!viewSrc.includes('dark:bg-emerald-500/15 dark:text-emerald-300')) throw new Error('the active chip literals drifted — re-derive');
if (!viewSrc.includes('dark:bg-emerald-500/10 dark:text-emerald-300')) throw new Error('the file-all/status emerald literals drifted — re-derive');
if (!viewSrc.includes('dark:bg-slate-900/60 dark:text-emerald-300')) throw new Error('the via chip literals drifted — re-derive');
if (!viewSrc.includes('bg-emerald-50/70')) throw new Error('the file-all light alpha drifted — re-derive');
if (!viewSrc.includes('dark:hover:bg-emerald-500/5')) throw new Error('the ledger row hover drifted — re-derive');
if (!viewSrc.includes('REPORT_STATUS_CHIP')) throw new Error('the report status chips moved — re-derive');

const readBgToken = (block) => {
  const m = block.match(/--background: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error('--background oklch not found in the expected block');
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootBlock = globalsCss.slice(globalsCss.indexOf(':root {'), globalsCss.indexOf('.dark {'));
const darkBlock = globalsCss.slice(globalsCss.indexOf('.dark {'), globalsCss.indexOf('.dark {') + 2500);

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

// The literal grounds (globals.css tokens, read above).
const GROUND_LIGHT = readBgToken(rootBlock);
const GROUND_DARK = readBgToken(darkBlock);
// The ledger row states (desk-report-view.tsx hover classes).
const LIGHT_HOVER_ROW = blend(token('emerald-50'), 0.4, GROUND_LIGHT); // hover:bg-emerald-50/40
const DARK_HOVER_ROW = blend(token('emerald-500'), 0.05, GROUND_DARK); // dark:hover:bg-emerald-500/5

// ── The active scope chip (window + branch chips) and the Print button:
//    light `bg-emerald-50 text-emerald-700` (opaque), dark `bg-emerald-
//    500/15 text-emerald-300`; the Print hover adds dark:bg-emerald-500/25.
// ── The File-all button: light `bg-emerald-50/70` (ALPHA over the page)
//    + hover `bg-emerald-100` (opaque), dark `bg-emerald-500/10` + hover
//    `bg-emerald-500/20`, text-emerald-300.
// ── The via chip: light `bg-white text-emerald-700` (opaque), dark
//    `bg-slate-900/60 text-emerald-300` over calm AND hover rows, chip
//    hover `dark:bg-emerald-500/15`.
// ── REPORT_STATUS_CHIP: light the opaque `-50` chips, dark `bg-{c}-500/10
//    text-{c}-300` (CANCELLED slate-800/60 + slate-400) over calm / hover.
const STATUS_CHIPS = [
  ['PENDING', 'amber-700', 'amber-50', 'amber-300', 'amber-500', 0.1, 'amber-300'],
  ['APPROVED', 'emerald-700', 'emerald-50', 'emerald-300', 'emerald-500', 0.1, 'emerald-300'],
  ['REJECTED', 'rose-700', 'rose-50', 'rose-300', 'rose-500', 0.1, 'rose-300'],
  ['CANCELLED', 'slate-500', 'slate-50', 'slate-400', 'slate-800', 0.6, 'slate-400'],
];

let fail = 0;
let count = 0;
const check = (label, fg, bg) => {
  count++;
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need 4.5:1)`);
};

console.log('── active scope chip + print button, light (opaque) / dark (alpha over the app ground) ──');
check('active chip light', token('emerald-700'), token('emerald-50'));
check('active chip dark calm', token('emerald-300'), blend(token('emerald-500'), 0.15, GROUND_DARK));
check('print dark hover', token('emerald-300'), blend(token('emerald-500'), 0.25, GROUND_DARK));
console.log('── file-all button, light (ALPHA 50/70 + opaque hover) / dark (alpha over the app ground) ──');
check('file-all light calm (50/70 over bg)', token('emerald-700'), blend(token('emerald-50'), 0.7, GROUND_LIGHT));
check('file-all light hover (opaque 100)', token('emerald-700'), token('emerald-100'));
check('file-all dark calm', token('emerald-300'), blend(token('emerald-500'), 0.10, GROUND_DARK));
check('file-all dark hover', token('emerald-300'), blend(token('emerald-500'), 0.20, GROUND_DARK));
console.log('── via chip, light (opaque white) / dark (slate-900/60 over calm + hover rows, chip hover) ──');
check('via chip light', token('emerald-700'), token('white'));
check('via chip dark calm', token('emerald-300'), blend(token('slate-900'), 0.6, GROUND_DARK));
check('via chip dark row-hover', token('emerald-300'), blend(token('slate-900'), 0.6, DARK_HOVER_ROW));
check('via chip dark chip-hover', token('emerald-300'), blend(token('emerald-500'), 0.15, GROUND_DARK));
console.log('── report status chips, light: opaque -50 chips (stack-independent) ──');
for (const [name, fg, bg] of STATUS_CHIPS) {
  check(`status ${name} light`, token(fg), token(bg));
}
console.log('── report status chips, dark: alpha chips over calm / ledger-hover grounds ──');
for (const [name, , , dfg, dtop, dalpha] of STATUS_CHIPS) {
  check(`status ${name} dark calm`, token(dfg), blend(token(dtop), dalpha, GROUND_DARK));
  check(`status ${name} dark hover`, token(dfg), blend(token(dtop), dalpha, DARK_HOVER_ROW));
}

console.log(`\n${count - fail}/${count} desk-report chip families pass the small-text bar.`);
console.log('(the unknown-status fallback reuses the CANCELLED slate shape — covered by that row)');
process.exit(fail > 0 ? 1 : 0);
