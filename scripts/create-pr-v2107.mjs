#!/usr/bin/env node
// Create PR for v2.107.0 — double-quoted bodies (the over-escaped-apostrophe
// gotcha never gets a third bite).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error('NO TOKEN'); process.exit(1); }

const body = [
  '## v2.107.0 — the chart files its month',
  '',
  'The filing family\u0027s arc completes its next step: the picker made any account askable (v2.105.0), the browse door showed the whole chart (v2.106.0) — and now the chart files ITSELF. One governed zip carries a CSV for EVERY account that posted inside the period\u0027s own days, plus a MANIFEST that says exactly what was filed and what was not. Month-end stops being thirty-seven downloads.',
  '',
  '- **A zip written in-house, byte-auditable** — new pure file account-bundle.ts: crc32 (the canonical IEEE poly, pinned by the check value), dosDateTime, and a STORE-ONLY zipStore writer (local headers PK\\u0003\\u0004 with method 0 and the UTF-8 flag, a central directory whose offsets point at the local blocks, an EOCD that counts every entry). No dependency, no compression — a month of payroll is bounded, and store-only keeps every CRC and size checkable with unzip -t.',
  '- **E2E-caught: the cross-realm trap** — vitest\u0027s global TextEncoder can return a Uint8Array from ANOTHER realm, so an instanceof gate is false for it and the naive else archived the String() of the array (\u002797,108,112\u2026\u0027). The writer narrows with ArrayBuffer.isView (the internal slot every realm carries) and re-wraps the SAME memory; a regression test pins the payload as bytes.',
  '- **MANIFEST.txt rides first** — the archive\u0027s own honesty through the SAME csvCell guard as every filing: what was filed (files, posted lines), the window it filed, how many accounts live in the chart, how many quiet accounts were left out and why, then an index row per file (code, lines, filename). Employee names ride nothing.',
  '- **Quiet is a fact, not a file** — an account with zero posted lines in the window produces no CSV (the single route already 404s on it); the manifest carries the count instead of pretending. Nothing active at all \u2192 404 NO_MOVEMENT_DATA (never an empty-looking archive).',
  '- **One window, the drawer\u2019s own** — the bundle files [startDate, endDate + 1 day), the same bounds the index badges and the drill\u2019s month window serve; no window param exists, so the file can never call itself something it is not (a year is one account at a time, through the account route). Built from the SAME truth through the SAME builders (buildAccountMovement \u2192 accountMovementToCsv \u2192 buildAccountBundle), so the zip cannot disagree with the screen.',
  '- **Audited with counts only** — PAYROLL_ACCOUNT_MOVEMENTS_BUNDLE_EXPORTED rides the DataExport row with files/lines/bytes/quiet; the codes live in the manifest inside the zip, and that is the record. Guard: hr.payroll.read.all, same four roles — the bundle widens nothing.',
  '- **The door lives in the browse box** — a violet "File all N accounts" exit (busy \u0027Building\u2026\u0027, honest title, month-window label) whose N comes from the index\u2019s own badges — the same truth the route re-derives — with the note riding the drawer\u0027s stale-state hygiene. When nothing posted, the door simply never renders.',
  '',
  'New: pure builders (crc32 / dosDateTime / zipStore / buildAccountBundle + BundleAccountFile, AccountBundleMeta, AccountBundle) in account-bundle.ts; GET /api/payroll/period-journal/accounts/export-bundle; the bundle row in the browse box; whats-new 2.107.0.',
  '',
  'Gates: vitest 2387/2387 (113 files, +33) - lint 0 errors / 421 warnings (= baseline) - tsc 424 source-only (= baseline) - verify 16/16 (fresh) - build green (webpack@2048).',
].join('\n');

const pr = JSON.stringify({
  title: 'feat: the chart files its month (v2.107.0)',
  head: 'feat/v2-107-0-chart-files-its-month',
  base: 'main',
  body,
});

const res = execSync(
  `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -d '${pr.replace(/'/g, `'\\''`)}' https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/pulls`,
  { encoding: 'utf8' },
);
const j = JSON.parse(res);
console.log('PR:', j.number, j.html_url ?? j.message ?? j);
