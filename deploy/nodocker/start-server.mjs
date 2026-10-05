#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS — standalone server launcher (no-Docker installs)
// Loads <repo>/.env into the environment, then runs the Next.js standalone
// server (.next/standalone/server.js). The standalone server does not read
// .env by itself, which is why this launcher exists.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} else {
  console.error('✗ .env not found in repo root. Run the installer first.');
  process.exit(1);
}

process.env.NODE_ENV = 'production';
process.env.PORT = process.env.PORT || process.env.APP_PORT || '3000';
process.env.HOSTNAME = process.env.HOSTNAME || '0.0.0.0';

const server = join(root, '.next', 'standalone', 'server.js');
if (!existsSync(server)) {
  console.error('✗ Build output missing (.next/standalone/server.js). Run the installer first.');
  process.exit(1);
}

console.log('──────────────────────────────────────────────────');
console.log('  MBUMAH HARDWARE POS');
console.log(`  →  http://localhost:${process.env.PORT}   (keep this window open)`);
console.log('──────────────────────────────────────────────────');

const child = spawn(process.execPath, [server], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
