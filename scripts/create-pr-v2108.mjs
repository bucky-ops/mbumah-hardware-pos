#!/usr/bin/env node
// Create PR for v2.108.0 — double-quoted bodies (the over-escaped-apostrophe
// gotcha never gets a third bite).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error('NO TOKEN'); process.exit(1); }

const body = [
  '## v2.108.0 — the chart files its year',
  '',
  'The filing family\u0027s year step: the bundle exit grows a SECOND door. One governed zip files EVERY account that posted in the calendar year as its own movement CSV — and year-end stops being twelve downloads. The archive\u0027s shape, order and honesty are byte-identical doctrine: same builders, same MANIFEST-first, same quiet-is-a-fact-not-a-file, same audited-counts-only.',
  '',
  '- **window=year through the SAME route** — the account route\u0027s exact validation and default (an unknown window is a 400, never a silent month); the year files the calendar year the period\u0027s first day lives in ([Jan 1, next Jan 1) UTC — the EXACT arithmetic v2.104.0 has served for single accounts), month stays the period\u0027s own days.',
  '- **The year door shows NO count on purpose** — the client only knows the month\u0027s badges, and a guessed number could disagree with the archive; the MANIFEST inside says exactly how many were filed and how many were quiet. No count beats a wrong count.',
  '- **Every member CSV says its own word** — \u0027starts the year at zero\u0027, \u0027Year totals\u0029, a filename carrying the year (mbumah-account-movement-1300-inventory-2026.csv), the manifest\u0027s Period row carrying the year itself (\u00272026\u0027) — the same loop-closing honesty the month files serve.',
  '- **The remembered accounts can be let go** — a quiet Clear button on the Recent row forgets THIS browser\u0027s chips (the chart itself is never touched); the empty note returns, and the next pick starts the memory again. A private-mode denial still leaves the memory alive in state for the visit.',
  '- **Same read roles as the ledger itself** — hr.payroll.read.all (HR, branch managers, owners, accountants); filing a year of what you may read widens nothing. Audit rides PAYROLL_ACCOUNT_MOVEMENTS_BUNDLE_EXPORTED with windowKind in the detail; counts live in the manifest, codes never ride the row.',
  '- **The pair gets its own micro-heading** — "File the chart" turns the exit into a place: two doors side by side (month with its honest count from the index badges, year with its honest no-count), one grid, one busy state, one note hygiene.',
  '',
  'New: window param on GET /api/payroll/period-journal/accounts/export-bundle; the year door + File-the-chart heading; the recents Clear affordance; verify-v2-108-0 (19 checks); whats-new 2.108.0.',
  '',
  'Gates: vitest 2392/2392 (113 files, +5) - lint 0 errors / 421 warnings (= baseline) - tsc 424 source-only (= baseline) - verify 19/19 (fresh) - build green (webpack@2048). E2E: year zip on disk, real unzip -t clean, MANIFEST first (Period 2026, Window 2026-01-01 → 2026-12-31, Files 11, 544 lines, 26 quiet), member 2210 PAYE closes its own year loop (0.00 / 70,414.80 / 70,414.80 Cr), month path regression 200 PK zip, decade 400, unauth 401, audit row at the manifest timestamp; light + dark screenshots.',
].join('\n');

const pr = JSON.stringify({
  title: 'feat: the chart files its year (v2.108.0)',
  head: 'feat/v2-108-0-chart-files-its-year',
  base: 'main',
  body,
});

const res = execSync(
  `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -d '${pr.replace(/'/g, `'\\''`)}' https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/pulls`,
  { encoding: 'utf8' },
);
const j = JSON.parse(res);
console.log('PR:', j.number, j.html_url ?? j.message ?? j);
