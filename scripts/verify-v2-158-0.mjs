#!/usr/bin/env node
// v2.158.0 verification — "the wake-up call gets through".
// Fresh-written (lesson 25). Pins the proxy cron pass-through (the fix that
// revives every scheduled job in production) and the release surfaces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

check("version: package.json leads 2.158.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.158.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.158.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.158.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-158-0"], "verify:v2-158-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.158.0] The wake-up call gets through"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.158.0'"), "whats-new head missing");
  assert(feed.indexOf("2.158.0") < feed.indexOf("2.157.0"), "2.158.0 is not the feed head");
});

check("counters re-anchored (47/48/49/80)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(47)"), "2.110.0 anchor not 47");
  assert(t.includes("toBe(80)"), "2.77.0 anchor not 80");
});

check("the proxy passes /api/cron/ past the session gate (the fix)", () => {
  const src = read("src/proxy.ts");
  assert(src.includes("const isCronPath = pathname.startsWith('/api/cron/');"), "cron-path check missing");
  // the guard must be in the Layer 5 condition — the cron exemption and the
  // public-path exemption must appear in the SAME if
  const i = src.indexOf("const isCronPath");
  const j = src.indexOf("if (!isPublicPath && !isCronPath) {", i);
  assert(j > i && j - i < 400, "cron exemption not wired into the auth condition");
  assert(!src.slice(i, j).includes("if (!isPublicPath && !isCronPath)"), "condition placed before the comment");
  // the comment documents the contract
  assert(src.includes("Vercel Cron sends UNAUTHENTICATED GETs"), "contract comment missing");
  // defense in depth: the route-level gates are untouched
  const route = read("src/app/api/cron/b2c-recovery/route.ts");
  assert(route.includes("request.headers.get('x-cron-secret')"), "route secret gate disturbed");
  assert(route.includes("Forbidden: invalid or missing x-cron-secret header."), "route 403 body disturbed");
});

check("no OTHER auth surface was weakened", () => {
  const src = read("src/proxy.ts");
  // PUBLIC_PATHS must NOT have grown (the exemption is the isCronPath guard, not a list entry)
  const i = src.indexOf("const PUBLIC_PATHS");
  const j = src.indexOf("];", i);
  const arr = src.slice(i, j);
  assert(!arr.includes("/api/cron"), "PUBLIC_PATHS grew a cron entry");
  assert((src.match(/isCronPath/g) ?? []).length === 2, "isCronPath count drifted (declaration + condition expected)");
});

check("the lifecycle doc still carries the full family ledger", () => {
  const doc = read("docs/payroll-run-lifecycle.md");
  assert(doc.includes("## The B2C auto-recovery contract (v2.155.0)"), "recovery contract missing");
  assert(doc.includes("## The amber + muted-alpha families (v2.156.0)"), "amber contract missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
