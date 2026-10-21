// PHANTOM-MODEL SWEEP (v2.210.0) — the db.ts cast hides ALL missing delegates from tsc.
// This script compares every `db.<delegate>` usage across src/ against the models the
// Prisma schema actually declares. Any delegate that is used but has no model is a
// PHANTOM — a runtime 500 hiding behind `as unknown as PrismaClient` (the v2.209 lesson).
//
// Scope law: only files that IMPORT the Prisma client (`@/lib/db`) are scanned —
// client-side IndexedDB code has its own local `db` and is out of scope by
// construction, not by allowlist. Comments are stripped before matching so
// `@db.Decimal` in a JSDoc can never read as a delegate.
//
// Usage: node scripts/phantom-model-sweep.mjs
// Exit 1 when phantoms are found (CI-able), exit 0 when the sweep is clean.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCHEMA = join(ROOT, "prisma", "schema.prisma");
const SRC = join(ROOT, "src");

// ---------- 1. Models declared in the schema ----------
const schemaText = readFileSync(SCHEMA, "utf8");
const declaredModels = new Set();
for (const m of schemaText.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
  declaredModels.add(m[1]);
}
// The client extension / delegate names are camelCase of the model name.
const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const validDelegates = new Set([...declaredModels].map(camel));

// ---------- 2. Walk src/ ----------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}
const files = walk(SRC);

const usages = new Map(); // delegate -> [{file, line, text}]
let dynamicAccesses = [];
let scanned = 0;
const DB_CALL_RE = /\bdb\??\.([A-Za-z_$][\w$]*)/g;
const DB_BRACKET_RE_NO_STRINGS = /\bdb\??\[\s*([A-Za-z_$][\w$]*)\s*\]/g; // ident-keyed dynamic access
const DB_DYNAMIC_RE = /\bdb\??\[\s*(?!['"`])(?!$)/g;

// Strip comments from one file's text so JSDoc prose (`@db.Decimal`,
// `db.ts`, `scripts/backup-db.mjs`) can never read as a delegate access.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, "")) // block comments → newlines preserved
    .replace(/(^|\s)\/\/[^\n]*/g, "$1"); // line comments
}

// Additionally blank string literals (kept quote-shaped) so prose like
// it('the db.ts contract ...') can never read as a delegate access.
function stripStrings(text) {
  return text.replace(
    /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
    (m) => (m.startsWith("`") ? "``" : m.charAt(0) + m.charAt(0)),
  );
}

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  let text = readFileSync(file, "utf8");
  // SCOPE LAW: only files that import the Prisma client are scanned.
  if (!/(from\s*['"][^'"]*lib\/db['"]|require\(\s*['"][^'"]*lib\/db['"]\s*\))/.test(text)) continue;
  scanned++;
  const noComments = stripComments(text);
  const clean = stripStrings(noComments);
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(DB_CALL_RE)) {
      const name = m[1];
      if (name.startsWith("$")) continue; // $queryRaw, $transaction, ...
      if (!usages.has(name)) usages.set(name, []);
      usages.get(name).push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
    }
    for (const m of line.matchAll(DB_BRACKET_RE_NO_STRINGS)) {
      const name = m[1];
      if (name.startsWith("$")) continue;
      if (!usages.has(name)) usages.set(name, []);
      usages.get(name).push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
    }
    if (DB_DYNAMIC_RE.test(line)) {
      dynamicAccesses.push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
    }
  }
}

// Delegates that appear only in test files (mocks) are still reported but flagged.
const isTest = (u) => u.file.includes("/tests/") || u.file.endsWith(".test.ts") || u.file.endsWith(".test.tsx");

// ---------- 3. The verdict ----------
const phantoms = [];
for (const [name, sites] of [...usages.entries()].sort()) {
  if (!validDelegates.has(name)) phantoms.push({ name, sites });
}

console.log(`schema models: ${declaredModels.size}`);
console.log(`valid delegates: ${validDelegates.size}`);
console.log(`files scanned (import @/lib/db): ${scanned} of ${files.length} in src/`);
console.log(`distinct db.<delegate> names used: ${usages.size}`);
console.log(`dynamic db[...] accesses: ${dynamicAccesses.length}`);
for (const d of dynamicAccesses) console.log(`  dynamic: ${d.file}:${d.line} ${d.text}`);
console.log("");

if (phantoms.length === 0) {
  console.log("SWEEP CLEAN — every db.<delegate> maps to a declared model.");
  process.exit(0);
}

console.log(`PHANTOMS FOUND: ${phantoms.length}`);
for (const p of phantoms) {
  const prod = p.sites.filter((s) => !isTest(s));
  const test = p.sites.filter(isTest);
  console.log(`\n  ✗ db.${p.name} (no model "${p.name.charAt(0).toUpperCase() + p.name.slice(1)}" in schema)`);
  for (const s of prod) console.log(`      prod: ${s.file}:${s.line}  ${s.text}`);
  for (const s of test) console.log(`      test: ${s.file}:${s.line}  ${s.text}`);
}
process.exit(1);
