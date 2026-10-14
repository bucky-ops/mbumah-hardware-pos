#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Release selection self-check (v2.18.0.2)
// ============================================================================
// Runs the release-selection matrix through the REAL selector
// (scripts/release/select-release.mjs) and the version parser/tag validator,
// asserting the exact decisions the release rules require. This is the
// script-level guard for "the updater must never again treat a four-part
// correction tag as the next normal release" (the v2.17.7 -> v2.18.0.0
// field incident).
//
// Exit 0 = every scenario behaved as specified. Exit 1 = a rule regressed.
// ============================================================================

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const selector = join(here, 'release', 'select-release.mjs');

let failures = 0;
function run(name, current, channel, releasesJson, expect) {
  const res = spawnSync(process.execPath, [selector, '--current', current, '--channel', channel, '--releases-json', releasesJson], {
    encoding: 'utf8',
  });
  if (res.error) {
    console.error(`[FAIL] ${name}: selector crashed: ${res.error.message}`);
    failures += 1;
    return;
  }
  if (res.status === 2) {
    console.error(`[FAIL] ${name}: selector reported a network error (fixtures must not hit the network).`);
    failures += 1;
    return;
  }
  let d = null;
  try {
    d = JSON.parse(res.stdout.trim().split('\n').pop() || '{}');
  } catch (e) {
    console.error(`[FAIL] ${name}: selector output unparsable: ${res.stdout.slice(0, 200)}`);
    failures += 1;
    return;
  }
  const problems = [];
  if (expect.action && d.action !== expect.action) {
    problems.push(`action: expected "${expect.action}", got "${d.action}"`);
  }
  if (expect.selected && d.selected !== expect.selected) {
    problems.push(`selected: expected "${expect.selected}", got "${d.selected}"`);
  }
  if (expect.latestStable !== undefined && d.latestStable !== expect.latestStable) {
    problems.push(`latestStable: expected "${expect.latestStable}", got "${d.latestStable}"`);
  }
  if (expect.ignoreTag) {
    const ignored = (d.ignored || []).find((i) => i.tag === expect.ignoreTag);
    if (!ignored) problems.push(`expected tag ${expect.ignoreTag} to be ignored, was not`);
    else if (expect.ignoreReasonPart && !ignored.reason.includes(expect.ignoreReasonPart)) {
      problems.push(`ignored reason should mention "${expect.ignoreReasonPart}", got "${ignored.reason}"`);
    }
  }
  if (problems.length > 0) {
    failures += 1;
    console.error(`[FAIL] ${name}`);
    for (const p of problems) console.error(`       ${p}`);
  } else {
    console.log(`[OK] ${name} -> action=${d.action}${d.selected ? ` selected=${d.selected}` : ''}`);
  }
}

// -- Scenario matrix (Phase 7 of the correction spec) -------------------------

