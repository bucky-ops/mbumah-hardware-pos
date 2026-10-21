#!/usr/bin/env node
// create-pr-v2201-hotfix.mjs - opens the v2.201.1 patch PR.
import { execSync } from 'node:child_process';
const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const TOKEN = (remote.match(/x-access-token:([^@]+)@/) || [])[1] || process.env.GITHUB_TOKEN || '';
const repoPath = (remote.match(/github\.com\/([^/]+\/[^.]+)\.git/) || [])[1];
const REPO = repoPath || 'collins-muchiri/mbumah-hardware-pos';
const body = [
  '## v2.201.1 - A cleaner debt book voice',
  '',
  'The round own agent-browser E2E (run against the SHIPPED v2.201.0 tag on the seeded Juja Main ledger) caught one voice bug class: the debt book risk lines and the day movers meta prefixed "KES" in front of formatKES own "Ksh" - "KES Ksh 88,400.00" on every named debtor lifetime-spend line and the movers headline total. The double prefix is gone from all four template sites (`branch-doors.tsx`); the figures read "Ksh 88,400.00" - same numbers, one currency voice.',
  '',
  '- **Fixed**: four "KES " prefix removals (the high-risk line, the ratio line, the calm lifetime line, the movers meta). No logic, no layout, no color changes.',
  '- **Tests**: `src/tests/branch-quiet-doors-v2201.test.ts` +1 (the one-currency-voice pin); pkg pins + head counters ride to 2.201.1 (the treadmill tax). FULL vitest **4180/4180** (202 files) - lint 0 errors / 542 warnings (baseline EXACT). The build gate rides the CI Build check (a four-string change; the identical build ran green 40 minutes prior).',
  '- **Recorded honestly**: v2.201.0 shipped with the bug because the E2E ran after the merge; this patch fixes it without rewriting a published release.',
  '',
  '### Release checklist',
  '- [x] Version bump 2.201.0 -> 2.201.1 (all three package.json slots)',
  '- [x] CHANGELOG + whats-new head the patch',
  '- [x] Full vitest + lint green before push',
  '- [ ] Required checks green, then squash merge (release.yml tags + publishes)',
];
if (!TOKEN) { console.error('NO TOKEN'); process.exit(1); }
const res = execSync(
  `curl -sL -X POST -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" -d @- https://api.github.com/repos/${REPO}/pulls`,
  { input: JSON.stringify({ title: 'fix: one currency voice in the debt book and the movers (v2.201.1)', head: 'release/v2.201.1', base: 'main', body: body.join('\n') }), encoding: 'utf8' },
);
const pr = JSON.parse(res);
if (pr.number) console.log(`PR #${pr.number} opened: ${pr.html_url}`);
else { console.error('PR FAILED:', res.slice(0, 300)); process.exit(1); }
