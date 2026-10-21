#!/usr/bin/env node
// v2.200.0 contrast math — the branch KPI row's three doors (the day's
// ledger, the day's receipts, the basket ladder —
// src/components/dashboard/kpi-doors.tsx + the row wiring in
// src/app/(shell)/tabs/dashboard-tab.tsx) in BOTH modes, over the real
// paint stacks from the INSTALLED Tailwind theme.
//
// THE ROUND'S HONEST FINDS (caught by the pre-derivation probe BEFORE the
// first commit of the new faces — the same discipline v2.198/v2.199 used):
//   1. The doors' 10px window notes and hour-axis labels were drafted as
//      text-slate-400 in light (2.63:1 on the white panel — under the 4.5
//      bar their small text must meet) and text-slate-500 in dark (3.74:1
//      on the slate-900 panel — the same miss). The draft was re-voiced to
//      text-slate-500 dark:text-slate-400 (4.77:1 light / 6.79:1 dark)
//      BEFORE anything shipped, and the draft pair is pinned in reverse
//      here so the ghost cannot return silently.
//   2. The bars' pastel fills (emerald/teal/amber -500/80 in light) sit
//      under the 3:1 non-text bar (1.86-2.10:1). They are DECORATION by
//      the v2.198.0 house rule: the key figures are aria-labeled on the
//      bar containers (role="img" with the peak/busiest hour and count)
//      AND spoken twice beside (the day-ledger-peak line, the
//      day-receipts-busiest line, every bucket's count + share text), so
//      the fills add no figure the text does not already carry. The dark
//      fills measure 5.08-5.59:1 — they would pass even as graphics, but
//      the light fills are deliberately NOT asserted as graphics; they are
//      documented here per the law.
//
// The doors speak the house voices from birth: emerald-700/teal-700/
// amber-700 accents on white (5.37/5.39/pass), the -50 chip grounds under
// -700 voices (5.09-5.17), slate-600 share chips on slate-100 (6.90), and
// the dark halves in the house's proven pattern (-500/10 ground under a
// -300 voice over each panel's own slate-900, 10.16-12.13). Every panel
// paints its dark half from birth (the branch row's three mounts of the
// dark-panel law: dark:border-slate-700 dark:bg-slate-900).
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
const doorsSrc = readFileSync(join(process.cwd(), 'src/components/dashboard/kpi-doors.tsx'), 'utf8');
const tabSrc = readFileSync(join(process.cwd(), 'src/app/(shell)/tabs/dashboard-tab.tsx'), 'utf8');

// The three doors exist and speak their testids.
if (!doorsSrc.includes('data-testid="day-ledger-modal"')) throw new Error('the ledger door drifted');
if (!doorsSrc.includes('data-testid="day-receipts-modal"')) throw new Error('the receipts door drifted');
if (!doorsSrc.includes('data-testid="basket-ladder-modal"')) throw new Error('the ladder door drifted');
if (!tabSrc.includes('testId="branch-revenue-card"')) throw new Error('the revenue card handle drifted');
if (!tabSrc.includes('testId="branch-transactions-card"')) throw new Error('the transactions card handle drifted');
if (!tabSrc.includes('testId="branch-atv-card"')) throw new Error('the ATV card handle drifted');
// The fixed meta/note voice (the round's find, fixed before ship).
if (!doorsSrc.includes('text-slate-500 dark:text-slate-400')) throw new Error('the fixed meta voice drifted');
if (doorsSrc.includes('text-slate-400 dark:text-slate-500')) throw new Error('the draft meta voice still speaks — re-derive');
// The panels paint their dark half from birth (the branch three-mount law).
if (!doorsSrc.includes('dark:border-slate-700 dark:bg-slate-900')) throw new Error('the dark-panel law drifted');
// The decoration law's spoken-beside lines exist.
if (!doorsSrc.includes('data-testid="day-ledger-peak"')) throw new Error('the ledger peak line drifted');
if (!doorsSrc.includes('data-testid="day-receipts-busiest"')) throw new Error('the receipts busiest line drifted');

