#!/usr/bin/env node
// v2.191.0 contrast math — the HR drill-down's status-badge families
// (org-console.tsx payroll cell: LOCKED/POSTED emerald, DRAFT/APPROVED
// amber, VOIDED slate). axe reports the DARK halves as color-contrast
// INCOMPLETE (alpha-composited badge bg it cannot model): light is the
// opaque -50 chip (stack-independent), dark is `{c}-950/40` (or slate-900
// /60) composited over the card token the table paints. The recipe
// (docs/a11y/contrast-math.md): oklch -> sRGB first, composite the real
// paint stack bottom-up, WCAG ratio vs 4.5:1 (the badge is 10px
// font-medium small text).
//
// Token values: card from src/app/globals.css (:root / .dark), palette
// from the INSTALLED Tailwind theme (node_modules/tailwindcss/theme.css)
// — the same sources the browser paints.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const theme = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
const token = (name) => {
  const m = theme.match(new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`token --color-${name} not found in theme.css`);
  return oklchToSrgb(parseFloat(m[1]) / 100, parseFloat(m[2]), parseFloat(m[3]));
};
const cssVar = (name) => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const m = css.match(new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`, 'g'));
  if (!m) throw new Error(`--${name} not found in globals.css`);
  // first match = :root (light), second = .dark — return both
  return m.map((s) => {
    const p = s.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
    return oklchToSrgb(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
  });
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

const [cardLight, cardDark] = cssVar('card');

const FAMILIES = [
  // [label, lightFg, lightBg, darkFg, darkBgAlphaTop, darkAlpha]
  ['emerald (locked/posted)', token('emerald-700'), token('emerald-50'), token('emerald-300'), token('emerald-950'), 0.4],
  ['amber (draft/approved)', token('amber-700'), token('amber-50'), token('amber-300'), token('amber-950'), 0.4],
  ['slate (voided)', token('slate-600'), token('slate-50'), token('slate-300'), token('slate-900'), 0.6],
];

let fail = 0;
for (const [label, lfg, lbg, dfg, dtop, dalpha] of FAMILIES) {
  const lr = ratio(lfg, lbg);
  const dr = ratio(dfg, blend(dtop, dalpha, cardDark));
  for (const [themeName, r] of [['light', lr], ['dark', dr]]) {
    const ok = r >= 4.5;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${themeName}: ${r.toFixed(2)}:1 (need 4.5:1)`);
  }
}
console.log(`\n${FAMILIES.length * 2 - fail}/${FAMILIES.length * 2} badge families pass the small-text bar.`);
process.exit(fail > 0 ? 1 : 0);
