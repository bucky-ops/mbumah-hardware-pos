#!/usr/bin/env node
// v2.130.0 PR creation — "the timeline files its copy".
// Written fresh this round (never patch a prior round's copy — house lesson 25).

import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@github/)?.[1];
const repo = remote.match(/github\.com[:/](.+)\.git/)?.[1];
if (!token || !repo) { console.error('cannot parse remote'); process.exit(1); }

const body = `## The timeline files its copy (v2.130.0)

The consent timeline drawer (v2.129.0) grew an **Export CSV door** — the export-honesty theme's third beat (v2.115 case list → v2.118 access ledger → now the consent timeline). The same round fixes the Privacy tab's honesty gap this work exposed: a card whose ledger fails to load used to spin "Loading…" forever.

### What changed

**The timeline CSV serializer (feature)**
- \`src/lib/hr/consent-timeline-csv.ts\`: \`buildConsentTimelineCsv(rows)\` — RFC 4180 cells (quote on comma/quote/CR/LF, double embedded quotes), CRLF line endings, header row first, nulls become empty cells, timestamps become ISO strings (a garbage timestamp degrades to an empty cell, never "Invalid Date" on file).
- The header is the ledger's own column set, pinned exactly: \`cycle,state,granted_at,withdrawn_at,stood_days,purpose,policy_version,employee_code,employee_name\`. \`consentTimelineStateLabel\` speaks the chips' own two words (WITHDRAWN / STANDING, derived from \`withdrawnAt\`, never free text); a standing cycle leaves \`withdrawn_at\` and \`stood_days\` empty — an open consent has no honest day count to write down. \`consentTimelineCsvFilename\` sanitizes the employee code into \`consent-timeline-{code}-{date}.csv\`.
- **The confidentiality contract is the row type itself**: no content field exists (\`note\`/\`description\`/\`salary\`/\`amount\`/\`content\` are all absent and test-pinned), so an export can never become a back door.

**The drawer's Export CSV door (styling)**
- An outline button (FileDown icon) rides the timeline footer, rendered ONLY when the ledger has rows (an empty ledger files nothing). Tooltip states the honesty: "Only who, when, and what purpose are exported — the ledger's own columns, never more." The export maps the drawer's own payload (the employee's code and name ride every row) through the pure serializer with the house Blob-download mechanics.

**The Loading-forever fix (Fixed)**
- \`loadConsent\` / \`loadErasure\` / \`loadRetention\` caught a failed fetch into \`null\` — the same state "not yet answered" renders as — so an expired session or a network failure left the card spinning forever. Each loader now carries its own \`failed\` flag (set true in the catch, cleared on success), and each card renders an honest rose error strip with dark twins and a Retry button: "The consent ledger could not be loaded — the desk stays dark rather than guess." (and the erasure-queue and retention-desk siblings). Skeletons remain the not-yet-answered state; failure and loading stay distinct.

### E2E (real walk on :3200)
Healthy baseline (7 doors, honest counts, 0 strips) → Mary Wanjiku's drawer → **Export CSV door live** (aria-label "Export consent timeline CSV — Mary Wanjiku", honesty tooltip) → click → **consent-timeline-MBH-1-002-2026-10-19.csv on disk (325 B)**: header + Cycle 1 WITHDRAWN (both ISO stamps, stood 351) + Cycle 2 STANDING (empty withdrawn/stood cells) — no content columns. **Failure-speech walk**: fetch poisoned with a 500 at the network boundary → Refresh → **rose error strip renders** (role=status, "the desk stays dark rather than guess.", Retry button) → screenshot → fetch restored → **Retry → strip gone → counts honest → 7 doors back**. Dark screenshot shows the CSV door riding the timeline footer; console clean; theme restored.

### Gates
vitest **2721/2721** (135 files, +18/+1) · lint **421 warnings** (= baseline) · tsc **424** source-only (= invariant; first run OOM-killed with Chrome alive — kill list re-applied) · verify-v2-130-0 **9/9** (fresh script; one check's search string was malformed — fixed the CHECK, not the code) · build green (webpack, BUILD_ID Jj5FXzS7X1kuXO_1bf_kx).

### Environment gotcha (new house lesson)
The pre-build kill list MUST include the :3200 daemon. This round rebuilt WITHOUT killing it: the stale server kept owning :3200 (the new daemon's bind failed silently) and served the OLD chunk manifest from memory — the root webpack chunk name hadn't changed so the served-chunk check PASSED while every page chunk 404'd (ChunkLoadError → inert tabs). Detection: compare the page-chunk filename referenced in served HTML against \`.next/static/chunks/app/...\` on disk, not just the root chunk. Browser disk cache then compounded it (fresh HTML cache-busted only by URL querystring; full recovery required a Chrome restart).

### Security
- No new permission surface: the CSV is a CLIENT-side serialization of data the viewer already fetched through the \`hr.report.branch\`-guarded history route — no new endpoint, no new permission, no server round-trip. The row type's field set is test-pinned (no content columns can exist); the filename is sanitized; the tooltip states the scope.
`;

const pr = execSync(`curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/pulls -d @-`, {
  input: JSON.stringify({
    title: 'feat: the timeline files its copy (v2.130.0)',
    head: 'feat/v2-130-0-timeline-files-copy',
    base: 'main',
    body,
  }),
  encoding: 'utf8',
});
const j = JSON.parse(pr);
if (j.number) console.log(`PR #${j.number} created: ${j.html_url}`);
else { console.error('FAILED:', pr.slice(0, 500)); process.exit(1); }
