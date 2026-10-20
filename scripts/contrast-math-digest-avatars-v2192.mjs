#!/usr/bin/env node
// v2.192.0 contrast math — the desk digest's avatar-hue + status-chip
// families (org panels.tsx DeskActivity: the digest roster's AVATAR_HUES
// pills, the timeline's DESK_STATUS_CHIP statuses). The desk REPORT page's
// own avatar family was measured at v2.190.0 (24/24 over the card token);
// THIS surface is the digest panel's parallel family — and it differs in
// two honest ways the numbers must respect:
//   1. the panel paints its ground LITERALLY (`dark:bg-slate-900` on the
//      section class, `bg-white` in light) — not the card token — so the
//      ground here is the literal palette value read from the component;
//   2. the timeline rows carry their own hover tints (`dark:hover:bg-
//      slate-800/40`, `hover:bg-slate-50`) that sit UNDER the translucent
//      dark chips, and the roster rows add the drilled emerald ground.
// Light halves are the OPAQUE `-100`/`-50` chips — stack-independent, so
// one number per family covers every row state in that mode. Dark halves
// composite bottom-up: row tint (if any) over slate-900, then the chip's
// alpha layer over that. The recipe (docs/a11y/contrast-math.md): oklch ->
// sRGB first, composite the real paint stack bottom-up, WCAG ratio vs
// 4.5:1 — every one of these texts is 10px (font-medium or font-bold),
// small text; bold does not buy the 3:1 large-text bar.
//
// Token values: palette from the INSTALLED Tailwind theme
// (node_modules/tailwindcss/theme.css) — the same source the browser paints.
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
// The digest panel's own ground, read FROM THE COMPONENT (never from memory):
const panelsSrc = readFileSync(join(process.cwd(), 'src/components/org/panels.tsx'), 'utf8');
if (!panelsSrc.includes('dark:bg-slate-900')) throw new Error('panels.tsx no longer paints dark:bg-slate-900 — re-derive the ground');
if (!panelsSrc.includes('bg-white p-4')) throw new Error('panels.tsx no longer paints light bg-white — re-derive the ground');

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

// The literal grounds the panel paints (panels.tsx DeskActivity section).
const GROUND_LIGHT = token('white');
const GROUND_DARK = token('slate-900');
// The roster row states (panels.tsx drilled / hover classes).
const DARK_HOVER_ROW = blend(token('slate-800'), 0.5, GROUND_DARK);   // dark:hover:bg-slate-800/50
const DARK_DRILLED_ROW = blend(token('emerald-500'), 0.1, GROUND_DARK); // dark:bg-emerald-500/10
const DARK_TIMELINE_HOVER = blend(token('slate-800'), 0.4, GROUND_DARK); // dark:hover:bg-slate-800/40

// ── AVATAR_HUES (panels.tsx): light `bg-{c}-100 text-{c}-700` (opaque),
//    dark `bg-{c}-500/20 text-{c}-300` over calm / hover / drilled rows.
const AVATAR_HUES = ['emerald', 'sky', 'violet', 'amber', 'rose', 'teal'];

// ── DESK_STATUS_CHIP (panels.tsx): light `bg-{c}-50 text-{c}-700` (opaque;
//    CANCELLED slate-500 on slate-50), dark `bg-{c}-500/10 text-{c}-300`
//    (CANCELLED slate-800/60 + slate-400) over calm / timeline-hover rows.
const STATUS_CHIPS = [
  ['PENDING', 'amber', 'amber-700', 'amber-50', 'amber-300', 'amber-500', 0.1, 'amber-300'],
  ['APPROVED', 'emerald', 'emerald-700', 'emerald-50', 'emerald-300', 'emerald-500', 0.1, 'emerald-300'],
  ['REJECTED', 'rose', 'rose-700', 'rose-50', 'rose-300', 'rose-500', 0.1, 'rose-300'],
  ['CANCELLED', 'slate', 'slate-500', 'slate-50', 'slate-400', 'slate-800', 0.6, 'slate-400'],
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

console.log('── avatar hues (digest roster + timeline initials), light: opaque -100 chips ──');
for (const c of AVATAR_HUES) {
  check(`avatar ${c} light`, token(`${c}-700`), token(`${c}-100`));
}
console.log('── avatar hues, dark: -500/20 chips over the THREE real row grounds ──');
for (const c of AVATAR_HUES) {
  check(`avatar ${c} dark calm`, token(`${c}-300`), blend(token(`${c}-500`), 0.2, GROUND_DARK));
  check(`avatar ${c} dark hover`, token(`${c}-300`), blend(token(`${c}-500`), 0.2, DARK_HOVER_ROW));
  check(`avatar ${c} dark drilled`, token(`${c}-300`), blend(token(`${c}-500`), 0.2, DARK_DRILLED_ROW));
}
console.log('── status chips (timeline), light: opaque -50 chips ──');
for (const [name, , fg, bg] of STATUS_CHIPS) {
  check(`status ${name} light`, token(fg), token(bg));
}
console.log('── status chips, dark: alpha chips over calm / timeline-hover grounds ──');
for (const [name, , , , dfg, dtop, dalpha] of STATUS_CHIPS) {
  check(`status ${name} dark calm`, token(dfg), blend(token(dtop), dalpha, GROUND_DARK));
  check(`status ${name} dark hover`, token(dfg), blend(token(dtop), dalpha, DARK_TIMELINE_HOVER));
}

console.log(`\n${count - fail}/${count} digest families pass the small-text bar.`);
console.log('(the unknown-status fallback reuses the CANCELLED slate shape — covered by that row)');
process.exit(fail > 0 ? 1 : 0);
