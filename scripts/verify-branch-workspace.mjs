#!/usr/bin/env node
// MBUMAH HARDWARE POS - Branch workspace verification (v2.18.0.0)
//
// A practical, read-only wrapper for the branch workspace correction release:
//   1. Prints the workspace-relevant environment summary (parsed from .env
//      when the file exists; runtime process.env is what the app actually
//      reads - this is a convenience view, not a substitute for it).
//   2. Runs the hygiene sweeps: code files (src/, scripts/) must contain no
//      "stores/undefined" or "stores/null" link building; markdown mentions
//      of the old bug in docs/ and CHANGELOG.md are reported as informational
//      context, not failures.
//   3. Reminds you that the deep logic tests (link builder safety checks +
//      resolver reasonCode matrix) run under vitest, and prints the commands.
//
// Exit code 0 = clean, 1 = hygiene findings. The script NEVER modifies files
// and NEVER touches the database or the hosts file.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENV_KEYS = [
  'NEXT_PUBLIC_USE_SUBDOMAINS',
  'NEXT_PUBLIC_STORE_WORKSPACE_MODE',
  'NEXT_PUBLIC_ROOT_DOMAIN',
  'NEXT_PUBLIC_APP_URL',
  'NEXTAUTH_URL',
  'ALLOWED_HOSTS',
  'TRUST_X_FORWARDED_HOST',
  'NEXTAUTH_COOKIE_DOMAIN',
  'NEXTAUTH_COOKIE_SECURE',
  'NEXTAUTH_COOKIE_SAME_SITE',
];

const HYGIENE_PATTERN = /stores\/(undefined|null)/;
const HYGIENE_SOURCE = 'stores/undefined|stores/null';
const SELF = 'scripts/verify-branch-workspace.mjs';
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];

function filterSelf(findings) {
  return findings.filter((f) => !f.includes(SELF));
}

function parseDotEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (ENV_KEYS.includes(key)) values[key] = value;
  }
  return values;
}

function walkFiles(dir, files = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      walkFiles(full, files);
    } else if (st.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function sweepWithRg(targets, globs) {
  const args = ['-n', HYGIENE_SOURCE];
  for (const glob of globs) args.push('--glob', glob);
  args.push(...targets);
  const result = spawnSync('rg', args, {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  // ok is derived from the FILTERED findings: the script's own pattern string
  // (this file quoting the sweep) is excluded, so a self-match never fails.
  if (result.status === 0) {
    const findings = filterSelf(result.stdout.trim().split('\n').filter(Boolean));
    return { findings, ok: findings.length === 0 };
  }
  if (result.status === 1) return { findings: [], ok: true };
  return null; // rg unavailable or failed to run
}

function sweepWithNode(targets, extensions) {
  const findings = [];
  for (const target of targets) {
    const abs = join(repoRoot, target);
    if (!existsSync(abs)) continue;
    for (const file of walkFiles(abs)) {
      if (file.endsWith(SELF)) continue;
      if (extensions && !extensions.some((ext) => file.endsWith(ext))) continue;
      let lines;
      try {
        lines = readFileSync(file, 'utf8').split(/\r?\n/);
      } catch {
        continue;
      }
      lines.forEach((line, i) => {
        if (HYGIENE_PATTERN.test(line)) findings.push(`${file}:${i + 1}:${line.trim()}`);
      });
    }
  }
  return { findings, ok: findings.length === 0 };
}

function main() {
  console.log('MBUMAH HARDWARE POS - branch workspace verification');
  console.log('');

  console.log('1. Workspace environment (.env when present; unset keys shown as -)');
  const envValues = parseDotEnv(join(repoRoot, '.env'));
  for (const key of ENV_KEYS) {
    const value = envValues[key];
    console.log(`   ${key}=${value === undefined || value === '' ? '-' : value}`);
  }
  console.log('   Safe local defaults: path mode everywhere; subdomain URLs never');
  console.log('   generated on localhost, 127.0.0.1 or raw IP addresses.');
  console.log('');

  console.log('2. Hygiene sweeps (no placeholder link building in code)');
  const codeSweep =
    sweepWithRg(['src', 'scripts'], ['*.ts', '*.tsx', '*.mjs', '*.js']) ??
    sweepWithNode(['src', 'scripts'], CODE_EXTENSIONS);
  if (codeSweep.findings.length === 0) {
    console.log('   PASS: 0 findings in src/ and scripts/ code files.');
  } else {
    for (const finding of codeSweep.findings) console.log(`   FAIL: ${finding}`);
    console.log(`   ${codeSweep.findings.length} finding(s).`);
  }
  const docSweep =
    sweepWithRg(['docs', 'CHANGELOG.md'], ['*.md']) ??
    sweepWithNode(['docs'], ['.md']);
  console.log(
    `   INFO: ${docSweep.findings.length} markdown mention(s) in docs/ and CHANGELOG.md (release notes quoting the fixed bug are expected).`,
  );
  console.log('   Reserved-subdomain handling: RESERVED_SUBDOMAINS in');
  console.log('   src/lib/workspace/config.ts (admin, api, www, ...) is enforced by');
  console.log('   both the host resolver and src/lib/branch-workspace.ts - reserved');
  console.log('   labels never become branch subdomains (path fallback instead).');
  console.log('');

  console.log('3. Deep logic tests (vitest; not re-run here)');
  console.log('   Full suite:        bun run test');
  console.log('   Targeted run:      bunx vitest run src/tests/lib/branch-workspace.test.ts');
  console.log('   Covers: link builder safety checks (localhost / raw IP / reserved');
  console.log('   labels / missing slug / inactive stores) and the resolver');
  console.log('   reasonCode matrix (store-not-found, store-inactive,');
  console.log('   user-not-allowed, missing-slug, schema-drift).');
  console.log('');

  if (!codeSweep.ok) {
    console.log('RESULT: hygiene findings above need attention (exit 1).');
    process.exit(1);
  }
  console.log('RESULT: clean (exit 0).');
}

main();
