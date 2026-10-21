#!/usr/bin/env node
// check-merge-v2201.mjs - waits for PR #328's required check-runs
// (CI Pass + Build via the Actions app) and squash-merges when green.
import { execSync } from 'node:child_process';

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'collins-muchiri/mbumah-hardware-pos';
const PR = 329;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path) =>
  JSON.parse(
    execSync(
      `curl -sL -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${REPO}${path}`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    ),
  );

if (!TOKEN) { console.error('NO TOKEN'); process.exit(1); }

const pr = api(`/pulls/${PR}`);
console.log(`PR #${PR}: ${pr.title} | state=${pr.state}`);
const sha = pr.head.sha;
console.log(`head sha: ${sha}`);

let settled = false;
for (let i = 0; i < 16; i++) {
  const runs = api(`/commits/${sha}/check-runs?per_page=100`);
  const byName = Object.fromEntries((runs.check_runs || []).map((c) => [c.name, c.conclusion]));
  const names = Object.entries(byName).map(([n, c]) => `${n}:${c}`).sort().join(' ');
  console.log(`[poll ${i}] ${names || '(none yet)'}`);
  const required = ['CI Pass', 'Build'];
  if (required.some((r) => byName[r] === 'failure')) {
    console.error('REQUIRED CHECK FAILED');
    process.exit(2);
  }
  if (required.every((r) => byName[r] === 'success')) { settled = true; break; }
  await sleep(30000);
}
if (!settled) { console.error('checks did not settle in time'); process.exit(3); }

console.log('all required checks green - squash merging');
const mergeRes = execSync(
  `curl -sL -X PUT -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" ` +
  `-d @- https://api.github.com/repos/${REPO}/pulls/${PR}/merge`,
  {
    input: JSON.stringify({
      merge_method: 'squash',
      commit_title: 'fix: one currency voice in the debt book and the movers (v2.201.1) (#329)',
      commit_message: "One currency voice: the debt book risk lines and the movers meta read Ksh 88,400.00 where they briefly said KES Ksh 88,400.00; plus the branch dashboard's two remaining quiet cards speak: the Debt Aging card becomes the debt family's ROSE door (the branch's debt book — the aging bar with honest shares, the wire's own high-risk rule spoken, the bill count stays the truth) and Top Products becomes the VIOLET door (the day's movers — the full named roster with window shares and the category mix the tab never read); plus the -600 contrast family closed on the branch dashboard (badge 3.82→6.42, chips 3.75/4.35/3.90→5.04/6.90/5.26, banner 4.36→5.88) and the v2.200 aria pluralization nit.",
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
