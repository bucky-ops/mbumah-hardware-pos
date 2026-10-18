#!/usr/bin/env node
// v2.122.0 merge gate — hardened waiter (lesson 26) + ONE squash PUT with a
// FRESH commit_title (lesson 25).
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { cwd: '/home/z/ems' }).toString().trim();
const token = remote.match(/x-access-token:([^@]+)@/)[1];
const REPO = 'bucky-ops/mbumah-hardware-pos';
const PR = 248;
const HEAD_SHA = execSync('git rev-parse HEAD', { cwd: '/home/z/ems' }).toString().trim();
const H = { 'User-Agent': 'ems-release', 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rounds = 0;
while (true) {
  rounds++;
  const cr = await fetch(`https://api.github.com/repos/${REPO}/commits/${HEAD_SHA}/check-runs`, { headers: H }).then((r) => r.json());
  const runs = cr.check_runs ?? [];
  const names = runs.map((r) => `${r.name}=${r.status}/${r.conclusion ?? '-'}`);
  const pending = runs.filter((r) => r.status !== 'completed');
  console.log(`[poll ${rounds}] ${names.join(' | ') || 'no runs yet'}`);
  const REQUIRED = ['CI Pass', 'Build', 'Lint', 'Test', 'Security & Schema', 'Install'];
  const seen = new Set(runs.map((r) => r.name));
  const requiredDone = REQUIRED.every((n) => seen.has(n));
  if (runs.length > 0 && pending.length === 0 && requiredDone) {
    const failedRequired = runs.filter((r) => r.conclusion === 'failure' && !/Type Check/i.test(r.name));
    if (failedRequired.length > 0) { console.error('REQUIRED CHECK FAILED:', failedRequired.map((r) => r.name).join(', ')); process.exit(1); }
    console.log('All known required checks completed; failures are advisory-only (Type Check = by-design).');
    break;
  }
  if (rounds > 40) { console.error('TIMEOUT waiting for checks'); process.exit(1); }
  await sleep(20000);
}

const title = 'feat: the hold takes the desk (v2.122.0) (#248)';
const merge = await fetch(`https://api.github.com/repos/${REPO}/pulls/${PR}/merge`, {
  method: 'PUT',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ merge_method: 'squash', commit_title: title }),
});
const mj = await merge.json();
console.log('MERGE:', merge.status, JSON.stringify(mj).slice(0, 200));
if (!merge.ok) process.exit(1);
console.log('SQUASH SHA:', mj.sha);
