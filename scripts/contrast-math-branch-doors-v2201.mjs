#!/usr/bin/env node
// v2.201.0 contrast math — the branch's debt book + the day's movers
// (src/components/dashboard/branch-doors.tsx + the two card doors in
// src/app/(shell)/tabs/dashboard-tab.tsx) in BOTH modes, over the real
// paint stacks from the INSTALLED Tailwind theme.
//
// THE ROUND'S SWEEP — the -600 straggler family, measured by the
// pre-derivation probe (scripts/probe-quiet-doors-v2201.mjs) and re-voiced
// at source BEFORE anything shipped. Sixteen real finds, one family: small
// and mid-weight text riding red-600/rose-600 over white, over the -50
// grounds and over the -100 chip grounds — the exact pairing v2.198.0
// found on the Expert OVERDUE badge and v2.199.0 found twice more (the
// login error line, the lens ACTIVE chip); this round closes the family on
// the branch dashboard:
//   - the Alerts COUNT BADGE: white 10px bold on bg-red-500 = 3.82:1 →
//     bg-red-700 = 6.42:1 (the badge's own alarm, caught red-handed);
//   - the payment-method DEBT chip rose-600 on rose-100 = 3.75 → rose-700
//     = 5.04, and the GIFT_CARD chip slate-500 on slate-100 = 4.35 →
//     slate-600 = 6.90;
//   - the alert CRITICAL chip red-600 on red-100 = 3.90 → red-700 = 5.26;
//   - the debt-crisis BANNER sub-line red-600 on red-50 = 4.36 → red-700
//     = 5.88 (the v2.199 login-error pairing, third instance);
//   - the KPI stock/debt card icons + values (red-600 on red-100 3.90,
//     red-600 on white 3.99, rose-600 knife-edge 4.51) → red-700/rose-700
//     (5.26/6.42/6.06) — the debt card's own total figure included;
//   - the trend badge's DOWN voice red-600 on red-50 4.36 → red-700;
//   - the shift drawer's cash-out, the top-customers' "Owes", the
//     high-risk avatar initials, the limited row's "N out" — all red-600
//     on white/red-100 → -700;
//   - the debt book's OWN figures rode in at rose-600 (4.51 — a
//     knife-edge pass on the installed palette) and were moved to
//     rose-700 light / rose-300 dark (6.06 / 9.29) as FAMILY ALIGNMENT,
//     recorded honestly: consistency plus margin, not a violation.
//
// GHOSTS PINNED IN REVERSE (the draft pairs must stay under their bars):
// white on red-500 (the badge draft), rose-600 on rose-100 (the DEBT chip
// draft), slate-500 on slate-100 (the GIFT draft), red-600 on red-100 (the
// critical draft), red-600 on red-50 (the banner/badge-down draft).
// RECORDED HONESTLY as ALIGNMENT, not violation: red-600 on white measures
// 4.76 on the installed palette — it PASSES the 4.5 bar — so the KPI card
// values, the shift drawer's cash-out, the top-customers' "Owes" and the
// debt figures moved red-600/rose-600 → -700 as FAMILY ALIGNMENT with the
// chip sweep (the v2.199 Store-Matrix precedent: consistency recorded as
// consistency), plus margin against palette drift.
//
// DECORATION, documented per the v2.198.0 law (NOT asserted as graphics):
// the aging bar's segments (emerald-500 2.46 / orange-500 2.89 on white)
// — the figures are spoken twice beside (the bucket cells carry dot +
// label + amount + share; the bar carries the role="img" aria naming all
// four buckets and the total); the cards' hot rings (rose-300 1.92 /
// slate-300 on white) — the alarm they hint at is spoken in the warning
// banner, the high-risk line and the card's aria-label; the severity dots
// of the activity feed are aria-hidden with the row text carrying the
// meaning.
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
const doorsSrc = readFileSync(join(process.cwd(), 'src/components/dashboard/branch-doors.tsx'), 'utf8');
const tabSrc = readFileSync(join(process.cwd(), 'src/app/(shell)/tabs/dashboard-tab.tsx'), 'utf8');