// ── the grounds ─────────────────────────────────────────────────────────
const PANEL_LIGHT = [1, 1, 1]; // bg-white (opaque)
const PANEL_DARK = token('slate-900'); // dark:bg-slate-900 (opaque)
const CHIP_DARK = (c) => blend(token(c), 0.1, PANEL_DARK);
const WHITE = [1, 1, 1];

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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (the pre-fix draft, must stay under ${max}:1)`);
};

console.log('── light mode (over the doors\' white panel) ──');
check('headline slate-900 on white', token('slate-900'), PANEL_LIGHT, 4.5);
check('meta/window note slate-500 on white (the fixed voice)', token('slate-500'), PANEL_LIGHT, 4.5);
check('peak/busiest line slate-600 on white', token('slate-600'), PANEL_LIGHT, 4.5);
check('ledger peak accent emerald-700 on white', token('emerald-700'), PANEL_LIGHT, 4.5);
check('receipts busiest accent teal-700 on white', token('teal-700'), PANEL_LIGHT, 4.5);
check('method chip emerald-700 on emerald-50', token('emerald-700'), token('emerald-50'), 4.5);
check('method chip teal-700 on teal-50', token('teal-700'), token('teal-50'), 4.5);
check('status chip emerald-700 on emerald-100', token('emerald-700'), token('emerald-100'), 4.5);
check('status chip slate-600 on slate-100', token('slate-600'), token('slate-100'), 4.5);
check('share chip slate-600 on slate-100', token('slate-600'), token('slate-100'), 4.5);
check('bucket label slate-700 on white', token('slate-700'), PANEL_LIGHT, 4.5);
check('bucket count slate-900 on white', token('slate-900'), PANEL_LIGHT, 4.5);

console.log('── dark mode (over each panel\'s own slate-900) ──');
check('headline slate-100 on slate-900', token('slate-100'), PANEL_DARK, 4.5);
check('meta/window note slate-400 on slate-900 (the fixed voice)', token('slate-400'), PANEL_DARK, 4.5);
check('peak/busiest line slate-300 on slate-900', token('slate-300'), PANEL_DARK, 4.5);
check('ledger peak accent emerald-300 on slate-900', token('emerald-300'), PANEL_DARK, 4.5);
check('receipts busiest accent teal-300 on slate-900', token('teal-300'), PANEL_DARK, 4.5);
check('method chip emerald-300 on emerald-500/10', token('emerald-300'), CHIP_DARK('emerald-500'), 4.5);
check('method chip teal-300 on teal-500/10', token('teal-300'), CHIP_DARK('teal-500'), 4.5);
check('status chip emerald-300 on emerald-500/10', token('emerald-300'), CHIP_DARK('emerald-500'), 4.5);
check('status chip slate-400 on slate-500/10', token('slate-400'), CHIP_DARK('slate-500'), 4.5);
check('share chip slate-400 on slate-500/10', token('slate-400'), CHIP_DARK('slate-500'), 4.5);
check('bucket label slate-300 on slate-900', token('slate-300'), PANEL_DARK, 4.5);

console.log('── the round\'s ghosts, pinned in reverse ──');
checkBug('  ghost: slate-400 on white (the draft light voice)', token('slate-400'), PANEL_LIGHT, 4.5);
checkBug('  ghost: slate-500 on slate-900 (the draft dark voice)', token('slate-500'), PANEL_DARK, 4.5);

console.log('── the cards\' edge/dot hues (graphics, 3:1 bar over the white card) ──');
check('revenue edge emerald-600 on white', token('emerald-600'), WHITE, 3);
check('receipts edge teal-600 on white', token('teal-600'), WHITE, 3);
check('ladder edge amber-600 on white', token('amber-600'), WHITE, 3);

console.log('── the bars\' fills, documented as DECORATION (NOT asserted as graphics) ──');
console.log(`  note: emerald-500/80 on white = ${ratio(blend(token('emerald-500'), 0.8, WHITE), WHITE).toFixed(2)}:1, teal-500/80 = ${ratio(blend(token('teal-500'), 0.8, WHITE), WHITE).toFixed(2)}:1, amber-500/80 = ${ratio(blend(token('amber-500'), 0.8, WHITE), WHITE).toFixed(2)}:1 — under the 3:1 non-text bar BY DESIGN: the figures are aria-labeled on the bar containers AND spoken twice beside (day-ledger-peak / day-receipts-busiest / every bucket's count + share).`);
console.log(`  note: the dark fills would pass even as graphics — emerald-400/70 = ${ratio(blend(token('emerald-400'), 0.7, PANEL_DARK), PANEL_DARK).toFixed(2)}:1, teal-400/70 = ${ratio(blend(token('teal-400'), 0.7, PANEL_DARK), PANEL_DARK).toFixed(2)}:1, amber-400/70 = ${ratio(blend(token('amber-400'), 0.7, PANEL_DARK), PANEL_DARK).toFixed(2)}:1.`);

console.log(`\n${pass}/${total} checks pass`);
process.exit(fail > 0 ? 1 : 0);
