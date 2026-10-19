#!/usr/bin/env node
// v2.154.0 verification — "buttons that read in the dark".
// Fresh-written (lesson 25). Pins the dark-theme button pairs (primary +
// accent-orange foregrounds), the login-screen glass sweep, and the CSV's
// desk-report section + Open follow-up.

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
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

check("version: package.json leads 2.154.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.154.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.154.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.154.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-154-0"], "verify:v2-154-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.154.0] Buttons that read in the dark"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.154.0'"), "whats-new head missing");
  assert(feed.indexOf("2.154.0") < feed.indexOf("2.153.0"), "2.154.0 is not the feed head");
});

check("counters re-anchored (43/44/45/76)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(43)"), "2.110.0 anchor not 43");
  assert(t.includes("toBe(76)"), "2.77.0 anchor not 76");
  assert(t.includes("2.154.0 \"buttons that read in the dark\" joining the feed"), "re-anchor comment missing");
});

check("dark primary pair: cool near-black foreground on the mid blue", () => {
  const css = read("src/app/globals.css");
  const darkAt = css.indexOf("--primary: oklch(0.65 0.15 260);");
  assert(darkAt > 0, "dark --primary not found");
  const window = css.slice(darkAt, darkAt + 800);
  assert(window.includes("--primary-foreground: oklch(0.155 0.03 260);"), "dark primary-foreground not flipped");
  // the light pair is untouched
  assert(css.includes("--primary: oklch(0.295 0.1 260);\n  --primary-foreground: oklch(0.985 0 0);"), "light pair disturbed");
});

check("dark accent-orange pair mirrors the light block", () => {
  const css = read("src/app/globals.css");
  const lightAt = css.indexOf("--accent-orange-foreground: oklch(0.175 0.05 55);");
  assert(lightAt > 0, "light accent-orange-foreground missing");
  const darkHalf = css.slice(css.indexOf(".dark {"));
  assert(darkHalf.includes("--accent-orange-foreground: oklch(0.175 0.05 55);"), "dark accent-orange-foreground not mirrored");
});

check("login glass sweep: foreground alphas in the footer, brighter dark-gradient texts", () => {
  const src = stripComments(read("src/components/login-screen.tsx"));
  assert(src.includes("text-[11px] text-foreground/80"), "footer foreground/80 missing");
  assert(!src.includes("text-muted-foreground/70"), "footer muted/70 still present");
  assert(!src.includes("text-muted-foreground/30"), "separator muted/30 still present");
  assert((src.match(/text-foreground\/50/g) ?? []).length === 2, "separators not on /50");
  assert(src.includes("text-xs text-white/70 font-medium tracking-wider"), "branding not on white/70");
  assert(src.includes("text-[10px] text-white/55 tracking-wider"), "version badge not on white/55");
  assert(!/className="[^"]*text-white\/40/.test(src), "branding still white/40");
  assert(!/className="[^"]*text-white\/25/.test(src), "badge still white/25");
  assert(src.includes("rounded-md p-1 text-destructive transition-colors"), "dismiss icon not solid");
  assert(!/className="[^"]*text-destructive\/70/.test(src), "dismiss icon still alpha");
});

check("branches CSV: the desk section contract", () => {
  const lib = stripComments(read("src/lib/org/branches-csv.ts"));
  assert(lib.includes("BranchDeskCsvBlock"), "BranchDeskCsvBlock missing");
  assert(lib.includes("desk?: BranchDeskCsvBlock | null"), "desk param missing");
  assert(lib.includes("`Desk report — ${desk.label}`"), "desk header missing");
  assert(lib.includes("'Branch,Visits (yesterday)'"), "per-branch header missing");
  assert(lib.includes("? 'None'") || lib.includes("          : 'None',"), "honest None missing");
});

check("org console: the handler rides review-activity and follows up", () => {
  const org = stripComments(read("src/components/workspace/org-console.tsx"));
  assert(org.includes("authorizedFetchJson('/api/org/review-activity')"), "review-activity fetch missing");
  assert(org.includes("if (!desk) deskNote"), "honest deskNote missing");
  assert(org.includes("data-testid=\"org-console-export-open\""), "Open link missing");
  assert(org.includes('aria-label="Open the exported CSV in a new tab"'), "Open aria-label missing");
  assert(org.includes('rel="noopener noreferrer"'), "noopener missing");
  assert(org.includes("if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);"), "revoke-previous missing");
  assert(org.includes("disabled={exporting}"), "busy guard missing");
  const stale = org.match(/\n    URL\.revokeObjectURL\(url\);\n    setExportNote/);
  assert(!stale, "old always-revoke still kills the Open link");
});

check("test suite mounts the v2.154.0 contract", () => {
  const t = read("src/tests/console-org-v2154.test.ts");
  assert(t.includes("Buttons that read in the dark") || t.includes("v2.154.0"), "suite header missing");
  const its = (t.match(/\bit\(/g) ?? []).length;
  assert(its >= 13, `expected >= 13 its, found ${its}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
