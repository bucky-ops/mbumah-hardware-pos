#!/usr/bin/env node
// v2.200.0 pre-derivation probe: measure the doors' candidate text voices
// against the INSTALLED Tailwind theme before pinning the classes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const theme = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8');
const token = (name) => {
  const m = theme.match(new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (m) return oklchToSrgb(parseFloat(m[1]) / 100, parseFloat(m[2]), parseFloat(m[3]));
  const hex = theme.match(new RegExp(`--color-${name}: (#(?:[0-9a-f]{3}|[0-9a-f]{6}))\\b`));
  if (hex) return hexToSrgb(hex[1]);
  throw new Error(`token --color-${name} not found`);
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

const WHITE = [1, 1, 1];
const PANEL_DARK = token('slate-900');
const CHIP_DARK = (c) => blend(token(c), 0.1, PANEL_DARK);

const cases = [
  // light text pairs (over the white panel)
  ['slate-900 on white (headline)', token('slate-900'), WHITE, 4.5],
  ['slate-500 on white (meta 11px)', token('slate-500'), WHITE, 4.5],
  ['slate-400 on white (window note 10px)', token('slate-400'), WHITE, 4.5],
  ['slate-600 on white (peak 12px)', token('slate-600'), WHITE, 4.5],
  ['emerald-700 on white (peak chip)', token('emerald-700'), WHITE, 4.5],
  ['teal-700 on white', token('teal-700'), WHITE, 4.5],
  ['emerald-700 on emerald-50 (method chip)', token('emerald-700'), token('emerald-50'), 4.5],
  ['teal-700 on teal-50 (method chip)', token('teal-700'), token('teal-50'), 4.5],
  ['slate-600 on slate-100 (share chip)', token('slate-600'), token('slate-100'), 4.5],
  ['emerald-700 on emerald-100 (status chip)', token('emerald-700'), token('emerald-100'), 4.5],
  // dark text pairs (over the slate-900 panel)
  ['slate-100 on slate-900 (headline dark)', token('slate-100'), PANEL_DARK, 4.5],
  ['slate-400 on slate-900 (meta dark)', token('slate-400'), PANEL_DARK, 4.5],
  ['slate-500 on slate-900 (axis labels dark)', token('slate-500'), PANEL_DARK, 4.5],
  ['slate-300 on slate-900 (peak dark)', token('slate-300'), PANEL_DARK, 4.5],
  ['emerald-300 on slate-900 (peak voice dark)', token('emerald-300'), PANEL_DARK, 4.5],
  ['teal-300 on slate-900', token('teal-300'), PANEL_DARK, 4.5],
  ['emerald-300 on emerald-500/10 (chip dark)', token('emerald-300'), CHIP_DARK('emerald-500'), 4.5],
  ['teal-300 on teal-500/10 (chip dark)', token('teal-300'), CHIP_DARK('teal-500'), 4.5],
  ['slate-400 on slate-500/10 (share chip dark)', token('slate-400'), CHIP_DARK('slate-500'), 4.5],
  ['emerald-300 on emerald-500/10 (status dark)', token('emerald-300'), CHIP_DARK('emerald-500'), 4.5],
  ['slate-400 on slate-500/10 (status dark)', token('slate-400'), CHIP_DARK('slate-500'), 4.5],
  // graphics (3:1 bar)
  ['emerald-500/80 fill on white (bar light)', blend(token('emerald-500'), 0.8, WHITE), WHITE, 3],
  ['emerald-400/70 fill on slate-900 (bar dark)', blend(token('emerald-400'), 0.7, PANEL_DARK), PANEL_DARK, 3],
  ['teal-500/80 fill on white', blend(token('teal-500'), 0.8, WHITE), WHITE, 3],
  ['teal-400/70 fill on slate-900', blend(token('teal-400'), 0.7, PANEL_DARK), PANEL_DARK, 3],
  ['amber-500/80 fill on white', blend(token('amber-500'), 0.8, WHITE), WHITE, 3],
  ['amber-400/70 fill on slate-900', blend(token('amber-400'), 0.7, PANEL_DARK), PANEL_DARK, 3],
];

for (const [label, fg, bg, need] of cases) {
  const r = ratio(fg, bg);
  console.log(`${r >= need ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (need ${need})`);
}
