/**
 * admin-truth-v2207.test.ts — the v2.207.0 gates.
 *
 * THE ROUND IN ONE LINE: the admin desk stopped lying (the invented CPU /
 * memory / session / DB-size constants and the 12-check latency seed died;
 * the panel rides the real /api/health wire now) and the quiet minis learned
 * to speak (the latency sparkline, the transactions daily trend, the
 * analytics sales trend, the compliance ring and the security gauge all
 * compose an honest aria from data they already hold).
 *
 * Three classes pinned here as law:
 * 1. THE HONEST-FIGURE LAW — a figure the wire doesn't carry is never
 *    rendered: the fabricated constants are banned at source, the latency
 *    history starts EMPTY, the "Operational" badge speaks the wire's actual
 *    verdict, and the health wire gained STRUCTURED counts (additive — the
 *    detail string stays for back-compat).
 * 2. THE ONE-WRITER VOICE LAW — the four new composers live in
 *    report-voices.ts (the one-writer module), take PRE-FORMATTED figures,
 *    and obey the zero-day law: a nothing never speaks, NaN can never ride
 *    an aria, and a single sample never claims extremes it can't compare.
 * 3. THE MEASURED PAIRS — every mark clears the 3:1 graphics bar and every
 *    text voice the 4.5:1 bar (green-600 3.30 / yellow-700 4.92 / emerald-600
 *    3.77 / amber-600 3.19 / orange-600 3.56 / teal-600 3.74 / red-500 3.76
 *    on white), with the buried -500 ghosts verified BELOW the bar in
 *    reverse. The probe (scripts/probe-graphics-v2207.mjs) runs the same
 *    math against source; the suite pins the law for CI.
 * Scripts: probe-graphics-v2207.mjs (contrast math, CODE-only scans).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  composeLatencyVoice,
  composeDailyRevenueVoice,
  composeTrendVoice,
  composeScoreVoice,
} from '@/lib/report-voices';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const ADMIN = read('src/app/(shell)/tabs/admin-tab.tsx');
const SYSHEALTH = read('src/app/(shell)/tabs/system-health-tab.tsx');
const SECURITY = read('src/app/(shell)/tabs/security-tab.tsx');
const TRANSACTIONS = read('src/app/(shell)/tabs/transactions-tab.tsx');
const TREND = read('src/components/analytics/sales-trend-chart.tsx');
const VOICES = read('src/lib/report-voices.ts');
const HEALTH_ROUTE = read('src/app/api/health/route.ts');
const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');

/** CODE-only scan (comments stripped — historical notes name ghosts and
 *  must never trip a ban; the v2.204.0 lesson). */
const codeOnly = (src: string) =>
  src
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');

const adminCode = codeOnly(ADMIN);
const syshealthCode = codeOnly(SYSHEALTH);
const securityCode = codeOnly(SECURITY);
const transactionsCode = codeOnly(TRANSACTIONS);
const trendCode = codeOnly(TREND);

// ---------------------------------------------------------------------------
// Contrast math (the same law the probe runs: the shipped voices must sit
// ABOVE their bar and the buried ghosts BELOW it — measured, not guessed).
// ---------------------------------------------------------------------------

