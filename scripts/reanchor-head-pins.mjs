#!/usr/bin/env node
// Head-pin re-anchoring script (the Task 149 recipe's promise, delivered in
// v2.155.0). Every release round must re-anchor the prior-round head-pin
// suites to the new head — this does it mechanically instead of hand-editing
// five files per round (lesson 64's treadmill tax).
//
// Usage: node scripts/reanchor-head-pins.mjs <newVersion> <oldVersion> <c110> <c109> <c108> <c77>
//   e.g. node scripts/reanchor-head-pins.mjs 2.156.0 2.155.0 45 46 47 78
//
// What it patches (idempotent - run after the version bump):
//   • the five head-pin suites: pkg.version/releaseVersion/baseVersion
//     toBe('old' → 'new'), CHANGELOG '## [old]' → '## [new]', feed-order
//     indexOf pins, and the a11y-shell counter anchor + console-changelog
//     counters (c110/c109/c108/c77) + the re-anchor comment.
//   • prints a diff summary; exits 1 if a suite went untouched (the suite
//     list has drifted - check src/tests/ for new head-pin files).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , NEW, OLD, C110, C109, C108, C77] = process.argv;
if (!NEW || !OLD || !C110 || !C109 || !C108 || !C77) {
  console.error('usage: node scripts/reanchor-head-pins.mjs <newVersion> <oldVersion> <c110> <c109> <c108> <c77>');
  process.exit(1);
}

const SUITES = [
  'src/tests/a11y-shell-v2148.test.ts',
  'src/tests/console-org-v2149.test.ts',
  'src/tests/console-org-v2151.test.ts',
  'src/tests/console-org-v2152.test.ts',
  'src/tests/console-org-v2153.test.ts',
  'src/tests/console-org-v2154.test.ts',
];

let touched = 0;
for (const p of SUITES) {
  if (!existsSync(p)) continue;
  const before = readFileSync(p, 'utf8');
  let s = before;
  s = s.replaceAll(`toBe('${OLD}')`, `toBe('${NEW}')`);
  s = s.replaceAll(`toContain('## [${OLD}]')`, `toContain('## [${NEW}]')`);
  s = s.replaceAll(`feed.indexOf("'${OLD}'")`, `feed.indexOf("'${NEW}'")`);
  s = s.replaceAll(`expect(whatsNewUnreadCount('2.110.0')).toBe(${Number(C110) - 1});`, `expect(whatsNewUnreadCount('2.110.0')).toBe(${C110});`);
  if (s !== before) {
    writeFileSync(join(process.cwd(), p), s);
    touched++;
    console.log(`[REANCHORED] ${p}`);
  }
}

// console-changelog counters + comment
const counterPath = 'src/tests/console-changelog.test.ts';
if (existsSync(counterPath)) {
  let s = readFileSync(counterPath, 'utf8');
  const before = s;
  const pairs = [
    [`expect(whatsNewUnreadCount('2.110.0')).toBe(${Number(C110) - 1});`, `expect(whatsNewUnreadCount('2.110.0')).toBe(${C110});`],
    [`expect(whatsNewUnreadCount('2.109.0')).toBe(${Number(C109) - 1});`, `expect(whatsNewUnreadCount('2.109.0')).toBe(${C109});`],
    [`expect(whatsNewUnreadCount('2.108.0')).toBe(${Number(C108) - 1});`, `expect(whatsNewUnreadCount('2.108.0')).toBe(${C108});`],
    [`expect(whatsNewUnreadCount('2.77.0')).toBe(${Number(C77) - 1});`, `expect(whatsNewUnreadCount('2.77.0')).toBe(${C77});`],
  ];
  for (const [a, b] of pairs) s = s.replace(a, b);
  s = s.replace(/\/\/ Re-anchored for [^\n]+\n/, `// Re-anchored for ${NEW} joining the feed.\n`);
  if (s !== before) {
    writeFileSync(join(process.cwd(), counterPath), s);
    touched++;
    console.log(`[REANCHORED] ${counterPath}`);
  }
}

if (touched === 0) {
  console.error('[WARN] no suite changed - check for new head-pin files and extend SUITES');
  process.exit(1);
}
console.log(`\n${touched} file(s) re-anchored. Run: npx vitest run src/tests/ | tail -4`);
