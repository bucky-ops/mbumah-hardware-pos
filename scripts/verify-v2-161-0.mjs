#!/usr/bin/env node
// v2.161.0 verification — "the payslip goes home".
// Fresh-written (lesson 25). Pins the self-service payslip PDF route, the
// honest issuance flags, the portal dialog affordance, and the documented
// Lighthouse re-measure.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

check("version: package.json leads 2.161.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.161.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.161.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.161.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-161-0"], "verify:v2-161-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.161.0] The payslip goes home"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.161.0'"), "whats-new head missing");
  assert(feed.indexOf("2.161.0") < feed.indexOf("2.160.0"), "2.161.0 is not the feed head");
});

check("counters re-anchored (50/51/52/83)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(50)"), "2.110.0 anchor not 50");
  assert(t.includes("toBe(83)"), "2.77.0 anchor not 83");
});

check("the self-service PDF route: guard, own-data scope, NOT_ISSUED gate", () => {
  const r = read("src/app/api/self-service/me/payslips/[id]/pdf/route.ts");
  assert(r.includes("selfServiceGuard('hr.payroll.read.own')"), "guard wrong");
  assert(r.match(/where:\s*\{\s*id,\s*employeeId:\s*employee\.id\s*\}/), "own-data scope missing");
  assert(r.includes("'NOT_ISSUED'") && r.includes("status: 409"), "NOT_ISSUED gate missing");
  assert(r.includes("buildPayslipView") && r.includes("buildPayslipPdf"), "canonical builders missing");
  assert(r.includes("hasHrPermission(session.role, 'hr.employee.unmask.pii')"), "server-side unmask computation missing");
  assert(!/hrGuard\(|maskValue|REDACTED/.test(r), "route must NOT re-implement HR masking");
});

check("the honest issuance flag rides both payloads", () => {
  const s = read("src/lib/hr/self-service.ts");
  const listPart = s.split("listMyPayslips")[1] || "";
  const detailPart = s.split("getMyPayslip")[1] || "";
  assert((listPart.match(/issued:\s*p\.payslipIssuedAt\s*!==\s*null/g) || []).length >= 1, "list flag missing");
  assert((detailPart.match(/issued:\s*p\.payslipIssuedAt\s*!==\s*null/g) || []).length >= 1, "detail flag missing");
  assert(s.includes("issuedAt: toIso(p.payslipIssuedAt) ?? p.createdAt.toISOString()"), "issuedAt fallback changed");
});

check("the portal dialog affordance is honest in all three states", () => {
  const v = read("src/app/(selfservice)/employees/me/payslips/payslips-view.tsx");
  assert(v.includes("detail.issued === true") && v.includes('data-testid="selfservice-payslip-pdf"'), "download state missing");
  assert(v.includes("detail.issued === false") && v.includes('data-testid="selfservice-payslip-pdf-pending"'), "pending note missing");
  const rowBlock = (v.split('<ul className="space-y-3"')[1] || "").split("</ul>")[0] || "";
  assert(!rowBlock.includes("<a"), "row must stay a pure button (no anchor inside)");
  assert(v.includes("border-emerald-300 bg-emerald-50") && v.includes("dark:border-emerald-800"), "dark pairs missing");
  assert(/p\.issued\s*\?\s*` · Issued /.test(v), "issued-date line missing");
});

check("the Lighthouse re-measure is documented with the verdict", () => {
  const d = read("docs/hr/self-service.md");
  assert(d.match(/v2\.161\.0 SSR-complete\*\* \| \*\*92\*\* \| \*\*100\*\* \| 96 \| 100/), "history row missing");
  assert(d.includes("spec acceptance 10 (Lighthouse above 90) HOLDS"), "verdict missing");
  assert(d.includes("_vercel"), "BP environment note missing");
  assert(d.includes("NOT_ISSUED"), "PDF contract missing");
  assert(d.includes("hr.employee.unmask.pii"), "masking posture missing");
});

check("the QA seed covers both paths", () => {
  assert(existsSync(join(process.cwd(), "scripts/seed-e2e-v161.cjs")), "seed missing");
  const s = read("scripts/seed-e2e-v161.cjs");
  assert(s.includes("'MBH-1-005'") && s.includes("'PS-2026-0901'") && s.includes("'POSTED'"), "seed shape wrong");
});

check("the new test suite exists and names the round", () => {
  const t = read("src/tests/selfservice-payslip-pdf-v2161.test.ts");
  assert(t.includes("selfservice-payslip-pdf-v2161"), "suite name missing");
  assert(t.includes("v2.161.0"), "round header missing");
  assert((t.match(/it\(/g) || []).length >= 14, "expected >=14 tests");
});

console.log(`\nverify-v2-161-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
