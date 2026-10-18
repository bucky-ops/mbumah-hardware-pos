// v2.98.0 create-pr — fresh this round.
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const m = remote.match(/x-access-token:([^@]+)@github/);
if (!m) throw new Error('no token in remote URL');
const TOKEN = m[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const HEAD = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

const res = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'feat: payroll runs read as periods (v2.98.0)',
    head: 'feat/v2-98-0-runs-read-as-periods',
    base: 'main',
    body: [
      '## v2.98.0 — payroll runs read as periods',
      '',
      'The largest standing debt (carried ×11) lands: the runs table stops reading as a log of rows and reads as a ledger of periods. "October 2026" says its name once; its runs fold underneath; the settled money is summed where the eye lands first.',
      '',
      '- **Pure builder**: `src/lib/hr/payroll/run-groups.ts` — `groupRunsByPeriod<T extends RunGroupSource>` folds the flat run list into period groups. Generic over the caller\'s DTO: narrow in (the builder reads only what grouping needs), wide out (the page\'s full PayrollRunDto flows through unnarrowed, so run rows keep submittedAt and the lifecycle stamps). No db, no network, no env — same purity constraint as run-history.ts.',
      '- **Honest money**: the header\'s settledGross/settledDeductions/settledNet and settledPayslips sum ONLY POSTED + LOCKED runs — a draft or a pending approval is an estimate and never sneaks into the settled total. VOIDED counts toward runCount and nothing else; REJECTED/FAILED read as "need attention" so a period cannot lie as done; an unknown status is never invented into a category.',
      '- **Period header row**: chevron + period name + pay date (EAT), a count-driven status rollup (settled · waiting · need attention · voided chips in the house palette, dark variants included), "N runs · M payslips issued", and the SETTLED NET subtotal — one honest row per month.',
      '- **Periods fold**: every header row is a real `<button>` (aria-expanded, honest aria-label) that collapses its month; collapsed headers keep their counts so a folded month never goes silent. A Collapse all / Expand all affordance appears when more than one period exists.',
      '- **The per-row Period column is gone** — the group header owns the name; repeating it per row was the very noise this release kills. Rows read Run → Status → money → Action.',
      '- **Tests**: payroll-run-groups.test.ts executes the builder for real — the seeded October shape (BONUS pending + OFF_CYCLE/SUPPLEMENTARY posted + REGULAR locked → settledNet exactly the two posted runs), period ordering by latest run, stable in-period order, voided/attention/unknown-status edges, numeric (not string) money sums. console-changelog re-anchored for the 2.98.0-fed feed.',
      '',
      '## Verification',
      '',
      '- vitest **2165/2165** (104 files, +9: run-groups honesty edges; changelog counters re-anchored 2.96.0→1, 2.95.0→2, 2.77.0→20)',
      '- lint **0 errors / 421 warnings (= baseline)**',
      '- tsc **424 (= baseline; ZERO in touched files; 3 GB heap)**',
      '- verify v2-98-0 FRESH **15 checks ALL PASS** (atLeast slots; WN leads + periods story; lib purity + settled predicate = POSTED/LOCKED only + VOIDED door + payslip honesty; page testids + aria + chips + prior anchors; tests pinned; changelog re-anchor; prior release stories intact)',
      '- build green (BUILD_ID verified before daemon start)',
      '- E2E on :3200 built tree: grouped header renders once ("October 2026", pays-stamp, 3 settled + 1 waiting chips, 4 runs · 14 payslips, SETTLED NET KES 395,545.20 = exactly the two posted runs\' 197,772.60 ×2 + the zero-value locked run) → collapse hides all run rows with aria-expanded=false and the label flips to Expand → expand restores all rows → run dialog opens with maker-checker intact (Approve disabled with the handover explanation) → What\'s New leads "2.98.0 — Payroll runs read as periods" → light + dark screenshots → waiting-since and Digest CSV anchors alive → console clean',
    ].join('\\n'),
  }),
});

const data = await res.json();
console.log('PR:', res.status, data.number ?? JSON.stringify(data));
if (!res.ok) process.exit(1);
console.log('HEAD:', HEAD);