function relLum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg: string, bg: string): number {
  const [a, b] = [relLum(fg), relLum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const WHITE = '#ffffff';
const GRAPHICS_BAR = 3.0;
const TEXT_BAR = 4.5;

describe('v2.207.0 — the measured pairs clear their bars', () => {
  const marks: Array<[string, string, number]> = [
    ['green-600 (good bar/dot)', '#16a34a', GRAPHICS_BAR],
    ['yellow-700 (warning bar/dot)', '#a16207', GRAPHICS_BAR],
    ['red-500 (critical bar/dot)', '#ef4444', GRAPHICS_BAR],
    ['orange-600 (latency spark)', '#ea580c', GRAPHICS_BAR],
    ['emerald-600 (pulse/db/iso)', '#059669', GRAPHICS_BAR],
    ['amber-600 (pulse degraded)', '#d97706', GRAPHICS_BAR],
    ['teal-600 (ISO 9001 bar)', '#0d9488', GRAPHICS_BAR],
  ];
  for (const [name, hex, bar] of marks) {
    it(`${name} clears ${bar}:1 on the white card ground`, () => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(bar);
    });
  }
  // The role chips carry WHITE TEXT on their fill — the fill is the text's
  // ground, so the pair must clear 4.5:1 (the v2.206 rank-chip class).
  const chipFills: Array<[string, string]> = [
    ['SUPER_ADMIN purple-600', '#9333ea'],
    ['STORE_OWNER blue-600', '#2563eb'],
    ['BRANCH_MANAGER green-700', '#15803d'],
    ['CASHIER amber-700', '#b45309'],
    ['ACCOUNTANT cyan-700', '#0e7490'],
  ];
  for (const [name, hex] of chipFills) {
    it(`white text on ${name} clears the 4.5:1 text bar`, () => {
      expect(contrastRatio('#ffffff', hex)).toBeGreaterThanOrEqual(TEXT_BAR);
    });
  }
  const buriedChips: Array<[string, string]> = [
    ['purple-500', '#a855f7'],
    ['blue-500', '#3b82f6'],
    ['amber-500', '#f59e0b'],
    ['cyan-500', '#06b6d4'],
  ];
  for (const [name, hex] of buriedChips) {
    it(`white text on ${name} stays BELOW the text bar (the buried ghost verified)`, () => {
      expect(contrastRatio('#ffffff', hex)).toBeLessThan(TEXT_BAR);
    });
  }
  const texts: Array<[string, string]> = [
    ['yellow-700 (warning text)', '#a16207'],
    ['red-600 (critical text)', '#dc2626'],
    ['green-700 (good text)', '#15803d'],
  ];
  for (const [name, hex] of texts) {
    it(`${name} clears the 4.5:1 text bar on white`, () => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(TEXT_BAR);
    });
  }
  const ghosts: Array<[string, string]> = [
    ['yellow-500', '#eab308'],
    ['green-500', '#22c55e'],
    ['emerald-500', '#10b981'],
    ['amber-500', '#f59e0b'],
    ['orange-500', '#f97316'],
    ['teal-500', '#14b8a6'],
  ];
  for (const [name, hex] of ghosts) {
    it(`${name} stays BELOW the graphics bar (the ghost math verified in reverse)`, () => {
      expect(contrastRatio(hex, WHITE)).toBeLessThan(GRAPHICS_BAR);
    });
  }
});

describe('v2.207.0 — the honesty law (fabrications banned at source)', () => {
  it('the invented CPU/memory/session/DB constants are gone', () => {
    expect(adminCode).not.toContain('cpuUsage = 23');
    expect(adminCode).not.toContain('memoryUsed = 67');
    expect(adminCode).not.toContain('const activeSessions = 3');
    expect(adminCode).not.toContain('const dbSizeMB = 2.4');
    expect(adminCode).not.toContain('Simulated health metrics');
  });

  it('the latency history starts EMPTY — the 12-check seed is banned', () => {
    expect(adminCode).toContain('useState<number[]>([])');
    expect(adminCode).not.toContain('[120, 95, 140, 110, 85, 130, 100, 115, 90, 105, 125, 98]');
    expect(adminCode).not.toContain('over last 12 checks');
  });

  it('the average caption speaks only REAL checks (guarded on an empty history)', () => {
    expect(adminCode).toContain("apiHistory.length === 0");
    expect(adminCode).toContain('Measuring — the first live check is in flight');
    expect(adminCode).toContain('over the last ${apiHistory.length} check');
  });

  it('a failed manual refresh is recorded like the interval path', () => {
    const refresh = adminCode.slice(adminCode.indexOf('const handleRefreshHealth'));
    const catchBody = refresh.slice(refresh.indexOf('catch'), refresh.indexOf('setIsRefreshing(false)'));
    expect(catchBody).toContain('setApiHistory');
    expect(catchBody).toContain('999');
  });

  it('the verdict badge rides the wire — the unconditional "Operational" ghost is dead', () => {
    expect(adminCode).not.toContain('bg-green-500 mr-1.5');
    expect(adminCode).not.toContain('>Operational<');
    expect(adminCode).toContain('{appStatus.word}');
    expect(adminCode).toContain('Checking wire…');
  });

  it('the client-side session timer died — uptime is the wire\u2019s process.uptime', () => {
    expect(adminCode).not.toContain('const [uptime, setUptime]');
    expect(adminCode).toContain('health.uptimeSeconds != null ? formatUptime(health.uptimeSeconds)');
    expect(adminCode).toContain('Since last restart · server process');
  });

  it('the memory indicator is REAL heap-of-RSS math with an honest measuring state', () => {
    expect(adminCode).toContain('label="Memory (heap of RSS)"');
    expect(adminCode).toContain('health.memory.heapUsedMB ?? 0');
    expect(adminCode).toContain('max={health.memory.rssMB}');
    expect(adminCode).toContain('Measuring…');
  });

  it('the invented CPU gauge is replaced by the wire\u2019s app-status verdict', () => {
    expect(adminCode).toContain('App status');
    expect(adminCode).toContain('Wire answered in {health.responseTime');
    expect(adminCode).toContain("'healthy' | 'degraded' | 'unhealthy'");
  });

  it('the DB-size card became the App-build card (version + posture, all real)', () => {
    expect(adminCode).not.toContain('DB Size');
    expect(adminCode).toContain('App build');
    expect(adminCode).toContain('v{health.version ?? \'—\'}');
    expect(adminCode).toContain('{health.databaseProvider ?? \'…\'} · {health.appMode ?? \'…\'}');
  });

  it('sessions read the health wire\u2019s structured counts — never a literal', () => {
    expect(adminCode).toContain('dbCounts?.sessions != null ? dbCounts.sessions : \'—\'');
    expect(HEALTH_ROUTE).toContain('counts: { users, products, transactions, sessions }');
    expect(HEALTH_ROUTE).toContain('active sessions`');
  });

  it('the latency bar caps at 100% — a 999ms outlier no longer overflows the track', () => {
    expect(adminCode).toContain('Math.min((apiResponseTime / 500) * 100, 100)');
  });

  it('latency values speak "—" until the first real check lands', () => {
    expect(adminCode.match(/\{apiResponseTime > 0 \? `\$\{apiResponseTime\}ms` : '—'\}/g)?.length).toBe(2);
  });
});

