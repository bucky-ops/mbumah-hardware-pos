#!/usr/bin/env node
// MBUMAH HARDWARE POS - Prepare the hermetic SQLite test database.
//
// WHY: src/tests/setup.ts force-points DATABASE_URL/DIRECT_URL at
// prisma/prisma/dev.db (absolute path) so the Vitest suite always runs
// against a real, seeded SQLite Prisma Client - the financial-accounting
// tests need actual journal-entry persistence. CI does this with an
// explicit "Prepare SQLite test database" step (mkdir + db:push + seed);
// locally the step was missing, so any fresh clone failed the 16
// DB-dependent tests with "Cannot find module / table does not exist".
//
// This script mirrors the CI step and is wired as the `pretest` npm
// lifecycle hook, making `bun run test` / `npm test` self-sufficient on a
// fresh clone. It is idempotent: existing databases are pushed (no-op when
// the schema matches) and the seed is upsert-safe, so re-running is cheap.
//
// Provider flip: setup-prisma-provider.mjs reads DATABASE_URL from the
// environment, so exporting a file: URL makes it switch the schema to
// sqlite (and strip @db.Decimal attributes) exactly like CI does. The
// ORIGINAL committed schema text (postgresql) is restored afterwards so
// `git status` stays clean - the generated client (already sqlite from
// this environment's postinstall) is what the tests actually import.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = resolve(root, 'prisma/prisma');
const dbPath = resolve(dbDir, 'dev.db');
const schemaPath = resolve(root, 'prisma/schema.prisma');

// Resolve the PINNED Prisma CLI (node_modules) - never `bunx`/`npx`, which
// can silently resolve a different major version (Prisma 7 rejects several
// prisma-6 flows and once pushed a schema without the new columns, leaving
// the seed to fail on missing columns).
function prismaCliPath() {
  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve('prisma/package.json');
    const pkg = req(pkgJson);
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.prisma;
    if (bin) return join(dirname(pkgJson), bin);
  } catch {
    // fall through to the npx fallback
  }
  return null;
}

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: `file:${dbPath}`,
      DIRECT_URL: `file:${dbPath}`,
      ...extraEnv,
    },
  });
  if (result.status !== 0) {
    console.error(`prepare-test-db: \`${cmd} ${args.join(' ')}\` failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

// 1. Ensure the database directory exists (gitignored, never committed).
mkdirSync(dbDir, { recursive: true });

// 2. Snapshot the committed schema so we can restore it after the flip.
const originalSchema = readFileSync(schemaPath, 'utf8');

try {
  // 3. Flip the schema provider to sqlite for the push/seed (env-driven).
  run('node', ['scripts/setup-prisma-provider.mjs']);

  // 4. Push the schema (no client regen - tests use the client generated
  //    at install time, which is already sqlite in this environment).
  //    With the resolved CLI bin the args omit the 'prisma' command name;
  //    the npx fallback keeps it.
  const cli = prismaCliPath();
  const cliArgs = (rest) => (cli ? rest : ['prisma', ...rest]);
  run(cli || 'npx', cliArgs(['db', 'push', '--skip-generate']));

  // 5. Seed the fixture data (upsert-safe, same as CI).
  run(cli || 'npx', cliArgs(['db', 'seed']));
} finally {
  // 6. Restore the committed postgresql schema text regardless of outcome
  //    so the working tree never shows a phantom schema modification.
  writeFileSync(schemaPath, originalSchema);
}

console.log(`prepare-test-db: ready (${dbPath})`);
