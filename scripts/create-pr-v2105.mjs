#!/usr/bin/env node
// Create PR for v2.105.0 — double-quoted bodies (the over-escaped-apostrophe
// gotcha never gets a third bite).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error('NO TOKEN'); process.exit(1); }

const body = [
  '## v2.105.0 — the ledger answers for any account',
  '',
  'Until now the account drill opened only where a ledger line happened to sit: an account this period never touched was unreachable, however real its year. The ledger drawer grows an account picker — type any code or name, and the same movement drill opens, month first, year one click away.',
  '',
  '- **The index widens nothing** — new GET /api/payroll/period-journal/accounts rides the drill\'s exact read contract (hr.payroll.read.all, same four roles), tenant-scoped end to end: the period resolves store-scoped first (404 for a foreign one), accounts resolve through the store\'s organization, and each row carries the count of posted, never-voided lines inside the EXACT window the drill serves ([startDate, endDate + 1 day)) — so "in this month" on a suggestion means the same window the drill will replay. A READ endpoint: no audit row.',
  '- **The rank is match quality, not popularity** — pure builder filterAccountSuggestions: exact code hit first, then code prefix, then name substring, case-insensitive, trimmed, stable on equal rank by code ascending; an empty query asks for nothing; the cap clamps to at least 1. A quiet account that matches better outranks an active one that matches worse — the picker is a finder, the badge says the rest.',
  '- **Quiet is a fact, not an error** — an account with no lines in the period still lists (periodLines 0, "quiet" badge) and is still askable; the drill says what it finds, starting at zero, honestly.',
  '- **Keyboard first** — ↑↓ to move, Enter to open (highlighted match, else top; an unknown code still asks the ledger and gets the drill\'s honest 404), Esc to dismiss. aria: role=combobox input, listbox + options, aria-activedescendant.',
  '- **E2E-caught and fixed** — the first Esc dismissed the suggestions AND closed the whole drawer (Radix\'s dismissable layer listens on document CAPTURE — a synthetic stopPropagation was proven NOT to stop it live); the drawer\'s own onEscapeKeyDown veto now keeps the drawer open while the box speaks; the second Esc closes it the Radix way. Pinned in tests + verify.',
  '- **Stale state never greets the next period** — query, open flag and highlight reset with the drawer\'s per-period effect; the index fetches once per period (cancelled mid-flight fetches never write state); a picker door opens on the MONTH, always.',
  '',
  'New: pure builder (filterAccountSuggestions + AccountPickerEntry) in period-journal.ts; accounts index route; the picker UI in the ledger drawer; whats-new 2.105.0.',
  '',
  'Gates: vitest 2323/2323 (111 files, +27) - lint 0 errors / 421 warnings (= baseline) - tsc 424 source-only (= baseline) - verify 16/16 (fresh) - build green (webpack@2048).',
].join('\n');

const pr = JSON.stringify({
  title: 'feat: the ledger answers for any account (v2.105.0)',
  head: 'feat/v2-105-0-ledger-answers-for-any-account',
  base: 'main',
  body,
});

const res = execSync(
  `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -d '${pr.replace(/'/g, `'\\''`)}' https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/pulls`,
  { encoding: 'utf8' },
);
const j = JSON.parse(res);
console.log('PR:', j.number, j.html_url ?? j.message ?? j);
