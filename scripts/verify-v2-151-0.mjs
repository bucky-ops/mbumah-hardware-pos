#!/usr/bin/env node
// v2.151.0 verification — "the last slate family".
// Fresh-written (lesson 25). Pins the experts/primitives slate sweep, the
// desk-report pairs that must survive, and the release surfaces.

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

check("version: package.json leads 2.151.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.151.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.151.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.151.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-151-0"], "verify:v2-151-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.151.0] The last slate family"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.151.0'"), "whats-new head missing");
  assert(feed.indexOf("2.151.0") < feed.indexOf("2.150.0"), "2.151.0 is not the feed head");
});

check("counter test re-anchored (40/41/42/73)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(40)"), "2.110.0 anchor not 40");
  assert(t.includes("toBe(73)"), "2.77.0 anchor not 73");
});

check("experts + primitives carry zero bare text-slate-400", () => {
  for (const f of ["src/components/org/experts.tsx", "src/components/org/primitives.tsx"]) {
    const src = read(f);
    const bare = src.match(/(^|[^:-])text-slate-400/g)?.length ?? 0;
    assert(bare === 0, `${f} still carries ${bare} bare text-slate-400`);
  }
});

check("the desk-report deliberate dark pairs survive", () => {
  const src = read("src/components/org/desk-report-view.tsx");
  assert((src.match(/text-slate-400 dark:text-slate-500/g)?.length ?? 0) >= 2, "desk-report pairs lost");
});

check("prior round contracts still stand (shell + wrappers + regions)", () => {
  const shell = read("src/components/console/unified-console.tsx");
  assert(shell.includes("w-full min-w-0 flex-1"), "shell width contract lost");
  const org = read("src/components/workspace/org-console.tsx");
  assert((org.match(/role="region"/g)?.length ?? 0) === 2, "region roles lost");
  assert(org.includes("flex max-w-full min-w-0 flex-wrap items-center gap-2"), "header wrap lost");
});

check("the follow-up test suite pins the contract", () => {
  const t = read("src/tests/console-org-v2151.test.ts");
  assert(t.includes("v2.151.0"), "suite does not speak the version");
});

console.log(`\nverify-v2-151-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