describe('v2.207.0 — the one-writer voice law (composeLatencyVoice)', () => {
  it('an empty history speaks the honest absence', () => {
    expect(composeLatencyVoice('API response time', [])).toBe('API response time — no completed checks yet.');
  });

  it('one check never claims extremes it cannot compare', () => {
    const v = composeLatencyVoice('API response time', [{ label: 'check 1', value: 120, figure: '120ms' }]);
    expect(v).toBe('API response time, one check so far: 120ms.');
    expect(v).not.toContain('slowest');
  });

  it('two checks name the extremes from the same samples, oldest first', () => {
    const v = composeLatencyVoice('API response time', [
      { label: 'check 1', value: 120, figure: '120ms' },
      { label: 'check 2', value: 95, figure: '95ms' },
    ]);
    expect(v).toBe('API response time across 2 checks, oldest first: 120ms, 95ms — slowest 120ms, fastest 95ms.');
  });

  it('a 999ms outlier is spoken, never smoothed away', () => {
    const v = composeLatencyVoice('API response time', [
      { label: 'check 1', value: 100, figure: '100ms' },
      { label: 'check 2', value: 999, figure: '999ms' },
      { label: 'check 3', value: 110, figure: '110ms' },
    ]);
    expect(v).toContain('slowest 999ms');
    expect(v).toContain('fastest 100ms');
  });

  it('a NaN sample can never poison the extremes (it is dropped, the rest still speak)', () => {
    const v = composeLatencyVoice('API response time', [
      { label: 'check 1', value: Number.NaN, figure: 'NaNms' },
      { label: 'check 2', value: 100, figure: '100ms' },
      { label: 'check 3', value: 90, figure: '90ms' },
    ]);
    expect(v).toContain('slowest 100ms');
    expect(v).toContain('fastest 90ms');
  });
});

