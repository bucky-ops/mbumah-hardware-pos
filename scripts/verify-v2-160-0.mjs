#!/usr/bin/env node
// v2.160.0 verification — "the spec's own paths".
// Fresh-written (lesson 25). Pins the three spec-path aliases, the parity
// gate script, the login <main> landmark + aria-hidden decorations, and
// the visible keyboard beacon.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

check("version: package.json leads 2.160.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.160.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.160.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.160.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-160-0"], "verify:v2-160-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.160.0] The spec's own paths"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.160.0'"), "whats-new head missing");
  assert(feed.indexOf("2.160.0") < feed.indexOf("2.159.0"), "2.160.0 is not the feed head");
});

check("counters re-anchored (49/50/51/82)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(49)"), "2.110.0 anchor not 49");
  assert(t.includes("toBe(82)"), "2.77.0 anchor not 82");
});

check("alias /api/payroll/exports/p10 re-exports the canonical p10 handler", () => {
  const src = read("src/app/api/payroll/exports/p10/route.ts");
  assert(src.match(/export\s*\{\s*GET\s*\}\s*from\s*'[^']*hr\/reports\/p10\/route'/), "re-export shape wrong");
  assert(/export\s*const\s*dynamic\s*=\s*'force-dynamic'/.test(src), "local segment config missing");
  const spec = src.match(/from\s+'([^']+)'/)[1];
  const resolved = resolve(join(process.cwd(), "src/app/api/payroll/exports/p10", spec));
  assert(resolved.endsWith("src/app/api/hr/reports/p10/route"), `specifier resolves to ${resolved}`);
  assert(!/hrGuard|new Response|searchParams/.test(src), "alias must be a PURE re-export");
});

check("alias /api/payroll/exports/statutory re-exports the canonical statutory-liability handler", () => {
  const src = read("src/app/api/payroll/exports/statutory/route.ts");
  assert(src.match(/export\s*\{\s*GET\s*\}\s*from\s*'[^']*hr\/reports\/statutory-liability\/route'/), "re-export shape wrong");
  assert(/export\s*const\s*dynamic\s*=\s*'force-dynamic'/.test(src), "local segment config missing");
  const spec = src.match(/from\s+'([^']+)'/)[1];
  const resolved = resolve(join(process.cwd(), "src/app/api/payroll/exports/statutory", spec));
  assert(resolved.endsWith("src/app/api/hr/reports/statutory-liability/route"), `specifier resolves to ${resolved}`);
  assert(!/hrGuard|new Response|searchParams/.test(src), "alias must be a PURE re-export");
});

check("alias /api/payroll/liability-report re-exports the canonical statutory-liability handler", () => {
  const src = read("src/app/api/payroll/liability-report/route.ts");
  assert(src.match(/export\s*\{\s*GET\s*\}\s*from\s*'[^']*hr\/reports\/statutory-liability\/route'/), "re-export shape wrong");
  assert(/export\s*const\s*dynamic\s*=\s*'force-dynamic'/.test(src), "local segment config missing");
  const spec = src.match(/from\s+'([^']+)'/)[1];
  const resolved = resolve(join(process.cwd(), "src/app/api/payroll/liability-report", spec));
  assert(resolved.endsWith("src/app/api/hr/reports/statutory-liability/route"), `specifier resolves to ${resolved}`);
  assert(!/hrGuard|new Response|searchParams/.test(src), "alias must be a PURE re-export");
});

check("the spec-parity gate exists and covers both phases", () => {
  assert(existsSync(join(process.cwd(), "scripts/verify-spec-paths.mjs")), "verify-spec-paths.mjs missing");
  const s = read("scripts/verify-spec-paths.mjs");
  for (const p of ["/api/payroll/runs", "/api/payroll/payslips/[id]/trace", "/api/payroll/corrections",
    "/api/payroll/exports/p10", "/api/payroll/exports/statutory", "/api/payroll/liability-report", "/hr/payroll",
    "/api/hr/performance/cycles", "/api/hr/performance/reviews", "/api/hr/goals", "/api/hr/assets", "/api/hr/discipline",
    "/api/self-service/me", "/api/self-service/me/documents", "/employees/me", "/employees/me/documents"]) {
    assert(s.includes(`'${p}'`), `spec list missing ${p}`);
  }
  assert(s.includes("re-exports"), "alias binding section missing");
});

check("the login content column is a motion.main landmark", () => {
  const t = read("src/components/login-screen.tsx");
  assert(t.includes("<motion.main"), "motion.main missing");
  assert(t.includes("</motion.main>"), "closing motion.main missing");
  assert(t.includes("region"), "the region-find comment missing (honest history)");
});

check("the decorative background layers are aria-hidden", () => {
  const t = read("src/components/login-screen.tsx");
  assert(t.includes('aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden"'), "particles layer not hidden");
  assert(t.includes('aria-hidden="true" className="absolute inset-0 dot-grid-pattern pointer-events-none"'), "dot grid not hidden");
  assert(t.includes('aria-hidden="true" className="absolute inset-0 opacity-[0.03] pointer-events-none"'), "hardware pattern not hidden");
});

check("the keyboard beacon is visible (0.35/0.5 ring + 0.7 border)", () => {
  const css = read("src/app/globals.css");
  assert(css.includes("box-shadow: 0 0 0 2px oklch(0.68 0.18 55 / 0.35);"), "ring floor not 0.35");
  assert(css.includes("box-shadow: 0 0 0 3px oklch(0.68 0.18 55 / 0.5);"), "ring peak not 0.5");
  assert(!css.includes("box-shadow: 0 0 0 2px oklch(0.68 0.18 55 / 0.15);"), "old ambient 0.15 ring still present");
  assert(/\.login-input:focus\s*\{[^}]*oklch\(0\.68 0\.18 55 \/ 0\.7\)/s.test(css), "focus border not 0.7");
});

check("the docs fold + spec section landed", () => {
  const doc = read("docs/payroll-run-lifecycle.md");
  assert(doc.includes("docs/cron-operations.md"), "cron-operations pointer missing");
  assert(doc.includes("The spec's own paths (v2.160.0)"), "spec-paths section missing");
  assert(doc.includes("RE-EXPORT"), "alias shape not documented");
});

check("the new test suite exists and names the round", () => {
  const t = read("src/tests/alias-paths-v2160.test.ts");
  assert(t.includes("v2.160.0"), "round header missing");
  assert(t.includes("alias-paths-v2160"), "suite name missing");
  assert((t.match(/it\(/g) || []).length >= 12, "expected >=12 tests");
});

console.log(`\nverify-v2-160-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
