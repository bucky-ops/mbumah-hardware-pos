#!/usr/bin/env node
// Lockfile parity guard (v2.37.0 chore).
//
// This repo carries BOTH bun.lock (CI installs + bun run) and
// package-lock.json (npm install parity). The drift that has repeatedly
// burned time is the half-regeneration: a dependency is added or bumped and
// only one lockfile is updated, so `bun install --frozen-lockfile` in CI
// resolves a DIFFERENT dependency set than `npm ci` would locally.
//
// This check walks package.json's dependencies + devDependencies and asserts
// each package is present in BOTH lockfiles. It deliberately does NOT
// compare exact versions (the two resolvers format versions differently);
// a missing entry is the failure mode that actually breaks installs.
//
// Exit 1 with a list of missing packages; run `bun install` then
// `npm install` after any dependency change to regenerate both.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const self = pkg.name;

const missing = { bun: [], npm: [] };

if (!existsSync(join(ROOT, 'bun.lock'))) missing.bun.push('(bun.lock missing entirely)');
if (!existsSync(join(ROOT, 'package-lock.json'))) missing.npm.push('(package-lock.json missing entirely)');

const bunLock = existsSync(join(ROOT, 'bun.lock')) ? readFileSync(join(ROOT, 'bun.lock'), 'utf8') : '';
const npmLock = existsSync(join(ROOT, 'package-lock.json')) ? readFileSync(join(ROOT, 'package-lock.json'), 'utf8') : '';

for (const name of Object.keys(deps)) {
  if (name === self) continue;
  // bun.lock entries look like `"next@16.1.3"` or `"@prisma/client@6.19.2"`;
  // package-lock v3 keys look like `"node_modules/next"`.
  if (bunLock && !bunLock.includes(`"${name}@`)) missing.bun.push(name);
  if (npmLock && !npmLock.includes(`"node_modules/${name}"`)) missing.npm.push(name);
}

const bunMissing = missing.bun;
const npmMissing = missing.npm;

if (bunMissing.length === 0 && npmMissing.length === 0) {
  console.log(`Lockfile parity OK — ${Object.keys(deps).length} dependencies present in both bun.lock and package-lock.json.`);
  process.exit(0);
}

console.error('Lockfile drift detected — regenerate BOTH lockfiles after dependency changes:');
if (bunMissing.length) console.error(`  missing from bun.lock:  ${bunMissing.join(', ')}`);
if (npmMissing.length) console.error(`  missing from package-lock.json:  ${npmMissing.join(', ')}`);
console.error('  fix: run `bun install` AND `npm install`, then commit both lockfiles.');
process.exit(1);
