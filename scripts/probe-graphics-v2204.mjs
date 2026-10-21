#!/usr/bin/env node
/**
 * GRAPHICS-BAR PROBE - v2.204.0 "the pictures learn to speak"
 * ═══════════════════════════════════════════════════════════════════════════
 * The v2.203.0 round caught ONE sub-3:1 line (the forecast dash at 2.15:1)
 * and this round's pre-derivation probe measured the WHOLE app's
 * meaning-bearing graphics against the same WCAG 2.x non-text 3:1 bar —
 * plus the two places where a GRAPHIC color was also painting TEXT (the
 * health score numbers), which must clear the 4.5:1 text bar.
 *
 * Every voice below is read FROM SOURCE (regex on the file), then measured
 * with the WCAG relative-luminance formula on its real ground. A voice that
 * drifts from its re-voiced constant fails the probe — the source cannot
 * silently regress.
 *
 * GROUNDS: white card #ffffff (all card-borne charts), slate-100 #f1f5f9
 * (the Kenya map's land fill). Dark-mode scoping is recorded per the house
 * law (the a11y-shell precedent): the -600/-700 families clear the bar on
 * slate-900 by an even wider margin, so the LIGHT-MODE law is the binding one.
 *
 * Exit 0 = every voice passes. Any failure prints and exits 1.
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => { try { return readFileSync(ROOT + p, 'utf8'); } catch { return ''; } };

// ── WCAG machinery ───────────────────────────────────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (hex) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (fg, bg) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};
const WHITE = '#ffffff', SLATE100 = '#f1f5f9';
const GRAPHICS_BAR = 3.0, TEXT_BAR = 4.5;

let pass = 0, fail = 0;
const verdict = (name, fg, bg, bar, srcHas) => {
  const c = fg === 'label' ? bar : contrast(fg, bg); // label mode: presence-only check
  const ok = srcHas && c >= bar - 0.001;
  if (ok) { pass++; console.log(`  PASS  ${fg === 'label' ? ' spoke ' : c.toFixed(2).padStart(5) + ':1'}  (${bar}:1)  ${name}${fg === 'label' ? '' : `  ${fg} on ${bg}`}`); }
  else { fail++; console.log(`  FAIL  ${fg === 'label' ? ' spoke ' : c.toFixed(2).padStart(5) + ':1'}  (${bar}:1)  ${name}${fg === 'label' ? '' : `  ${fg} on ${bg}`}${srcHas ? '' : '  [SOURCE MISSING]'}`); }
};

console.log('═ SCENE 1 — the branch dashboard (dashboard-tab.tsx) ═');
const dash = read('src/app/(shell)/tabs/dashboard-tab.tsx');
{
  // Payment donut + legend mini-bars (the PAYMENT_META map)
  const meta = dash.match(/const PAYMENT_META[^=]*= \{[\s\S]*?\n\};/)?.[0] ?? '';
  verdict('payment CASH segment', '#059669', WHITE, GRAPHICS_BAR, meta.includes("color: '#059669'"));
  verdict('payment MPESA segment', '#d97706', WHITE, GRAPHICS_BAR, meta.includes("color: '#d97706'"));
  verdict('payment DEBT segment', '#f43f5e', WHITE, GRAPHICS_BAR, meta.includes("color: '#f43f5e'"));
  verdict('payment SPLIT segment', '#64748b', WHITE, GRAPHICS_BAR, meta.includes("color: '#64748b'"));
  verdict('payment GIFT_CARD segment', '#7c3aed', WHITE, GRAPHICS_BAR, /GIFT_CARD[^}]*color: '#7c3aed'/.test(meta));
  // Aging bar segments
  const segs = dash.match(/const segments = buckets[\s\S]*?\n    : \[\];/)?.[0] ?? '';
  verdict('aging CURRENT segment', '#059669', WHITE, GRAPHICS_BAR, segs.includes("color: '#059669'"));
  verdict('aging 30d segment', '#64748b', WHITE, GRAPHICS_BAR, segs.includes("color: '#64748b'"));
  verdict('aging 60d segment', '#ea580c', WHITE, GRAPHICS_BAR, segs.includes("color: '#ea580c'"));
  verdict('aging 90d segment', '#ef4444', WHITE, GRAPHICS_BAR, segs.includes("color: '#ef4444'"));
  // healthColor (gauge stroke + breakdown bar fills) + healthTextColor (score numbers)
  const hc = dash.match(/function healthColor[\s\S]*?\n\}/)?.[0] ?? '';
  verdict('health stroke good', '#059669', WHITE, GRAPHICS_BAR, hc.includes("'#059669'"));
  verdict('health stroke mid', '#d97706', WHITE, GRAPHICS_BAR, hc.includes("'#d97706'"));
  verdict('health stroke hot', '#ea580c', WHITE, GRAPHICS_BAR, hc.includes("'#ea580c'"));
  verdict('health stroke debt', '#ef4444', WHITE, GRAPHICS_BAR, hc.includes("'#ef4444'"));
  const htc = dash.match(/function healthTextColor[\s\S]*?\n\}/)?.[0] ?? '';
  verdict('health TEXT good', '#047857', WHITE, TEXT_BAR, htc.includes("'#047857'"));
  verdict('health TEXT mid', '#b45309', WHITE, TEXT_BAR, htc.includes("'#b45309'"));
  verdict('health TEXT hot', '#c2410c', WHITE, TEXT_BAR, htc.includes("'#c2410c'"));
  verdict('health TEXT debt', '#b91c1c', WHITE, TEXT_BAR, htc.includes("'#b91c1c'"));
  // the week chart's own voices (line + forecast dash from v2.203)
  verdict('week line', '#059669', WHITE, GRAPHICS_BAR, /stroke="#059669"/.test(dash));
  verdict('week forecast dash', '#d97706', WHITE, GRAPHICS_BAR, dash.includes('stroke="#d97706"'));
  // the area gradient now rides the -600 family too
  const grad = dash.match(/id="dashRevGrad"[\s\S]*?<\/linearGradient>/)?.[0] ?? '';
  verdict('week area gradient top stop', '#059669', WHITE, GRAPHICS_BAR, grad.includes('stopColor="#059669"'));
  verdict('donut aria composes the split', 'label', 'n/a', 1, /aria-label=\{donutSpoken\}/.test(dash));
  verdict('aging bar aria composes buckets', 'label', 'n/a', 1, /aria-label=\{agingSpoken\}/.test(dash));
  verdict('week chart aria composes days', 'label', 'n/a', 1, /weekSpoken/.test(dash));
  verdict('heatmap aria composes peak', 'label', 'n/a', 1, /heatmapSpoken/.test(dash));
}

console.log('═ SCENE 2 — the org primitives (Sparkline, Kenya map, health gauge) ═');
const prim = read('src/components/org/primitives.tsx');
{
  verdict('Sparkline default stroke', '#059669', WHITE, GRAPHICS_BAR, /stroke = '#059669'/.test(prim));
  verdict('Sparkline speaks when labeled', 'label', 'n/a', 1, /'aria-label': spoken/.test(prim) && /spokenLabel/.test(prim));
  verdict('health gauge stroke good', '#059669', WHITE, GRAPHICS_BAR, /score >= 80 \? '#059669'/.test(prim));
  verdict('health gauge stroke mid', '#d97706', WHITE, GRAPHICS_BAR, /score >= 60 \? '#d97706'/.test(prim));
  verdict('health gauge TEXT good', '#047857', WHITE, TEXT_BAR, /textColor = score >= 80 \? '#047857'/.test(prim));
  verdict('health gauge TEXT mid', '#b45309', WHITE, TEXT_BAR, /score >= 60 \? '#b45309'/.test(prim));
  verdict('health gauge TEXT hot', '#b91c1c', WHITE, TEXT_BAR, /: '#b91c1c'/.test(prim));
  // Kenya map dots on the slate-100 land fill
  verdict('map hot dot', '#ea580c', SLATE100, GRAPHICS_BAR, /heat > 0\.5 \? '#ea580c'/.test(prim));
  verdict('map warm dot', '#059669', SLATE100, GRAPHICS_BAR, /heat > 0 \? '#059669'/.test(prim));
  verdict('map quiet dot', '#64748b', SLATE100, GRAPHICS_BAR, /: '#64748b'/.test(prim));
  verdict('map aria composes ranks', 'label', 'n/a', 1, /mapSpoken|aria-label=\{/.test(prim));
}

console.log('═ SCENE 3 — analytics (KPI accents, area chart, product bars, donut) ═');
{
  const grid = read('src/components/analytics/kpi-grid.tsx');
  verdict('KPI accent revenue', '#059669', WHITE, GRAPHICS_BAR, grid.includes("accent: '#059669'"));
  verdict('KPI accent transactions', '#0284c7', WHITE, GRAPHICS_BAR, grid.includes("accent: '#0284c7'"));
  verdict('KPI accent amber', '#d97706', WHITE, GRAPHICS_BAR, grid.includes("accent: '#d97706'"));
  verdict('KPI accent orange', '#ea580c', WHITE, GRAPHICS_BAR, grid.includes("accent: '#ea580c'"));
  const trend = read('src/components/analytics/sales-trend-chart.tsx');
  verdict('analytics area stroke', '#059669', WHITE, GRAPHICS_BAR, trend.includes('stroke="#059669"'));
  verdict('analytics prev-period dash', '#64748b', WHITE, GRAPHICS_BAR, trend.includes('stroke="#64748b"'));
  verdict('analytics gradient stop', '#059669', WHITE, GRAPHICS_BAR, trend.includes('stopColor="#059669"'));
  const prods = read('src/components/analytics/top-products-chart.tsx');
  for (const [name, hex] of [['palette emerald', '#059669'], ['palette amber', '#d97706'], ['palette teal', '#0d9488'], ['palette orange', '#ea580c'], ['palette cyan', '#0891b2'], ['palette lime', '#65a30d'], ['palette yellow', '#a16207']]) {
    verdict(`top-products ${name}`, hex, WHITE, GRAPHICS_BAR, prods.includes(`'${hex}'`));
  }
  const util = read('src/lib/analytics-utils.ts');
  for (const [name, hex] of [['PAYMENT CASH', '#059669'], ['PAYMENT MPESA', '#d97706'], ['PAYMENT GIFT_CARD', '#0891b2']]) {
    verdict(name, hex, WHITE, GRAPHICS_BAR, new RegExp(hex.replace('#', '#')).test(util));
  }
  const donut = read('src/components/analytics/payment-donut.tsx');
  verdict('donut % TEXT voices map exists', 'label', 'n/a', 1, /PAYMENT_METHOD_TEXT/.test(donut) || /paymentMethodTextColor/.test(donut));
  verdict('donut zero-row border', '#64748b', WHITE, GRAPHICS_BAR, donut.includes("'#64748b'"));
}

console.log('═ SCENE 4 — the org console doors stay in sync ═');
{
  const doors = read('src/components/dashboard/kpi-doors.tsx');
  verdict('tender meta CASH (sync with the page card)', '#059669', WHITE, GRAPHICS_BAR, doors.includes("color: '#059669'"));
  verdict('tender meta MPESA', '#d97706', WHITE, GRAPHICS_BAR, doors.includes("color: '#d97706'"));
  const bd = read('src/components/dashboard/branch-doors.tsx');
  verdict('debt book CURRENT dot/bar', '#059669', WHITE, GRAPHICS_BAR, bd.includes("color: '#059669'"));
  verdict('debt book 60d dot/bar', '#ea580c', WHITE, GRAPHICS_BAR, bd.includes("color: '#ea580c'"));
}

console.log('═ SCENE 5 — financial / reports / system health / security ═');
{
  const fin = read('src/app/(shell)/tabs/financial-tab.tsx');
  verdict('financial revenue line', '#059669', WHITE, GRAPHICS_BAR, fin.includes("color: '#059669'"));
  verdict('financial expenses bars', '#ea580c', WHITE, GRAPHICS_BAR, fin.includes("color: '#ea580c'"));
  verdict('financial DEBT line', '#d97706', WHITE, GRAPHICS_BAR, fin.includes("color: '#d97706'"));
  const rep = read('src/app/(shell)/tabs/reports-tab.tsx');
  verdict('reports trend line', '#059669', WHITE, GRAPHICS_BAR, rep.includes("fill=\"#059669\"") || rep.includes('stroke="#059669"'));
  verdict('reports category green', '#16a34a', WHITE, GRAPHICS_BAR, rep.includes("'#16a34a'"));
  verdict('reports category teal', '#0d9488', WHITE, GRAPHICS_BAR, rep.includes("'#0d9488'"));
  verdict('reports pie speaks', 'label', 'n/a', 1, /Category share of inventory value, loudest first/.test(rep));
  const shw = read('src/app/(shell)/tabs/dashboard/StoreHealthWidget.tsx');
  verdict('store health widget stroke good', '#059669', WHITE, GRAPHICS_BAR, shw.includes("stroke: '#059669'"));
  verdict('store health widget stroke mid', '#d97706', WHITE, GRAPHICS_BAR, shw.includes("stroke: '#d97706'"));
  verdict('store health widget stroke hot', '#e11d48', WHITE, GRAPHICS_BAR, shw.includes("stroke: '#e11d48'"));
  const sys = read('src/app/(shell)/tabs/system-health-tab.tsx');
  verdict('system health gauge good', '#059669', WHITE, GRAPHICS_BAR, sys.includes("'#059669'"));
  verdict('system health gauge mid', '#d97706', WHITE, GRAPHICS_BAR, sys.includes("'#d97706'"));
  const sec = read('src/app/(shell)/tabs/security-tab.tsx');
  verdict('security ERROR fill', '#ea580c', WHITE, GRAPHICS_BAR, sec.includes("ERROR: '#ea580c'"));
  verdict('security WARN fill', '#a16207', WHITE, GRAPHICS_BAR, sec.includes("WARN: '#a16207'"));
  verdict('security DEBUG fill', '#6b7280', WHITE, GRAPHICS_BAR, sec.includes("DEBUG: '#6b7280'"));
}

console.log('═ SCENE 6 — the GHOSTS pinned BELOW the bar (reverse law) ═');
{
  const ghosts = [
    ['#10b981', 'emerald-500', WHITE, GRAPHICS_BAR],
    ['#f59e0b', 'amber-500', WHITE, GRAPHICS_BAR],
    ['#f97316', 'orange-500', WHITE, GRAPHICS_BAR],
    ['#FF8C00', 'darkorange', WHITE, GRAPHICS_BAR],
    ['#94a3b8', 'slate-400', WHITE, GRAPHICS_BAR],
    ['#0ea5e9', 'sky-500', WHITE, GRAPHICS_BAR],
    ['#06b6d4', 'cyan-500', WHITE, GRAPHICS_BAR],
    ['#14b8a6', 'teal-500', WHITE, GRAPHICS_BAR],
    ['#22c55e', 'green-500', WHITE, GRAPHICS_BAR],
    ['#eab308', 'yellow-500', WHITE, GRAPHICS_BAR],
    ['#84cc16', 'lime-500', WHITE, GRAPHICS_BAR],
    ['#9ca3af', 'gray-400', WHITE, GRAPHICS_BAR],
  ];
  for (const [hex, name, bg, bar] of ghosts) {
    const c = contrast(hex, bg);
    if (c < bar) { pass++; console.log(`  PASS  ghost ${name} ${hex} pinned BELOW: ${c.toFixed(2)}:1 < ${bar}:1`); }
    else { fail++; console.log(`  FAIL  ghost ${name} ${hex} measures ${c.toFixed(2)}:1 — expected BELOW ${bar}:1`); }
  }
  // the text-bar ghost: a -600 voice as TEXT is still not enough
  const t = contrast('#059669', WHITE);
  if (t < TEXT_BAR) { pass++; console.log(`  PASS  emerald-600 as TEXT pinned BELOW: ${t.toFixed(2)}:1 < 4.5:1 (why the -700 text family exists)`); }
  else { fail++; console.log(`  FAIL  emerald-600 as TEXT measures ${t.toFixed(2)}:1`); }
}

console.log('═ AUDITED FILES carry none of the ghost graphics voices ═');
{
  const audited = [
    'src/app/(shell)/tabs/dashboard-tab.tsx',
    'src/components/org/primitives.tsx',
    'src/components/org/kpi-row.tsx',
    'src/components/org/store-matrix.tsx',
    'src/components/dashboard/kpi-doors.tsx',
    'src/components/dashboard/branch-doors.tsx',
    'src/lib/analytics-utils.ts',
    'src/components/analytics/payment-donut.tsx',
    'src/components/analytics/kpi-grid.tsx',
    'src/components/analytics/sales-trend-chart.tsx',
    'src/components/analytics/top-products-chart.tsx',
    'src/app/(shell)/tabs/financial-tab.tsx',
    'src/app/(shell)/tabs/reports-tab.tsx',
    'src/app/(shell)/tabs/dashboard/StoreHealthWidget.tsx',
    'src/app/(shell)/tabs/system-health-tab.tsx',
    'src/app/(shell)/tabs/security-tab.tsx',
  ];
  const ghostRe = /#10b981|#f59e0b(?! )|#f97316|#FF8C00|#0ea5e9|#06b6d4|#14b8a6|#22c55e|#eab308|#84cc16/;
  // slate-400 #94a3b8 stays legal as a NON-graphics voice (text chips, borders
  // that are decorative) — the probe only bans it where it painted a MARK, and
  // those spots were re-voiced by hand above. The other ghosts are banned flat
  // out of the audited files — CODE only: comments are stripped first, so a
  // historical note naming an old voice never trips the scan.
  const stripComments = (src) => {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '?'));
    return noBlock.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/(?<![:"'`])\/\/.*$/, ''))).join('\n');
  };
  for (const f of audited) {
    const src = stripComments(read(f));
    const hits = [...src.matchAll(/#10b981|#f59e0b|#f97316|#FF8C00|#0ea5e9|#06b6d4|#14b8a6|#22c55e|#eab308|#84cc16|#9ca3af/g)].map((m) => m[0]);
    if (hits.length === 0) { pass++; console.log(`  PASS  ${f} clean`); }
    else { fail++; console.log(`  FAIL  ${f} still carries ${[...new Set(hits)].join(', ')}`); }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
