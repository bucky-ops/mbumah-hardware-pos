#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Prisma provider auto-detection
// ─────────────────────────────────────────────────────────────────────────────
//
// This script runs BEFORE `prisma generate` (in both `postinstall` and
// `vercel-build`) to set the correct `provider` in `prisma/schema.prisma`
// based on the DATABASE_URL scheme.
//
//   • file:./...        → provider = "sqlite"   (local dev)
//   • postgresql://...  → provider = "postgresql" (Vercel / Neon / Supabase)
//   • postgres://...    → provider = "postgresql"
//
// This allows a SINGLE schema.prisma + SINGLE codebase to target SQLite
// locally and PostgreSQL in production without manual provider swaps or
// environment-specific schema files. The script is idempotent: if the
// provider is already correct, the file is not rewritten.
//
// WHY THIS IS NEEDED:
//   Prisma generates a database-specific client at build time. If the schema
//   says `provider = "sqlite"` but the runtime DATABASE_URL is a PostgreSQL
//   URL, every query throws: "the URL must start with the protocol `file:`".
//   This was the root cause of the Vercel production 500 on /api/auth/login.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const schemaPath = join(process.cwd(), 'prisma', 'schema.prisma');

if (!existsSync(schemaPath)) {
  console.error('✗ prisma/schema.prisma not found at', schemaPath);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL || '';

// Detect the provider from the DATABASE_URL scheme.
// Default to "postgresql" when DATABASE_URL is unset. This happens during
// Vercel's install phase (before build env vars are injected) and during
// fresh `bun install` before .env exists. Defaulting to postgresql ensures
// the committed schema (provider=postgresql) is used as-is on Vercel,
// preventing the "URL must start with file:" runtime error that occurs
// when sqlite provider meets a postgresql DATABASE_URL. Local dev with
// SQLite MUST set DATABASE_URL=file:./... in .env so postinstall switches
// the provider correctly.
let provider = 'postgresql';
if (databaseUrl.startsWith('postgresql:') || databaseUrl.startsWith('postgres:')) {
  provider = 'postgresql';
} else if (databaseUrl.startsWith('file:')) {
  provider = 'sqlite';
}

const schema = readFileSync(schemaPath, 'utf8');

// Match the provider line inside the datasource block.
//   datasource db {
//     provider = "sqlite"      ← this line
//     url      = env("DATABASE_URL")
//   }
const providerRegex = /(\ndatasource\s+db\s+\{[\s\S]*?provider\s*=\s*")(sqlite|postgresql)(")/;

const match = schema.match(providerRegex);
if (!match) {
  console.error('✗ Could not find `datasource db { provider = "..." }` in schema.prisma');
  console.error('  Please check the schema file format.');
  process.exit(1);
}

const currentProvider = match[2];

if (currentProvider === provider) {
  console.log(`ℹ  Prisma provider already "${provider}" — no change needed.`);
} else {
  const updated = schema.replace(providerRegex, `$1${provider}$3`);
  writeFileSync(schemaPath, updated);
  console.log(`✓  Prisma provider updated: "${currentProvider}" → "${provider}"`);
  console.log(`   (detected from DATABASE_URL: ${databaseUrl ? databaseUrl.slice(0, 40) + '…' : '(unset, defaulted to sqlite)'})`);
}
