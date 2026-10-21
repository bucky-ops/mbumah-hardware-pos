#!/usr/bin/env node
// check-merge-v2200.mjs - polls PR #327's required checks and, when every
// REQUIRED check is green, squash-merges (release.yml then auto-tags +
// publishes). Type Check is advisory (pre-existing tsc baseline, recorded
// since v2.193.0) and is skipped.
import { execSync } from 'node:child_process';

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'collins-muchiri/mbumah-hardware-pos';
const PR = 327;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path) =>
  JSON.parse(
    execSync(
      `curl -sL -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${REPO}${path}`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    ),
  );

if (!TOKEN) {
  console.error('NO TOKEN');
  process.exit(1);
}

const pr = api(`/pulls/${PR}`);
if (!pr.mergeable_state && !pr.head) {
  console.error('PR fetch failed');
  process.exit(1);
}
console.log(`PR #${PR}: ${pr.title} | state=${pr.state} draft=${pr.draft}`);
const sha = pr.head.sha;
console.log(`head sha: ${sha}`);

let settled = null;
for (let i = 0; i < 60; i++) {
  const st = api(`/commits/${sha}/status`);
  const byCtx = Object.fromEntries((st.statuses || []).map((s) => [s.context, s.state]));
  const ci = byCtx['CI Pass'];
  const build = byCtx['Build'];
  console.log(`[poll ${i}] combined=${st.state} CI Pass=${ci || 'missing'} Build=${build || 'missing'}`);

  if (ci === 'failure' || build === 'failure') {
    console.error('REQUIRED STATUS FAILED');
    process.exit(2);
  }
  if (ci === 'success' && build === 'success') {
    settled = byCtx;
    break;
  }
  await sleep(30000);
}

if (!settled) {
  console.error('required statuses did not settle in time');
  process.exit(3);
}

console.log('all checks green (Type Check advisory excluded) - squash merging');
const mergeRes = execSync(
  `curl -sL -X PUT -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" ` +
  `-d @- https://api.github.com/repos/${REPO}/pulls/${PR}/merge`,
  {
    input: JSON.stringify({
      merge_method: 'squash',
      commit_title: 'feat: the branch row speaks (v2.200.0) (#327)',
      commit_message: 'The branch workspaces\' KPI row\'s three quiet tiles (Today\'s Revenue / Transactions / Avg Transaction) become the family\'s branch face - three doors, three self-contained focus views (the day ledger / the day receipts / the basket ladder), zero new queries; the contrast find (draft slate-400 light 2.63:1 / slate-500 dark 3.74:1) re-voiced to slate-500+dark:slate-400 (4.77/6.79) and pinned in reverse.',
    }),
    encoding: 'utf8',
  },
);
const merged = JSON.parse(mergeRes);
if (merged.merged) {
  console.log(`MERGED: ${merged.sha}`);
} else {
  console.error('MERGE FAILED:', mergeRes.slice(0, 300));
  process.exit(4);
}
