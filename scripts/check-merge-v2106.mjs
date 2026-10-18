#!/usr/bin/env node
// Single-shot check-merge for PR (v2.106.0): poll checks on the PR's head
// SHA, verify green (skipped counts as satisfied), then PUT the squash
// merge. Merge is a PUT, not POST (learned the hard way).
//
// v2.102 LESSON APPLIED: `Type Check (advisory)` is continue-on-error by
// design and its failure is its steady state on PR heads (~665 pre-existing
// strict-mode errors) — it is EXCLUDED here as satisfied-by-design. The
// REQUIRED checks (CI Pass, Build, Security & Schema, Lint, Test, Vercel
// Preview Comments, Install, Deploy Preview) gate the merge.
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error('NO TOKEN'); process.exit(1); }
const api = (path, opts = {}) => execSync(
  `curl -s -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" ${opts.method ? `-X ${opts.method}` : ''} https://api.github.com/repos/bucky-ops/mbumah-hardware-pos${path}`,
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);

const ADVISORY = /Type Check/i; // satisfied-by-design; failure is its steady state

const prNumber = process.argv[2];
if (!prNumber) { console.error('usage: node check-merge-v2106.mjs <pr-number>'); process.exit(1); }
const pr = JSON.parse(api(`/pulls/${prNumber}`));
const sha = pr.head.sha;
console.log('PR', prNumber, 'HEAD SHA:', sha);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let attempts = 0;
let merged = false;
while (attempts < 40 && !merged) {
  attempts++;
  await sleep(15000);
  const runs = JSON.parse(api(`/commits/${sha}/check-runs?per_page=100`));
  const checks = (runs.check_runs ?? []).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
  if (checks.length === 0) { console.log(`[${attempts}] no check runs yet`); continue; }
  const pending = checks.filter((c) => c.status !== 'completed');
  if (pending.length > 0) { console.log(`[${attempts}] pending: ${pending.map((c) => c.name).join(', ')}`); continue; }
  const advisory = checks.filter((c) => ADVISORY.test(c.name));
  const required = checks.filter((c) => !ADVISORY.test(c.name));
  const failed = required.filter((c) => c.conclusion !== 'success' && c.conclusion !== 'skipped' && c.conclusion !== 'neutral');
  console.log('CHECKS:');
  for (const c of checks) console.log(`  ${c.conclusion}  ${c.name}${ADVISORY.test(c.name) ? '  (advisory — satisfied-by-design)' : ''}`);
  if (failed.length > 0) { console.log('FAILED:', failed.map((c) => `${c.name}=${c.conclusion}`).join(', ')); process.exit(1); }
  // Required green (skipped = satisfied). Squash merge — merge_method is
  // EXPLICIT: the API's default is a merge commit, and PR #224 (v2.104.0)
  // landed as one when no body was sent. Squash is the house shape.
  const res = execSync(
    `curl -s -X PUT -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -d '{"merge_method":"squash"}' https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/pulls/${prNumber}/merge`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  const mj = JSON.parse(res);
  console.log('MERGE:', mj.merged ? 'OK' : mj.message, mj.sha ?? '');
  merged = !!mj.merged;
}
if (!merged) { console.log('TIMEOUT waiting for checks'); process.exit(1); }