// The field incident: on 2.17.7 with only 2.17.7 and the hotfix v2.18.0.0
// available, the stable channel must NOT jump to the four-part tag.
run(
  'stable ignores the four-part hotfix when it is the only newer tag',
  '2.17.7', 'stable', '["2.17.7","2.18.0.0"]',
  { action: 'up-to-date', selected: 'v2.17.7', ignoreTag: '2.18.0.0', ignoreReasonPart: 'three-part base 2.18.0' },
);
run(
  'stable picks the next valid three-part release (2.17.8)',
  '2.17.7', 'stable', '["2.17.7","2.17.8","2.18.0.0"]',
  { action: 'update', selected: 'v2.17.8', ignoreTag: '2.18.0.0' },
);
run(
  'hotfix channel picks the hotfix for the current base',
  '2.17.7.0', 'hotfix', '["2.17.7","2.17.7.1"]',
  { action: 'update', selected: 'v2.17.7.1' },
);
run(
  'stable with 2.18.0 + hotfix 2.18.0.0 available selects 2.18.0 (never the hotfix)',
  '2.17.7', 'stable', '["2.17.7","2.18.0","2.18.0.0"]',
  { action: 'update', selected: 'v2.18.0' },
);
run(
  'hotfix channel on 2.17.7 selects the base release 2.18.0 (hotfixes need the base installed)',
  '2.17.7', 'hotfix', '["2.17.7","2.18.0","2.18.0.1"]',
  { action: 'update', selected: 'v2.18.0' },
);
run(
  'hotfix channel on 2.18.0.0 picks 2.18.0.1',
  '2.18.0.0', 'hotfix', '["2.18.0","2.18.0.1"]',
  { action: 'update', selected: 'v2.18.0.1' },
);
run(
  'stable never downgrades a hotfix install (2.18.0.1 >= 2.18.0)',
  '2.18.0.1', 'stable', '["2.18.0","2.18.0.0","2.18.0.1"]',
  { action: 'up-to-date', selected: 'v2.18.0', latestStable: 'v2.18.0' },
);
run(
  'a four-part tag without its base is invalid and reported',
  '2.18.0', 'stable', '["2.18.0","2.19.0.0"]',
  { action: 'up-to-date', ignoreTag: '2.19.0.0', ignoreReasonPart: 'base 2.19.0' },
);
run(
  'hotfix .6 is outside the allowed range and ignored',
  '2.18.0', 'hotfix', '["2.18.0","2.18.0.6"]',
  { action: 'up-to-date', ignoreTag: '2.18.0.6', ignoreReasonPart: '.0 through .5' },
);
run(
  'prerelease suffixes are rejected for this release process',
  '2.18.0', 'stable', '["2.18.0","2.19.0-rc.1"]',
  { action: 'up-to-date', ignoreTag: '2.19.0-rc.1', ignoreReasonPart: 'prerelease' },
);

// -- Parser direct checks (parse-version.mjs) ---------------------------------
const { parseVersion, compareVersions } = await import(join(here, 'release', 'parse-version.mjs'));
const parserChecks = [
  ['2.17.7', { valid: true, three: true, four: false, hotfix: null }],
  ['v2.17.7', { valid: true, three: true, four: false, hotfix: null }],
  ['2.17.7.0', { valid: true, three: false, four: true, hotfix: 0 }],
  ['v2.18.0.0', { valid: true, three: false, four: true, hotfix: 0 }],
  ['2.18.0.5', { valid: true, three: false, four: true, hotfix: 5 }],
  ['2.18.0.6', { valid: false }],
  ['2.18.0-rc.1', { valid: false }],
  ['2.18', { valid: false }],
  ['', { valid: false }],
];
for (const [input, want] of parserChecks) {
  const p = parseVersion(input);
  if (p.valid !== want.valid) {
    failures += 1;
    console.error(`[FAIL] parseVersion("${input}") valid=${p.valid}, expected ${want.valid}`);
    continue;
  }
  if (want.valid) {
    if (p.isValidThreePart !== want.three || p.isValidFourPartHotfix !== want.four || p.hotfix !== want.hotfix) {
      failures += 1;
      console.error(`[FAIL] parseVersion("${input}") shape mismatch: ${JSON.stringify(p)}`);
    }
  } else if (!p.reason) {
    failures += 1;
    console.error(`[FAIL] parseVersion("${input}") rejected without a reason`);
  }
}

// Ordering: hotfix .0 equals the base, .1 above it, never below.
const pairs = [
  ['2.18.0', '2.18.0.0', 0],
  ['2.18.0.0', '2.18.0.1', -1],
  ['2.18.0.1', '2.18.0', 1],
  ['2.17.7', '2.18.0', -1],
  ['2.18.0.2', '2.18.0.1', 1],
];
for (const [a, b, want] of pairs) {
  const got = compareVersions(parseVersion(a), parseVersion(b));
  if (got !== want) {
    failures += 1;
    console.error(`[FAIL] compareVersions(${a}, ${b}) = ${got}, expected ${want}`);
  }
}

if (failures > 0) {
  console.error('');
  console.error(`[FAIL] Release selection self-check: ${failures} failure(s). The release rules regressed - DO NOT ship an updater built from this tree.`);
  process.exit(1);
}
console.log('');
console.log('[OK] Release selection self-check passed: the updater follows the release rules.');
