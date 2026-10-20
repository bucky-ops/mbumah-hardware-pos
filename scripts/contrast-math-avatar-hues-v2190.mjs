#!/usr/bin/env node
// v2.190.0 contrast math — the desk roster's avatar-hue family
// (panels.tsx AVATAR_HUES: light "bg-{c}-100 text-{c}-700" (opaque chips),
// dark "bg-{c}-500/20 text-{c}-300" (ALPHA-composited — the class axe
// reports color-contrast INCOMPLETE on, the page-composite family).
// The recipe (docs/a11y/contrast-math.md): oklch -> sRGB first, composite
// the real paint stack bottom-up, WCAG ratio vs 4.5:1 (the family wears
// 10px text: the roster chips' font-medium and the ledger initials'
// font-bold are both small text — the bold does not buy the 3:1 bar).
//
// The dark chip paints over THREE real row states, and the worst corner
// decides — so all three stacks are computed:
//   calm    row: slate-900 (the panel's dark bg) under the /20 hue layer;
//   hover   row: slate-800/50 over slate-900 under the /20 hue layer;
//   drilled row: emerald-500/10 over slate-900 under the /20 hue layer
//                (the v2.188.0 drill tint dark:bg-emerald-500/10).
// The light chip is OPAQUE (bg-{c}-100 solid), so the row state cannot
// reach it — one light composite per hue, three dark ones.
//
// Token values are read from the INSTALLED Tailwind theme
// (node_modules/tailwindcss/theme.css), not from memory — the same source
// the browser paints.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const theme = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
const token = (name) => {
  const m = theme.match(new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`token --color-${name} not found in theme.css`);
  return oklchToSrgb(parseFloat(m[1]) / 100, parseFloat(m[2]), parseFloat(m[3]));
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

const HUES = ['emerald', 'sky', 'violet', 'amber', 'rose', 'teal'];
const ROW_STATES = [
  ['calm', (T) => T.slate900],
  ['hover', (T) => blend(T.slate800, 0.5, T.slate900)],
  ['drilled', (T) => blend(T.emerald500, 0.1, T.slate900)],
];

const T = {
  slate800: token('slate-800'),
  slate900: token('slate-900'),
  emerald500: token('emerald-500'),
};
for (const h of HUES) {
  for (const step of [100, 300, 500, 700]) T[`${h}${step}`] = token(`${h}-${step}`);
}

const verdicts = [];
for (const h of HUES) {
  // LIGHT: the chip paints its own solid -100; the -700 text sits on it.
  const lightBg = T[`${h}100`];
  verdicts.push({
    surface: `light ${h} (700 on 100)`,
    fg: T[`${h}700`],
    bg: lightBg,
  });
  // DARK: the /20 hue layer composites over each real row state; the
  // -300 text sits on the composite.
  for (const [state, paint] of ROW_STATES) {
    verdicts.push({
      surface: `dark ${h} (300 on 500/20 over ${state})`,
      fg: T[`${h}300`],
      bg: blend(T[`${h}500`], 0.2, paint(T)),
    });
  }
}

let fail = 0;
for (const v of verdicts) {
  const r = ratio(v.fg, v.bg);
  const ok = r >= 4.5;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.surface}: ${r.toFixed(2)}:1 (need 4.5:1)`);
}
console.log(`\n${verdicts.length - fail}/${verdicts.length} families pass the small-text bar.`);
process.exit(fail > 0 ? 1 : 0);
