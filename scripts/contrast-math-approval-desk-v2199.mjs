#!/usr/bin/env node
// v2.199.0 contrast math — the approval desk (the KPI row's sixth modal,
// src/components/org/kpi-row.tsx) in BOTH modes, plus the round's sweep
// work (chrome.tsx login error, store-matrix.tsx hot debt figure, the
// revenue lens toggle's ACTIVE GROSS chip) and the org-dashboard mover
// voices recorded (the a11y backlog's audit half — they pass).
// THE DISCOVERY THIS SCRIPT RECORDS (numbers from the INSTALLED Tailwind
// theme, measured bottom-up over the real paint stacks):
//   1. the revenue modal's ACTIVE GROSS lens chip rode white-on-emerald-600
//      (3.67:1) since the toggle shipped (v2.187.0) — the INACTIVE voice
//      passes (4.77:1); the ACTIVE one was the violator. Fixed to
//      emerald-700 (5.37:1). The net chip (white-on-violet-600, 5.88:1)
//      always passed and stays.
//   2. the login error line rode red-600-on-red-50 (4.36:1) — the exact
//      pairing v2.198.0 found on the Expert ledger's OVERDUE badge.
//      Fixed to red-700 (5.88:1).
//   3. the Store Matrix's hot debt figure rode red-600-on-white — 4.76:1,
//      ABOVE the bar with the installed palette (the v2.159 knife-edge
//      number came from the older palette) — so this one is a CONSISTENCY
//      re-voice, not a violation: the house lifted its hot REAL text to
//      red-700 in v2.159 and the siblings speak red-700/red-800; the
//      matrix figure now agrees (red-700, 6.42:1). Recorded honestly:
//      pre-fix state passes, the fix is family alignment.
// The new desk speaks the house voices from birth: indigo-700 hot number
// on white (8.07:1), indigo-700 chips on indigo-50 (7.22:1), slate-600
// chips on slate-100 (6.90:1), amber-700 date-late chips on amber-50
// (4.87:1), and the dark halves in the house's proven pattern (-500/10
// ground under a -300 voice over the modal's own slate-900 panel). The
// org-console mover family (emerald-700/red-700 light, emerald-400/
// red-400 dark over the bg-card token) is RECORDED here as the backlog
// audit's answer: it already passes — no fix owed.
// The recipe (docs/a11y/contrast-math.md): oklch -> sRGB first, composite
// the real paint stack bottom-up, WCAG ratio vs 4.5:1 for text (the
// chips' 9-10px semibold text is small text — bold does not buy the
// 3:1 large-text bar). The desk's composition-bar fills follow the
// v2.198.0 house rule: DECORATION — the figures are aria-labeled on the
// bar itself AND spoken twice beside it (the card's aria-label; the
// modal's three grid cells with their shares) — so the fills are exempt
// from the 3:1 non-text bar and deliberately NOT asserted here (the
// lightest fill, indigo-400, measures 2.85:1 on the slate-100 track in
// light and the darkest, indigo-600, 2.28:1 on the slate-800 track in
// dark — the bar adds no figure the text does not already carry).
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

// ── the literals this release pinned (assert FROM the component source —
// if these drift, the numbers below are measuring a ghost) ──────────────
const kpiSrc = readFileSync(join(process.cwd(), 'src/components/org/kpi-row.tsx'), 'utf8');
const chromeSrc = readFileSync(join(process.cwd(), 'src/components/org/chrome.tsx'), 'utf8');
const matrixSrc = readFileSync(join(process.cwd(), 'src/components/org/store-matrix.tsx'), 'utf8');
const globalsCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

