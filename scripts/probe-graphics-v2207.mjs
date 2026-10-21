#!/usr/bin/env node
/**
 * GRAPHICS-BAR PROBE - v2.207.0 "the admin desk tells the truth; the minis speak"
 * ═══════════════════════════════════════════════════════════════════════════
 * The v2.204 probe audited the dashboards' charts; this round's surfaces
 * (the admin health panel, the system-health tab, the security gauge, the
 * transactions mini-trend) were the audit's blind spot — green-500 2.28 /
 * yellow-500 1.92 / emerald-500 2.54 / amber-500 2.15 marks survived there.
 *
 * Every voice is read FROM SOURCE (regex on the file), then measured with
 * the WCAG relative-luminance formula on its real ground. A voice that
 * drifts from its re-voiced constant fails the probe.
 *
 * GROUNDS: white card #ffffff (card-borne marks). Dark-mode scoping per the
 * house law: the -600/-700 families clear the bar on slate-900 by an even
 * wider margin, so the LIGHT-MODE law is the binding one.
 *
 * Exit 0 = every voice passes. Any failure prints and exits 1.
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => { try { return readFileSync(ROOT + p, 'utf8'); } catch { return ''; } };

// ── WCAG machinery (same as probe-graphics-v2204.mjs) ───────────────────────
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
const WHITE = '#ffffff';
const GRAPHICS_BAR = 3.0, TEXT_BAR = 4.5;

let pass = 0, fail = 0;
const verdict = (name, fg, bg, bar, srcHas) => {
  const c = contrast(fg, bg);
  const ok = srcHas && c >= bar - 0.001;
  if (ok) { pass++; console.log(`  PASS  ${c.toFixed(2).padStart(5)}:1  (${bar}:1)  ${name}  ${fg} on ${bg}`); }
  else { fail++; console.log(`  FAIL  ${c.toFixed(2).padStart(5)}:1  (${bar}:1)  ${name}  ${fg} on ${bg}${srcHas ? '' : '  [SOURCE MISSING]'}`); }
};
const spoken = (name, srcHaystack, needle) => {
  const ok = srcHaystack.includes(needle);
  if (ok) { pass++; console.log(`  PASS   spoke   —  ${name}`); }
  else { fail++; console.log(`  FAIL   SILENT  —  ${name}  [missing: ${needle}]`); }
};
const banned = (name, srcHaystack, needle) => {
  const ok = !srcHaystack.includes(needle);
  if (ok) { pass++; console.log(`  PASS  ghost banned  —  ${name}`); }
  else { fail++; console.log(`  FAIL  ghost PRESENT  —  ${name}  [found: ${needle}]`); }
};

// CODE-ONLY scan (the v2.204 lesson): the round's own explanation comments
// name the ghosts they buried ("a fake Avg over last 12 checks") and must
// not trip the banned-needle scan. Strip block comments, then line comments.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const admin = code(read('src/app/(shell)/tabs/admin-tab.tsx'));
const syshealth = code(read('src/app/(shell)/tabs/system-health-tab.tsx'));
const security = code(read('src/app/(shell)/tabs/security-tab.tsx'));
const transactions = code(read('src/app/(shell)/tabs/transactions-tab.tsx'));
const trend = code(read('src/components/analytics/sales-trend-chart.tsx'));
const voices = code(read('src/lib/report-voices.ts'));
const healthRoute = code(read('src/app/api/health/route.ts'));

console.log('═ SCENE 1 — the admin health panel (admin-tab.tsx) ═');
// Marks (3:1) — the re-voiced pairs.
verdict('good bar  bg-green-600', '#16a34a', WHITE, GRAPHICS_BAR, admin.includes('[&>div]:bg-green-600'));
verdict('warning bar  bg-yellow-700', '#a16207', WHITE, GRAPHICS_BAR, admin.includes('[&>div]:bg-yellow-700'));
verdict('critical bar  bg-red-500', '#ef4444', WHITE, GRAPHICS_BAR, admin.includes('[&>div]:bg-red-500'));
verdict('good dot  bg-green-600', '#16a34a', WHITE, GRAPHICS_BAR, admin.includes("good: 'bg-green-600'"));
verdict('warning dot  bg-yellow-700', '#a16207', WHITE, GRAPHICS_BAR, admin.includes("warning: 'bg-yellow-700'"));
verdict('latency card spark  text-orange-600', '#ea580c', WHITE, GRAPHICS_BAR, admin.includes('color="text-orange-600"'));
// Text (4.5:1).
verdict('warning text  text-yellow-700', '#a16207', WHITE, TEXT_BAR, admin.includes("warning: 'text-yellow-700'"));
verdict('critical text  text-red-600', '#dc2626', WHITE, TEXT_BAR, admin.includes("critical: 'text-red-600'"));
// The fabricated constants are ghosts — banned in reverse.
banned('invented CPU 23%', admin, 'cpuUsage = 23');
banned('invented memory 67%', admin, 'memoryUsed = 67');
banned('invented 3 sessions', admin, 'const activeSessions = 3');
banned('invented 2.4 MB DB', admin, 'const dbSizeMB = 2.4');
banned('the 12-check seed array', admin, '[120, 95, 140, 110, 85, 130, 100, 115, 90, 105, 125, 98]');
banned('the fake unconditional badge', admin, '>Operational<');
banned('hardcoded "last 12 checks"', admin, 'over last 12 checks');
// The sparkline speaks + the wire rides.
spoken('MiniSparkline role="img"', admin, 'role={ariaLabel ? \'img\' : undefined}');
spoken('latency aria composed (composeLatencyVoice)', admin, 'composeLatencyVoice(');
spoken('health wire query', admin, "queryKey: ['admin-health-wire']");
spoken('App build card speaks the version', admin, 'v{health.version');
spoken('sessions read the structured counts', admin, 'dbCounts?.sessions');

console.log('═ SCENE 2 — the system-health tab (system-health-tab.tsx) ═');
verdict('pulse healthy  bg-emerald-600', '#059669', WHITE, GRAPHICS_BAR, syshealth.includes('bg-emerald-600 shadow-emerald-600/50'));
verdict('pulse degraded  bg-amber-600', '#d97706', WHITE, GRAPHICS_BAR, syshealth.includes('bg-amber-600 shadow-amber-600/50'));
verdict('pulse critical  bg-red-500', '#ef4444', WHITE, GRAPHICS_BAR, syshealth.includes("'bg-red-500 shadow-red-500/50'"));
verdict('db latency bar  bg-emerald-600', '#059669', WHITE, GRAPHICS_BAR, syshealth.includes("'[&>div]:bg-emerald-600'"));
verdict('db latency bar  bg-amber-600', '#d97706', WHITE, GRAPHICS_BAR, syshealth.includes("'[&>div]:bg-amber-600'"));
verdict('ISO 27001 bar  bg-emerald-600', '#059669', WHITE, GRAPHICS_BAR, syshealth.includes('[&>div]:bg-emerald-600'));
verdict('ISO 9001 bar  bg-teal-600', '#0d9488', WHITE, GRAPHICS_BAR, syshealth.includes('[&>div]:bg-teal-600'));
banned('sub-3:1 pulse emerald-500', syshealth, 'bg-emerald-500 shadow-emerald-500/50');
banned('sub-3:1 pulse amber-500', syshealth, 'bg-amber-500 shadow-amber-500/50');
banned('sub-3:1 ISO bar emerald-500', syshealth, '[&>div]:bg-emerald-500');
banned('sub-3:1 ISO bar teal-500', syshealth, '[&>div]:bg-teal-500');
spoken('compliance ring role="img"', syshealth, "role=\"img\"\n                        aria-label={composeScoreVoice(");
spoken('compliance ring voice composer', syshealth, 'composeScoreVoice(');

console.log('═ SCENE 3 — the security gauge (security-tab.tsx) ═');
spoken('gauge role="img"', security, 'role="img"');
spoken('gauge voice composer', security, "composeScoreVoice('Security score'");

console.log('═ SCENE 4 — the quiet minis speak (transactions + analytics) ═');
spoken('MiniTrendChart role="img"', transactions, "role={ariaLabel ? 'img' : undefined}");
spoken('daily revenue aria composer', transactions, 'composeDailyRevenueVoice(');
spoken('trend caption row', transactions, 'day{trendData.length === 1 ? \'\' : \'s\'} on the chart');
spoken('SalesTrendChart role="img"', trend, 'role="img" aria-label={trendVoice}');
spoken('trend aria composer', trend, 'composeTrendVoice(');
spoken('prev-period line named honestly', trend, 'hasPrevSeries: (data?.previousSeries?.length ?? 0) > 0');

console.log('═ SCENE 5 — the voice module grew the four composers ═');
for (const fn of ['composeLatencyVoice', 'composeDailyRevenueVoice', 'composeTrendVoice', 'composeScoreVoice']) {
  spoken(`export ${fn}`, voices, `export function ${fn}`);
}

console.log('═ SCENE 6 — the health wire carries structured counts ═');
spoken('counts object (additive)', healthRoute, 'counts: { users, products, transactions, sessions }');
spoken('detail string kept (back-compat)', healthRoute, 'active sessions`');

console.log('═ SCENE 7 — the measured pairs, verified against the WCAG math ═');
const PAIRS = [
  ['green-600', '#16a34a', GRAPHICS_BAR], ['yellow-700', '#a16207', GRAPHICS_BAR],
  ['emerald-600', '#059669', GRAPHICS_BAR], ['amber-600', '#d97706', GRAPHICS_BAR],
  ['orange-600', '#ea580c', GRAPHICS_BAR], ['teal-600', '#0d9488', GRAPHICS_BAR],
  ['red-500', '#ef4444', GRAPHICS_BAR], ['yellow-700 text', '#a16207', TEXT_BAR],
  ['red-600 text', '#dc2626', TEXT_BAR], ['green-700 text', '#15803d', TEXT_BAR],
];
for (const [name, hex, bar] of PAIRS) {
  verdict(name, hex, WHITE, bar, true);
}
const GHOSTS = [
  ['yellow-500', '#eab308'], ['green-500', '#22c55e'], ['emerald-500', '#10b981'],
  ['amber-500', '#f59e0b'], ['orange-500', '#f97316'], ['teal-500', '#14b8a6'],
];
for (const [name, hex] of GHOSTS) {
  const c = contrast(hex, WHITE);
  if (c < GRAPHICS_BAR) { pass++; console.log(`  PASS  ${name} ${c.toFixed(2)}:1 — confirmed below the bar (ghost math verified)`); }
  else { fail++; console.log(`  FAIL  ${name} measured ${c.toFixed(2)}:1 — the ghost math drifted; re-check the bans`); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
