#!/usr/bin/env node
// v2.207.0 verification — "the admin desk tells the truth; the quiet minis speak".
// Written fresh this round (never patch a prior round's copy): every
// check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

const codeOnly = (src) =>
  src
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');
const CHANGELOG = read('CHANGELOG.md');
const ADMIN = codeOnly(read('src/app/(shell)/tabs/admin-tab.tsx'));
const SYSHEALTH = codeOnly(read('src/app/(shell)/tabs/system-health-tab.tsx'));
const SECURITY = codeOnly(read('src/app/(shell)/tabs/security-tab.tsx'));
const TRANSACTIONS = codeOnly(read('src/app/(shell)/tabs/transactions-tab.tsx'));
const TREND = codeOnly(read('src/components/analytics/sales-trend-chart.tsx'));
const VOICES = codeOnly(read('src/lib/report-voices.ts'));
const ROUTE = read('src/app/api/health/route.ts');

check('package.json is 2.207.0 (version + releaseVersion + baseVersion)', () => {
  assert(PKG.version === '2.207.0', `version is ${PKG.version}`);
  assert(PKG.mbumah.releaseVersion === '2.207.0', `releaseVersion is ${PKG.mbumah.releaseVersion}`);
  assert(PKG.mbumah.baseVersion === '2.207.0', `baseVersion is ${PKG.mbumah.baseVersion}`);
});

check('whats-new heads the 2.207.0 entry', () => {
  const head = WN.indexOf("version: '2.207.0'");
  assert(head >= 0, 'no 2.207.0 whats-new entry');
  assert(head < WN.indexOf("version: '2.206.0'"), '2.207.0 does not head the feed');
  assert(WN.includes('The admin desk tells the truth; the quiet minis speak'), 'round title missing');
});

check('changelog carries the round', () => {
  assert(CHANGELOG.includes('## [2.207.0] The admin desk tells the truth; the quiet minis speak'), 'no changelog entry');
});

check('HONESTY: the four invented constants + the latency seed are dead', () => {
  assert(!ADMIN.includes('cpuUsage = 23'), 'cpuUsage = 23 survived');
  assert(!ADMIN.includes('memoryUsed = 67'), 'memoryUsed = 67 survived');
  assert(!ADMIN.includes('const activeSessions = 3'), 'activeSessions = 3 survived');
  assert(!ADMIN.includes('const dbSizeMB = 2.4'), 'dbSizeMB = 2.4 survived');
  assert(!ADMIN.includes('[120, 95, 140, 110, 85, 130, 100, 115, 90, 105, 125, 98]'), 'the 12-check seed survived');
  assert(!ADMIN.includes('over last 12 checks'), 'the fake "last 12 checks" caption survived');
  assert(!ADMIN.includes('bg-green-500 mr-1.5'), 'the unconditional Operational badge survived');
  assert(!ADMIN.includes('const [uptime, setUptime]'), 'the client-side uptime timer survived');
});

check('HONESTY: the panel rides the real wire', () => {
  assert(ADMIN.includes("queryKey: ['admin-health-wire']"), 'the health wire query is missing');
  assert(ADMIN.includes('useState<number[]>([])'), 'the latency history does not start empty');
  assert(ADMIN.includes('Measuring — the first live check is in flight'), 'the honest measuring caption is missing');
  assert(ADMIN.includes('{appStatus.word}'), 'the verdict badge does not ride the wire');
  assert(ADMIN.includes('v{health.version'), 'the app-build card is missing');
  assert(ADMIN.includes('dbCounts?.sessions'), 'sessions do not read the structured counts');
  assert(ROUTE.includes('counts: { users, products, transactions, sessions }'), 'the additive counts are missing from the route');
  assert(ROUTE.includes('active sessions`'), 'the back-compat detail string was removed');
});

check('VOICES: the four composers exist in the one-writer module', () => {
  for (const fn of ['composeLatencyVoice', 'composeDailyRevenueVoice', 'composeTrendVoice', 'composeScoreVoice']) {
    assert(VOICES.includes(`export function ${fn}`), `${fn} missing`);
  }
  assert(!VOICES.includes('KES'), 'the voice module must not hard-code the org console KES voice');
});

check('VOICES: every quiet mini is wired to its composer + role="img"', () => {
  assert((ADMIN.match(/ariaLabel=\{latencyVoice\}/g) || []).length === 2, 'the latency sparkline arias are not both wired');
  assert(ADMIN.includes('role={ariaLabel ? \'img\' : undefined}'), 'the MiniSparkline has no role gate');
  assert(TRANSACTIONS.includes('composeDailyRevenueVoice('), 'the daily-revenue composer is not wired');
  assert(TRANSACTIONS.includes('ariaLabel={trendVoice}'), 'the transactions trend has no aria');
  assert(TREND.includes('role="img" aria-label={trendVoice}'), 'the sales trend has no role/aria');
  assert(TREND.includes('hasPrevSeries: (data?.previousSeries?.length ?? 0) > 0'), 'the prev-period honesty flag is missing');
  assert(SECURITY.includes("composeScoreVoice('Security score'"), 'the security gauge voice is missing');
  assert(SYSHEALTH.includes("'Overall compliance score'"), 'the compliance ring voice is missing');
});

check('CONTRAST: the measured pairs ride source and the ghosts are banned', () => {
  for (const needle of ["'[&>div]:bg-green-600'", "'[&>div]:bg-yellow-700'", "'[&>div]:bg-red-500'", 'color="text-orange-600"', "warning: 'text-yellow-700'"]) {
    assert(ADMIN.includes(needle), `admin panel missing ${needle}`);
  }
  for (const needle of ['bg-emerald-600 shadow-emerald-600/50', 'bg-amber-600 shadow-amber-600/50', "'[&>div]:bg-emerald-600'", '[&>div]:bg-teal-600']) {
    assert(SYSHEALTH.includes(needle), `system-health missing ${needle}`);
  }
  for (const needle of ['[&>div]:bg-green-500', '[&>div]:bg-yellow-500', 'color="text-orange-500"']) {
    assert(!ADMIN.includes(needle), `admin ghost survived: ${needle}`);
  }
  for (const needle of ['bg-emerald-500 shadow-emerald-500/50', 'bg-amber-500 shadow-amber-500/50', '[&>div]:bg-emerald-500', '[&>div]:bg-teal-500']) {
    assert(!SYSHEALTH.includes(needle), `system-health ghost survived: ${needle}`);
  }
});

check('STYLE: the 9px captions died and the figures ride tabular-nums', () => {
  assert(!ADMIN.includes('text-[9px]'), 'a 9px caption survived in admin-tab');
  assert(ADMIN.includes('tabular-nums'), 'admin figures not aligned');
  assert(TRANSACTIONS.includes('tabular-nums'), 'trend caption not aligned');
});

check('BUG GUARDS: the single-point NaN divide and the overflow bar are pinned', () => {
  assert(ADMIN.includes('Math.max(data.length - 1, 1)'), 'the sparkline single-point guard is missing');
  assert(TRANSACTIONS.includes('Math.max(data.length - 1, 1)'), 'the trend single-point guard is missing');
  assert(ADMIN.includes('Math.min((apiResponseTime / 500) * 100, 100)'), 'the latency bar overflow cap is missing');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
