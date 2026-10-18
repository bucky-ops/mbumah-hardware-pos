#!/usr/bin/env node
// Create PR for v2.109.0 — double-quoted bodies (the over-escaped-apostrophe
// gotcha never gets a third bite).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error('NO TOKEN'); process.exit(1); }

const body = [
  '## v2.109.0 — People & payroll joins Finance & Insights',
  '',
  'The navigation/console round: the EMS "People & payroll by branch (N)" panel moves under Finance & Insights in the main SPA, the Expert Console grows a Home button back to POS, and Branch Selector / Organization Console / Expert Console / Global Chat now follow the Admin module in that exact order, each wearing its own icon. Both consoles render through one shared shell.',
  '',
  '- **The panel is a real Finance & Insights tab** — new AppTab `people-payroll` (registered in all five registries: AppTab union, TAB_CONFIG, NAV_GROUPS right after payroll, TAB_LOADERS, the render switch), offered to exactly the trio /api/org/summary\u0027s guard serves (SUPER_ADMIN, STORE_OWNER, ACCOUNTANT); the sidebar renders it LOCKED for everyone else. The server still fail-closes per request.',
  '- **One shared panel, two homes** — src/components/finance/people-payroll-by-branch.tsx serves the new tab (open by default) and the Expert Console (collapsed, density preserved). Per branch: headcount, employment cost (KES, en-KE separators), absence rate, latest run (period + status + run date), expiry alerts (90-day documents + overdue assets). Desktop keeps the dense sticky-header table; mobile gets cards (no horizontal scroll).',
  '- **Every gap says why** — PAYROLL_RUN_NOT_AVAILABLE on a runless branch, PERMISSION_DENIED on 401/403, HR_DATA_SOURCE_UNAVAILABLE when the summary answers without the HR block (module off or permission missing), API_ERROR_SAFE on failures. No blank, no undefined, no guessed number; a branch that never ran shows "no runs yet", never fake data.',
  '- **The Home action** — the Expert Console header carries Home (Home icon, label "Home", aria "Back to POS"), first in the actions row so it can never overlap the health gauge, stores, chat or user chip. One shared helper (goHomeToPos) sets the POS tab on the persisted app store and assigns "/" — an internal path only; no query, header or host is trusted, so it cannot become an open redirect. E2E: click Home -> root SPA with the POS tab ACTIVE.',
  '- **The order after Admin** — Compliance & System ends Security, Admin; the workspace links block moved BELOW the nav, rendering Branch Selector (Building2), Organization Console (Network), Expert Console (Gauge), Global Chat (MessagesSquare) — in that exact visible order, collapsed rail included. Admin now wears ShieldCheck. Every TAB_CONFIG icon is type-required and pinned by test (no duplicate ids or labels).',
  '- **The unified console** — both /console (expert) and /org/dashboard (organization) render through UnifiedConsoleShell (shared landmarks, skip link, mode attribute) and share goHomeToPos + the panel. No section moved and no capability lost: docs/CONSOLE_MERGE_PARITY_MATRIX.md lists every former feature of both consoles and where it lives now.',
  '- **Docs** — NAVIGATION_INFORMATION_ARCHITECTURE.md (sources of truth, visible order, Finance & Insights membership, Home behavior, roles), CONSOLE_MERGE_PARITY_MATRIX.md, ICON_SYSTEM.md.',
  '',
  'New: people-payroll-tab.tsx; people-payroll-by-branch.tsx; unified-console.tsx; nav-console-v2109.test.ts (19 cases); verify-v2-109-0 (19 checks); the three docs; whats-new 2.109.0.',
  '',
  'Gates: vitest 2411/2411 (114 files, +19) - lint 0 errors / 421 warnings (= baseline) - tsc 424 source-only (= baseline) - verify 19/19 (fresh) - build green (webpack@2048). E2E: sidebar order verified in-DOM (Admin, Branch Selector, Organization Console, Expert Console, Global Chat); the tab renders the real panel (5 branches; Juja Main 5 / KES 726,292.60 / 0% / October 2026 pending_approval / 0; quiet branches show "no runs yet"); Home -> POS verified on disk screenshots; org console regression-clean; light + dark screenshots; console clean.',
].join('\n');

const pr = JSON.stringify({
  title: 'feat: people & payroll joins finance, console home and nav order (v2.109.0)',
  head: 'feat/finance-people-payroll-console-nav-icons',
  base: 'main',
  body,
});

const res = execSync(
  `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -d '${pr.replace(/'/g, `'\\''`)}' https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/pulls`,
  { encoding: 'utf8' },
);
const j = JSON.parse(res);
console.log('PR:', j.number, j.html_url ?? j.message ?? j);