describe('v2.207.0 — the one-writer voice law (composeDailyRevenueVoice)', () => {
  it('no days on record speaks the honest absence', () => {
    expect(composeDailyRevenueVoice('Daily revenue', [])).toBe('Daily revenue — no days on record in this range.');
  });

  it('days ride calendar order; a quiet day says "no sales" (the zero-day law)', () => {
    const v = composeDailyRevenueVoice('Daily revenue', [
      { label: '10-20', value: 0, figure: 'Ksh 0.00' },
      { label: '10-21', value: 43000, figure: 'Ksh 43,000.00' },
    ]);
    expect(v).toBe('Daily revenue across 2 days, oldest first: 10-20 no sales, 10-21 Ksh 43,000.00 — the loudest day: 10-21 Ksh 43,000.00.');
  });

  it('a range where nothing was ever sold names no loudest day', () => {
    const v = composeDailyRevenueVoice('Daily revenue', [{ label: '10-20', value: 0, figure: 'Ksh 0.00' }]);
    expect(v).not.toContain('loudest');
    expect(v).toContain('across 1 day');
  });

  it('the figures pass through pre-formatted — the Ksh voice is the caller\u2019s', () => {
    const v = composeDailyRevenueVoice('Daily revenue', [{ label: '10-21', value: 7500, figure: 'Ksh 7,500.00' }]);
    expect(v).toContain('Ksh 7,500.00');
  });
});

describe('v2.207.0 — the one-writer voice law (composeTrendVoice)', () => {
  const points = [
    { label: 'Mon', value: 1000, figure: 'Ksh 1,000.00', transactions: 2 },
    { label: 'Tue', value: 0, figure: 'Ksh 0.00', transactions: 0 },
  ];

  it('no data in the period speaks the honest absence', () => {
    expect(composeTrendVoice('Sales trend', [], { totalFigure: 'Ksh 0.00', totalTransactions: 0, hasPrevSeries: false }))
      .toBe('Sales trend — no data in this period.');
  });

  it('every bucket speaks in order with its real transaction count', () => {
    const v = composeTrendVoice('Sales trend', points, { totalFigure: 'Ksh 1,000.00', totalTransactions: 2, hasPrevSeries: true });
    expect(v).toBe('Sales trend, in order: Mon Ksh 1,000.00 (2 tx), Tue Ksh 0.00 (no transactions) — Ksh 1,000.00 total across 2 transactions. The dashed line draws the previous period for comparison.');
  });

  it('a zero-transaction total never fabricates an "across 0 transactions" clause', () => {
    const v = composeTrendVoice('Sales trend', points, { totalFigure: 'Ksh 1,000.00', totalTransactions: 0, hasPrevSeries: false });
    expect(v).not.toContain('across 0 transactions');
    expect(v).not.toContain('dashed line');
  });

  it('the dashed line is named ONLY when the wire carries a previous period', () => {
    const withPrev = composeTrendVoice('Sales trend', points, { totalFigure: 'Ksh 1,000.00', totalTransactions: 2, hasPrevSeries: true });
    const withoutPrev = composeTrendVoice('Sales trend', points, { totalFigure: 'Ksh 1,000.00', totalTransactions: 2, hasPrevSeries: false });
    expect(withPrev).toContain('dashed line');
    expect(withoutPrev).not.toContain('dashed line');
  });
});

describe('v2.207.0 — the one-writer voice law (composeScoreVoice)', () => {
  it('the ring\u2019s fill IS the score: the aria names score, ceiling and verdict', () => {
    expect(composeScoreVoice('Security score', 92, 100, 'Good')).toBe('Security score 92 of 100 — Good.');
  });

  it('a missing score speaks the honest absence, never a percentage of nothing', () => {
    expect(composeScoreVoice('Overall compliance score', null, 100, 'healthy'))
      .toBe('Overall compliance score — not measured yet.');
    expect(composeScoreVoice('Overall compliance score', Number.NaN, 100, 'healthy'))
      .toBe('Overall compliance score — not measured yet.');
  });
});

