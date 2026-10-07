#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS — Database verifier (shared by all install paths)
// ============================================================================
// Answers ONE question with an exit code a script can act on:
//
//   "Does the database this install points at contain the seeded data?"
//
// Exit codes:
//   0  — connected AND users > 0 (seed present) → install/boot may proceed
//   10 — connected BUT users == 0 (schema pushed, never seeded)
//   1  — could not connect / client missing (schema missing or wrong URL)
//
// Used by:
//   • install-nodocker.ps1 / .sh  (BUILD 5/5 — fail the install if empty)
//   • docker-entrypoint.sh       (auto-seed when the DB is empty)
//   • start-pos.ps1 / .sh        (support: run manually to diagnose "backend
//                                 unavailable" on a laptop)
//
// Env resolution mirrors start-server.mjs: values from <repo>/.env OVERRIDE
// the inherited environment (the repo .env is the single source of truth for
// local installs). In the Docker runner there is no .env file, so compose
// environment variables are used as-is.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// ── Load .env (WINS over inherited env — same precedence as the launcher) ────
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

if (!process.env.DATABASE_URL) {
  console.error('[verify-db] ✗ DATABASE_URL is not set and no .env was found.');
  console.error('           Run the installer first, or set DATABASE_URL explicitly.');
  process.exit(1);
}

// ── Instantiate the generated Prisma client ──────────────────────────────────
// At install time the client lives in <root>/node_modules/.prisma/client; in
// the Docker runner image it lives in /app/node_modules/.prisma (copied with
// the standalone output). A plain import from the repo root resolves both.
let PrismaClient;
try {
  ({ PrismaClient } = await import('@prisma/client'));
} catch {
  console.error('[verify-db] ✗ @prisma/client not found — dependencies not installed?');
  process.exit(1);
}

const db = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

try {
  const [users, products] = await Promise.all([db.user.count(), db.product.count()]);

  if (users === 0) {
    console.log('[verify-db] ⚠  Database is reachable but EMPTY (0 users, ' + products + ' products).');
    console.log('             Schema exists but the seed never ran.');
    process.exit(10);
  }

  console.log(`[verify-db] ✓ Database OK — ${users} users, ${products} products.`);
  process.exit(0);
} catch (err) {
  const raw = String(err && err.message ? err.message : err);
  const firstLine = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || 'Unknown error';
  console.error('[verify-db] ✗ Could not query the database:');
  console.error('  ' + firstLine.slice(0, 300));
  process.exit(1);
} finally {
  await db.$disconnect().catch(() => {});
}
