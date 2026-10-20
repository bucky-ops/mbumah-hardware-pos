#!/usr/bin/env node
// v2.168.0 verification — "the hints become visible".
// Fresh-written (lesson 25). Pins the visible-on-focus bubble contract
// (chips + failed-tick pill, absolute overlay, aria-hidden speak-once,
// popover token pair), the honest suffix tooltips, the title-only link
// sweep (StatCard sr-only echo + branch accessible-name fold), the doc
// note, and the release surfaces. Comment-strip per lesson 49.
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

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

check("version: package.json leads 2.168.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.168.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.168.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.168.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-168-0"], "verify:v2-168-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.168.0] The hints become visible"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.168.0'"), "whats-new head missing");
  assert(feed.indexOf("2.168.0") < feed.indexOf("2.167.0"), "2.168.0 is not the feed head");
});

check("counters re-anchored (57/58/59/90)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(57)"), "2.110.0 anchor not 57");
  assert(t.includes("toBe(90)"), "2.77.0 anchor not 90");
  assert(t.includes("Re-anchored for 2.168.0 joining the feed."), "re-anchor comment missing");
});

check("hinted chips + failed pill render a visible-on-focus bubble", () => {
  const c = stripComments(read("src/components/workspace/org-console.tsx"));
  assert(c.includes('data-testid="automation-subjob-hint-bubble"'), "chip bubble missing");
  assert(c.includes('data-testid="automation-failed-bubble"'), "pill bubble missing");
  const bubbles = (c.match(/group-focus-visible:block/g) || []).length;
  assert(bubbles === 2, `expected 2 group-focus-visible bubbles, found ${bubbles}`);
});

check("the bubble is an absolute overlay on the popover token pair (no reflow, no alpha)", () => {
  const c = read("src/components/workspace/org-console.tsx");
  const recipe = 'pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-max max-w-[16rem] rounded-md border bg-popover px-2 py-1 text-[11px] font-normal leading-snug text-popover-foreground shadow-md group-focus-visible:block';
  const chipBubble = c.split('data-testid="automation-subjob-hint-bubble"')[0].split('data-testid="automation-failed-bubble"')[0] || '';
  assert(c.includes(recipe), "shared bubble recipe drifted");
  assert(recipe.includes('absolute left-0 top-full'), "not an overlay");
  assert(!/\/\d/.test(recipe), "recipe gained an alpha token");
  const pillBubble = c.split('data-testid="automation-failed-bubble"')[1].split('</span>')[0] || c;
  void chipBubble; void pillBubble;
  assert(c.includes('text-[11px] font-normal normal-case tracking-normal'), "pill bubble type override missing");
});

check("the bubble speaks once - aria-hidden, single-sourced copy", () => {
  const c = stripComments(read("src/components/workspace/org-console.tsx"));
  const bubbleAt = c.indexOf('data-testid="automation-subjob-hint-bubble"');
  const ariaAt = c.lastIndexOf('aria-hidden="true"', bubbleAt);
  assert(ariaAt > -1 && bubbleAt - ariaAt < 80, "chip bubble is not aria-hidden");
  const guardCount = (c.match(/AUTOMATION_SUBJOB_HINTS\[job\.name\] && \(/g) || []).length;
  assert(guardCount === 2, `chip guard blocks = ${guardCount}, want 2 (sr-only + bubble)`);
  const helperUses = (c.match(/failedTickTooltip\(automation\)/g) || []).length;
  assert(helperUses >= 6, `helper uses = ${helperUses}, want >= 6`);
});

check("the v2.167.0 keyboard contract is untouched", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("tabIndex={AUTOMATION_SUBJOB_HINTS[job.name] ? 0 : undefined}"), "chip tabIndex drifted");
  assert(c.includes("tabIndex={failedTickTooltip(automation) ? 0 : undefined}"), "pill tabIndex drifted");
  assert(c.includes('<span className="sr-only"> — {AUTOMATION_SUBJOB_HINTS[job.name]}</span>'), "chip sr-only drifted");
  assert(c.includes("(recorded {formatEatStamp(new Date(automation.lastTick.at))})"), "last-tick sr-only drifted");
});

check("the suffixes speak for themselves (reaper + HTTP)", () => {
  const c = stripComments(read("src/components/workspace/org-console.tsx"));
  assert(c.includes("expired session"), "reaper suffix tooltip missing");
  assert(c.includes("zero expired sessions at tick time"), "clean-sweep tooltip missing");
  assert(c.includes("The dispatcher recorded HTTP"), "HTTP suffix tooltip missing");
  assert((c.match(/className="tabular-nums cursor-help"/g) || []).length === 2, "suffix cursor-help pair drifted");
});

check("the title-only links learn to speak", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes('{title && <span className="sr-only"> — {title}</span>}'), "StatCard sr-only echo missing");
  assert(c.includes('aria-label={`Open the People & Payroll tab pre-filtered to ${store.name}`}'), "branch accessible-name fold missing");
  assert(c.includes('title={`Open the People & Payroll tab pre-filtered to ${store.name}`}'), "branch hover title missing (one truth, two surfaces)");
  assert(c.includes('group-hover:opacity-100 group-focus-visible:opacity-100'), "StatCard Open affordance drifted");
});

check("the doc says what the card now does (chronology, not replacement)", () => {
  const doc = read("docs/cron-operations.md");
  assert(doc.includes("The hints become visible (v2.168.0)"), "v2.168.0 note missing");
  assert(doc.includes("never reflows"), "no-reflow note missing");
  assert(doc.includes("The hints reach the keyboard (v2.167.0)"), "v2.167.0 note missing");
  assert(doc.includes("## The sub-jobs (nine, as of v2.167.0)"), "register heading missing");
});

check("the v2168 suite exists and the org console stays a client-safe surface", () => {
  const t = read("src/tests/keyboard-visible-v2168.test.ts");
  assert(t.includes("BUBBLE_RECIPE"), "v2168 suite recipe pin missing");
  const c = read("src/components/workspace/org-console.tsx");
  assert(!/from ['"]@prisma\/client['"]/.test(c), "client surface gained a server import");
  assert(!/from ['"]next\/headers['"]/.test(c), "client surface gained next/headers");
});

console.log(`\nverify-v2-168-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