describe('v2.207.0 — the quiet minis speak (aria wiring at source)', () => {
  it('the latency sparkline is role="img" fed by the one-writer composer', () => {
    expect(adminCode).toContain("role={ariaLabel ? 'img' : undefined}");
    expect(adminCode).toContain('ariaLabel={latencyVoice}');
    expect(adminCode).toContain('composeLatencyVoice(');
    expect(adminCode.match(/ariaLabel=\{latencyVoice\}/g)?.length).toBe(2);
  });

  it('the sparkline gained the grounding baseline and the latest-check marker', () => {
    expect(adminCode).toContain('text-muted-foreground/40');
    expect(adminCode).toContain('<circle cx={last.x} cy={last.y} r="2" fill="currentColor" />');
  });

  it('a single latency sample is a dot, not a NaN line (the divide-by-zero guard)', () => {
    expect(adminCode).toContain('Math.max(data.length - 1, 1)');
    expect(transactionsCode).toContain('Math.max(data.length - 1, 1)');
  });

  it('the transactions daily trend speaks (calendar order, quiet days honest)', () => {
    expect(transactionsCode).toContain('composeDailyRevenueVoice(');
    expect(transactionsCode).toContain('ariaLabel={trendVoice}');
    expect(transactionsCode).toContain('<circle cx={last.x} cy={last.y} r="2.5" fill="currentColor" className="text-primary" />');
    expect(transactionsCode).toContain("day{trendData.length === 1 ? '' : 's'} on the chart");
  });

  it('the analytics sales trend speaks (totals once, the dash named honestly)', () => {
    expect(trendCode).toContain('role="img" aria-label={trendVoice}');
    expect(trendCode).toContain('composeTrendVoice(');
    expect(trendCode).toContain('hasPrevSeries: (data?.previousSeries?.length ?? 0) > 0');
  });

  it('both score rings speak (the security gauge and the compliance ring)', () => {
    expect(securityCode).toContain("composeScoreVoice('Security score'");
    expect(securityCode).toContain('role="img"');
    expect(syshealthCode).toContain("'Overall compliance score'");
    expect(syshealthCode.match(/composeScoreVoice\(/g)?.length).toBe(1);
  });

  it('the trend card\u2019s change chip stays REAL (the wire\u2019s revenueChangePct)', () => {
    expect(trendCode).toContain('summary?.revenueChangePct ?? 0');
  });

  it('the arias keep the tab app\u2019s Ksh voice — no literal KES in the voice module', () => {
    expect(codeOnly(VOICES)).not.toMatch(/KES/);
  });
});

describe('v2.207.0 — the contrast re-voices ride source (probe parity)', () => {
  it('the admin panel\u2019s bars and dots ride the measured -600/-700 pairs', () => {
    expect(adminCode).toContain("'[&>div]:bg-green-600'");
    expect(adminCode).toContain("'[&>div]:bg-yellow-700'");
    expect(adminCode).toContain("'[&>div]:bg-red-500'");
    expect(adminCode).toContain("good: 'bg-green-600'");
    expect(adminCode).toContain("warning: 'bg-yellow-700'");
    expect(adminCode).toContain("critical: 'bg-red-500'");
    expect(adminCode).toContain("warning: 'text-yellow-700'");
  });

  it('the sub-3:1 ghosts are dead in the admin panel and the system-health tab', () => {
    expect(adminCode).not.toContain('[&>div]:bg-green-500');
    expect(adminCode).not.toContain('[&>div]:bg-yellow-500');
    expect(adminCode).not.toContain('color="text-orange-500"');
    expect(syshealthCode).not.toContain('bg-emerald-500 shadow-emerald-500/50');
    expect(syshealthCode).not.toContain('bg-amber-500 shadow-amber-500/50');
    expect(syshealthCode).not.toContain('[&>div]:bg-emerald-500');
    expect(syshealthCode).not.toContain('[&>div]:bg-teal-500');
    expect(syshealthCode).not.toContain("'[&>div]:bg-amber-500'");
  });

  it('the tiny captions grew and the figures aligned (the style law)', () => {
    expect(adminCode).not.toContain('text-[9px]');
    expect(adminCode).toContain('tabular-nums');
    expect(transactionsCode).toContain('tabular-nums');
  });
});

describe('v2.207.0 — the release surfaces speak the version', () => {
  it('package.json leads 2.207.0 with the mbumah metadata', () => {
    expect(PKG.version).toBe('2.210.0');
    expect(PKG.mbumah.releaseVersion).toBe('2.210.0');
    expect(PKG.mbumah.baseVersion).toBe('2.210.0');
  });

  it('whats-new heads the 2.207.0 entry', () => {
    expect(WN.indexOf("'2.207.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("'2.207.0'")).toBeLessThan(WN.indexOf("'2.206.0'"));
    expect(WN).toContain('The admin desk tells the truth; the quiet minis speak');
  });

  it('the health wire\u2019s additive counts keep the detail string (back-compat)', () => {
    expect(HEALTH_ROUTE).toContain("detail: `${users} users, ${products} products, ${transactions} transactions, ${sessions} active sessions`");
    expect(HEALTH_ROUTE.indexOf('counts: { users, products, transactions, sessions }')).toBeGreaterThan(
      HEALTH_ROUTE.indexOf('checks.database_stats = {'),
    );
  });
});
