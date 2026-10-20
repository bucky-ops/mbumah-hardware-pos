#!/usr/bin/env node
// v2.162.0 verification — "the portal's thirty minutes".
// Fresh-written (lesson 25). Pins the self-service idle contract: the pure
// module, both guards' enforcement + slide, the client watch's literal hook
// reuse, the surface scoping, the docs section, and the login glass-card
// contrast fixes.
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

check("version: package.json leads 2.162.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.162.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.162.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.162.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-162-0"], "verify:v2-162-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.162.0] The portal's thirty minutes"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.162.0'"), "whats-new head missing");
  assert(feed.indexOf("2.162.0") < feed.indexOf("2.161.0"), "2.162.0 is not the feed head");
});

check("counters re-anchored (51/52/53/84)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(51)"), "2.110.0 anchor not 51");
  assert(t.includes("toBe(84)"), "2.77.0 anchor not 84");
});

check("the pure module: same 30-min cadence, honest degradation, stable 401 code", () => {
  const m = read("src/lib/session-idle.ts");
  assert(m.includes("export const SELF_SERVICE_IDLE_MS = 30 * 60 * 1000"), "cadence not 30min");
  assert(m.includes("export function idleExpired("), "idleExpired missing");
  assert(m.includes("export const SESSION_IDLE_EXPIRED_CODE = 'SESSION_IDLE_EXPIRED'"), "code missing");
  assert(m.includes("Signed out after 30 minutes of inactivity"), "human sentence missing");
  // lesson 49: strip comments, then assert the module body has no clock reads
  const body = m.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!body.includes("Date.now()"), "module reads Date.now() — must take now");
  assert(!body.includes("db.") && !body.includes("fetch("), "module is not pure");
});

check("both auth readers surface sessionId + lastActiveAt", () => {
  const a = read("src/lib/auth.ts");
  const populated = a.match(/mustChangePassword: session\.user\.mustChangePassword,\n    sessionId: session\.id,\n    lastActiveAt: session\.lastActiveAt,/g);
  assert(populated && populated.length === 2, `readers populated ${populated ? populated.length : 0}/2`);
  assert(a.includes("sessionId?: string;") && a.includes("lastActiveAt?: Date;"), "optional fields missing");
});

check("the API guard: idle check → delete row + 401, fresh → slide", () => {
  const s = read("src/lib/hr/self-service.ts");
  const guard = s.slice(s.indexOf("export function selfServiceGuard"));
  assert(guard.includes("idleExpired(session.lastActiveAt, new Date(), SELF_SERVICE_IDLE_MS)"), "idle check missing");
  assert(/db\.session\s*\n\s*\.delete\(\{\s*where:\s*\{\s*id:\s*session\.sessionId\s*\}\s*\}\)/.test(guard), "row delete missing");
  assert(guard.includes("sessionIdleExpiredResponse()"), "401 shape not used");
  assert(/data:\s*\{\s*lastActiveAt:\s*new Date\(\)\s*\}/.test(guard), "slide missing");
});

check("the SSR portal guard: honest idle note, same delete + slide", () => {
  const p = read("src/app/(selfservice)/employees/me/self-portal.tsx");
  assert(p.includes("Signed out for your safety"), "idle note title missing");
  assert(p.includes("idleExpired(session.lastActiveAt, new Date(), SELF_SERVICE_IDLE_MS)"), "SSR idle check missing");
  assert(/db\.session\s*\n\s*\.delete\(\{\s*where:\s*\{\s*id:\s*session\.sessionId\s*\}\s*\}\)/.test(p), "SSR row delete missing");
  assert(/data:\s*\{\s*lastActiveAt:\s*new Date\(\)\s*\}/.test(p), "SSR slide missing");
});

check("the client watch reuses the till hook and posts logout", () => {
  const w = read("src/components/hr/self-service-idle-watch.tsx");
  assert(w.includes("import { useIdleTimeout } from '@/hooks/use-idle-timeout';"), "hook not reused");
  assert(w.includes("useIdleTimeout(handleIdleTimeout)"), "hook not wired");
  assert(/fetch\('\/api\/auth\/logout',\s*\{\s*method:\s*'POST',\s*keepalive:\s*true\s*\}\)/.test(w), "logout POST missing");
  assert(w.includes('role="alertdialog"') && w.includes('aria-modal="true"'), "alertdialog contract missing");
  assert(w.includes('data-testid="self-idle-signin"'), "sign-in affordance missing");
  assert(w.includes("headingRef.current?.focus()"), "focus management missing");
});

check("mounted once in the slim providers; the till is untouched", () => {
  const prov = read("src/lib/providers-selfservice.tsx");
  assert(prov.includes("<SelfServiceIdleWatch />"), "watch not mounted");
  const app = read("src/components/app/main-app.tsx");
  assert(app.includes("useIdleTimeout(handleIdleTimeout)"), "till hook missing");
  assert(app.includes("mbt:session-expired"), "till contract changed");
  assert(!app.includes("session-idle"), "till imports the new module — surface scoping broken");
});

check("docs answer the spec (843.6 / 1068.7) in the thirty-minute contract", () => {
  const d = read("docs/hr/self-service.md");
  assert(d.includes("## The thirty-minute contract (v2.162.0)"), "section missing");
  assert(d.includes("843.6") && d.includes("1068.7"), "spec lines not cited");
  assert(d.includes("SESSION_IDLE_EXPIRED"), "401 code not documented");
});

check("the login glass-card contrast fixes are pinned in code", () => {
  const l = read("src/components/login-screen.tsx");
  assert(l.includes("text-foreground/90 underline underline-offset-2"), "forgot link fix missing");
  assert(l.includes("text-red-800 dark:text-destructive"), "dismiss X fix missing");
  assert(/<span className="text-foreground\/80" aria-hidden="true">·<\/span>/.test(l), "dots fix missing");
  assert(l.includes('text-sm text-foreground/80'), "footer base fix missing");
  const css = read("src/app/globals.css");
  assert(css.includes(".login-input::placeholder"), "placeholder rule missing");
  assert(css.includes("color-mix(in oklab, var(--foreground) 80%, transparent)"), "placeholder color wrong");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
