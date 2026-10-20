#!/usr/bin/env node
// Login glass-card MANUAL contrast audit (v2.162.0) — closes the 17 axe
// "color-contrast incomplete" findings that axe cannot compute because the
// glass card's background is alpha-composited (backdrop-filter) over the
// dark login gradient. This script does the blend math axe can't:
//   page gradient (fixed dark oklch stops) → glass-card (alpha) → element bg → text
// and evaluates WCAG contrast for EVERY text family in BOTH themes, each
// against its ACTUAL painted background (own badge bg where present, page
// where outside the card, glass blend where directly on the card).
//
// Usage: node /home/z/my-project/scripts/contrast-audit-login.mjs
// Exit 1 if any family fails its threshold.

// ---- oklch → sRGB (Björn Ottosson's conversion) ----
function oklchToSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const toGamma = (c) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return [toGamma(r), toGamma(g), toGamma(bl)].map((c) =>
    Math.min(1, Math.max(0, c)),
  );
}
function lum(rgb) {
  const lin = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
  const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a];
  return (lum(hi) + 0.05) / (lum(lo) + 0.05);
}
function composite(top, topAlpha, bottom) {
  return top.map((c, i) => c * topAlpha + bottom[i] * (1 - topAlpha));
}

// ---- Named colors (Tailwind v4 palette, oklch-sourced) ----
const NAMED = {
  white: [1, 1, 1],
  green50: oklchToSrgb(0.982, 0.018, 155),
  green700: oklchToSrgb(0.527, 0.154, 150),
  green400: oklchToSrgb(0.792, 0.209, 151),
  green950: oklchToSrgb(0.266, 0.065, 152),
  amber50: oklchToSrgb(0.987, 0.022, 95),
  amber700: oklchToSrgb(0.555, 0.163, 48),
  amber800: oklchToSrgb(0.473, 0.137, 46),
  amber300: oklchToSrgb(0.879, 0.169, 91),
  amber400: oklchToSrgb(0.828, 0.189, 84),
  amber950: oklchToSrgb(0.279, 0.077, 45),
  amber200: oklchToSrgb(0.924, 0.12, 95),
  emerald50: oklchToSrgb(0.979, 0.021, 166),
  emerald700: oklchToSrgb(0.508, 0.118, 165),
  emerald400: oklchToSrgb(0.765, 0.177, 163),
  emerald950: oklchToSrgb(0.262, 0.051, 172),
  destructive: oklchToSrgb(0.577, 0.245, 27),
};

// ---- Theme tokens (src/app/globals.css :root / .dark) ----
const TOKENS = {
  light: {
    foreground: oklchToSrgb(0.175, 0.02, 260),
    primary: oklchToSrgb(0.295, 0.1, 260),
    mutedFg: oklchToSrgb(0.5, 0.02, 260),
  },
  dark: {
    foreground: oklchToSrgb(0.935, 0.01, 250),
    primary: oklchToSrgb(0.65, 0.15, 260),
    mutedFg: oklchToSrgb(0.65, 0.03, 260),
  },
};

// ---- Page background (the login gradient stack — FIXED across themes) ----
const GRAD_BR = [
  oklchToSrgb(0.22, 0.07, 260),
  oklchToSrgb(0.295, 0.1, 260),
  oklchToSrgb(0.22, 0.06, 260),
];
const GRAD_TR = [
  oklchToSrgb(0.22, 0.08, 30),
  oklchToSrgb(0.25, 0.09, 150),
];
function pageBackgrounds() {
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const seg = t < 0.5 ? 0 : 1;
    const lt = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const br = GRAD_BR[seg].map((c, k) => c * (1 - lt) + GRAD_BR[seg + 1][k] * lt);
    const ovAlpha = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2;
    const ovEnd = t < 0.5 ? GRAD_TR[0] : GRAD_TR[1];
    pts.push({ t, page: ovAlpha > 0.001 ? composite(ovEnd, ovAlpha, br) : br });
  }
  return pts;
}
function glassBg(page, theme) {
  return theme === 'light'
    ? composite([1, 1, 1], 0.6, page)
    : composite(oklchToSrgb(0.19, 0.02, 260), 0.6, page);
}

const results = [];
function audit(theme, label, opts) {
  const {
    text, textAlpha = 1, // text color factory: (theme) => rgb
    bg = 'card', // 'card' | 'page' | { rgb, alpha } (own bg composited over card)
    threshold = 4.5,
  } = opts;
  const ratios = pageBackgrounds().map((p) => {
    const card = glassBg(p.page, theme);
    let base;
    if (bg === 'card') base = card;
    else if (bg === 'page') base = p.page;
    else base = composite(bg.rgb(theme), bg.alpha, card);
    const t = textAlpha < 1 ? composite(text(theme), textAlpha, base) : text(theme);
    return contrast(t, base);
  });
  const worst = Math.min(...ratios);
  results.push({ theme, label, worst: worst.toFixed(2), threshold, pass: worst >= threshold });
}

