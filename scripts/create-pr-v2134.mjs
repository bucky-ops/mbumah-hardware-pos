#!/usr/bin/env node
// v2.134.0 PR creation — "the gate opens onto empty months".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25; the v2.133.0 merge shipped with v2.132.0's title words because a
// template was patched instead of rewritten — that drift stops here).

import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@github/)?.[1];
const repo = remote.match(/github\.com[:/](.+)\.git/)?.[1];
if (!token || !repo) { console.error('cannot parse remote'); process.exit(1); }

const body = `## The gate opens onto empty months (v2.134.0)

The v2.133.0 pre-flight gate door rode the runs table's period headers — and the runs table only renders periods that HAVE runs. A freshly opened month (zero runs — every month's starting state) rendered nowhere, so the lifecycle's front door was locked exactly when it matters most: before the FIRST run of the month is prepared. This release unlocks it from the outside.

### What changed

**The pure empty-month builder (feature)**
- \`emptyPeriodRows\` in \`src/lib/hr/payroll/run-groups.ts\`: given the periods the API knows and the groups the runs built, it names the periods the runs table will never render. Matching is by period NAME — the same key \`groupRunsByPeriod\` groups by (the house rule the grouping already stands on).
- Every row carries the period's REAL id (a run-less period has no run to borrow \`payrollPeriodId\` from — the header door's \`runs[0]\` trick has nothing to borrow from), its lifecycle status verbatim (unknown/missing degrades to \`''\` — the chip renders UNKNOWN, never a guessed state), and a deterministic newest-month-first order (startDate desc, name-ascending tie-break).
- VOIDED periods are NOT filtered out — the gate has an honest verdict for them. Pure: no db, no network, no env; wide DTOs flow through unnarrowed.

**The pre-flight months section (feature + styling)**
- Renders on the Runs tab only when a run-less period exists, below the runs ledger so the money table's story stays intact.
- Each row speaks the month's own words: name, a mono lifecycle chip (OPEN emerald / VOIDED amber / everything else muted ink), date range + pay date in tabular numerals with an honest "pay date not set" fallback.
- Each row carries the SAME Gate door the period headers carry: same \`ShieldCheck\` affordance, same aria family (\`Check the {period} run gate\`), same single loader (\`toggleGate\` → \`loadGate\`), same \`GatePanel\` verdict with its clear/blocked/voided/failed states. One gate, two doors — no third implementation to drift.
- House styling throughout: dark twins on every colored surface, hover + focus-within affordances, the header-rail door letterform, and an inset verdict keyed by the period's real id.

### Gates
vitest **2792/2792** (139 files, +16/+1) · lint **0 errors / 421 warnings** (= baseline) · tsc **424** source-only (= invariant) · verify-v2-134-0 **13/13** (fresh script) · build green (webpack@2048) · E2E on :3200 (restored v2.133.0 clone → seeded → rebuilt): run-less October 2026 renders as a pre-flight row, its Gate door returns "5 clear" live, dark twins screenshot-verified.

### Security
- Read-only by construction: the pre-flight door opens the SAME read-only gate route behind the runs list's existing read-right quartet — no new route, no mutation path, no payslip computed; the write-verb ban stays test-pinned.
`;

const pr = execSync(`curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/pulls -d @-`, {
  input: JSON.stringify({
    title: 'feat: the gate opens onto empty months (v2.134.0)',
    head: 'feat/v2-134-0-gate-opens-empty-months',
    base: 'main',
    body,
  }),
  encoding: 'utf8',
});
const j = JSON.parse(pr);
if (j.number) console.log(`PR #${j.number} created: ${j.html_url}`);
else { console.error('FAILED:', pr.slice(0, 500)); process.exit(1); }
