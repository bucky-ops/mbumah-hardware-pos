// v2.98.0 check-then-merge — SINGLE SHOT (no poller, per round convention).
// PR number hardcoded; EXPECT_HEAD is the FULL sha.
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const m = remote.match(/x-access-token:([^@]+)@github/);
if (!m) throw new Error('no token in remote URL');
const TOKEN = m[1];

const PR = 219;
const EXPECT_HEAD = '__FILL_FULL_SHA__';
const REPO = 'bucky-ops/mbumah-hardware-pos';
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

const api = async (path, init) => {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: H, ...init });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
};

// 0. Head guard
const pr = await api(`/pulls/${PR}`);
if (!pr.ok) throw new Error(`PR ${PR} not readable: ${pr.status}`);
if (pr.data.head.sha !== EXPECT_HEAD) {
  console.error(`HEAD MISMATCH: PR head ${pr.data.head.sha} != expected ${EXPECT_HEAD}`);
  process.exit(1);
}
console.log(`PR #${PR} head verified: ${pr.data.head.sha.slice(0, 12)} · state=${pr.data.state} · mergeable=${pr.data.mergeable}`);

// 1-6. Probe checks with generous lead, then judge
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REQUIRED_PREFIXES = ['Test', 'Lint', 'Build', 'Security', 'Install', 'CI Pass'];
let verdict = null;

for (let probe = 1; probe <= 6; probe++) {
  await sleep(probe === 1 ? 45000 : 60000);
  const runs = await api(`/commits/${EXPECT_HEAD}/check-runs?per_page=100`);
  if (!runs.ok) { console.log(`probe ${probe}: check-runs ${runs.status}`); continue; }
  const all = runs.data.check_runs;
  const combined = all.map((r) => ({ name: r.name, concl: r.conclusion }));
  console.log(`probe ${probe}: ${combined.map((c) => `${c.name}=${c.concl ?? 'pending'}`).join(' | ')}`);

  const failing = combined.filter((c) => c.concl === 'failure');
  const requiredFail = failing.filter((c) => REQUIRED_PREFIXES.some((p) => c.name.startsWith(p)));
  // "Type Check (advisory)" failing = the documented 424 baseline (PR #200-#218 precedent).
  const advisoryFail = failing.filter((c) => c.name.startsWith('Type Check'));
  const pending = combined.filter((c) => c.concl == null || c.concl === 'pending' || ['queued', 'in_progress'].includes(c.status));
  if (pending.length === 0) {
    if (requiredFail.length === 0) {
      verdict = `ALL GREEN${advisoryFail.length ? ` (advisory Type Check = 424 baseline: ${advisoryFail.map((c) => c.name).join(', ')})` : ''}`;
      break;
    }
    verdict = `REQUIRED FAILURES: ${requiredFail.map((c) => `${c.name}=${c.concl}`).join(', ')}`;
    break;
  }
}

if (!verdict || !verdict.startsWith('ALL GREEN')) {
  console.error(`VERDICT: ${verdict ?? 'STILL PENDING after 6 probes'} — NOT merging.`);
  process.exit(1);
}
console.log(`VERDICT: ${verdict}`);

// 7. Squash merge (PUT)
const merge = await api(`/pulls/${PR}/merge`, {
  method: 'PUT',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    merge_method: 'squash',
    commit_title: 'feat: payroll runs read as periods (v2.98.0) (#219)',
  }),
});
console.log('MERGE:', merge.status, JSON.stringify(merge.data).slice(0, 200));
if (!merge.ok) process.exit(1);
console.log('MERGED sha:', merge.data.sha);
