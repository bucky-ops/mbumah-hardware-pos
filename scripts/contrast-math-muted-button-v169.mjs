#!/usr/bin/env node
// v2.169.0 contrast math — the HR per-store expand button (org-console.tsx
// "bg-muted/40 … text-muted-foreground", hover "bg-muted/70").
// axe reports this family as color-contrast INCOMPLETE (alpha-composited
// bg it cannot model). The recipe (docs/a11y/contrast-math.md):
// oklch -> sRGB first, composite the real paint stack bottom-up
// (card solid -> muted alpha layer), WCAG ratio vs 4.5:1 (12px text).
// Token values from src/app/globals.css :root and .dark blocks.
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

// tokens (light :root / dark .dark)
const LIGHT = {
  card: oklchToSrgb(1, 0, 0),
  muted: oklchToSrgb(0.96, 0.008, 250),
  mutedFg: oklchToSrgb(0.5, 0.02, 260),
};
const DARK = {
  card: oklchToSrgb(0.19, 0.02, 260),
  muted: oklchToSrgb(0.24, 0.02, 260),
  mutedFg: oklchToSrgb(0.65, 0.03, 260),
};

const verdicts = [];
for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
  for (const [state, alpha] of [['rest /40', 0.4], ['hover /70', 0.7]]) {
    const bg = blend(T.muted, alpha, T.card);
    const r = ratio(T.mutedFg, bg);
    const ok = r >= 4.5;
    verdicts.push({ surface: `${name} ${state}`, ratio: r.toFixed(2), ok });
  }
}
for (const v of verdicts) {
  console.log(`${v.ok ? 'PASS' : 'FAIL'}  ${v.surface}: ${v.ratio}:1 (need 4.5:1)`);
}
process.exit(verdicts.some((v) => !v.ok) ? 1 : 0);