// The lens toggle's fixed active-gross voice (v2.199.0) — and the fix's
// ghost check: the OLD emerald-600 chip must be GONE from the toggle.
if (!kpiSrc.includes("'bg-emerald-700 text-white shadow'")) throw new Error('the lens gross fix drifted — re-derive');
if (kpiSrc.includes("'bg-emerald-600 text-white shadow'")) throw new Error('the old emerald-600 lens chip still speaks — re-derive');
// The desk's faces (assert the exact class strings the math below reads).
if (!kpiSrc.includes('data-testid="pending-card"')) throw new Error('the pending card door drifted');
if (!kpiSrc.includes('data-testid="approval-desk-count"')) throw new Error('the desk count drifted');
if (!kpiSrc.includes("'text-indigo-700 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'")) throw new Error('the desk hot-number dark lift drifted');
if (!kpiSrc.includes('bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-200')) throw new Error('the queue qualifier chip drifted');
if (!kpiSrc.includes("'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30'")) throw new Error('the approval/due-today chip drifted');
if (!kpiSrc.includes("'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'")) throw new Error('the Nd-late chip drifted');
if (!kpiSrc.includes("'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'")) throw new Error('the draft/date/no-date chip drifted');
if (!kpiSrc.includes('data-testid="revenue-card"')) throw new Error('the revenue-card testid drifted');
if (!kpiSrc.includes("hue: 'bg-indigo-600'") || !kpiSrc.includes("hue: 'bg-indigo-500'") || !kpiSrc.includes("hue: 'bg-indigo-400'")) throw new Error('the desk band hues drifted');
// The sweep fixes.
if (!chromeSrc.includes('rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700')) throw new Error('the login error fix drifted — re-derive');
if (!matrixSrc.includes("'font-semibold text-red-700'")) throw new Error('the matrix debt-figure fix drifted — re-derive');

// ── the grounds ─────────────────────────────────────────────────────────
// The card paints bg-white (opaque). The desk modal's panel paints
// bg-slate-50 (light) / dark:bg-slate-900 (dark) — both opaque, the dark
// panel painted on day one (the v2.195.0 house law). The dialog ground
// from globals.css for the texts that sit OUTSIDE the panel.
const readToken = (block, name) => {
  const m = block.match(new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`--${name} oklch not found in the expected block`);
  return oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
};
const rootBlock = globalsCss.slice(globalsCss.indexOf(':root {'), globalsCss.indexOf('.dark {'));
const darkBlock = globalsCss.slice(globalsCss.indexOf('.dark {'), globalsCss.indexOf('.dark {') + 2500);
const DIALOG_LIGHT = readToken(rootBlock, 'background');
const DIALOG_DARK = readToken(darkBlock, 'background');
const CARD_DARK = readToken(darkBlock, 'card');
const PANEL_LIGHT = token('slate-50');
const PANEL_DARK = token('slate-900');
const WHITE = [1, 1, 1];
// The dark chips composite over the panel's own slate-900 (they sit inside it).
const CHIP_DARK = (c) => blend(token(c), 0.1, PANEL_DARK);
// The org-console mover grounds: bg-card light is white, dark is the token.
const MOVER_LIGHT = WHITE;
const MOVER_DARK = CARD_DARK;

let pass = 0, fail = 0, total = 0;
const check = (label, fg, bg, need) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need ${need}:1)`);
};
// The pre-fix states, pinned in reverse so they cannot return silently
// (the v2.198.0 pattern): each must measure UNDER its bar.
const checkBug = (label, fg, bg, max) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r < max;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (the pre-fix state, must stay under ${max}:1)`);
};

console.log('── the sweep: two fixes + one consistency re-voice (ghosts pinned in reverse) ──');
check('lens ACTIVE gross: white on emerald-700 (fixed)', WHITE, token('emerald-700'), 4.5);
checkBug('  ghost: white on emerald-600 (pre-fix, must stay under)', WHITE, token('emerald-600'), 4.5);
check('lens ACTIVE net: white on violet-600 (unchanged, passes)', WHITE, token('violet-600'), 4.5);
check('lens INACTIVE light: slate-500 on white', token('slate-500'), WHITE, 4.5);
check('lens INACTIVE dark: slate-400 on slate-900', token('slate-400'), token('slate-900'), 4.5);
check('login error: red-700 on red-50 (fixed)', token('red-700'), token('red-50'), 4.5);
checkBug('  ghost: red-600 on red-50 (pre-fix, must stay under)', token('red-600'), token('red-50'), 4.5);
check('matrix hot debt: red-700 on white (re-voiced)', token('red-700'), WHITE, 4.5);
check('  pre-fix red-600 on white measured (passed the bar; re-voice is family alignment)', token('red-600'), WHITE, 4.5);