if (!doorsSrc.includes('data-testid="branch-debt-count"')) throw new Error('the debt book drifted');
if (!doorsSrc.includes('data-testid="branch-movers-count"')) throw new Error('the movers door drifted');
if (!tabSrc.includes('data-testid="branch-debt-card"')) throw new Error('the debt card handle drifted');
if (!tabSrc.includes('data-testid="branch-movers-card"')) throw new Error('the movers card handle drifted');
// The sweep's fixed voices at source (the -600 family must be GONE from the
// branch dashboard's text voices).
if (tabSrc.includes('text-red-600') || tabSrc.includes('text-rose-600')) throw new Error('a -600 text voice still rides — re-derive');
if (!tabSrc.includes('bg-red-700 px-1.5 text-[10px] font-bold text-white')) throw new Error('the alerts badge fix drifted');
if (!tabSrc.includes("DEBT: 'bg-rose-100 text-rose-700'")) throw new Error('the DEBT chip fix drifted');
if (!tabSrc.includes("GIFT_CARD: 'bg-slate-100 text-slate-600'")) throw new Error('the GIFT chip fix drifted');
if (!tabSrc.includes("circle: 'bg-red-100 text-red-700'")) throw new Error('the critical chip fix drifted');
// The debt book's own figures speak the family's -700/-300 alignment.
if (!doorsSrc.includes('text-rose-700 dark:text-rose-300')) throw new Error('the debt figure voice drifted');
if (doorsSrc.includes('text-rose-600') || doorsSrc.includes('dark:text-rose-400')) throw new Error('a draft debt figure voice still rides');
// The panels paint their dark half from birth (the branch page's next mounts).
if (!doorsSrc.includes('dark:border-slate-700 dark:bg-slate-900')) throw new Error('the dark-panel law drifted');

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
const checkBug = (label, fg, bg, max) => {
  total++;
  const r = ratio(fg, bg);
  const ok = r < max;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (the pre-fix draft, must stay under ${max}:1)`);
};

console.log('── the sweep, light mode ──');
check('alerts badge white on red-700 (the fix)', WHITE, token('red-700'), 4.5);
check('DEBT chip rose-700 on rose-100 (the fix)', token('rose-700'), token('rose-100'), 4.5);
check('GIFT chip slate-600 on slate-100 (the fix)', token('slate-600'), token('slate-100'), 4.5);
check('CRITICAL chip red-700 on red-100 (the fix)', token('red-700'), token('red-100'), 4.5);
check('banner sub red-700 on red-50 (the fix)', token('red-700'), token('red-50'), 4.5);
check('trend DOWN chip red-700 on red-50 (the fix)', token('red-700'), token('red-50'), 4.5);
check('stock KPI value red-700 on white (the fix)', token('red-700'), WHITE, 4.5);
check('debt KPI value rose-700 on white (the fix)', token('rose-700'), WHITE, 4.5);
check('debt card total rose-700 on white (the fix)', token('rose-700'), WHITE, 4.5);
check('warning voice amber-700 on amber-100 (measured, already passes)', token('amber-700'), token('amber-100'), 4.5);
check('CASH chip emerald-700 on emerald-100 (measured, already passes)', token('emerald-700'), token('emerald-100'), 4.5);
check('MPESA chip amber-700 on amber-100 (measured, already passes)', token('amber-700'), token('amber-100'), 4.5);
check('SPLIT chip slate-600 on slate-200 (measured, already passes)', token('slate-600'), token('slate-200'), 4.5);

console.log('── the debt book, light (over its white panel) ──');
check('count rose-700 on white (the family-aligned figure)', token('rose-700'), WHITE, 4.5);
check('owes rose-700 on white (the family-aligned figure)', token('rose-700'), WHITE, 4.5);
check('meta/window slate-500 on white', token('slate-500'), WHITE, 4.5);
check('risk chip rose-700 on rose-50', token('rose-700'), token('rose-50'), 4.5);
check('clear line emerald-700 on emerald-50', token('emerald-700'), token('emerald-50'), 4.5);
check('banner line rose-700 on rose-50', token('rose-700'), token('rose-50'), 4.5);
check('debtor name slate-900 on white', token('slate-900'), WHITE, 4.5);

console.log('── the debt book, dark (over its own slate-900) ──');
check('count rose-300 on slate-900', token('rose-300'), PANEL_DARK, 4.5);
check('owes rose-300 on slate-900', token('rose-300'), PANEL_DARK, 4.5);
check('meta/window slate-400 on slate-900', token('slate-400'), PANEL_DARK, 4.5);
check('risk chip rose-300 on rose-500/10', token('rose-300'), CHIP_DARK('rose-500'), 4.5);
check('clear line emerald-300 on emerald-500/10', token('emerald-300'), CHIP_DARK('emerald-500'), 4.5);
check('banner line rose-300 on rose-500/10', token('rose-300'), CHIP_DARK('rose-500'), 4.5);

console.log("── the day's movers, light ──");
check('headline slate-900 on white', token('slate-900'), WHITE, 4.5);
check('meta/share slate-500 on white', token('slate-500'), WHITE, 4.5);
check('mover revenue slate-900 on white', token('slate-900'), WHITE, 4.5);
check('category name slate-700 on white', token('slate-700'), WHITE, 4.5);
check('clear line slate-500 on slate-50', token('slate-500'), token('slate-50'), 4.5);

console.log("── the day's movers, dark ──");
check('headline slate-100 on slate-900', token('slate-100'), PANEL_DARK, 4.5);
check('meta/share slate-400 on slate-900', token('slate-400'), PANEL_DARK, 4.5);
check('mover revenue slate-100 on slate-900', token('slate-100'), PANEL_DARK, 4.5);
check('category name slate-200 on slate-900', token('slate-200'), PANEL_DARK, 4.5);
check('clear line slate-400 on slate-500/10', token('slate-400'), CHIP_DARK('slate-500'), 4.5);

console.log('── the round\'s ghosts, pinned in reverse ──');
checkBug('  ghost: white on red-500 (the badge draft)', WHITE, token('red-500'), 4.5);
checkBug('  ghost: rose-600 on rose-100 (the DEBT chip draft)', token('rose-600'), token('rose-100'), 4.5);
checkBug('  ghost: slate-500 on slate-100 (the GIFT chip draft)', token('slate-500'), token('slate-100'), 4.5);
checkBug('  ghost: red-600 on red-100 (the critical draft)', token('red-600'), token('red-100'), 4.5);
checkBug('  ghost: red-600 on red-50 (the banner draft)', token('red-600'), token('red-50'), 4.5);
console.log(`  note (alignment, not violation): red-600 on white = ${ratio(token('red-600'), WHITE).toFixed(2)}:1 — PASSES 4.5 on the installed palette; the value voices moved to red-700/rose-700 (${ratio(token('red-700'), WHITE).toFixed(2)}/${ratio(token('rose-700'), WHITE).toFixed(2)}) as FAMILY ALIGNMENT with the chip sweep + margin against palette drift.`);

console.log('── the doors\' edge/dot hues (graphics, 3:1 over the white card) ──');
check('debt edge rose-600 on white', token('rose-600'), WHITE, 3);
check('movers edge violet-600 on white', token('violet-600'), WHITE, 3);

console.log('── decoration, documented per the v2.198.0 law (NOT asserted) ──');
console.log(`  note: the aging bar's segments on white = emerald-500 ${ratio(token('emerald-500'), WHITE).toFixed(2)}:1 / orange-500 ${ratio(token('orange-500'), WHITE).toFixed(2)}:1 / red-500 ${ratio(token('red-500'), WHITE).toFixed(2)}:1 / slate-500 ${ratio(token('slate-500'), WHITE).toFixed(2)}:1 — the under-3 fills are BY DESIGN decoration: the bar is role="img" naming all four buckets and the total, and every figure is spoken twice beside (the bucket cells' dot + label + amount + share).`);
console.log(`  note: the hot rings on white = rose-300 ${ratio(token('rose-300'), WHITE).toFixed(2)}:1 / slate-300 ${ratio(token('slate-300'), WHITE).toFixed(2)}:1 — the alarm is spoken in the warning banner, the high-risk line and the card's aria-label, the ring hints only.`);
console.log(`  note: the movers' category dots carry the wire's own colors with an aria-hidden and the row text naming the category + revenue + share — decoration.`);

console.log(`\n${pass}/${total} checks pass`);
process.exit(fail > 0 ? 1 : 0);
