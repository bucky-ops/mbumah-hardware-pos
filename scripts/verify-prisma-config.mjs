#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Prisma configuration self-check (v2.18.0.2)
// ============================================================================
// Guards the Prisma configuration against regressions:
//   1. prisma.config.ts exists and is the active configuration location
//      (package.json#prisma is deprecated and was removed in this release).
//   2. package.json no longer contains the deprecated "prisma" block.
//   3. Prisma and @prisma/client are pinned to the current STABLE line:
//      no prerelease/rc/dev tags, no major drift. The project must never be
//      auto-upgraded to a prerelease such as 8.0.0-rc.22 by an updater, a
//      script or CI - a major upgrade is its own planned feature release.
//   4. `prisma validate` passes for the schema flavor currently checked out.
//
// Exit 0 = all checks pass. Exit 1 = a check failed (CI red, fix before ship).
// ============================================================================

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const problems = [];

// -- 1. prisma.config.ts exists ----------------------------------------------
const configPath = join(root, 'prisma.config.ts');
if (!existsSync(configPath)) {
  problems.push('prisma.config.ts is missing - the seed command has nowhere to live.');
} else {
  const text = readFileSync(configPath, 'utf8');
  if (!text.includes('defineConfig')) {
    problems.push('prisma.config.ts does not use defineConfig from "prisma/config".');
  }
  if (!text.includes('schema.prisma')) {
    problems.push('prisma.config.ts does not point at the Prisma schema.');
  }
}

// -- 2. package.json block removed + 3. stable pin ----------------------------
const STABLE_MAJOR = 6; // bump ONLY as its own planned feature release
let pkg = null;
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
} catch (e) {
  problems.push(`package.json is not parsable: ${e.message}`);
}
if (pkg) {
  if (pkg.prisma !== undefined) {
    problems.push(
      'package.json still contains the deprecated "prisma" block - move the seed command to prisma.config.ts and delete the block.',
    );
  }
  const ranges = {
    '@prisma/client': pkg.dependencies ? pkg.dependencies['@prisma/client'] : undefined,
    prisma: pkg.devDependencies ? pkg.devDependencies.prisma : undefined,
  };
  for (const [name, range] of Object.entries(ranges)) {
    if (!range) {
      problems.push(`${name} is not declared in package.json.`);
      continue;
    }
    if (range.includes('-') || range.includes('rc') || range.includes('beta') || range.includes('dev')) {
      problems.push(`${name} is pinned to "${range}" - prerelease tags are never allowed (npm @latest/@next/8.0.0-rc.x must not creep in).`);
    }
    const major = Number(String(range).replace(/^[^\d]*/, '').split('.')[0]);
    if (!Number.isInteger(major)) {
      problems.push(`${name} range "${range}" has no parseable major version.`);
    } else if (major !== STABLE_MAJOR) {
      problems.push(
        `${name} is on major ${major} - this project stays on the stable ${STABLE_MAJOR}.x line. ` +
          'A major upgrade is its own planned feature release (docs/prisma-config.md).',
      );
    }
  }
}

// -- 4. prisma validate passes for the checked-out schema flavor --------------
if (problems.length === 0) {
  const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
  const providerMatch = schema.match(/provider\s*=\s*"(\w+)"/);
  const provider = providerMatch ? providerMatch[1] : 'unknown';
  // validate never connects, but the URL must parse for the schema's provider.
  const url =
    provider === 'sqlite'
      ? 'file:' + join(root, 'prisma', 'prisma', 'verify-prisma-config.db')
      : 'postgresql://verify:verify@localhost:5432/verify';
  const cli = join(root, 'node_modules', '.bin', 'prisma');
  const res = spawnSync(process.execPath, [cli, 'validate'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    timeout: 120000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  if (res.status !== 0) {
    problems.push(`prisma validate failed (provider ${provider}):\n${out.split('\n').slice(0, 12).join('\n')}`);
  } else if (/deprecated/i.test(out)) {
    problems.push('prisma validate still prints a deprecation warning about package.json#prisma.');
  } else {
    console.log(`[OK] prisma validate passed (schema provider: ${provider}).`);
  }
}

if (problems.length > 0) {
  console.error('');
  console.error('[FAIL] Prisma configuration self-check FAILED:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('');
console.log('[OK] Prisma configuration self-check passed: config file active, deprecated block gone, stable 6.x pin intact.');