console.log('── light mode: the approval-desk card + modal ──');
check('card hot number indigo-700 on white', token('indigo-700'), WHITE, 4.5);
check('card calm number slate-600 on white', token('slate-600'), WHITE, 4.5);
check('card label slate-500 on white', token('slate-500'), WHITE, 4.5);
check('card icon indigo-600 on white (decorative, recorded)', token('indigo-600'), WHITE, 3);
check('live dot indigo-600 on white (non-text, recorded)', token('indigo-600'), WHITE, 3);
check('queue qualifier indigo-700 on indigo-50', token('indigo-700'), token('indigo-50'), 4.5);
check('desk count indigo-700 on slate-50 panel', token('indigo-700'), PANEL_LIGHT, 4.5);
check('desk label slate-500 on slate-50 panel', token('slate-500'), PANEL_LIGHT, 4.5);
check('desk value slate-800 on slate-50 panel', token('slate-800'), PANEL_LIGHT, 4.5);
check('PO row supplier slate-700 on white', token('slate-700'), WHITE, 4.5);
check('PO row branch slate-500 on white', token('slate-500'), WHITE, 4.5);
check('PO row total slate-700 on white', token('slate-700'), WHITE, 4.5);
check('approval chip indigo-700 on indigo-50', token('indigo-700'), token('indigo-50'), 4.5);
check('draft chip slate-600 on slate-100', token('slate-600'), token('slate-100'), 4.5);
check('Nd-late chip amber-700 on amber-50', token('amber-700'), token('amber-50'), 4.5);
check('due-in/no-date chip slate-600 on slate-100', token('slate-600'), token('slate-100'), 4.5);
check('due-today chip indigo-700 on indigo-50', token('indigo-700'), token('indigo-50'), 4.5);
check('cap note slate-500 on white/60 stack', token('slate-500'), blend(WHITE, 0.6, WHITE), 4.5);
console.log('── light composition bar: decoration by the house rule (NOT asserted) ──');
console.log('        the fills are aria-labeled on the bar AND spoken twice beside it (the card');
console.log('        aria-label; the modal grid with counts + shares) — the fills are exempt from');
console.log('        the 3:1 non-text bar; the bar adds no figure the text does not already carry.');

console.log('── dark mode: the desk panel paints slate-900 from birth ──');
check('desk count indigo-400 on slate-900 panel', token('indigo-400'), PANEL_DARK, 4.5);
check('desk label slate-400 on slate-900 panel', token('slate-400'), PANEL_DARK, 4.5);
check('desk value slate-100 on slate-900 panel', token('slate-100'), PANEL_DARK, 4.5);
check('PO supplier slate-200', token('slate-200'), PANEL_DARK, 4.5);
check('PO branch slate-400', token('slate-400'), PANEL_DARK, 4.5);
check('PO total slate-300', token('slate-300'), PANEL_DARK, 4.5);
check('approval chip dark: indigo-300 on indigo-500/10', token('indigo-300'), CHIP_DARK('indigo-500'), 4.5);
check('draft chip dark: slate-400 on slate-500/10', token('slate-400'), CHIP_DARK('slate-500'), 4.5);
check('Nd-late chip dark: amber-300 on amber-500/10', token('amber-300'), CHIP_DARK('amber-500'), 4.5);
check('due-today chip dark: indigo-300 on indigo-500/10', token('indigo-300'), CHIP_DARK('indigo-500'), 4.5);
check('stale note slate-400 on slate-900/60 stack', token('slate-400'), blend(PANEL_DARK, 0.6, PANEL_DARK), 4.5);
console.log('── the org-dashboard mover voices (backlog audit half — recorded) ──');
check('mover up light: emerald-700 on bg-card(white)', token('emerald-700'), MOVER_LIGHT, 4.5);
check('mover down light: red-700 on bg-card(white)', token('red-700'), MOVER_LIGHT, 4.5);
check('mover up dark: emerald-400 on bg-card(0.19)', token('emerald-400'), MOVER_DARK, 4.5);
check('mover down dark: red-400 on bg-card(0.19)', token('red-400'), MOVER_DARK, 4.5);

console.log(`\n${pass}/${total} families pass (ghosts pinned in reverse; the bar fills documented as decoration, not asserted).`);
process.exit(fail > 0 ? 1 : 0);
