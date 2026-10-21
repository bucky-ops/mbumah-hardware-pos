#!/usr/bin/env node
// v2.202.0 contrast math — the org desk's six doors (the branch-slice
// modal src/components/org/desk-doors.tsx + the door wiring in
// src/components/workspace/org-console.tsx) in BOTH modes, over the REAL
// paint stacks from the INSTALLED Tailwind theme.
//
// THE ROUND'S PRE-DERIVATION PROBE (scripts/probe-desk-doors-v2202.mjs)
// measured the SIX-hue vocabulary BEFORE anything shipped — the /console
// KPI row's own face inventory (orange revenue, blue transactions, amber
// stock, rose rentals, red debt, indigo pending) spoken by the org desk's
// tiles: all 36 checks pass (the -700 accents 5.05-8.07 on white, the -50
// chip grounds 4.87-7.22, the -300 dark accents 8.88-12.34 on slate-900,
// the -500/10 dark chip stacks 8.05-10.63, the edges as graphics 3.19-6.44
// over the white card).
//
// RECORDED HONESTLY as ALIGNMENT, not violation: the branches table's
// overdue cell rode text-red-600 on bg-card — 4.76:1 on the installed
// palette, a PASS — re-voiced to red-700 (6.42:1) as the family alignment
// the Task-188 sweep established (consistency + margin against palette
// drift). The dots are aria-hidden decoration per the v2.198.0 law: the
// figure each dot hints at is the card's own value text.
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
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
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
const blend = (top, alpha, bottom) => top.map((v, i) => v * alpha + bottom[i] * (1 - alpha));

// ── the literals this release pins (assert FROM the component source —
// if these drift, the numbers below are measuring a ghost) ──────────────
const doorsSrc = readFileSync(join(process.cwd(), 'src/components/org/desk-doors.tsx'), 'utf8');
const consoleSrc = readFileSync(join(process.cwd(), 'src/components/workspace/org-console.tsx'), 'utf8');

if (!doorsSrc.includes('org-desk-total-${metric.id}')) throw new Error('the total handle drifted');
if (!doorsSrc.includes('org-desk-row-${metric.id}')) throw new Error('the row handle drifted');
for (const id of ['revenue', 'transactions', 'lowStock', 'overdueRentals', 'debt', 'pendingMpesa']) {
  if (!consoleSrc.includes(`org-desk-card-${id}`)) throw new Error(`the ${id} card handle drifted`);
  if (!doorsSrc.includes(`'${id}'`) && !doorsSrc.includes(`"${id}"`)) throw new Error(`the ${id} metric drifted`);
}
if (!doorsSrc.includes('dark:border-slate-700 dark:bg-slate-900')) throw new Error('the dark-panel law drifted');
if (!consoleSrc.includes('text-red-700 font-medium')) throw new Error('the overdue alignment drifted');
if (consoleSrc.includes('text-red-600')) throw new Error('a -600 text voice still rides the org console');
if (!doorsSrc.includes('% of the org')) throw new Error('the share voice drifted');
if (!doorsSrc.includes('At zero: ')) throw new Error('the quiet-branch voice drifted');

// ── the grounds ─────────────────────────────────────────────────────────
const WHITE = [1, 1, 1];
const PANEL_DARK = token('slate-900');
const CHIP_DARK = (c) => blend(token(c), 0.1, PANEL_DARK);

let pass = 0, fail = 0, total = 0;
const check = (label, fg, bg, need) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need ${need}:1)`);
};

const HUES = ['orange', 'blue', 'amber', 'rose', 'red', 'indigo'];

console.log('── the six accents, light (over the white panel) ──');
for (const h of HUES) check(`${h}-700 on white`, token(`${h}-700`), WHITE, 4.5);
check('headline slate-900 on white', token('slate-900'), WHITE, 4.5);
check('meta/window slate-500 on white', token('slate-500'), WHITE, 4.5);
check('row name slate-900 on white', token('slate-900'), WHITE, 4.5);
check('quiet line slate-500 on white', token('slate-500'), WHITE, 4.5);
check('clear line emerald-700 on emerald-50', token('emerald-700'), token('emerald-50'), 4.5);
check('empty line slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);

console.log('── the six accents, dark (over the panel\'s own slate-900) ──');
for (const h of HUES) check(`${h}-300 on slate-900`, token(`${h}-300`), PANEL_DARK, 4.5);
check('headline slate-100 on slate-900', token('slate-100'), PANEL_DARK, 4.5);
check('meta/window slate-400 on slate-900', token('slate-400'), PANEL_DARK, 4.5);
check('row name slate-100 on slate-900', token('slate-100'), PANEL_DARK, 4.5);
check('quiet line slate-400 on slate-900', token('slate-400'), PANEL_DARK, 4.5);
check('clear line emerald-300 on emerald-500/10', token('emerald-300'), CHIP_DARK('emerald-500'), 4.5);
check('empty line slate-400 on slate-500/10', token('slate-400'), CHIP_DARK('slate-500'), 4.5);

console.log('── the six -50 chip grounds (the door chips, light) ──');
for (const h of HUES) check(`${h}-700 on ${h}-50`, token(`${h}-700`), token(`${h}-50`), 4.5);

console.log('── the six dark chip stacks ──');
for (const h of HUES) check(`${h}-300 on ${h}-500/10`, token(`${h}-300`), CHIP_DARK(`${h}-500`), 4.5);

console.log('── the six edges as graphics over the white card (3:1) ──');
for (const h of HUES) check(`${h}-600 edge on bg-card`, token(`${h}-600`), WHITE, 3);

console.log('── the alignment record (NOT a violation) ──');
console.log(`  note: red-600 on bg-card = ${ratio(token('red-600'), WHITE).toFixed(2)}:1 — PASSES 4.5 on the installed palette; the branches table's overdue cell re-voiced to red-700 (${ratio(token('red-700'), WHITE).toFixed(2)}:1) as the Task-188 family alignment + margin.`);
console.log('  note: the six dots are aria-hidden decoration (the v2.198.0 law) — the figure each hints at is the card\'s own value text; the bars draw nothing (the modal speaks every branch in words).');

console.log(`\n${pass}/${total} checks pass`);
process.exit(fail > 0 ? 1 : 0);
