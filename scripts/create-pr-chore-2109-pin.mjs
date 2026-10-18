#!/usr/bin/env node
// Create the chore PR for the 2.109.0 changelog entry + verify pin.
import { execSync } from 'node:child_process';

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const token = remote.match(/x-access-token:([^@]+)@/)?.[1];
if (!token) { console.error('NO TOKEN'); process.exit(1); }

const body = [
  '## chore: changelog 2.109.0 entry + v2.108.0 verify pin',
  '',
  'Two hygiene fixes riding behind v2.109.0 (NO version bump \u2014 release.yml no-ops):',
  '- CHANGELOG.md gains the 2.109.0 entry (the file historically lags; the entry documents the released IA round).',
  '- verify-v2-108-0.mjs pinned the changelog-counter test bytes that v2.109.0 re-anchored (2.107.0\u21921, 2.106.0\u21922, 2.77.0\u219231). The pin now mirrors the committed test exactly; both verify scripts (19/19 + 19/19) pass on this tree.',
].join('\n');

const pr = JSON.stringify({
  title: 'chore: changelog 2.109.0 entry + v2.108.0 verify pin',
  head: 'chore/v2-109-changelog-and-verify-pin',
  base: 'main',
  body,
});

const res = execSync(
  `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" -d '${pr.replace(/'/g, `'\\''`)}' https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/pulls`,
  { encoding: 'utf8' },
);
const j = JSON.parse(res);
console.log('PR:', j.number, j.html_url ?? j.message ?? j);
