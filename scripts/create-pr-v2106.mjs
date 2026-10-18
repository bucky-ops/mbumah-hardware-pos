#!/usr/bin/env node
// Create PR for v2.106.0 — double-quoted bodies (the over-escaped-apostrophe
// gotcha never gets a third bite).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error('NO TOKEN'); process.exit(1); }

const body = [
  '## v2.106.0 — the picker remembers and browses',
  '',
  'The account picker (v2.105.0) answered only when you could spell: it spoke on typing, and the chart itself stayed folded. Now the box opens on focus — the doors you opened come back as violet chips, and one door lists the whole chart, grouped by type. An account needs no spelling at all.',
  '',
  '- **Memory follows the chart** — pure builder rememberAccountCode: the picked code moves to the front, deduped case-insensitively, capped at a glance (3, clamped to at least 1), client-local under mbumah.payroll.account-picker.recent. Only a chart-known code is remembered (the honest-no path is a question, not a door, and a question is not remembered), canonicalized to the chart spelling before it lands.',
  '- **The memory read is narrowed before any use** — pure builder parseRecentAccountCodes: a corrupted, foreign or non-array payload degrades to [] (an empty memory, never a crash); every surviving code must match the chart case-insensitively and rides the CANONICAL spelling, so a chip can never open a door that 404s. Re-validated on every index landing — the memory re-answers to each period\'s chart.',
  '- **The browse door is the same truth** — pure builder groupAccountsByType: the whole chart grouped by type (groups alphabetical, accounts by code ascending, a missing type in its own UNCLASSIFIED bucket, never dropped), walked by the same keyboard contract (↑↓ moves the flattened rows, Enter opens the highlighted account), wearing the same activity/quiet badges. Typing leaves browse; the two voices never mix.',
  '- **Layered Esc, re-anchored** — the box now opens on focus (idle panel: recents + browse door), so the drawer\'s Radix veto is the BOX itself, not the query (the v2.105.0 query-guarded form is pinned gone); the input handler steps the layers back (browse → box → drawer) and the next Esc closes the drawer the Radix way.',
  '- **A failed index stays honest by absence** — no chips, no browse door, and the idle panel says so plainly while typing still asks the ledger. Stale browse state resets with the picker\'s per-period hygiene; a picker door opens on the MONTH, always.',
  '- **Assistive tech hears both voices** — aria-controls names both listboxes, aria-expanded reflects idle/browse/suggestions, aria-activedescendant points at whichever voice is speaking; the shared row renderer keeps one markup with two testid namespaces.',
  '',
  'New: pure builders (rememberAccountCode / parseRecentAccountCodes / groupAccountsByType + AccountTypeGroup, ACCOUNT_PICKER_RECENTS_KEY/CAP) in period-journal.ts; the idle panel, recents chips and grouped browse UI in the ledger drawer; whats-new 2.106.0.',
  '',
  'Gates: vitest 2354/2354 (112 files, +31) - lint 0 errors / 421 warnings (= baseline) - tsc 424 source-only (= baseline) - verify 17/17 (fresh) - build green (webpack@2048).',
].join('\n');

const pr = JSON.stringify({
  title: 'feat: the picker remembers and browses (v2.106.0)',
  head: 'feat/v2-106-0-picker-remembers-and-browses',
  base: 'main',
  body,
});

const res = execSync(
  `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -d '${pr.replace(/'/g, `'\\''`)}' https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/pulls`,
  { encoding: 'utf8' },
);
const j = JSON.parse(res);
console.log('PR:', j.number, j.html_url ?? j.message ?? j);
