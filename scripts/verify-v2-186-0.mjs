#!/usr/bin/env node
// v2.186.0 verification — "the reviewer roster rides".
// Fresh-written per the house convention. Pins the full per-reviewer roster
// riding end to end: the read exposes yesterday.reviewerRows (additive,
// bounded, loudest-first — the reviewers COUNT keeps its meaning), the
// digest strip draws the share-bar roster, the branches CSV files the
// "Reviews by reviewer" sub-section with lib-computed shares, and the
// export's parse keeps only provably sound rows.
// Comment-strip per lesson 49; comment-text pins trimmed to survive
// line-wraps.
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

check("version: package.json leads 2.186.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.186.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.186.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.186.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-186-0"], "verify:v2-186-0 script missing");
  assert(pkg.scripts["verify:v2-185-0"], "verify:v2-185-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.186.0] The reviewer roster rides"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.186.0]") < changelog.indexOf("## [2.185.0]"), "2.186.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.186.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The reviewer roster rides'"), "whats-new title missing");
  assert(feed.indexOf("2.186.0") < feed.indexOf("2.185.0"), "2.186.0 is not the feed head");
});

check("the read: reviewerRows additive, bounded, ordered - the count keeps its meaning", () => {
  const route = read("src/app/api/org/review-activity/route.ts");
  assert(route.includes("const digestReviewers = [...reviewerDigest.entries()]"), "digestReviewers derivation missing");
  assert(route.includes(".slice(0, 24)"), "the 24-row cap missing");
  assert(route.includes(".map(([name, visits]) => ({ name, visits }))"), "row shape missing");
  assert(route.includes("reviewerRows: digestReviewers,"), "reviewerRows payload field missing");
  assert(route.includes("reviewers: reviewerDigest.size,"), "the reviewers COUNT must keep its meaning");
  assert(route.indexOf("reviewerRows: digestReviewers,") !== route.indexOf("reviewers: reviewerDigest.size,"), "the two fields must be distinct keys");
});

check("the digest strip: the share-bar roster, gated and honest", () => {
  const panels = read("src/components/org/panels.tsx");
  assert(panels.includes('{yesterday.reviewerRows && yesterday.reviewerRows.length > 1 && ('), "the >1-reviewer + optional gate missing");
  assert(panels.includes('data-testid="desk-digest-roster"'), "roster testid missing");
  assert(panels.includes('data-testid="desk-digest-roster-row"'), "roster row testid missing");
  assert(panels.includes("const share = yesterday.visits > 0 ? Math.round((r.visits / yesterday.visits) * 100) : 0;"), "share math missing");
  assert(panels.includes("style={{ width: `${Math.min(100, share)}%` }}"), "the width cap missing");
  assert(panels.includes("yesterday.reviewerRows.slice(0, 6)"), "the six-row render missing");
  assert(panels.includes("+{yesterday.reviewerRows.length - 6} more reviewer"), "the +N more honesty missing");
});

check("the type: reviewerRows OPTIONAL", () => {
  const types = read("src/components/org/primitives.tsx");
  assert(types.includes("reviewerRows?: Array<{ name: string; visits: number }>;"), "optional reviewerRows field missing");
});

check("the branches CSV: the offline twin with lib-computed shares", () => {
  const lib = read("src/lib/org/branches-csv.ts");
  assert(lib.includes("reviewerRows?: ReadonlyArray<{ name: string; visits: number }>"), "the block's optional reviewerRows field missing");
  assert(lib.includes("'Reviews by reviewer,Reviewer,Visits,Share (%)'"), "the sub-section header missing");
  assert(lib.includes("Math.round((r.visits / desk.visits) * 10000) / 100"), "the lib-computed share missing");
  assert(lib.includes("desk.reviewerRows && desk.reviewerRows.length > 0 && desk.visits > 0"), "the zero-visit + absence gate missing");
});

check("the export parse: only provably sound rows survive", () => {
  const comp = read("src/components/workspace/org-console.tsx");
  assert(comp.includes("Array.isArray(y.reviewerRows)"), "the array gate missing");
  assert(comp.includes("typeof r?.name === 'string' && typeof r?.visits === 'number'"), "the sound-row filter missing");
  assert(comp.includes(": undefined,"), "the absent-field tolerance missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/reviewer-roster-v2186.test.ts");
  assert(suite.includes("the reviewer roster rides"), "suite header missing");
  assert(suite.includes("reviewerRows: digestReviewers,"), "the additive-naming pin missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
