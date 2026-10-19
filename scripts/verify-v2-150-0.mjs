#!/usr/bin/env node
// v2.150.0 verification — "the header wraps too".
// Fresh-written this round (lesson 25). Pins the v2.149.0 re-audit's two
// follow-ups: the header right group that wraps (the measured 435px
// unmasked pusher) and the scroll wrappers whose names became legal
// (role="region"). Double-quoted strings throughout (lesson 61 amendment).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');

const ORG = "src/components/workspace/org-console.tsx";

check("version: package.json leads 2.150.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.150.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.150.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.150.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-150-0"], "verify:v2-150-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.150.0] The header wraps too"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.150.0'"), "whats-new head missing");
  assert(feed.indexOf("2.150.0") < feed.indexOf("2.149.0"), "2.150.0 is not the feed head");
});

check("counter test re-anchored to the new head (39/40/41/72)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(39)"), "2.110.0 anchor not 39");
  assert(t.includes("expect(whatsNewUnreadCount('2.109.0')).toBe(40)"), "2.109.0 anchor not 40");
  assert(t.includes("expect(whatsNewUnreadCount('2.108.0')).toBe(41)"), "2.108.0 anchor not 41");
  assert(t.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(72)"), "2.77.0 anchor not 72");
});

check("header right group wraps and cannot push (max-w-full min-w-0 flex-wrap)", () => {
  const org = stripComments(read(ORG));
  assert(org.includes("flex max-w-full min-w-0 flex-wrap items-center gap-2"), "group lacks the wrap trio");
  assert(org.includes("max-w-full whitespace-normal text-xs"), "role Badge cannot wrap inside itself");
});

check("both scroll wrappers are role=region (names are legal now)", () => {
  const org = stripComments(read(ORG));
  const regions = org.match(/role="region"/g)?.length ?? 0;
  assert(regions === 2, `expected 2 role="region", found ${regions}`);
  assert(org.includes('aria-label="Branches, scrollable table"'), "branches name moved");
  assert(org.includes('aria-label="People and payroll by branch, scrollable table"'), "drill-down name moved");
  assert(org.includes("tabIndex={0}"), "scrollers no longer focusable");
});

check("the v2.149.0 width contract still stands underneath", () => {
  const shell = stripComments(read("src/components/console/unified-console.tsx"));
  assert(shell.includes("w-full min-w-0 flex-1"), "shell main lost its width contract");
  const org = stripComments(read(ORG));
  assert(org.includes("min-w-0 overflow-x-auto focus-visible:outline-none"), "branches wrapper lost min-w-0");
});

check("the follow-up test suite pins the contract", () => {
  const t = read("src/tests/console-org-v2150.test.ts");
  assert(t.includes("v2.150.0"), "suite does not speak the version");
  assert(t.includes("role=\"region\""), "region role unpinned");
});

console.log(`\nverify-v2-150-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