for (const theme of ['light', 'dark']) {
  const T = TOKENS[theme];
  const d = theme === 'light';
  // — On the glass card directly —
  audit(theme, 'CardTitle (foreground, 24px bold)', { text: () => T.foreground, threshold: 3.0 });
  audit(theme, 'CardDescription (foreground/70 → /80 FIX)', { text: () => T.foreground, textAlpha: 0.8 });
  audit(theme, 'Label (foreground, 14px)', { text: () => T.foreground });
  audit(theme, 'Input typed text (foreground)', { text: () => T.foreground });
  audit(theme, 'Input placeholder (muted-foreground → fg/80 FIX)', { text: () => T.foreground, textAlpha: 0.8 });
  audit(theme, 'Forgot link (foreground/90 + underline FIX)', { text: () => T.foreground, textAlpha: 0.9 });
  audit(theme, 'Forgot help text (amber-800 on amber-50 solid / amber-300 on amber-950/30)', {
    text: () => (d ? NAMED.amber800 : NAMED.amber300),
    bg: d ? { rgb: () => NAMED.amber50, alpha: 1 } : { rgb: () => NAMED.amber950, alpha: 0.3 },
  });
  // — Badges: own bg (solid light / alpha dark) —
  audit(theme, 'Badge security (green-700 on green-50 / green-400 on green-950/30)', {
    text: () => (d ? NAMED.green700 : NAMED.green400),
    bg: d ? { rgb: () => NAMED.green50, alpha: 1 } : { rgb: () => NAMED.green950, alpha: 0.3 },
  });
  audit(theme, 'Badge mpesa (amber-700 on amber-50 / amber-400 on amber-950/30)', {
    text: () => (d ? NAMED.amber700 : NAMED.amber400),
    bg: d ? { rgb: () => NAMED.amber50, alpha: 1 } : { rgb: () => NAMED.amber950, alpha: 0.3 },
  });
  audit(theme, 'Badge multi-branch (emerald-700 on emerald-50 / emerald-400 on emerald-950/30)', {
    text: () => (d ? NAMED.emerald700 : NAMED.emerald400),
    bg: d ? { rgb: () => NAMED.emerald50, alpha: 1 } : { rgb: () => NAMED.emerald950, alpha: 0.3 },
  });
  // — Footer inside card —
  audit(theme, 'Footer contact row (foreground/80, 11px)', { text: () => T.foreground, textAlpha: 0.8 });
  audit(theme, 'Footer dots (foreground/80 + aria-hidden FIX)', { text: () => T.foreground, textAlpha: 0.8 });
  audit(theme, 'Footer base (foreground/80 FIX, was muted-foreground)', { text: () => T.foreground, textAlpha: 0.8 });
  // — Above/below the card: on the PAGE, not the glass —
  audit(theme, 'Header tagline (white/60, 11px)', { text: () => NAMED.white, textAlpha: 0.6, bg: 'page' });
  audit(theme, 'Header h2 (white/90, 20px)', { text: () => NAMED.white, textAlpha: 0.9, bg: 'page', threshold: 4.5 });
  audit(theme, 'Powered-by line (white/70, 12px)', { text: () => NAMED.white, textAlpha: 0.7, bg: 'page' });
  audit(theme, 'Copyright line (white/55, 10px)', { text: () => NAMED.white, textAlpha: 0.55, bg: 'page' });
  // — Non-text / remaining solid-bg families for completeness —
  audit(theme, 'Submit button label (accent-orange-foreground on accent-orange gradient)', {
    text: () => oklchToSrgb(0.175, 0.05, 55),
    bg: { rgb: () => oklchToSrgb(0.68, 0.18, 55), alpha: 1 },
  });
  audit(theme, 'Error clear X (red-700 light FIX / destructive dark, 3:1 UI component)', {
    text: () => (d ? oklchToSrgb(0.505, 0.213, 27.181) : oklchToSrgb(0.704, 0.191, 22.216)),
    threshold: 3.0,
  });
}

console.log('LOGIN GLASS-CARD CONTRAST AUDIT v2 — correct painted backgrounds per family');
console.log('='.repeat(104));
let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log(
    `[${r.pass ? 'PASS' : 'FAIL'}] ${r.theme.padEnd(5)} ${r.label.padEnd(72)} worst ${r.worst}:1 (need ${r.threshold})`,
  );
}
console.log('='.repeat(104));
console.log(`${fail} failing of ${results.length} checks`);
process.exit(fail > 0 ? 1 : 0);
