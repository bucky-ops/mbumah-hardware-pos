#!/usr/bin/env node
// v2.121.0 PR creation — written fresh this round (lesson 25: never derive by sed).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { cwd: '/home/z/ems' }).toString().trim();
const token = remote.match(/x-access-token:([^@]+)@/)[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const H = { 'User-Agent': 'ems-release', 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };

const body = `## v2.121.0 — "The roster reads the room"

Consent visibility where HR actually works (v2.120.0's option 1). The consent ledger (v2.119.0) and the onboarding capture (v2.120.0) both exist — but the roster, the surface HR lives in all day, still answered nothing about consent. This release overlays the ledger onto /hr/employees: the roster answers the payroll run's read at a glance, and the Privacy tab keeps the authoritative detail.

### Added
- **Consent chips on the roster** (\`src/app/(shell)/hr/employees/page.tsx\`): a "Payroll consent" column (desktop table) and a compact chip (mobile cards) fed by the SAME ledger the Privacy tab reads (\`GET /api/hr/privacy/consent\`) — emerald Active / amber Withdrawn / slate None on file, tones mirroring the consent card EXACTLY so a color never means two things. Each chip's tooltip says its MISSING_CONSENT truth aloud instead of relying on color; a row outside the view's first-200 window renders a muted dash whose tooltip points at the authoritative ledger — never a look-alike consent state.
- **Counts strip in the filter bar** (\`hr-employees-consent-counts\`): "N active · W withdrawn · M without consent" with the without-consent phrase rose-tinted when nonzero — the same sentence and honesty as the Privacy tab's counts line, with a tooltip that admits it counts the whole consent view, not the filtered list.

### Changed
- The consent overlay fetch rides its own effect (cleanup-guarded against late answers, refreshed with the list's reload key) and maps ONLY the three known statuses — an invented status can never render a look-alike chip. \`ConsentChip\` takes an optional status and renders null on absence — no non-null assertions anywhere on the overlay path.
- The What's-New feed leads with the roster story; the unread-counter test re-anchored for the 2.121.0-fed feed (2.110.0→10, 2.109.0→11, 2.108.0→12, 2.77.0→43).

### Security
- The overlay degrades HONESTLY behind the ledger's guard: \`GET /api/hr/privacy/consent\` stays \`hr.report.branch\` + VIEW_ROLES (deliberately excluding ACCOUNTANT, who may still see the roster), and when the fetch 403s — or fails at all — the column, chips, and counts hide WHOLESALE. Absence of the view is never rendered as absence of consent; the page carries no consent vocabulary a denied role could misread, and the authoritative ledger remains the Privacy tab.

### Verification
- vitest 2569/2569 (126 files, +10) · lint 0 errors / 421 warnings (= baseline) · tsc 424 source-only (= baseline) · verify-v2-121-0 11/11 · build green (webpack@2048, BUILD_ID verified)
- E2E on :3200: owner view — "Payroll consent" column renders with 6 emerald "Active" chips + Kip Chirchir's slate "None on file", counts strip "6 active · 0 withdrawn · 1 without consent" (rose span), light + dark screenshots, console clean; accountant view — the roster renders but ZERO consent traces survive the 403 (column, chips, counts all hidden wholesale) AND the onboard button is absent (canCreate=false re-verified for a second role), console clean; unauth consent GET 401 (fail-closed intact).
`;

const pr = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'feat: the roster reads the room (v2.121.0)',
    head: 'feat/v2-121-0-roster-consent',
    base: 'main',
    body,
  }),
});
const pj = await pr.json();
console.log('PR:', pr.status, pj.number, pj.html_url);
if (!pr.ok) process.exit(1);
